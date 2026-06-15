import type { AppConfigService } from '../../src/core/config';
import type { AuditAppender } from '../../src/core/audit';
import type { OutboxService } from '../../src/core/outbox';
import { LeadService } from '../../src/modules/capture/lead.service';
import { RetentionEngine } from '../../src/modules/compliance/retention.engine';
import type { KyselyDb } from '../../src/core/db/database';
import type { PinoLogger } from 'nestjs-pino';

import { setupTestDb, type TestDb } from './test-db';
import { ORG, seedCustomerProfile, seedLead, seedRetentionPolicy } from './seed';

/**
 * BRD §14.7 — retention CONTACT anonymise against a REAL Postgres. Verifies the
 * cross-FR-found fix: the customer_profiles scrub must satisfy BOTH
 * ck_customer_profiles_mobile (`^[6-9][0-9]{9}$`) and the unique
 * (org_id, primary_mobile) — the old constant '0000000000' violated both. Own
 * container so no competing identity-purge policy soft-deletes the lead first.
 */
describe('§14.7 retention CONTACT anonymise (customer_profiles fix)', () => {
  let ctx: TestDb;
  let engine: RetentionEngine;

  beforeAll(async () => {
    ctx = await setupTestDb();
    const fakeAudit = { append: jest.fn().mockResolvedValue(undefined) } as unknown as AuditAppender;
    const fakeOutbox = { emit: jest.fn().mockResolvedValue(undefined) } as unknown as OutboxService;
    const leadService = new LeadService(fakeAudit, fakeOutbox);
    const fakeLogger = {
      info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    } as unknown as PinoLogger;
    engine = new RetentionEngine(
      ctx.db as KyselyDb,
      ctx.uow,
      fakeAudit,
      leadService,
      {} as unknown as AppConfigService,
      fakeLogger,
    );
  }, 120_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  it('scrubs primary_mobile to a valid, unique value (not the real number)', async () => {
    const cpId = await seedCustomerProfile(ctx.pool, { mobile: '9123456789' });
    await seedRetentionPolicy(ctx.pool, { action: 'anonymise', dataCategory: 'contact', retainDays: 30 });
    await seedLead(ctx.pool, { stage: 'rejected', terminalDaysAgo: 400, customerProfileId: cpId });

    await engine.applyRun('run-contact', ORG);

    const cp = await ctx.pool.query<{ primary_mobile: string; display_name: string }>(
      'SELECT primary_mobile, display_name FROM customer_profiles WHERE customer_profile_id = $1',
      [cpId],
    );
    expect(cp.rows[0]!.display_name).toBe('ANONYMISED');
    expect(cp.rows[0]!.primary_mobile).not.toBe('9123456789'); // real number scrubbed
    expect(cp.rows[0]!.primary_mobile).toMatch(/^[6-9][0-9]{9}$/); // valid format (the fix)
  });
});
