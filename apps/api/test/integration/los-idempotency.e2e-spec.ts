import { setupTestDb, type TestDb } from './test-db';
import { ORG, SYSTEM_USER } from './seed';

/**
 * BRD §14.7 — the LOS-status idempotency safety net (FR-082) verified against a
 * REAL Postgres partial unique index (`uq_integration_idempotency`), which the
 * mocked-DB unit tests cannot exercise. A replayed event id must be rejected by
 * the DB; null keys (outbound logs) must remain unconstrained.
 */
describe('§14.7 integration_logs idempotency (FR-082)', () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 120_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  const insertWithKey = (key: string): Promise<unknown> =>
    ctx.pool.query(
      `INSERT INTO integration_logs (org_id, integration, direction, correlation_id, idempotency_key, status, created_by, updated_by)
       VALUES ($1,'los_status','inbound',$2,$3,'success',$4,$4)`,
      [ORG, 'corr-' + key, key, SYSTEM_USER],
    );

  it('rejects a replayed idempotency_key via the partial unique index', async () => {
    await insertWithKey('evt-dup');
    await expect(insertWithKey('evt-dup')).rejects.toThrow(/duplicate key|unique/i);
  });

  it('permits multiple NULL idempotency_key rows (partial index excludes NULLs)', async () => {
    const insertNull = (corr: string): Promise<unknown> =>
      ctx.pool.query(
        `INSERT INTO integration_logs (org_id, integration, direction, correlation_id, status, created_by, updated_by)
         VALUES ($1,'los_handoff','outbound',$2,'pending',$3,$3)`,
        [ORG, corr, SYSTEM_USER],
      );
    await insertNull('c-null-1');
    await insertNull('c-null-2');

    const { rows } = await ctx.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM integration_logs WHERE idempotency_key IS NULL",
    );
    expect(rows[0]!.n).toBeGreaterThanOrEqual(2);
  });
});
