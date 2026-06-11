import { Inject, Injectable } from '@nestjs/common';

import type { AuditAction } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../db';

/**
 * Canonical audit entry (docs/contracts/shared-utilities.md / CORRECTIONS.md).
 * Fields are EXACTLY these — `detail` must already be masked (no raw PII,
 * passwords, tokens, or OTPs; security.md §Audit integrity). `ipDevice` is
 * stored in the dedicated `ip_device` column, not in `detail`.
 */
export interface AuditEntry {
  action: AuditAction;
  entity_type: string;
  entity_id: string | null;
  actor_id: string;
  org_id: string;
  lead_id?: string | null;
  detail?: Record<string, unknown> | null;
  ipDevice?: { ip?: string; user_agent?: string } | null;
}

/**
 * Appends an audit intent to `audit_logs`. The hash chain
 * (`prev_audit_hash`/`after_hash`) is computed and written **only** by the
 * single-writer `AuditChainConsumer` (architecture §8) — this appender never
 * touches those columns. Pass the ambient `tx` when the audit must commit
 * atomically with the surrounding write; omit it for a standalone append.
 *
 * `audit_logs` is append-only (INSERT only); this service issues no UPDATE/DELETE.
 */
@Injectable()
export class AuditAppender {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  async append(entry: AuditEntry, tx?: DbTransaction): Promise<void> {
    const executor = tx ?? this.db;
    await executor
      .insertInto('audit_logs')
      .values({
        org_id: entry.org_id,
        actor_id: entry.actor_id,
        action: entry.action,
        entity_type: entry.entity_type,
        entity_id: entry.entity_id,
        lead_id: entry.lead_id ?? null,
        detail: entry.detail != null ? JSON.stringify(entry.detail) : null,
        ip_device: entry.ipDevice != null ? JSON.stringify(entry.ipDevice) : null,
      })
      .execute();
  }
}
