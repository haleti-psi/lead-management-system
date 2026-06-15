import { setupTestDb, type TestDb } from './test-db';

/**
 * Smoke test for the Testcontainers integration harness: proves a real Postgres
 * 15 starts, ALL Flyway migrations apply in order, and the V1 seed + the latest
 * migration (V5 TASK_OVERDUE) are present. De-risks the harness before the
 * scenario suites.
 */
describe('integration harness (Testcontainers + Flyway migrations)', () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 120_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  it('applies every migration and seeds the default org', async () => {
    const org = await ctx.db.selectFrom('orgs').selectAll().executeTakeFirst();
    expect(org).toBeDefined();
  });

  it('applied V5 (TASK_OVERDUE added to the event_code enum)', async () => {
    const { rows } = await ctx.pool.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum e
         JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'event_code' AND enumlabel = 'TASK_OVERDUE'`,
    );
    expect(rows).toHaveLength(1);
  });
});
