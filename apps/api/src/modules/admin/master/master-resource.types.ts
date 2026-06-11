import type { ZodSchema } from 'zod';

import type { DbTransaction, KyselyDb } from '../../../core/db';

/**
 * A master record as returned to the API. Each descriptor projects its own row to
 * a camelCase view; the shared keys below are always present so the generic
 * handler/service can reason about identity and activeness uniformly.
 */
export interface MasterRecordView {
  id: string;
  isActive: boolean;
  [key: string]: unknown;
}

/** A page of records plus the total count for pagination meta. */
export interface MasterListPage {
  rows: MasterRecordView[];
  total: number;
}

export interface ListArgs {
  page: number;
  limit: number;
  /** When provided, filter on the resource's activeness column. */
  isActive?: boolean;
}

/**
 * Scope model of a resource:
 *  - `global`   — org-wide config with no branch column → only scope A may write.
 *  - `branch`   — has an optional `branch_id`; scope B may write rows in their branch.
 */
export type ScopeModel = 'global' | 'branch';

/**
 * Activeness model of a resource:
 *  - `boolean` — an `is_active` column (most masters).
 *  - `status`  — a status enum column (`partners.status`, `*_templates.status`,
 *                `dla_registry.status`); "active" ⇔ a designated active value.
 *  - `none`    — no deactivation possible (`regions`).
 */
export type ActivenessModel = 'boolean' | 'status' | 'none';

/**
 * The contract a single master resource implements. The registry holds one
 * descriptor per allow-listed resource; the generic service/controller never
 * touches a table directly — it delegates to the descriptor (owner-writes within
 * the admin module). Every DB method accepts a Kysely executor (pool or the
 * ambient `tx`) so writes enlist in the caller's UnitOfWork transaction.
 */
export interface MasterResourceDescriptor {
  /** URL slug (e.g. `rejection-reasons`) — the `{masterResource}` path value. */
  readonly slug: string;
  /** `configuration_versions.config_type` discriminator for this resource. */
  readonly configType: string;
  /** `audit_logs.entity_type` / `event_outbox` aggregate detail for this resource. */
  readonly entityType: string;
  readonly scopeModel: ScopeModel;
  readonly activenessModel: ActivenessModel;
  /** Zod schema for the create body. */
  readonly createSchema: ZodSchema<unknown>;
  /** Zod schema for the patch body (partial, ≥1 key). */
  readonly patchSchema: ZodSchema<unknown>;

  /** Paginated, org-scoped, LIMIT-bounded list. */
  list(executor: KyselyDb, args: ListArgs): Promise<MasterListPage>;

  /** Load one record by id (org-scoped); `undefined` when absent/another org. */
  findById(executor: KyselyDb | DbTransaction, id: string): Promise<MasterRecordView | undefined>;

  /**
   * Insert a new master row. Resources governed by maker-checker (config_status /
   * versioned) insert in a non-live state; simple masters insert active. Returns
   * the new record view + the change diff to record on the configuration_version.
   */
  insert(
    tx: DbTransaction,
    body: unknown,
    actorId: string,
  ): Promise<{ record: MasterRecordView; version: number; diff: Record<string, unknown> }>;

  /**
   * Apply a partial update to an existing record (already loaded & scope-checked).
   * Returns the updated view + the diff. The activeness toggle is part of `body`.
   */
  update(
    tx: DbTransaction,
    existing: MasterRecordView,
    body: unknown,
    actorId: string,
  ): Promise<{ record: MasterRecordView; version: number; diff: Record<string, unknown> }>;

  /**
   * Referential-integrity guard invoked before a deactivation (`isActive=false` /
   * status→inactive). Throws CONFLICT when the record is still referenced by
   * active rows; may throw CONFLICT + `detail.reason` (e.g. LEGAL_HOLD).
   * No-op resources return without throwing.
   */
  assertNotInUse(executor: DbTransaction, record: MasterRecordView): Promise<void>;

  /**
   * Optional pre-insert foreign-key validation (e.g. branch.regionId must exist
   * and be active). Throws VALIDATION_ERROR with the offending field. Default: none.
   */
  validateReferences?(executor: DbTransaction, body: unknown): Promise<void>;
}
