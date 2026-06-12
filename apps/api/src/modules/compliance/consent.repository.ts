import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';

import type {
  ConsentActor,
  ConsentPurpose,
  ConsentState,
  CreationChannel,
  DataCategory,
  Lang,
} from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { ConsentRecords } from '../../core/db/types.generated';
import { LATEST_PER_PURPOSE_LIMIT } from './compliance.constants';

/** Read shape of a `consent_records` row (all columns). */
export type ConsentRecordRow = Selectable<ConsentRecords>;

/** Optional filters for the consent-history list (LLD §Endpoint 1). */
export interface ConsentListFilters {
  purpose?: ConsentPurpose;
  state?: ConsentState;
}

/** Insert shape for one append-only ledger row (LLD §Data Operations). */
export interface NewConsentRecord {
  consent_id: string;
  org_id: string;
  lead_id: string;
  customer_profile_id: string | null;
  purpose: ConsentPurpose;
  data_category: DataCategory | null;
  state: ConsentState;
  channel: CreationChannel;
  language: Lang | null;
  notice_version: string;
  consent_text_version: string;
  actor: ConsentActor;
  ip_device: { ip: string; device: string } | null;
  expires_at: Date | null;
}

/** Latest non-superseded (purpose, state) pair — derivation input. */
export interface LatestPurposeState {
  purpose: ConsentPurpose;
  state: ConsentState;
}

/** Lead attributes the consent endpoints need: scope check + row defaults. */
export interface LeadConsentContext {
  lead_id: string;
  org_id: string;
  owner_id: string | null;
  branch_id: string | null;
  customer_profile_id: string | null;
  /** `source_attributions.partner_id` — PARTNER (P) scope check. */
  partner_id: string | null;
}

/**
 * FR-110 — owner repository for `consent_records` (M12, auth-matrix
 * `consent_records.writer = "M12 (append-only)"`). The ledger is STRICTLY
 * append-only: this class exposes INSERT and reads only. The single sanctioned
 * exception is {@link markSuperseded}, which sets the `superseded_by` POINTER
 * on the prior row when a new `granted` row supersedes it — `state` and every
 * other column of an existing row are never mutated, and no DELETE exists
 * (LLD §Data Operations; state-machines.md §ConsentRecord). It also hosts
 * M12's bounded read over `leads` (reads are permitted — owner-writes governs
 * writes only). All queries are parameterised Kysely and LIMIT-bounded.
 */
@Injectable()
export class ConsentRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  // ───────────────────────────────────────────────── consent_records reads ──

  /** Chronological consent history page for a lead (LIMIT ≤ 100 via DTO). */
  async listForLead(
    leadId: string,
    orgId: string,
    filters: ConsentListFilters,
    page: number,
    limit: number,
  ): Promise<ConsentRecordRow[]> {
    let query = this.db
      .selectFrom('consent_records')
      .selectAll()
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId);
    if (filters.purpose != null) {
      query = query.where('purpose', '=', filters.purpose);
    }
    if (filters.state != null) {
      query = query.where('state', '=', filters.state);
    }
    return query
      .orderBy('created_at', 'asc') // ledger is read in order (LLD)
      .limit(limit)
      .offset((page - 1) * limit)
      .execute();
  }

  /** Total matching rows (pagination meta) — same WHERE as the page query. */
  async countForLead(
    leadId: string,
    orgId: string,
    filters: ConsentListFilters,
  ): Promise<number> {
    let query = this.db
      .selectFrom('consent_records')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId);
    if (filters.purpose != null) {
      query = query.where('purpose', '=', filters.purpose);
    }
    if (filters.state != null) {
      query = query.where('state', '=', filters.state);
    }
    const row = await query.executeTakeFirstOrThrow();
    return Number(row.count);
  }

  /**
   * Latest non-superseded consent state per purpose (derivation input — LLD
   * "most recent non-superseded record per purpose"). `DISTINCT ON (purpose)`
   * with `created_at DESC` is the SQL form of the LLD's group-in-app step and
   * keeps the read bounded (≤ one row per purpose; hard LIMIT as a guard).
   */
  async findLatestPerPurpose(
    leadId: string,
    orgId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<LatestPurposeState[]> {
    return executor
      .selectFrom('consent_records')
      .select(['purpose', 'state'])
      .distinctOn('purpose')
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('superseded_by', 'is', null)
      .orderBy('purpose', 'asc')
      .orderBy('created_at', 'desc')
      .limit(LATEST_PER_PURPOSE_LIMIT)
      .execute();
  }

  /**
   * Most recent open (`superseded_by IS NULL`) `granted` row for the purpose —
   * the row a new grant supersedes (LLD §Backend Flow step 4d).
   */
  async findLatestOpenGrant(
    leadId: string,
    orgId: string,
    purpose: ConsentPurpose,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<{ consent_id: string } | undefined> {
    return executor
      .selectFrom('consent_records')
      .select(['consent_id'])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('purpose', '=', purpose)
      .where('state', '=', 'granted')
      .where('superseded_by', 'is', null)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Whether ANY prior `granted` row exists for `(lead_id, purpose)` —
   * withdrawal pre-check (LLD §Backend Flow step 4c; INV-05). Superseded
   * grants count: the purpose WAS granted.
   */
  async hasPriorGrant(
    leadId: string,
    orgId: string,
    purpose: ConsentPurpose,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<boolean> {
    const row = await executor
      .selectFrom('consent_records')
      .select(['consent_id'])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('purpose', '=', purpose)
      .where('state', '=', 'granted')
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  // ──────────────────────────────────────────────── consent_records writes ──

  /** Append one ledger row (INSERT only — the table is never UPDATEd/DELETEd). */
  async insert(record: NewConsentRecord, tx: DbTransaction): Promise<ConsentRecordRow> {
    return tx
      .insertInto('consent_records')
      .values({
        consent_id: record.consent_id,
        org_id: record.org_id,
        lead_id: record.lead_id,
        customer_profile_id: record.customer_profile_id,
        purpose: record.purpose,
        data_category: record.data_category,
        state: record.state,
        channel: record.channel,
        language: record.language,
        notice_version: record.notice_version,
        consent_text_version: record.consent_text_version,
        actor: record.actor,
        ip_device: record.ip_device != null ? JSON.stringify(record.ip_device) : null,
        expires_at: record.expires_at,
        superseded_by: null, // set on the PRIOR row by markSuperseded only
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Set the `superseded_by` pointer on the PRIOR `granted` row — the one
   * allowed mutation on `consent_records` (LLD §Data Operations: "a pointer
   * added to the old row when a new row supersedes it. The `state` column is
   * never changed."). Same `(lead, purpose)` org-scoped row, same tx as the
   * new row's INSERT.
   */
  async markSuperseded(
    priorConsentId: string,
    newConsentId: string,
    orgId: string,
    tx: DbTransaction,
  ): Promise<void> {
    await tx
      .updateTable('consent_records')
      .set({ superseded_by: newConsentId, updated_at: new Date() })
      .where('consent_id', '=', priorConsentId)
      .where('org_id', '=', orgId)
      .execute();
  }

  // ─────────────────────────────────────────────────── bounded leads read ──

  /** Lead context for scope checks + row defaults (404 when undefined). */
  async findLeadConsentContext(
    leadId: string,
    orgId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<LeadConsentContext | undefined> {
    return executor
      .selectFrom('leads')
      .leftJoin('source_attributions', 'source_attributions.source_attribution_id', 'leads.source_attribution_id')
      .select([
        'leads.lead_id as lead_id',
        'leads.org_id as org_id',
        'leads.owner_id as owner_id',
        'leads.branch_id as branch_id',
        'leads.customer_profile_id as customer_profile_id',
        'source_attributions.partner_id as partner_id',
      ])
      .where('leads.lead_id', '=', leadId)
      .where('leads.org_id', '=', orgId)
      .where('leads.deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
  }
}
