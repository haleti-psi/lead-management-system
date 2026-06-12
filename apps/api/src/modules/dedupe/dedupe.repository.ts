import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import type {
  DupAction,
  DupRecordStatus,
  DupStatus,
  LeadSource,
  LeadStage,
  MatchConfidence,
  ProductCode,
} from '@lms/shared';

import type { DbTransaction, KyselyDb } from '../../core/db';
import { EXISTING_PAIR_LIMIT, PER_KEY_CANDIDATE_LIMIT } from './dedupe.constants';

/**
 * The checked lead + its identity + source attribution (FR-020 LLD §Step 1).
 * Loaded once per check; provides every match key and the scope attributes the
 * row-level ABAC check needs.
 */
export interface DedupeLeadContext {
  lead_id: string;
  org_id: string;
  lead_code: string;
  stage: LeadStage;
  branch_id: string | null;
  owner_id: string | null;
  team_id: string | null;
  duplicate_status: DupStatus;
  version: number;
  product_code: ProductCode;
  pin_code: string | null;
  master_lead_id: string | null;
  lead_identity_id: string;
  mobile: string;
  pan_token: string | null;
  ckyc_id: string | null;
  gstin: string | null;
  name: string;
  source: LeadSource | null;
  partner_id: string | null;
}

/** One candidate row from a key-match query (LLD §Step 2 select list). */
export interface CandidateLeadRow {
  lead_id: string;
  lead_code: string;
  stage: LeadStage;
  master_lead_id: string | null;
  /** Master's code joined in one pass (merged-master resolution, T08). */
  master_lead_code: string | null;
  branch_id: string | null;
  pin_code: string | null;
  product_code: ProductCode;
  mobile: string;
  pan_token: string | null;
  name: string;
  pan_masked: string | null;
}

/** Pre-existing `duplicate_matches` row state (idempotent re-check, T23). */
export interface ExistingMatchRow {
  duplicate_match_id: string;
  matched_lead_id: string;
  confidence: MatchConfidence;
  action: DupAction;
  status: DupRecordStatus;
}

/**
 * Snapshot of one `duplicate_matches` row for the merging pair, taken BEFORE
 * the merge resolves it (FR-021). Stored in the merge `audit_logs.detail` so
 * unmerge can restore the row's pre-merge action — re-opening with
 * `action='merged'` left behind would poison FR-020's recompute (an open
 * `merged` row derives `duplicate_status='merged'`).
 */
export interface PairMatchSnapshot {
  duplicate_match_id: string;
  action: DupAction;
  status: DupRecordStatus;
  action_by: string | null;
  action_reason: string | null;
}

/** Values for one upserted `duplicate_matches` row (LLD §Step 3). */
export interface UpsertMatchValues {
  org_id: string;
  lead_id: string;
  matched_lead_id: string;
  confidence: MatchConfidence;
  matched_on: readonly string[];
  action: DupAction;
  action_by: string | null;
  action_reason: string | null;
  actor_id: string;
}

/**
 * FR-020 — Kysely access for M3 dedupe. The SOLE writer of `duplicate_matches`
 * (auth-matrix `resource_governance`: system_managed, owning service writes).
 * All reads against `lead_identities`/`leads` are parameterised, org-scoped,
 * soft-delete-filtered and capped at {@link PER_KEY_CANDIDATE_LIMIT} per key
 * (performance.md LIMIT rule).
 */
@Injectable()
export class DedupeRepository {
  /** LLD §Step 1 — lead + identity (+ source) with org scope; undefined → 404. */
  async findLeadContext(
    leadId: string,
    orgId: string | null,
    db: KyselyDb,
  ): Promise<DedupeLeadContext | undefined> {
    let query = db
      .selectFrom('leads as l')
      .innerJoin('lead_identities as li', 'li.lead_identity_id', 'l.lead_identity_id')
      .leftJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .select([
        'l.lead_id',
        'l.org_id',
        'l.lead_code',
        'l.stage',
        'l.branch_id',
        'l.owner_id',
        'l.team_id',
        'l.duplicate_status',
        'l.version',
        'l.product_code',
        'l.pin_code',
        'l.master_lead_id',
        'li.lead_identity_id',
        'li.mobile',
        'li.pan_token',
        'li.ckyc_id',
        'li.gstin',
        'li.name',
        'sa.source',
        'sa.partner_id',
      ])
      .where('l.lead_id', '=', leadId)
      .where('l.deleted_at', 'is', null);
    if (orgId !== null) {
      query = query.where('l.org_id', '=', orgId);
    }
    return query.limit(1).executeTakeFirst();
  }

  /** Exact PAN-token match (`ix_lead_identities_pan`). */
  async findByPan(
    panToken: string,
    orgId: string,
    excludeLeadId: string | null,
    db: KyselyDb,
  ): Promise<CandidateLeadRow[]> {
    return this.candidateQuery(db, orgId, excludeLeadId)
      .where('li.pan_token', '=', panToken)
      .limit(PER_KEY_CANDIDATE_LIMIT)
      .execute();
  }

  /** Exact mobile match (`ix_lead_identities_mobile`). */
  async findByMobile(
    mobile: string,
    orgId: string,
    excludeLeadId: string | null,
    db: KyselyDb,
  ): Promise<CandidateLeadRow[]> {
    return this.candidateQuery(db, orgId, excludeLeadId)
      .where('li.mobile', '=', mobile)
      .limit(PER_KEY_CANDIDATE_LIMIT)
      .execute();
  }

  /** Exact CKYC-id match (`ix_lead_identities_ckyc`). */
  async findByCkyc(
    ckycId: string,
    orgId: string,
    excludeLeadId: string | null,
    db: KyselyDb,
  ): Promise<CandidateLeadRow[]> {
    return this.candidateQuery(db, orgId, excludeLeadId)
      .where('li.ckyc_id', '=', ckycId)
      .limit(PER_KEY_CANDIDATE_LIMIT)
      .execute();
  }

  /** GSTIN + same product (business-asset proxy, AMBIGUITIES.md A5 / LLD §Step 2). */
  async findByGstin(
    gstin: string,
    productCode: ProductCode,
    orgId: string,
    excludeLeadId: string | null,
    db: KyselyDb,
  ): Promise<CandidateLeadRow[]> {
    return this.candidateQuery(db, orgId, excludeLeadId)
      .where('li.gstin', '=', gstin)
      .where('l.product_code', '=', productCode)
      .limit(PER_KEY_CANDIDATE_LIMIT)
      .execute();
  }

  /**
   * Trigram-fuzzy name + same pin + same source (weak signal; GIN index
   * `ix_lead_identities_name_trgm`). `sql` is used ONLY for the `%` similarity
   * operator fragment — the name value itself stays a bound parameter.
   */
  async findByFuzzyName(
    name: string,
    pinCode: string,
    source: LeadSource,
    orgId: string,
    excludeLeadId: string | null,
    db: KyselyDb,
  ): Promise<CandidateLeadRow[]> {
    return this.candidateQuery(db, orgId, excludeLeadId)
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .where(sql<boolean>`${sql.ref('li.name')} % ${name}`)
      .where('l.pin_code', '=', pinCode)
      .where('sa.source', '=', source)
      .limit(PER_KEY_CANDIDATE_LIMIT)
      .execute();
  }

  /**
   * Current rows for the (lead, matched) pairs about to be upserted — drives
   * the idempotent-re-check gate (T23/INV-07: an identical re-check must not
   * duplicate audit/outbox rows).
   */
  async findExistingMatches(
    leadId: string,
    matchedLeadIds: readonly string[],
    orgId: string,
    db: KyselyDb,
  ): Promise<Map<string, ExistingMatchRow>> {
    if (matchedLeadIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .selectFrom('duplicate_matches')
      .select(['duplicate_match_id', 'matched_lead_id', 'confidence', 'action', 'status'])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('matched_lead_id', 'in', [...matchedLeadIds])
      .limit(EXISTING_PAIR_LIMIT)
      .execute();
    return new Map(rows.map((row) => [row.matched_lead_id, row]));
  }

  /**
   * LLD §Step 3 — upsert one row per unique matched lead inside the caller's
   * UnitOfWork transaction. `uq_dup_pair` makes the re-check idempotent: the
   * existing row is refreshed (confidence/matched_on/action/actor, status back
   * to `open`, `updated_at` bumped) instead of duplicated. Returns
   * matched_lead_id → duplicate_match_id for the response payload.
   */
  async upsertMatches(
    values: readonly UpsertMatchValues[],
    tx: DbTransaction,
  ): Promise<Map<string, string>> {
    if (values.length === 0) {
      return new Map();
    }
    const rows = await tx
      .insertInto('duplicate_matches')
      .values(
        values.map((v) => ({
          org_id: v.org_id,
          lead_id: v.lead_id,
          matched_lead_id: v.matched_lead_id,
          confidence: v.confidence,
          matched_on: JSON.stringify(v.matched_on),
          action: v.action,
          action_by: v.action_by,
          action_reason: v.action_reason,
          status: 'open' as const,
          created_by: v.actor_id,
          updated_by: v.actor_id,
        })),
      )
      .onConflict((oc) =>
        oc.constraint('uq_dup_pair').doUpdateSet({
          confidence: (eb) => eb.ref('excluded.confidence'),
          matched_on: (eb) => eb.ref('excluded.matched_on'),
          action: (eb) => eb.ref('excluded.action'),
          action_by: (eb) => eb.ref('excluded.action_by'),
          action_reason: (eb) => eb.ref('excluded.action_reason'),
          status: 'open',
          updated_by: (eb) => eb.ref('excluded.updated_by'),
          updated_at: new Date(),
        }),
      )
      .returning(['duplicate_match_id', 'matched_lead_id'])
      .execute();
    return new Map(rows.map((row) => [row.matched_lead_id, row.duplicate_match_id]));
  }

  // ─────────────────────────────── FR-021 merge pair transitions ────────────

  /**
   * FR-021 — the `duplicate_matches` rows linking the merging pair (both
   * directions), snapshotted before the merge resolves them. Bounded by
   * {@link EXISTING_PAIR_LIMIT} (LIMIT rule).
   */
  async findPairMatches(
    leadId: string,
    matchedLeadId: string,
    orgId: string,
    db: KyselyDb,
  ): Promise<PairMatchSnapshot[]> {
    return db
      .selectFrom('duplicate_matches')
      .select(['duplicate_match_id', 'action', 'status', 'action_by', 'action_reason'])
      .where('org_id', '=', orgId)
      .where((eb) =>
        eb.or([
          eb.and([eb('lead_id', '=', leadId), eb('matched_lead_id', '=', matchedLeadId)]),
          eb.and([eb('lead_id', '=', matchedLeadId), eb('matched_lead_id', '=', leadId)]),
        ]),
      )
      .limit(EXISTING_PAIR_LIMIT)
      .execute();
  }

  /**
   * FR-021 LLD §Merge step 7 — resolve every `duplicate_matches` row linking
   * the pair: `status='resolved'`, `action='merged'`, `action_by`/`action_reason`
   * recorded (state-machines.md §DuplicateMatch open → resolved). Returns the
   * number of rows transitioned (drives `duplicate_match_resolved`).
   */
  async resolvePairAsMerged(
    duplicateId: string,
    masterId: string,
    orgId: string,
    actorId: string,
    reason: string,
    tx: DbTransaction,
  ): Promise<number> {
    const rows = await tx
      .updateTable('duplicate_matches')
      .set({
        status: 'resolved',
        action: 'merged',
        action_by: actorId,
        action_reason: reason,
        updated_by: actorId,
        updated_at: new Date(),
      })
      .where('org_id', '=', orgId)
      .where((eb) =>
        eb.or([
          eb.and([eb('lead_id', '=', duplicateId), eb('matched_lead_id', '=', masterId)]),
          eb.and([eb('lead_id', '=', masterId), eb('matched_lead_id', '=', duplicateId)]),
        ]),
      )
      .returning(['duplicate_match_id'])
      .execute();
    return rows.length;
  }

  /**
   * FR-021 LLD §Unmerge step 6 — re-open the pair rows resolved at merge time,
   * restoring each row's EXACT pre-merge state from the audit-detail snapshot
   * (see {@link PairMatchSnapshot}): rows that were open before the merge go
   * back to `open` with their prior action (leaving `action='merged'` on an
   * open row would poison FR-020's recompute); rows already resolved before
   * the merge stay resolved. One bounded UPDATE per snapshotted row (the pair
   * set is ≤ {@link EXISTING_PAIR_LIMIT}).
   */
  async reopenMatches(
    snapshots: readonly PairMatchSnapshot[],
    orgId: string,
    actorId: string,
    tx: DbTransaction,
  ): Promise<number> {
    let reopened = 0;
    for (const snapshot of snapshots) {
      const result = await tx
        .updateTable('duplicate_matches')
        .set({
          status: snapshot.status,
          action: snapshot.action,
          action_by: snapshot.action_by,
          action_reason: snapshot.action_reason,
          updated_by: actorId,
          updated_at: new Date(),
        })
        .where('duplicate_match_id', '=', snapshot.duplicate_match_id)
        .where('org_id', '=', orgId)
        .executeTakeFirst();
      reopened += Number(result.numUpdatedRows);
    }
    return reopened;
  }

  /**
   * Shared candidate SELECT (LLD §Step 2 list + the master's code for T08):
   * org-scoped, soft-delete-filtered, self-excluded when re-checking an
   * existing lead. Soft-deleted masters resolve to null and fall back to the
   * candidate itself in scoring.
   */
  private candidateQuery(db: KyselyDb, orgId: string, excludeLeadId: string | null) {
    let query = db
      .selectFrom('lead_identities as li')
      .innerJoin('leads as l', 'l.lead_identity_id', 'li.lead_identity_id')
      .leftJoin('leads as master', (join) =>
        join.onRef('master.lead_id', '=', 'l.master_lead_id').on('master.deleted_at', 'is', null),
      )
      .select([
        'l.lead_id',
        'l.lead_code',
        'l.stage',
        'l.master_lead_id',
        'master.lead_code as master_lead_code',
        'l.branch_id',
        'l.pin_code',
        'l.product_code',
        'li.mobile',
        'li.pan_token',
        'li.name',
        'li.pan_masked',
      ])
      .where('l.org_id', '=', orgId)
      .where('l.deleted_at', 'is', null);
    if (excludeLeadId !== null) {
      query = query.where('l.lead_id', '!=', excludeLeadId);
    }
    return query;
  }
}
