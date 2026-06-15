import { MirrorSource } from '@lms/shared';

import { LosApplicationMirrorRepository } from '../../src/modules/los/los-application-mirror.repository';
import type { KyselyDb } from '../../src/core/db/database';

import { setupTestDb, type TestDb } from './test-db';
import { ORG, seedLead } from './seed';

/**
 * BRD §14.7 — the FR-082 out-of-order safety net verified against the REAL
 * `los_application_mirrors` ON CONFLICT ... WHERE excluded.status_date > stored.
 * A delayed/replayed webhook with an older status_date must NOT regress the
 * mirror; a newer one must apply. The mocked-DB unit tests cannot exercise the
 * real conflict clause.
 */
describe('§14.7 LOS mirror out-of-order safety (FR-082)', () => {
  let ctx: TestDb;
  let repo: LosApplicationMirrorRepository;
  let leadId: string;
  const APP = 'LOS-T-0001';

  beforeAll(async () => {
    ctx = await setupTestDb();
    repo = new LosApplicationMirrorRepository(ctx.db as KyselyDb);
    ({ leadId } = await seedLead(ctx.pool, { stage: 'handed_off' }));
  }, 120_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  const upsert = (status: string, statusDate: Date): Promise<void> =>
    ctx.uow.run((tx) =>
      repo.upsertMirror(
        {
          orgId: ORG,
          leadId,
          losApplicationId: APP,
          status,
          statusDate,
          correlationId: 'corr-x',
          receivedVia: MirrorSource.WEBHOOK,
        },
        tx,
      ),
    );

  it('ignores an older status_date and applies a newer one (ON CONFLICT WHERE)', async () => {
    const t1 = new Date('2026-06-10T08:00:00Z');
    const t2 = new Date('2026-06-10T12:00:00Z');
    const t3 = new Date('2026-06-10T18:00:00Z');

    await upsert('CREDIT_APPRAISAL', t2);
    await upsert('SUBMITTED', t1); // older → the upsert WHERE skips the update

    const mid = await ctx.pool.query<{ status: string }>(
      'SELECT status FROM los_application_mirrors WHERE los_application_id = $1',
      [APP],
    );
    expect(mid.rows[0]!.status).toBe('CREDIT_APPRAISAL');

    await upsert('APPROVED', t3); // newer → updates
    const end = await ctx.pool.query<{ status: string }>(
      'SELECT status FROM los_application_mirrors WHERE los_application_id = $1',
      [APP],
    );
    expect(end.rows[0]!.status).toBe('APPROVED');
  });
});
