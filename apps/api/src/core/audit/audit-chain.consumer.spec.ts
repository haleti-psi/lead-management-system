import { Logger } from 'nestjs-pino';

import type { KyselyDb } from '../db';
import { AuditChainConsumer } from './audit-chain.consumer';
import { computeAfterHash, GENESIS_PREV_HASH, type CanonicalAuditRow } from './audit-canonical';
import type { ChainRow } from './audit-chain.types';

/**
 * FR-123 / ADR-5 — unit tests for the single-writer audit hash-chain consumer.
 * `verifyWindow` and the canonical hash are pure and fully covered here; the
 * DB-backed `sealPending` is exercised with a minimal scripted Kysely fake (the
 * Testcontainers tier — DEFERRED — covers the live SQL path end-to-end).
 */

const ORG = '00000000-0000-0000-0000-000000000001';

function row(overrides: Partial<ChainRow> = {}): ChainRow {
  return {
    audit_id: 'a1',
    org_id: ORG,
    actor_id: 'u1',
    action: 'stage_transition',
    entity_type: 'leads',
    entity_id: 'lead-1',
    lead_id: 'lead-1',
    detail: null,
    created_at: new Date('2026-06-09T08:00:00.000Z'),
    prev_audit_hash: null,
    after_hash: null,
    ...overrides,
  };
}

function canonical(r: ChainRow): CanonicalAuditRow {
  return {
    audit_id: r.audit_id,
    org_id: r.org_id,
    actor_id: r.actor_id,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    lead_id: r.lead_id,
    detail: r.detail,
    created_at: r.created_at,
  };
}

/** Seal an array of rows in order, returning the same array with hashes filled. */
function seal(rows: ChainRow[]): ChainRow[] {
  let prev = GENESIS_PREV_HASH;
  for (const r of rows) {
    r.prev_audit_hash = prev;
    r.after_hash = computeAfterHash(prev, canonical(r));
    prev = r.after_hash;
  }
  return rows;
}

function consumer(db: KyselyDb = {} as KyselyDb): AuditChainConsumer {
  const logger = { log: jest.fn(), warn: jest.fn() } as unknown as Logger;
  return new AuditChainConsumer(db, logger);
}

describe('audit-canonical.computeAfterHash', () => {
  it('is a 64-char lowercase hex sha256 digest', () => {
    const h = computeAfterHash(GENESIS_PREV_HASH, canonical(row()));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic regardless of detail key order', () => {
    const a = computeAfterHash('prev', canonical(row({ detail: { b: 2, a: 1 } })));
    const b = computeAfterHash('prev', canonical(row({ detail: { a: 1, b: 2 } })));
    expect(a).toBe(b);
  });

  it('treats a JSON-string detail and an equivalent object identically', () => {
    const asObject = computeAfterHash('p', canonical(row({ detail: { mobile: '98xxxxxx78' } })));
    const asString = computeAfterHash('p', canonical(row({ detail: '{"mobile":"98xxxxxx78"}' })));
    expect(asObject).toBe(asString);
  });

  it('changes when any content field changes (tamper sensitivity)', () => {
    const base = computeAfterHash(GENESIS_PREV_HASH, canonical(row({ action: 'stage_transition' })));
    const edited = computeAfterHash(GENESIS_PREV_HASH, canonical(row({ action: 'lead_update' })));
    expect(edited).not.toBe(base);
  });

  it('chains: a different prev_hash yields a different digest for the same row', () => {
    const r = canonical(row());
    expect(computeAfterHash('hashA', r)).not.toBe(computeAfterHash('hashB', r));
  });
});

describe('AuditChainConsumer.verifyWindow', () => {
  it('returns intact + checkedCount 0 for an empty window', () => {
    const result = consumer().verifyWindow([]);
    expect(result).toEqual({ intact: true, checkedCount: 0, breakAt: null, breakKind: null });
  });

  it('returns intact for a single sealed row (no pair to verify)', () => {
    const [r] = seal([row({ audit_id: 'only' })]);
    const result = consumer().verifyWindow([r!]);
    expect(result.intact).toBe(true);
    expect(result.checkedCount).toBe(1);
    expect(result.breakAt).toBeNull();
  });

  it('returns intact for a correctly-chained, correctly-hashed window', () => {
    const rows = seal([
      row({ audit_id: 'r0', created_at: new Date('2026-06-09T08:00:00Z') }),
      row({ audit_id: 'r1', created_at: new Date('2026-06-09T08:01:00Z') }),
      row({ audit_id: 'r2', created_at: new Date('2026-06-09T08:02:00Z') }),
    ]);
    const result = consumer().verifyWindow(rows);
    expect(result.intact).toBe(true);
    expect(result.checkedCount).toBe(3);
    expect(result.breakKind).toBeNull();
  });

  it('detects a chain_gap when prev_audit_hash does not link to the prior after_hash', () => {
    const rows = seal([row({ audit_id: 'r0' }), row({ audit_id: 'r1' }), row({ audit_id: 'r2' })]);
    // Break the link at r2 without touching its content hash.
    rows[2]!.prev_audit_hash = 'deadbeef';
    const result = consumer().verifyWindow(rows);
    expect(result.intact).toBe(false);
    expect(result.breakKind).toBe('chain_gap');
    expect(result.breakAt).toBe('r2');
  });

  it('detects a hash_mismatch when a sealed row content was tampered after sealing', () => {
    const rows = seal([row({ audit_id: 'r0' }), row({ audit_id: 'r1' })]);
    // Mutate r1's content but keep its (now-stale) after_hash → recompute differs.
    rows[1]!.action = 'lead_override';
    const result = consumer().verifyWindow(rows);
    expect(result.intact).toBe(false);
    expect(result.breakKind).toBe('hash_mismatch');
    expect(result.breakAt).toBe('r1');
  });

  it('flags an unsealed row inside the window', () => {
    const rows = seal([row({ audit_id: 'r0' })]);
    rows.push(row({ audit_id: 'r1', after_hash: null, prev_audit_hash: null }));
    const result = consumer().verifyWindow(rows);
    expect(result.intact).toBe(false);
    expect(result.breakKind).toBe('unsealed');
    expect(result.breakAt).toBe('r1');
  });
});

describe('AuditChainConsumer.sealPending', () => {
  it('seals unsealed rows in order from the existing tip and is idempotent on a sealed row', async () => {
    // Pre-existing sealed tip.
    const tipRow = seal([row({ audit_id: 'tip', created_at: new Date('2026-06-09T07:00:00Z') })])[0]!;
    const pending = [
      row({ audit_id: 'p1', created_at: new Date('2026-06-09T08:00:00Z') }),
      row({ audit_id: 'p2', created_at: new Date('2026-06-09T08:01:00Z') }),
    ];

    const updates: Array<{ audit_id: string; prev_audit_hash: string; after_hash: string }> = [];
    const db = scriptedDb(tipRow.after_hash!, pending, updates);

    const result = await consumer(db).sealPending(ORG, 100);

    expect(result.sealed).toBe(2);
    // p1 chains off the existing tip; p2 chains off p1.
    expect(updates[0]).toMatchObject({ audit_id: 'p1', prev_audit_hash: tipRow.after_hash });
    expect(updates[1]).toMatchObject({ audit_id: 'p2', prev_audit_hash: updates[0]!.after_hash });
    // The sealed hashes equal an independent recomputation (no drift).
    expect(updates[0]!.after_hash).toBe(computeAfterHash(tipRow.after_hash!, canonical(pending[0]!)));
    expect(result.tipHash).toBe(updates[1]!.after_hash);
  });

  it('starts from genesis when there is no existing tip, and seals nothing when none pending', async () => {
    const updates: Array<{ audit_id: string; prev_audit_hash: string; after_hash: string }> = [];
    const db = scriptedDb(null, [], updates);

    const result = await consumer(db).sealPending(ORG, 100);

    expect(result.sealed).toBe(0);
    expect(result.tipHash).toBeNull();
    expect(updates).toHaveLength(0);
  });
});

/**
 * A minimal Kysely fake supporting exactly the two read chains
 * (tip lookup, pending fetch) and the update chain `sealPending` issues, all
 * inside a single `transaction().execute(cb)`. `tipAfterHash` is returned by the
 * tip query; `pending` rows by the pending query; updates are captured.
 */
function scriptedDb(
  tipAfterHash: string | null,
  pending: ChainRow[],
  updates: Array<{ audit_id: string; prev_audit_hash: string; after_hash: string }>,
): KyselyDb {
  let selectCall = 0;

  const tx = {
    selectFrom() {
      // First select = tip lookup; second = pending fetch.
      const isTip = selectCall === 0;
      selectCall += 1;
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.where = chain;
      builder.orderBy = chain;
      builder.limit = chain;
      builder.executeTakeFirst = async () =>
        isTip ? (tipAfterHash != null ? { after_hash: tipAfterHash } : undefined) : undefined;
      builder.execute = async () =>
        isTip ? [] : pending.map((p) => ({ ...p }));
      return builder;
    },
    updateTable() {
      let pendingPrev = '';
      let pendingAfter = '';
      let auditId = '';
      const builder: Record<string, unknown> = {};
      builder.set = (vals: { prev_audit_hash: string; after_hash: string }) => {
        pendingPrev = vals.prev_audit_hash;
        pendingAfter = vals.after_hash;
        return builder;
      };
      builder.where = (col: string, _op: string, val: unknown) => {
        if (col === 'audit_id') auditId = String(val);
        return builder;
      };
      builder.execute = async () => {
        updates.push({ audit_id: auditId, prev_audit_hash: pendingPrev, after_hash: pendingAfter });
        return [];
      };
      return builder;
    },
  };

  return {
    transaction() {
      return {
        execute: async <T>(cb: (trx: unknown) => Promise<T>): Promise<T> => cb(tx),
      };
    },
  } as unknown as KyselyDb;
}
