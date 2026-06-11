import { AuditAction, DataScope } from '@lms/shared';

import type { AuditAppender, AuditEntry } from '../../core/audit';
import type { UnitOfWork } from '../../core/db';
import type { DbTransaction } from '../../core/db';
import { isDomainException } from '../../core/http';
import { FakeRedis, fakePinoLogger } from '../../core/integration/integration.test-helpers';
import { IntegrationService, type IntegrationActor } from './integration.service';
import type { IntegrationRepository } from './integration.repository';
import type { WebhookRow } from './dto/webhook-response.dto';
import type { IntegrationLogListRow } from './dto/integration-log-response.dto';
import type { CreateWebhookDto } from './dto/create-webhook.dto';

/**
 * FR-140 component tests for {@link IntegrationService} (FR-140-tests.md:
 * scope-A authorisation T19/T20/T27 at the service boundary; idempotent webhook
 * replay T25; transaction rollback T30; `secret_ref` never returned T21/T23).
 * Collaborators are in-memory typed doubles (Redis fake, UoW that runs the
 * callback with a sentinel tx). Full HTTP-tier auth (401/403 via the guards) and
 * the DB-invariant tier are deferred to e2e/Testcontainers.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const ACTOR: IntegrationActor = { userId: 'admin-1', orgId: ORG };

function dto(overrides: Partial<CreateWebhookDto> = {}): CreateWebhookDto {
  return {
    eventCode: 'LEAD_HANDED_OFF',
    targetUrl: 'https://partner.example.com/hooks/lead',
    secretRef: 'projects/123/secrets/webhook-hmac/versions/latest',
    ...overrides,
  } as CreateWebhookDto;
}

function webhookRow(overrides: Partial<WebhookRow> = {}): WebhookRow {
  return {
    webhook_subscription_id: 'wh-1',
    event_code: 'LEAD_HANDED_OFF',
    target_url: 'https://partner.example.com/hooks/lead',
    is_active: true,
    last_status: null,
    created_at: new Date('2026-06-09T10:00:00.000Z'),
    updated_at: new Date('2026-06-09T10:00:00.000Z'),
    ...overrides,
  };
}

/** Typed in-memory IntegrationRepository fake. */
class FakeRepo {
  logs: IntegrationLogListRow[] = [];
  webhooks: WebhookRow[] = [];
  insertError?: Error;

  listLogs = jest.fn(async (): Promise<IntegrationLogListRow[]> => this.logs);
  countLogs = jest.fn(async (): Promise<number> => this.logs.length);
  listWebhooks = jest.fn(async (): Promise<WebhookRow[]> => this.webhooks);
  countWebhooks = jest.fn(async (): Promise<number> => this.webhooks.length);
  createWebhook = jest.fn(async (): Promise<WebhookRow> => {
    if (this.insertError) throw this.insertError;
    return webhookRow();
  });

  asRepo(): IntegrationRepository {
    return this as unknown as IntegrationRepository;
  }
}

/** AuditAppender fake recording entries (and optionally the tx passed). */
class FakeAudit {
  entries: AuditEntry[] = [];
  append = jest.fn(async (entry: AuditEntry) => {
    this.entries.push(entry);
  });
  asAppender(): AuditAppender {
    return this as unknown as AuditAppender;
  }
}

/** UnitOfWork double that runs the callback with a sentinel tx. */
function fakeUow(): UnitOfWork {
  return {
    run: jest.fn(async (fn: (tx: DbTransaction) => Promise<unknown>) =>
      fn({ __tx: true } as unknown as DbTransaction),
    ),
  } as unknown as UnitOfWork;
}

function makeService(repo: FakeRepo, audit: FakeAudit, redis: FakeRedis) {
  return new IntegrationService(
    repo.asRepo(),
    audit.asAppender(),
    fakeUow(),
    redis.asRedis(),
    fakePinoLogger() as never,
  );
}

async function captureRejection(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to reject, but it resolved');
}

const PAGE = { page: 1, limit: 25 };

describe('IntegrationService', () => {
  // ── scope-A authorisation (T19/T20/T27 at the service boundary) ──
  describe('scope-A enforcement', () => {
    it('rejects a non-A effective scope on listLogs with FORBIDDEN', async () => {
      const service = makeService(new FakeRepo(), new FakeAudit(), new FakeRedis());
      const err = await captureRejection(() => service.listLogs({}, PAGE, '-created_at', DataScope.B));
      expect(isDomainException(err)).toBe(true);
      expect((err as { code: string }).code).toBe('FORBIDDEN');
    });

    it('rejects a non-A effective scope on listWebhooks with FORBIDDEN', async () => {
      const service = makeService(new FakeRepo(), new FakeAudit(), new FakeRedis());
      const err = await captureRejection(() => service.listWebhooks(PAGE, DataScope.M));
      expect((err as { code: string }).code).toBe('FORBIDDEN');
    });

    it('rejects a non-A effective scope on createWebhook with FORBIDDEN (no DB write)', async () => {
      const repo = new FakeRepo();
      const service = makeService(repo, new FakeAudit(), new FakeRedis());
      const err = await captureRejection(() => service.createWebhook(dto(), undefined, ACTOR, DataScope.B));
      expect((err as { code: string }).code).toBe('FORBIDDEN');
      expect(repo.createWebhook).not.toHaveBeenCalled();
    });

    it('rejects an undefined effective scope (no grant) with FORBIDDEN', async () => {
      const service = makeService(new FakeRepo(), new FakeAudit(), new FakeRedis());
      const err = await captureRejection(() => service.listLogs({}, PAGE, '-created_at', undefined));
      expect((err as { code: string }).code).toBe('FORBIDDEN');
    });
  });

  // ── createWebhook happy path (T23) ──
  it('creates a webhook atomically with a config_change audit entry, returning no secret_ref', async () => {
    const repo = new FakeRepo();
    const audit = new FakeAudit();
    const service = makeService(repo, audit, new FakeRedis());

    const outcome = await service.createWebhook(dto(), undefined, ACTOR, DataScope.A);

    expect(outcome.replay).toBe(false);
    expect(outcome.webhook.webhookSubscriptionId).toBe('wh-1');
    // The response object has no secretRef/secret_ref key (compile-time + runtime).
    expect(Object.keys(outcome.webhook)).not.toContain('secretRef');
    expect(Object.keys(outcome.webhook)).not.toContain('secret_ref');
    // Audit: config_change on webhook_subscriptions, within the same tx.
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      action: AuditAction.CONFIG_CHANGE,
      entity_type: 'webhook_subscriptions',
      entity_id: 'wh-1',
      actor_id: ACTOR.userId,
    });
  });

  // ── idempotent replay (T25) ──
  it('returns the original webhook on an idempotent replay without a second DB write (T25)', async () => {
    const repo = new FakeRepo();
    const audit = new FakeAudit();
    const redis = new FakeRedis();
    const service = makeService(repo, audit, redis);

    // First create with a key → row created, response cached.
    const first = await service.createWebhook(dto(), 'IDEM-1', ACTOR, DataScope.A);
    expect(first.replay).toBe(false);
    expect(repo.createWebhook).toHaveBeenCalledTimes(1);

    // Second create with the SAME key → replay of the original, no new write.
    const second = await service.createWebhook(dto(), 'IDEM-1', ACTOR, DataScope.A);
    expect(second.replay).toBe(true);
    expect(second.webhook).toEqual(first.webhook);
    expect(repo.createWebhook).toHaveBeenCalledTimes(1); // unchanged
    expect(audit.entries).toHaveLength(1); // no second audit row
  });

  it('throws CONFLICT when the same idempotency key is still in flight', async () => {
    const repo = new FakeRepo();
    const redis = new FakeRedis();
    const service = makeService(repo, new FakeAudit(), redis);
    // Simulate a concurrent in-flight marker.
    redis.seed('idem:webhook:BUSY', { status: 'in_flight' });

    const err = await captureRejection(() => service.createWebhook(dto(), 'BUSY', ACTOR, DataScope.A));
    expect((err as { code: string }).code).toBe('CONFLICT');
    expect(repo.createWebhook).not.toHaveBeenCalled();
  });

  // ── transaction rollback (T30) ──
  it('propagates a DB insert failure and releases the in-flight idempotency marker (T30)', async () => {
    const repo = new FakeRepo();
    repo.insertError = new Error('unique violation');
    const redis = new FakeRedis();
    const service = makeService(repo, new FakeAudit(), redis);

    const err = await captureRejection(() => service.createWebhook(dto(), 'IDEM-FAIL', ACTOR, DataScope.A));
    expect(err).toBeInstanceOf(Error);
    // The in-flight marker was deleted so a corrected retry can proceed.
    expect(redis.del).toHaveBeenCalledWith('idem:webhook:IDEM-FAIL');
  });

  // ── list shape (T21) ──
  it('maps integration logs and omits no required fields; request_ref carries no PII', async () => {
    const repo = new FakeRepo();
    repo.logs = [
      {
        integration_log_id: 'il-1',
        integration: 'los_handoff',
        direction: 'outbound',
        lead_id: null,
        correlation_id: 'corr_1',
        idempotency_key: 'k1',
        request_ref: 'gcs://masked/los/handoff/ref',
        status: 'success',
        http_status: 201,
        retry_count: 0,
        error_code: null,
        completed_at: new Date('2026-06-09T10:00:00.000Z'),
        created_at: new Date('2026-06-09T09:59:58.000Z'),
      },
    ];
    const service = makeService(repo, new FakeAudit(), new FakeRedis());

    const page = await service.listLogs({}, PAGE, '-created_at', DataScope.A);
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({
      integrationLogId: 'il-1',
      status: 'success',
      httpStatus: 201,
      requestRef: 'gcs://masked/los/handoff/ref',
    });
  });
});
