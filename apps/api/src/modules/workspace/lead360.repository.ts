import { Inject, Injectable } from '@nestjs/common';

import {
  DupRecordStatus,
  TaskStatus,
  type ConsentPurpose,
  type ConsentState,
  type ConsentStatus,
  type CreationChannel,
  type CustomerType,
  type DocStatus,
  type DupAction,
  type DupStatus,
  type EligibilityStatus,
  type KycCheckStatus,
  type KycStatus,
  type Lang,
  type LeadSource,
  type LeadStage,
  type MatchConfidence,
  type PartnerStatus,
  type PartnerType,
  type Priority,
  type ProductCode,
  type ScopePredicate,
  type ValidationStatus,
} from '@lms/shared';

import { KYSELY, type KyselyDb } from '../../core/db';
import { LeadScopeService, leadListBase } from './lead-scope.service';

/**
 * FR-051 per-section row caps (LLD §Data Operations steps 2–10). Every child
 * query is LIMIT-bounded; the consent fetch uses the platform list maximum
 * because the LLD de-duplicates latest-per-purpose in the application layer.
 */
export const STAGE_HISTORY_LIMIT = 20;
export const NOTES_LIMIT = 10;
export const DUPLICATE_MATCHES_LIMIT = 5;
export const CONSENT_FETCH_LIMIT = 100;
/** GROUP BY status returns at most one row per enum value; bounded defensively. */
export const STATUS_GROUP_LIMIT = 20;

/**
 * Core row (LLD step 1): lead + identity + profile + attribution + product
 * detail + branch/owner/team/partner display columns. Raw `name`/`mobile`/
 * `email` are fetched solely for the service's masked projection — never
 * serialised raw. `pan_token`/`aadhaar_ref_token`/`ckyc_id`/`address` are
 * NEVER selected (FR-002 §Masking).
 */
export interface Lead360CoreRow {
  lead_id: string;
  lead_code: string;
  stage: LeadStage;
  priority: Priority;
  is_hot: boolean;
  score: number | null;
  score_reasons: unknown;
  requested_amount: string | null;
  channel_created_by: CreationChannel;
  consent_status: ConsentStatus;
  kyc_status: KycStatus;
  duplicate_status: DupStatus;
  los_application_id: string | null;
  sla_first_contact_due_at: Date | null;
  reopened_count: number;
  nurture_next_at: Date | null;
  created_at: Date;
  updated_at: Date;
  version: number;
  product_code: ProductCode;
  branch_id: string | null;
  owner_id: string | null;
  team_id: string | null;
  lead_identity_id: string;
  name: string;
  mobile: string;
  email: string | null;
  pan_masked: string | null;
  gstin: string | null;
  dob: Date | null;
  preferred_language: Lang | null;
  customer_profile_id: string | null;
  display_name: string | null;
  customer_type: CustomerType | null;
  is_existing_customer: boolean | null;
  source: LeadSource;
  sub_source: string | null;
  partner_id: string | null;
  campaign_code: string | null;
  utm: unknown;
  lead_product_detail_id: string | null;
  product_config_id: string | null;
  attributes: unknown;
  validation_status: ValidationStatus | null;
  branch_name: string | null;
  owner_full_name: string | null;
  team_name: string | null;
  partner_code: string | null;
  partner_legal_name: string | null;
  partner_type: PartnerType | null;
  partner_status: PartnerStatus | null;
}

export interface Lead360StageHistoryRow {
  stage_history_id: string;
  from_stage: LeadStage | null;
  to_stage: LeadStage;
  actor_id: string;
  reason: string | null;
  occurred_at: Date;
}

export interface Lead360EligibilityRow {
  eligibility_snapshot_id: string;
  indicative_amount: string | null;
  tenure_months: number | null;
  rate_range: string | null;
  conditions: unknown;
  validity_until: Date | null;
  status: EligibilityStatus;
  created_at: Date;
}

export interface Lead360LosMirrorRow {
  los_mirror_id: string;
  los_application_id: string;
  status: string;
  status_date: Date;
}

export interface DocumentStatusCountRow {
  status: DocStatus;
  cnt: string;
}

export interface KycStatusCountRow {
  status: KycCheckStatus;
  cnt: string;
}

export interface Lead360ConsentRow {
  purpose: ConsentPurpose;
  state: ConsentState;
  created_at: Date;
}

export interface Lead360NoteRow {
  note_id: string;
  author_id: string;
  body: string;
  is_internal: boolean;
  created_at: Date;
}

export interface Lead360DuplicateMatchRow {
  duplicate_match_id: string;
  matched_lead_id: string;
  matched_lead_code: string;
  confidence: MatchConfidence;
  status: DupRecordStatus;
  action: DupAction;
}

/**
 * FR-051 — read-only Kysely queries for the Lead-360 aggregate (M6 reads
 * everything, writes NOTHING — architecture §11). Every query is parameterised
 * and LIMIT-bounded. The core fetch enforces the caller's ABAC scope IN SQL
 * (FR-050's `LeadScopeService` pattern — never post-filtered), so an
 * out-of-scope lead simply returns no row → the service maps it to 404
 * NOT_FOUND (existence hidden, BRD §8.4).
 *
 * The `build*` query assemblers are public for compile-level component tests
 * (FR-050 pattern: assert the SQL the deferred Testcontainers tier would run).
 */
@Injectable()
export class Lead360Repository {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    private readonly scope: LeadScopeService,
  ) {}

  /** Step 1 — lead core + joins, org-bound, soft-delete-aware, scope-in-SQL. */
  async fetchCore(
    orgId: string,
    predicate: ScopePredicate | undefined,
    leadId: string,
  ): Promise<Lead360CoreRow | undefined> {
    return this.buildCoreQuery(orgId, predicate, leadId).executeTakeFirst();
  }

  buildCoreQuery(orgId: string, predicate: ScopePredicate | undefined, leadId: string) {
    return this.scope
      .applyScope(leadListBase(this.db, orgId), predicate)
      .leftJoin('customer_profiles as cp', 'cp.customer_profile_id', 'l.customer_profile_id')
      .leftJoin('lead_product_details as lpd', 'lpd.lead_id', 'l.lead_id')
      .leftJoin('branches as b', 'b.branch_id', 'l.branch_id')
      .leftJoin('users as owner', 'owner.user_id', 'l.owner_id')
      .leftJoin('teams as t', 't.team_id', 'l.team_id')
      .where('l.lead_id', '=', leadId)
      .select([
        'l.lead_id',
        'l.lead_code',
        'l.stage',
        'l.priority',
        'l.is_hot',
        'l.score',
        'l.score_reasons',
        'l.requested_amount',
        'l.channel_created_by',
        'l.consent_status',
        'l.kyc_status',
        'l.duplicate_status',
        'l.los_application_id',
        'l.sla_first_contact_due_at',
        'l.reopened_count',
        'l.nurture_next_at',
        'l.created_at',
        'l.updated_at',
        'l.version',
        'l.product_code',
        'l.branch_id',
        'l.owner_id',
        'l.team_id',
        'li.lead_identity_id',
        'li.name',
        'li.mobile',
        'li.email',
        'li.pan_masked',
        'li.gstin',
        'li.dob',
        'li.preferred_language',
        'cp.customer_profile_id',
        'cp.display_name',
        'cp.customer_type',
        'cp.is_existing_customer',
        'sa.source',
        'sa.sub_source',
        'sa.partner_id',
        'sa.campaign_code',
        'sa.utm',
        'lpd.lead_product_detail_id',
        'lpd.product_config_id',
        'lpd.attributes',
        'lpd.validation_status',
        'b.name as branch_name',
        'owner.full_name as owner_full_name',
        't.name as team_name',
        'p.partner_code',
        'p.legal_name as partner_legal_name',
        'p.type as partner_type',
        'p.status as partner_status',
      ])
      .limit(1);
  }

  /** Step 2 — stage history, latest 20 desc. */
  async fetchStageHistory(leadId: string): Promise<Lead360StageHistoryRow[]> {
    return this.buildStageHistoryQuery(leadId).execute();
  }

  buildStageHistoryQuery(leadId: string) {
    return this.db
      .selectFrom('stage_history')
      .select(['stage_history_id', 'from_stage', 'to_stage', 'actor_id', 'reason', 'occurred_at'])
      .where('lead_id', '=', leadId)
      .orderBy('occurred_at', 'desc')
      .limit(STAGE_HISTORY_LIMIT);
  }

  /** Step 3 — latest eligibility snapshot (most recent created_at). */
  async fetchLatestEligibilitySnapshot(leadId: string): Promise<Lead360EligibilityRow | undefined> {
    return this.buildEligibilityQuery(leadId).executeTakeFirst();
  }

  buildEligibilityQuery(leadId: string) {
    return this.db
      .selectFrom('eligibility_snapshots')
      .select([
        'eligibility_snapshot_id',
        'indicative_amount',
        'tenure_months',
        'rate_range',
        'conditions',
        'validity_until',
        'status',
        'created_at',
      ])
      .where('lead_id', '=', leadId)
      .orderBy('created_at', 'desc')
      .limit(1);
  }

  /** Step 4 — latest LOS application mirror (most recent status_date). */
  async fetchLatestLosMirror(leadId: string): Promise<Lead360LosMirrorRow | undefined> {
    return this.buildLosMirrorQuery(leadId).executeTakeFirst();
  }

  buildLosMirrorQuery(leadId: string) {
    return this.db
      .selectFrom('los_application_mirrors')
      .select(['los_mirror_id', 'los_application_id', 'status', 'status_date'])
      .where('lead_id', '=', leadId)
      .orderBy('status_date', 'desc')
      .limit(1);
  }

  /** Step 5 — document counts by status (active documents only). */
  async fetchDocumentStatusCounts(leadId: string): Promise<DocumentStatusCountRow[]> {
    return this.buildDocumentCountsQuery(leadId).execute();
  }

  buildDocumentCountsQuery(leadId: string) {
    return this.db
      .selectFrom('documents')
      .select('status')
      .select((eb) => eb.fn.count<string>('document_id').as('cnt'))
      .where('lead_id', '=', leadId)
      .where('deleted_at', 'is', null)
      .groupBy('status')
      .limit(STATUS_GROUP_LIMIT);
  }

  /** Step 6 — KYC verification counts by status. */
  async fetchKycStatusCounts(leadId: string): Promise<KycStatusCountRow[]> {
    return this.buildKycCountsQuery(leadId).execute();
  }

  buildKycCountsQuery(leadId: string) {
    return this.db
      .selectFrom('kyc_verifications')
      .select('status')
      .select((eb) => eb.fn.count<string>('kyc_verification_id').as('cnt'))
      .where('lead_id', '=', leadId)
      .groupBy('status')
      .limit(STATUS_GROUP_LIMIT);
  }

  /** Step 7 — open task count (`status NOT IN (done, cancelled)`). */
  async fetchOpenTaskCount(leadId: string): Promise<number> {
    const row = await this.buildOpenTaskCountQuery(leadId).executeTakeFirst();
    return Number(row?.cnt ?? 0);
  }

  buildOpenTaskCountQuery(leadId: string) {
    return this.db
      .selectFrom('tasks')
      .select((eb) => eb.fn.count<string>('task_id').as('cnt'))
      .where('lead_id', '=', leadId)
      .where('status', 'not in', [TaskStatus.DONE, TaskStatus.CANCELLED]);
  }

  /**
   * Step 8 — consent rows, newest first, bounded by the platform list maximum;
   * the service reduces them to the latest state per purpose (LLD/TC-051-12).
   */
  async fetchConsentRows(leadId: string): Promise<Lead360ConsentRow[]> {
    return this.buildConsentRowsQuery(leadId).execute();
  }

  buildConsentRowsQuery(leadId: string) {
    return this.db
      .selectFrom('consent_records')
      .select(['purpose', 'state', 'created_at'])
      .where('lead_id', '=', leadId)
      .orderBy('created_at', 'desc')
      .limit(CONSENT_FETCH_LIMIT);
  }

  /** Step 9 — latest 10 notes desc; PARTNER callers see only non-internal notes. */
  async fetchNotes(leadId: string, externalOnly: boolean): Promise<Lead360NoteRow[]> {
    return this.buildNotesQuery(leadId, externalOnly).execute();
  }

  buildNotesQuery(leadId: string, externalOnly: boolean) {
    let query = this.db
      .selectFrom('notes')
      .select(['note_id', 'author_id', 'body', 'is_internal', 'created_at'])
      .where('lead_id', '=', leadId)
      .orderBy('created_at', 'desc')
      .limit(NOTES_LIMIT);
    if (externalOnly) {
      query = query.where('is_internal', '=', false);
    }
    return query;
  }

  /** Step 10 — open duplicate matches (max 5) with the matched lead's code.
   * `orgId` is threaded into the matched-lead join to prevent cross-org leaks
   * (Fix 3: ml.org_id constraint). */
  async fetchOpenDuplicateMatches(leadId: string, orgId: string): Promise<Lead360DuplicateMatchRow[]> {
    return this.buildDuplicateMatchesQuery(leadId, orgId).execute();
  }

  buildDuplicateMatchesQuery(leadId: string, orgId: string) {
    return this.db
      .selectFrom('duplicate_matches as dm')
      .innerJoin('leads as ml', 'ml.lead_id', 'dm.matched_lead_id')
      .select([
        'dm.duplicate_match_id',
        'dm.matched_lead_id',
        'ml.lead_code as matched_lead_code',
        'dm.confidence',
        'dm.status',
        'dm.action',
      ])
      .where('dm.lead_id', '=', leadId)
      .where('dm.status', '=', DupRecordStatus.OPEN)
      .where('ml.org_id', '=', orgId)
      .limit(DUPLICATE_MATCHES_LIMIT);
  }
}
