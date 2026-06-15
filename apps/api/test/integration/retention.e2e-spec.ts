import type { AppConfigService } from '../../src/core/config';
import type { AuditAppender } from '../../src/core/audit';
import type { OutboxService } from '../../src/core/outbox';
import { LeadService } from '../../src/modules/capture/lead.service';
import { RetentionEngine } from '../../src/modules/compliance/retention.engine';
import type { KyselyDb } from '../../src/core/db/database';
import type { PinoLogger } from 'nestjs-pino';

import { setupTestDb, type TestDb } from './test-db';
import { ORG, seedLead, seedOpenGrievance, seedRetentionPolicy } from './seed';

/**
 * BRD §14.7 — retention purge against a REAL Postgres (FR-115). Verifies the
 * cross-FR-fixed behaviour end-to-end on real DDL: (1) an eligible terminal lead
 * is soft-deleted through LeadService (C1 — version bumped) with its identity
 * anonymised in the same transaction; (2) a lead with an open grievance is
 * excluded by the NOT EXISTS safety filter. Mocked-DB unit tests cannot prove
 * the real SQL (NOT EXISTS, the multi-table tx, the version guard).
 */
describe('§14.7 retention purge (FR-115 / cross-FR C1)', () => {
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

  it('soft-deletes an eligible lead via LeadService (version bumped) + anonymises identity', async () => {
    await seedRetentionPolicy(ctx.pool, { action: 'purge', retainDays: 30 });
    const { leadId, leadIdentityId } = await seedLead(ctx.pool, {
      stage: 'rejected',
      terminalDaysAgo: 400,
      name: 'Real Name',
    });

    await engine.applyRun('run-eligible', ORG);

    const lead = await ctx.pool.query<{ deleted_at: Date | null; version: number }>(
      'SELECT deleted_at, version FROM leads WHERE lead_id = $1',
      [leadId],
    );
    expect(lead.rows[0]!.deleted_at).not.toBeNull(); // C1 soft-delete applied
    expect(lead.rows[0]!.version).toBe(2); // version bumped by LeadService.softDeleteForRetention

    const ident = await ctx.pool.query<{ name: string }>(
      'SELECT name FROM lead_identities WHERE lead_identity_id = $1',
      [leadIdentityId],
    );
    expect(ident.rows[0]!.name).toBe('ANONYMISED'); // anonymised in the same tx
  });

  it('excludes a lead with an open grievance (NOT EXISTS safety filter)', async () => {
    await seedRetentionPolicy(ctx.pool, { action: 'purge', retainDays: 30 });
    const { leadId } = await seedLead(ctx.pool, {
      stage: 'rejected',
      terminalDaysAgo: 400,
      name: 'Held Name',
    });
    await seedOpenGrievance(ctx.pool, leadId);

    await engine.applyRun('run-held', ORG);

    const lead = await ctx.pool.query<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM leads WHERE lead_id = $1',
      [leadId],
    );
    expect(lead.rows[0]!.deleted_at).toBeNull(); // excluded — never purged
  });
});
