import type { ColumnType, Generated } from 'kysely';

import type {
  AuditAction,
  EventCode,
  OutboxStatus,
  UserStatus,
} from '@lms/shared';

/**
 * Hand-authored MINIMAL Kysely database interface.
 *
 * This is a temporary, compile-time-sufficient subset. The full, authoritative
 * `DB` interface for all 47 tables is generated from docs/data-model/schema.sql
 * via `npm run db:codegen` (kysely-codegen → core/db/types.generated.ts) once a
 * database is reachable. Until then this hand-authored subset lets the core
 * infrastructure (UnitOfWork, DbModule) compile with full type-safety and NO
 * `any`. Column names/types here match schema.sql exactly — do not invent
 * columns. When the generated file lands, switch `DbModule`'s import to it.
 *
 * Conventions (architecture §10): UUID PKs, TIMESTAMPTZ created_at/updated_at,
 * snake_case columns. `Generated<T>` marks DB-defaulted columns; `ColumnType`
 * marks read-only / insert-optional shapes.
 */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type JsonValue = ColumnType<unknown, string, string>;

export interface OrgsTable {
  id: Generated<string>;
  name: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface UsersTable {
  user_id: Generated<string>;
  org_id: Generated<string>;
  username: string;
  email: string;
  full_name: string;
  mobile: string | null;
  password_hash: string | null;
  totp_secret_enc: string | null;
  role_id: string;
  branch_id: string | null;
  team_id: string | null;
  region_id: string | null;
  partner_id: string | null;
  product_skills: JsonValue | null;
  mfa_enabled: Generated<boolean>;
  status: Generated<UserStatus>;
  reporting_manager_id: string | null;
  last_login_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by: string;
  updated_by: string;
}

export interface AuditLogsTable {
  audit_id: Generated<string>;
  org_id: Generated<string>;
  actor_id: string;
  action: AuditAction;
  entity_type: string;
  entity_id: string | null;
  lead_id: string | null;
  before_hash: string | null;
  after_hash: string | null;
  prev_audit_hash: string | null;
  detail: JsonValue | null;
  ip_device: JsonValue | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface EventOutboxTable {
  event_id: Generated<string>;
  org_id: Generated<string>;
  event_code: EventCode;
  aggregate_type: string;
  aggregate_id: string;
  payload: JsonValue;
  schema_version: Generated<number>;
  status: Generated<OutboxStatus>;
  published_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/**
 * The Kysely database schema. Extend by regenerating via `npm run db:codegen`.
 */
export interface DB {
  orgs: OrgsTable;
  users: UsersTable;
  audit_logs: AuditLogsTable;
  event_outbox: EventOutboxTable;
}
