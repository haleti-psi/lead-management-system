import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';
import { sql } from 'kysely';

import { AuditAction, DataCategory, LeadOutcome, LeadStage, type RetentionAction } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { AppConfigService } from '../../core/config';
import { KYSELY, UnitOfWork, type KyselyDb } from '../../core/db';
import { LeadService } from '../capture/lead.service';
import type { DryRunCategoryCount, DryRunPreview, RetentionMode } from './retention-policy.dto';
import type { RetentionPolicyRow } from './retention-policy.repository';

/**
 * The system actor UUID used by all background jobs in this system.
 * Corresponds to 00000000-0000-0000-0000-000000000000 per LLD §Auth.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

/** Default batch size if env var is absent. */
const DEFAULT_BATCH_SIZE = 100;

/**
 * Upper bound on the number of orgs enumerated in one autonomous sweep — keeps
 * the org-enumeration query bounded (never an unlimited scan).
 */
const ORG_SWEEP_LIMIT = 1000;

/** Terminal lead stages by outcome (per LLD §Data Operations). */
const OUTCOME_STAGE_MAP: Record<LeadOutcome, LeadStage[]> = {
  [LeadOutcome.REJECTED]: ['rejected'],
  [LeadOutcome.HANDED_OFF]: ['handed_off'],
  [LeadOutcome.DORMANT]: ['dormant'],
  [LeadOutcome.ANY]: ['rejected', 'handed_off', 'dormant'],
};

export interface LeadCandidate {
  lead_id: string;
  lead_identity_id: string;
  customer_profile_id: string | null;
  terminal_at: Date;
}


/**
 * FR-115 RetentionEngine — owned by M12 Compliance.
 *
 * Provides:
 * - `dryRun(orgId, dataCategory?)` — read-only preview of what would be processed.
 * - `applyRun(runId, orgId, dataCategory?)` — applies purge/anonymise in bounded batches.
 *
 * Hard rules:
 * - NEVER purges or anonymises a lead with `legal_hold=true` on any active policy.
 * - NEVER touches leads with open `DataRightsRequest` or `Grievance`.
 * - Every write is in its own per-lead `UnitOfWork` tx; a failure rolls back only that lead.
 * - Audit record is written inside the same tx as the data change.
 * - `audit_logs`, `consent_records`, and `stage_history` are NEVER modified.
 * - Batches are bounded to `RETENTION_BATCH_SIZE` (default 100).
 */
@Injectable()
export class RetentionEngine {
  private readonly batchSize: number;

  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
    private readonly leadService: LeadService,
    _config: AppConfigService,
    @InjectPinoLogger(RetentionEngine.name) private readonly logger: PinoLogger,
  ) {
    // RETENTION_BATCH_SIZE is optional — default 100 per environment-contract.md
    const raw = process.env['RETENTION_BATCH_SIZE'];
    const parsed = raw ? parseInt(raw, 10) : NaN;
    this.batchSize = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
  }

  // ─────────────────────────────────────────────────────────────── dry-run ──

  /**
   * Preview what would be processed; ZERO writes.
   */
  async dryRun(orgId: string, dataCategory?: DataCategory): Promise<DryRunPreview> {
    const policies = await this.getActivePolicies(orgId, dataCategory);
    const legalHoldCategories = new Set(
      policies.filter((p) => p.legal_hold).map((p) => p.data_category),
    );

    // open-DRR / open-grievance exclusion is now inside fetchCandidates via NOT EXISTS;
    // no separate pre-fetch needed (BLOCKER 1 fixed).
    // blocked_by_open_request is 0 for dry-run preview because fetchCandidates already
    // excludes those leads — they do not appear in the candidate set at all.

    let totalEligible = 0;
    let blockedByLegalHold = 0;
    const byCategory: DryRunCategoryCount[] = [];

    for (const policy of policies) {
      if (policy.legal_hold) {
        // Count candidates (without open-request filter applied here, for preview accuracy)
        const candidates = await this.fetchCandidatesForLegalHoldCount(orgId, policy);
        blockedByLegalHold += candidates.length;
        continue;
      }

      // Policies whose category has a legal-hold policy active
      if (legalHoldCategories.has(policy.data_category)) {
        const candidates = await this.fetchCandidatesForLegalHoldCount(orgId, policy);
        blockedByLegalHold += candidates.length;
        continue;
      }

      // fetchCandidates already excludes open-DRR and open-grievance leads atomically
      const candidates = await this.fetchCandidates(orgId, policy);

      if (candidates.length > 0) {
        totalEligible += candidates.length;
        byCategory.push({
          data_category: policy.data_category as DataCategory,
          action: policy.action as RetentionAction,
          count: candidates.length,
        });
      }
    }

    return {
      eligible_leads: totalEligible,
      by_category: byCategory,
      blocked_by_legal_hold: blockedByLegalHold,
      blocked_by_open_request: 0, // excluded upstream in fetchCandidates NOT EXISTS
    };
  }

  // ─────────────────────────────────────────────────────────────── apply ──

  /**
   * Execute purge/anonymise for all eligible leads.
   * Each lead is processed in its own UnitOfWork transaction; failures roll back
   * only that lead and are logged; processing continues.
   */
  async applyRun(runId: string, orgId: string, dataCategory?: DataCategory): Promise<void> {
    const policies = await this.getActivePolicies(orgId, dataCategory);
    const legalHoldCategories = new Set(
      policies.filter((p) => p.legal_hold).map((p) => p.data_category),
    );

    // open-DRR / open-grievance exclusion is now inside fetchCandidates via NOT EXISTS;
    // no separate pre-fetch needed (BLOCKER 1 fixed).

    let processed = 0;
    let failed = 0;

    for (const policy of policies) {
      if (policy.legal_hold || legalHoldCategories.has(policy.data_category)) {
        this.logger.info(
          { policyId: policy.retention_policy_id, category: policy.data_category },
          'Skipping policy: legal hold active',
        );
        continue;
      }

      // fetchCandidates atomically excludes open-DRR and open-grievance leads;
      // every returned candidate is safe to process (BLOCKER 1 fixed).
      // distinctOn guarantees each lead appears at most once (BLOCKER 2 fixed).
      const candidates = await this.fetchCandidates(orgId, policy);

      for (const candidate of candidates) {
        try {
          await this.processLead(runId, candidate, policy, orgId, 'apply');
          processed++;
        } catch (err) {
          failed++;
          // Log with correlation context; no PII values
          this.logger.error(
            { leadId: candidate.lead_id, policyId: policy.retention_policy_id, err },
            'Retention apply failed for lead; skipping to next',
          );
        }
      }
    }

    this.logger.info(
      { runId, orgId, processed, failed },
      'Retention apply-run complete',
    );
  }

  // ───────────────────────────────────────────────── all-orgs sweep ──

  /**
   * Autonomous retention sweep across every org that has an active policy.
   *
   * Driven by Cloud Scheduler → Cloud Tasks (see `RetentionSweepController`) with
   * NO user context, so it enumerates the orgs itself (bounded by
   * {@link ORG_SWEEP_LIMIT}) and runs the per-org {@link applyRun} for each. One
   * org failing is logged and never aborts the rest of the sweep — mirroring the
   * per-lead resilience already inside `applyRun`. Returns how many orgs were
   * swept successfully.
   */
  async sweepAllOrgs(runId: string): Promise<{ orgsSwept: number }> {
    const orgIds = await this.findOrgIdsWithActivePolicies();
    let orgsSwept = 0;

    for (const orgId of orgIds) {
      try {
        await this.applyRun(runId, orgId);
        orgsSwept++;
      } catch (err) {
        this.logger.error(
          { runId, orgId, err },
          'Retention sweep failed for org; continuing to next org',
        );
      }
    }

    this.logger.info(
      { runId, orgsSwept, orgsFound: orgIds.length },
      'Retention all-orgs sweep complete',
    );
    return { orgsSwept };
  }

  /**
   * Distinct org_ids that have at least one active retention policy. Bounded by
   * {@link ORG_SWEEP_LIMIT} so the enumeration is never an unlimited scan.
   */
  private async findOrgIdsWithActivePolicies(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('retention_policies')
      .select('org_id')
      .distinct()
      .where('is_active', '=', true)
      .orderBy('org_id')
      .limit(ORG_SWEEP_LIMIT)
      .execute();

    return rows.map((r) => r.org_id);
  }

  // ─────────────────────────────────────────── Per-lead transaction ──

  private async processLead(
    runId: string,
    candidate: LeadCandidate,
    policy: RetentionPolicyRow,
    orgId: string,
    mode: RetentionMode,
  ): Promise<void> {
    await this.uow.run(async (tx) => {
      const category = policy.data_category as DataCategory;

      if (policy.action === 'anonymise') {
        await this.anonymise(category, candidate, tx);
      } else {
        await this.purge(category, candidate, tx);
      }

      await this.audit.append(
        {
          action: AuditAction.LEAD_UPDATE,
          entity_type: 'retention_run',
          entity_id: runId,
          actor_id: SYSTEM_ACTOR_ID,
          org_id: orgId,
          lead_id: candidate.lead_id,
          detail: {
            retention_policy_id: policy.retention_policy_id,
            data_category: category,
            action_taken: policy.action,
            run_mode: mode,
          },
        },
        tx,
      );
    });
  }

  // ────────────────────────────────────────────────────── Anonymise ──

  private async anonymise(
    category: DataCategory,
    lead: LeadCandidate,
    tx: Parameters<Parameters<UnitOfWork['run']>[0]>[0],
  ): Promise<void> {
    switch (category) {
      case DataCategory.IDENTITY:
        await tx
          .updateTable('lead_identities')
          .set({
            name: 'ANONYMISED',
            // Must satisfy ck_lead_identities_mobile (`^[6-9][0-9]{9}$`); a plain
            // zero string violates it. No uniqueness constraint on this column.
            mobile: '9000000000',
            email: null,
            pan_token: null,
            pan_masked: null,
            ckyc_id: null,
            gstin: null,
            dob: null,
            aadhaar_ref_token: null,
            address: null,
            updated_at: new Date(),
            updated_by: SYSTEM_ACTOR_ID,
          })
          .where('lead_identity_id', '=', lead.lead_identity_id)
          .execute();
        break;

      case DataCategory.CONTACT:
        if (lead.customer_profile_id) {
          await tx
            .updateTable('customer_profiles')
            .set({
              // Must satisfy ck_customer_profiles_mobile (`^[6-9][0-9]{9}$`) AND
              // uq_customer_profiles_mobile (org_id, primary_mobile) — a constant
              // would violate both, so derive a valid, per-row-unique scrubbed value.
              primary_mobile: sql`'9' || lpad((abs(hashtext(customer_profile_id::text)) % 1000000000)::text, 9, '0')`,
              display_name: 'ANONYMISED',
              address: null,
              deleted_at: new Date(),
              updated_at: new Date(),
              updated_by: SYSTEM_ACTOR_ID,
            })
            .where('customer_profile_id', '=', lead.customer_profile_id)
            .execute();
        }
        break;

      case DataCategory.FINANCIAL:
        await tx
          .updateTable('lead_product_details')
          .set({
            attributes: sql`'{}'::jsonb`,
            updated_at: new Date(),
            updated_by: SYSTEM_ACTOR_ID,
          })
          .where('lead_id', '=', lead.lead_id)
          .execute();
        break;

      case DataCategory.BEHAVIOURAL:
        await tx
          .updateTable('communication_logs')
          .set({
            recipient: 'ANONYMISED',
            updated_at: new Date(),
            updated_by: SYSTEM_ACTOR_ID,
          })
          .where('lead_id', '=', lead.lead_id)
          .execute();
        break;

      case DataCategory.KYC_DOC:
        // For anonymise action on kyc_doc: nullify kyc_verifications sensitive fields
        await tx
          .updateTable('kyc_verifications')
          .set({
            masked_response: null,
            reference: null,
            updated_at: new Date(),
            updated_by: SYSTEM_ACTOR_ID,
          })
          .where('lead_id', '=', lead.lead_id)
          .execute();
        break;

      case DataCategory.CONSENT:
        // NEVER touched — consent records are retention-exempt per BRD §5.2
        break;

      case DataCategory.ASSET:
        // Asset category — no specific PII table defined in LLD; no-op
        break;

      default:
        break;
    }
  }

  // ──────────────────────────────────────────────────────── Purge ──

  private async purge(
    category: DataCategory,
    lead: LeadCandidate,
    tx: Parameters<Parameters<UnitOfWork['run']>[0]>[0],
  ): Promise<void> {
    switch (category) {
      case DataCategory.KYC_DOC: {
        // Soft-delete documents and nullify storage_ref inside the DB transaction.
        // GCS object deletion is deferred: no GCS delete port exists yet (FR-115-A2 in
        // AMBIGUITY.md). A structured warn is logged per lead so orphaned objects are
        // traceable in Cloud Logging. No PII is logged.
        await tx
          .updateTable('documents')
          .set({
            storage_ref: null,
            deleted_at: new Date(),
            updated_at: new Date(),
            updated_by: SYSTEM_ACTOR_ID,
          })
          .where('lead_id', '=', lead.lead_id)
          .execute();

        this.logger.warn(
          { leadId: lead.lead_id },
          'kyc_doc purge: GCS object deletion deferred (no delete port) — storage_ref nulled in DB; object may be orphaned until reconciliation sweep',
        );

        await tx
          .updateTable('kyc_verifications')
          .set({
            masked_response: null,
            reference: null,
            updated_at: new Date(),
            updated_by: SYSTEM_ACTOR_ID,
          })
          .where('lead_id', '=', lead.lead_id)
          .execute();
        break;
      }

      case DataCategory.IDENTITY:
        // Purge action on identity: anonymise PII + soft-delete the lead.
        // The `leads` write goes through LeadService (sole writer, §11); it bumps
        // version so a concurrent optimistic-lock read detects the deletion.
        await this.anonymise(category, lead, tx);
        await this.leadService.softDeleteForRetention(lead.lead_id, SYSTEM_ACTOR_ID, tx);
        break;

      default:
        // For other categories, fall back to anonymise behaviour
        await this.anonymise(category, lead, tx);
        break;
    }
  }

  // ──────────────────────────────────────────────────── Helpers ──

  private async getActivePolicies(orgId: string, dataCategory?: DataCategory): Promise<RetentionPolicyRow[]> {
    // MINOR 7: use a dedicated large limit (1000) — batchSize (100) silently
    // truncates when more than 100 policies exist.
    const POLICY_FETCH_LIMIT = 1000;

    let query = this.db
      .selectFrom('retention_policies')
      .selectAll()
      .where('org_id', '=', orgId)
      .where('is_active', '=', true)
      .limit(POLICY_FETCH_LIMIT);

    if (dataCategory !== undefined) {
      query = query.where('data_category', '=', dataCategory);
    }

    const rows = await query.execute();
    return rows as unknown as RetentionPolicyRow[];
  }

  /**
   * Variant of fetchCandidates used only by dry-run legal-hold counting.
   * Omits open-DRR / open-grievance exclusion so the reported
   * blocked_by_legal_hold count includes all candidates the policy would
   * have otherwise seen (mirrors original intent).
   */
  private async fetchCandidatesForLegalHoldCount(
    orgId: string,
    policy: RetentionPolicyRow,
  ): Promise<LeadCandidate[]> {
    const outcome = (policy.lead_outcome ?? LeadOutcome.ANY) as LeadOutcome;
    const outcomeStages = OUTCOME_STAGE_MAP[outcome];
    const cutoff = new Date(Date.now() - policy.retain_days * 24 * 60 * 60 * 1000);

    const rows = await this.db
      .selectFrom('leads as l')
      .innerJoin('stage_history as sh', (join) =>
        join
          .onRef('sh.lead_id', '=', 'l.lead_id')
          .on('sh.to_stage', 'in', outcomeStages as [LeadStage, ...LeadStage[]]),
      )
      .distinctOn('l.lead_id')
      .select([
        'l.lead_id',
        'l.lead_identity_id',
        'l.customer_profile_id',
        'sh.created_at as terminal_at',
      ])
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .where('sh.created_at', '<', cutoff)
      .orderBy('l.lead_id')
      .limit(this.batchSize)
      .execute();

    return rows.map((r) => ({
      lead_id: r.lead_id,
      lead_identity_id: r.lead_identity_id,
      customer_profile_id: r.customer_profile_id,
      terminal_at: r.terminal_at as unknown as Date,
    }));
  }

  /**
   * Fetch at most `batchSize` distinct candidate leads for a given policy.
   *
   * Correctness guarantees:
   * - `distinctOn('l.lead_id')` eliminates duplicates caused by multiple
   *   matching stage_history rows per lead (BLOCKER 2).
   * - NOT EXISTS correlated subqueries for open data_rights_requests and
   *   open grievances are org_id-scoped and carry no LIMIT — a safety filter
   *   must never be truncatable (BLOCKER 1 / MAJOR 3).
   */
  private async fetchCandidates(orgId: string, policy: RetentionPolicyRow): Promise<LeadCandidate[]> {
    const outcome = (policy.lead_outcome ?? LeadOutcome.ANY) as LeadOutcome;
    const outcomeStages = OUTCOME_STAGE_MAP[outcome];
    const cutoff = new Date(Date.now() - policy.retain_days * 24 * 60 * 60 * 1000);

    const rows = await this.db
      .selectFrom('leads as l')
      .innerJoin('stage_history as sh', (join) =>
        join
          .onRef('sh.lead_id', '=', 'l.lead_id')
          .on('sh.to_stage', 'in', outcomeStages as [LeadStage, ...LeadStage[]]),
      )
      // BLOCKER 2: one row per lead regardless of how many matching stage_history rows exist
      .distinctOn('l.lead_id')
      .select([
        'l.lead_id',
        'l.lead_identity_id',
        'l.customer_profile_id',
        'sh.created_at as terminal_at',
      ])
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null)
      .where('sh.created_at', '<', cutoff)
      // BLOCKER 1 / MAJOR 3: atomic, org-scoped, unlimited open-DRR exclusion
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('data_rights_requests as drr')
              .select(sql<number>`1`.as('one'))
              .where('drr.lead_id', '=', eb.ref('l.lead_id'))
              .where('drr.org_id', '=', orgId)
              .where('drr.status', 'in', ['open', 'in_review']),
          ),
        ),
      )
      // BLOCKER 1 / MAJOR 3: atomic, org-scoped, unlimited open-grievance exclusion
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('grievances as g')
              .select(sql<number>`1`.as('one'))
              .where('g.lead_id', '=', eb.ref('l.lead_id'))
              .where('g.org_id', '=', orgId)
              .where('g.status', 'in', ['open', 'in_progress', 'escalated']),
          ),
        ),
      )
      .orderBy('l.lead_id')
      .limit(this.batchSize)
      .execute();

    return rows.map((r) => ({
      lead_id: r.lead_id,
      lead_identity_id: r.lead_identity_id,
      customer_profile_id: r.customer_profile_id,
      terminal_at: r.terminal_at as unknown as Date,
    }));
  }
}
