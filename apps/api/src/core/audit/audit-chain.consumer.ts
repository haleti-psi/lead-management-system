import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { KYSELY, type DbTransaction, type KyselyDb } from '../db';
import {
  computeAfterHash,
  GENESIS_PREV_HASH,
  type CanonicalAuditRow,
} from './audit-canonical';
import {
  type ChainRow,
  type IntegrityResult,
  type SealResult,
} from './audit-chain.types';

/** Default rows sealed per `sealPending` invocation (bounded; NFR-17). */
export const AUDIT_CHAIN_BATCH_SIZE = 100;

/**
 * ADR-5 — the SINGLE-WRITER audit hash-chain consumer.
 *
 * `AuditAppender` (FR-001) INSERTs `audit_logs` rows leaving the chain columns
 * (`prev_audit_hash`/`after_hash`) null. This consumer is the ONLY writer of
 * those columns: deployed at concurrency = 1 (one worker, never parallel), it
 * walks unsealed rows in insertion order and seals each one by computing
 * `after_hash = H(prev_audit_hash + canonical(row))`, where `prev_audit_hash` is
 * the previous sealed row's `after_hash`. Sealing fills the two null hash columns
 * only — it never rewrites a row's auditable content, so `audit_logs` stays
 * append-only (§5.6.3). The work is **idempotent**: the `after_hash IS NULL`
 * predicate means an already-sealed row is never re-touched, so a replay seals
 * only genuinely-new rows.
 *
 * Tamper-evidence: because each `after_hash` folds in the prior `after_hash`, any
 * post-hoc edit, insertion, or deletion of a sealed row breaks the recomputation
 * of every later row — {@link verifyWindow} detects both a content edit
 * (`hash_mismatch`) and a missing/extra link (`chain_gap`).
 */
@Injectable()
export class AuditChainConsumer {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    private readonly logger: Logger,
  ) {}

  /**
   * Seal up to `batchSize` unsealed rows (oldest first) for an org, extending the
   * chain from its current tip. Runs in ONE transaction so the batch's hashes
   * commit atomically. Returns how many rows were sealed and the new tip hash.
   *
   * MUST be invoked by a single-writer worker (concurrency = 1). The ordering
   * (`created_at`, then `audit_id` as a stable tie-break) is the canonical chain
   * order; `audit_id` breaks ties deterministically when two rows share a
   * microsecond timestamp.
   */
  async sealPending(
    orgId: string,
    batchSize: number = AUDIT_CHAIN_BATCH_SIZE,
  ): Promise<SealResult> {
    const limit = Math.min(Math.max(batchSize, 1), AUDIT_CHAIN_BATCH_SIZE);

    return this.db.transaction().execute(async (tx) => {
      let prevHash = await this.currentTipHash(tx, orgId);

      const pending = await tx
        .selectFrom('audit_logs')
        .select([
          'audit_id',
          'org_id',
          'actor_id',
          'action',
          'entity_type',
          'entity_id',
          'lead_id',
          'detail',
          'created_at',
        ])
        .where('org_id', '=', orgId)
        .where('after_hash', 'is', null)
        .orderBy('created_at', 'asc')
        .orderBy('audit_id', 'asc')
        .limit(limit)
        .execute();

      let sealed = 0;
      for (const row of pending) {
        const afterHash = computeAfterHash(prevHash, toCanonical(row));
        await tx
          .updateTable('audit_logs')
          // Content is never touched — only the two null chain columns are filled.
          .set({ prev_audit_hash: prevHash, after_hash: afterHash })
          .where('audit_id', '=', row.audit_id)
          .where('after_hash', 'is', null) // idempotent guard (never re-seal)
          .execute();
        prevHash = afterHash;
        sealed += 1;
      }

      if (sealed > 0) {
        this.logger.log(
          { module: 'audit', event: 'audit_chain_sealed', org_id: orgId, sealed },
          'Sealed audit_logs hash chain batch',
        );
      }

      // `prevHash` is the chain tip after the run (the pre-existing tip when
      // nothing was sealed). Genesis ('') surfaces as null — there is no tip yet.
      return { sealed, tipHash: prevHash === GENESIS_PREV_HASH ? null : prevHash };
    });
  }

  /**
   * Verify a contiguous, oldest-first window of audit rows. For each consecutive
   * pair it checks `curr.prev_audit_hash === prev.after_hash` (chain continuity)
   * and recomputes every row's `after_hash` to confirm its sealed value
   * (tamper-evidence). The first failure is reported with the offending
   * `audit_id` and its kind; the scan stops there. A window of 0 or 1 rows has no
   * pair to verify and is reported intact with `checkedCount <= 1`.
   *
   * Pure and side-effect free — safe to call on the request path (the explorer's
   * per-page badge) and from an offline full-history audit job.
   */
  verifyWindow(rowsOldestFirst: readonly ChainRow[]): IntegrityResult {
    const checkedCount = rowsOldestFirst.length;
    if (checkedCount === 0) {
      return { intact: true, checkedCount, breakAt: null, breakKind: null };
    }

    for (let i = 0; i < checkedCount; i++) {
      const curr = rowsOldestFirst[i]!;

      // A row inside the window that is not yet sealed cannot be verified.
      if (curr.after_hash == null) {
        return { intact: false, checkedCount, breakAt: curr.audit_id, breakKind: 'unsealed' };
      }

      if (i > 0) {
        const prev = rowsOldestFirst[i - 1]!;
        if (curr.prev_audit_hash !== prev.after_hash) {
          return { intact: false, checkedCount, breakAt: curr.audit_id, breakKind: 'chain_gap' };
        }
      }

      const recomputed = computeAfterHash(curr.prev_audit_hash ?? GENESIS_PREV_HASH, toCanonical(curr));
      if (recomputed !== curr.after_hash) {
        return { intact: false, checkedCount, breakAt: curr.audit_id, breakKind: 'hash_mismatch' };
      }
    }

    return { intact: true, checkedCount, breakAt: null, breakKind: null };
  }

  /** The chain tip: `after_hash` of the most-recently-sealed row, or genesis. */
  private async currentTipHash(tx: DbTransaction, orgId: string): Promise<string> {
    const tip = await tx
      .selectFrom('audit_logs')
      .select('after_hash')
      .where('org_id', '=', orgId)
      .where('after_hash', 'is not', null)
      .orderBy('created_at', 'desc')
      .orderBy('audit_id', 'desc')
      .limit(1)
      .executeTakeFirst();
    return tip?.after_hash ?? GENESIS_PREV_HASH;
  }
}

/** Narrow a DB row to the canonical content shape the hash is computed over. */
function toCanonical(row: {
  audit_id: string;
  org_id: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  lead_id: string | null;
  detail: unknown;
  created_at: Date | string;
}): CanonicalAuditRow {
  return {
    audit_id: row.audit_id,
    org_id: row.org_id,
    actor_id: row.actor_id,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    lead_id: row.lead_id,
    detail: row.detail,
    created_at: row.created_at,
  };
}
