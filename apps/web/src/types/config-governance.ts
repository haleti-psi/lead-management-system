/**
 * FR-132 — Configuration Governance (maker-checker) view & request types.
 *
 * These mirror the NestJS `ConfigGovernanceService` result shapes
 * (`ApproveConfigResult`, `RollbackConfigResult` in
 * `apps/api/src/modules/admin/config-governance.service.ts`) and the request
 * DTOs (`ApproveConfigDto`, `RollbackConfigDto`), plus the `GET /admin/config`
 * pending-queue row (`PendingConfigVersionView`). Each action acts on a single
 * `configuration_versions` id.
 */
import type { ConfigChangeStatus } from '@lms/shared';

/**
 * One pending row from `GET /admin/config` (`PendingConfigVersionView`). The
 * server lists `pending` versions newest-first, paginated; `diff` is the opaque
 * JSONB captured when the version was created and is rendered by {@link DiffEntry}
 * normalisation without a further fetch.
 */
export interface PendingConfigVersion {
  configurationVersionId: string;
  makerId: string;
  configType: string;
  configRef: string | null;
  status: ConfigChangeStatus;
  createdAt: string;
  diff: unknown;
}

/** A single change inside a `configuration_versions.diff` JSON, normalised for
 * display. The server stores `diff` as opaque JSONB; the web renders whatever
 * key/value pairs it finds without assuming a fixed schema. */
export interface DiffEntry {
  /** Dotted field path or key within the diff. */
  field: string;
  /** Prior value (when the diff records `before`/`from`); `undefined` if absent. */
  before?: unknown;
  /** New value (when the diff records `after`/`to`); `undefined` if absent. */
  after?: unknown;
}

/**
 * `POST /admin/config/{id}/approve` 200 body (`ApproveConfigResult`). On
 * `action:'approved'` the `status` is `active` (or `approved` for a future
 * `effectiveAt`); on `action:'rejected'` it is `rejected`. `diff` is the opaque
 * JSONB captured when the version was created.
 */
export interface ApproveConfigResult {
  configurationVersionId: string;
  configType: string;
  configRef: string | null;
  version: number;
  status: ConfigChangeStatus;
  effectiveAt: string | null;
  makerId: string;
  checkerId: string;
  diff: unknown;
}

/** `POST /admin/config/{id}/rollback` 200 body (`RollbackConfigResult`).
 * `restoredVersionId` is the re-activated `rollback_ref`, or null when there was
 * no prior version to restore. */
export interface RollbackConfigResult {
  rolledBackVersionId: string;
  restoredVersionId: string | null;
  configType: string;
  status: ConfigChangeStatus;
}

/** The checker decision for the approve endpoint. */
export type ConfigDecision = 'approved' | 'rejected';

/** `POST /admin/config/{id}/approve` body (ApproveConfigDto). `comment` ≤500. */
export interface ApproveConfigBody {
  action: ConfigDecision;
  comment?: string;
}

/** `POST /admin/config/{id}/rollback` body (RollbackConfigDto). `reason` 1–500. */
export interface RollbackConfigBody {
  reason: string;
}
