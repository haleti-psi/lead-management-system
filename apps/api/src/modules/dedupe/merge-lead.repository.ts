import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import type {
  AttributionStatus,
  DupStatus,
  LeadStage,
  Priority,
  UserStatus,
} from '@lms/shared';

import type { DbTransaction, KyselyDb } from '../../core/db';
import type { Json } from '../../core/db/types.generated';
import { LEADS_RESOURCE_TYPE } from '../capture/capture.constants';

/** The lead columns the merge/unmerge flow needs (FR-021 LLD §Data Operations). */
export interface MergeLeadRow {
  lead_id: string;
  org_id: string;
  lead_code: string;
  stage: LeadStage;
  branch_id: string | null;
  owner_id: string | null;
  team_id: string | null;
  priority: Priority;
  duplicate_status: DupStatus;
  master_lead_id: string | null;
  source_attribution_id: string;
  version: number;
}

/** Manual-override owner row (validated against the master's branch). */
export interface OverrideOwnerRow {
  user_id: string;
  branch_id: string | null;
  status: UserStatus;
}

/** Most-recent `lead_merge` audit entry for a (master, duplicate) pair. */
export interface MergeAuditRow {
  audit_id: string;
  detail: Json | null;
  created_at: Date;
}

/**
 * FR-021 — Kysely access for M3's merge/unmerge flow. Owns the child-record
 * FK re-parents the LLD's merge transaction performs (documents,
 * consent_records, tasks — the not-yet-built M8/M11/M12 owner FRs inherit
 * these tables later; the LLD assigns the merge-scope re-parent to M3) and the
 * `source_attributions` merge transition (capture's repository defers
 * "reassignment/merge histories" to FR-021/FR-030). NEVER writes `leads`
 * (LeadService is the sole writer) or `duplicate_matches` (DedupeRepository).
 *
 * `consent_records` is append-only: per AMBIGUITIES A6 (RESOLVED) the merge
 * re-parents the `lead_id` FK ONLY — `state`/`superseded_by`/every consent
 * column other than the FK is untouched, here and everywhere.
 */
@Injectable()
export class MergeLeadRepository {
  /** Org-scoped, soft-delete-filtered lead read for merge validation; undefined → 404. */
  async findLeadForMerge(
    leadId: string,
    orgId: string,
    db: KyselyDb,
  ): Promise<MergeLeadRow | undefined> {
    return db
      .selectFrom('leads')
      .select([
        'lead_id',
        'org_id',
        'lead_code',
        'stage',
        'branch_id',
        'owner_id',
        'team_id',
        'priority',
        'duplicate_status',
        'master_lead_id',
        'source_attribution_id',
        'version',
      ])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Whether other live leads reference `leadId` as their master — merging a
   * lead that is itself a master would orphan its children's `master_lead_id`
   * chain (test-spec INV-008: a master must never be merged).
   */
  async hasChildMergedLeads(leadId: string, orgId: string, db: KyselyDb): Promise<boolean> {
    const row = await db
      .selectFrom('leads')
      .select('lead_id')
      .where('master_lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** Manual-override owner lookup (LLD: owner must be valid for the master's scope). */
  async findOverrideOwner(
    userId: string,
    orgId: string,
    db: KyselyDb,
  ): Promise<OverrideOwnerRow | undefined> {
    return db
      .selectFrom('users')
      .select(['user_id', 'branch_id', 'status'])
      .where('user_id', '=', userId)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * FR-021 LLD §Merge step 3 / §Unmerge step 2 — flip the duplicate's
   * `source_attributions.attribution_status` (`merged_into` on merge,
   * `original` on unmerge; state-machines.md §SourceAttribution). The row is
   * never deleted and never re-pointed — source attribution of BOTH leads is
   * preserved (the FR's title rule). Returns the rows updated (expected 1).
   */
  async setAttributionStatus(
    sourceAttributionId: string,
    status: AttributionStatus,
    orgId: string,
    actorId: string,
    tx: DbTransaction,
  ): Promise<number> {
    const result = await tx
      .updateTable('source_attributions')
      .set({ attribution_status: status, updated_by: actorId, updated_at: new Date() })
      .where('source_attribution_id', '=', sourceAttributionId)
      .where('org_id', '=', orgId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  /** Merge step 4 — re-parent ALL of the duplicate's documents to the master. */
  async reparentDocuments(
    fromLeadId: string,
    toLeadId: string,
    orgId: string,
    actorId: string,
    tx: DbTransaction,
  ): Promise<string[]> {
    const rows = await tx
      .updateTable('documents')
      .set({ lead_id: toLeadId, updated_by: actorId, updated_at: new Date() })
      .where('lead_id', '=', fromLeadId)
      .where('org_id', '=', orgId)
      .returning(['document_id'])
      .execute();
    return rows.map((row) => row.document_id);
  }

  /**
   * Merge step 5 — re-parent the duplicate's consent rows to the master.
   * `lead_id` (+ bookkeeping `updated_at`) ONLY — consent state is append-only
   * (A6; the consent ledger's own `markSuperseded` precedent for `updated_at`).
   */
  async reparentConsents(
    fromLeadId: string,
    toLeadId: string,
    orgId: string,
    tx: DbTransaction,
  ): Promise<string[]> {
    const rows = await tx
      .updateTable('consent_records')
      .set({ lead_id: toLeadId, updated_at: new Date() })
      .where('lead_id', '=', fromLeadId)
      .where('org_id', '=', orgId)
      .returning(['consent_id'])
      .execute();
    return rows.map((row) => row.consent_id);
  }

  /** Merge step 6 — re-parent the duplicate's tasks to the master. */
  async reparentTasks(
    fromLeadId: string,
    toLeadId: string,
    orgId: string,
    actorId: string,
    tx: DbTransaction,
  ): Promise<string[]> {
    const rows = await tx
      .updateTable('tasks')
      .set({ lead_id: toLeadId, updated_by: actorId, updated_at: new Date() })
      .where('lead_id', '=', fromLeadId)
      .where('org_id', '=', orgId)
      .returning(['task_id'])
      .execute();
    return rows.map((row) => row.task_id);
  }

  /**
   * Unmerge step 3 — restore to the duplicate ONLY the documents that were
   * re-parented at merge time (`relinked_ids` from the merge audit detail,
   * E3/T-026) — documents added to the master after the merge stay put.
   */
  async restoreDocuments(
    documentIds: readonly string[],
    masterId: string,
    duplicateId: string,
    orgId: string,
    actorId: string,
    tx: DbTransaction,
  ): Promise<number> {
    if (documentIds.length === 0) {
      return 0;
    }
    const rows = await tx
      .updateTable('documents')
      .set({ lead_id: duplicateId, updated_by: actorId, updated_at: new Date() })
      .where('lead_id', '=', masterId)
      .where('org_id', '=', orgId)
      .where('document_id', 'in', [...documentIds])
      .returning(['document_id'])
      .execute();
    return rows.length;
  }

  /** Unmerge step 4 — restore the originally re-parented consents (FK only, A6). */
  async restoreConsents(
    consentIds: readonly string[],
    masterId: string,
    duplicateId: string,
    orgId: string,
    tx: DbTransaction,
  ): Promise<number> {
    if (consentIds.length === 0) {
      return 0;
    }
    const rows = await tx
      .updateTable('consent_records')
      .set({ lead_id: duplicateId, updated_at: new Date() })
      .where('lead_id', '=', masterId)
      .where('org_id', '=', orgId)
      .where('consent_id', 'in', [...consentIds])
      .returning(['consent_id'])
      .execute();
    return rows.length;
  }

  /** Unmerge step 5 — restore the originally re-parented tasks. */
  async restoreTasks(
    taskIds: readonly string[],
    masterId: string,
    duplicateId: string,
    orgId: string,
    actorId: string,
    tx: DbTransaction,
  ): Promise<number> {
    if (taskIds.length === 0) {
      return 0;
    }
    const rows = await tx
      .updateTable('tasks')
      .set({ lead_id: duplicateId, updated_by: actorId, updated_at: new Date() })
      .where('lead_id', '=', masterId)
      .where('org_id', '=', orgId)
      .where('task_id', 'in', [...taskIds])
      .returning(['task_id'])
      .execute();
    return rows.length;
  }

  /**
   * Unmerge step 8 — the most-recent MERGE audit entry for the pair
   * (`action='lead_merge'`, `entity_id=master`, `detail.duplicate_lead_id`
   * matches, `detail.action='merged'` — unmerge entries share the audit action
   * and are excluded by the detail filter). Carries `unmerge_allowed_until` +
   * `relinked_ids` (E3). `sql` is used only for the `->>` JSON operator; the
   * compared id stays a bound parameter.
   */
  async findLatestMergeAudit(
    masterId: string,
    duplicateId: string,
    orgId: string,
    db: KyselyDb,
  ): Promise<MergeAuditRow | undefined> {
    return db
      .selectFrom('audit_logs')
      .select(['audit_id', 'detail', 'created_at'])
      .where('org_id', '=', orgId)
      .where('action', '=', 'lead_merge')
      .where('entity_type', '=', LEADS_RESOURCE_TYPE)
      .where('entity_id', '=', masterId)
      .where(sql<boolean>`${sql.ref('detail')} ->> 'duplicate_lead_id' = ${duplicateId}`)
      .where(sql<boolean>`${sql.ref('detail')} ->> 'action' = 'merged'`)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }
}
