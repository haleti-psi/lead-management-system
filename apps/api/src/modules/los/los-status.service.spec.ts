/**
 * FR-082 — LosStatusService unit tests.
 *
 * Covers: T03 (out-of-order), T04 (idempotent replay), T07 (unknown app id),
 * T11 (transaction rollback), T13 (poll reconcile success), T14 (poll upstream
 * failure), T15 (LIMIT 100), T18 (audit intent written), T19 (no PII in logs).
 *
 * API-integration tests (T01, T02, T05, T06, T08–T10, T12) are in the
 * controller spec file; E2E (T20) is deferred per manifest.
 */

import {
  AuditAction,
  ERROR_CODES,
  IntegrationKind,
  MirrorSource,
} from '@lms/shared';

import type { KyselyDb, DbTransaction, UnitOfWork } from '../../core/db';
import type { AuditAppender } from '../../core/audit';
import type { IntegrationGateway } from '../../core/integration/integration-gateway';
import type { IntegrationPort } from '../../core/integration/ports/integration-port';
import { SYSTEM_USER_ID } from '../../core/integration/integration.constants';
import { LosStatusService } from './los-status.service';
import type { LosApplicationMirrorRepository } from './los-application-mirror.repository';
import type { PinoLogger } from 'nestjs-pino';
import type { LosStatusWebhookDto } from './dto/los-status-webhook.dto';

// ── Constants ────────────────────────────────────────────────────────────────

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD_ID = 'b0000000-0000-0000-0000-00000000000b';
const APP_ID = 'LOS-2026-00123';
const EVENT_ID = 'evt_abc123';
const CORR_ID = 'corr_test_001';

const VALID_DTO: LosStatusWebhookDto = {
  event_id: EVENT_ID,
  los_application_id: APP_ID,
  status: 'CREDIT_APPRAISAL',
  status_date: '2026-06-09T10:30:00Z',
  correlation_id: CORR_ID,
  remarks: 'Moved to credit team',
};

const OLDER_DTO: LosStatusWebhookDto = {
  ...VALID_DTO,
  event_id: 'evt_older',
  status: 'SUBMITTED',
  status_date: '2026-06-09T08:00:00Z',
};

// ── Minimal chainable Kysely mock ────────────────────────────────────────────

function makeChain(value: unknown): Record<string, jest.Mock> {
  const q: Record<string, jest.Mock> = {};
  const methods = [
    'selectFrom', 'select', 'selectAll', 'insertInto', 'updateTable',
    'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'values',
    'returning', 'returningAll', 'set', 'execute',
  ];
  methods.forEach((m) => {
    q[m] = jest.fn().mockReturnValue(q);
  });
  q['executeTakeFirst'] = jest.fn().mockResolvedValue(value);
  q['executeTakeFirstOrThrow'] = jest.fn().mockResolvedValue(value);
  q['execute'] = jest.fn().mockResolvedValue(value !== null ? [value] : []);
  return q;
}

// ── Harness ───────────────────────────────────────────────────────────────────

interface HarnessOptions {
  existingIntegrationLog?: Record<string, unknown> | null;
  lead?: Record<string, unknown> | null;
  uowError?: Error | null;
  staleLeads?: Array<{ lead_id: string; los_application_id: string; org_id: string }>;
  pollResult?: { httpStatus: number; body: unknown } | Error;
}

function makeHarness(opts: HarnessOptions = {}) {
  const lead = opts.lead !== undefined
    ? opts.lead
    : { lead_id: LEAD_ID, org_id: ORG, stage: 'handed_off', version: 1, los_application_id: APP_ID };

  const existingIntegrationLog = opts.existingIntegrationLog !== undefined
    ? opts.existingIntegrationLog
    : null;

  const dbSelectFrom = jest.fn().mockImplementation((table: string) => {
    if (table === 'integration_logs') return makeChain(existingIntegrationLog);
    if (table === 'leads') return makeChain(lead);
    return makeChain(null);
  });
  const dbInsertInto = jest.fn().mockReturnValue(makeChain({ integration_log_id: 'il-001' }));

  const db = {
    selectFrom: dbSelectFrom,
    insertInto: dbInsertInto,
  } as unknown as KyselyDb;

  // TX mock that supports Kysely chain calls.
  const txInsertChain = makeChain(null);
  const tx = {
    insertInto: jest.fn().mockReturnValue(txInsertChain),
    selectFrom: jest.fn().mockReturnValue(makeChain(null)),
  } as unknown as DbTransaction;

  const uow = {
    run: jest.fn().mockImplementation(async (fn: (t: DbTransaction) => Promise<unknown>) => {
      if (opts.uowError) throw opts.uowError;
      return fn(tx);
    }),
  } as unknown as UnitOfWork;

  const upsertMirrorMock = jest.fn().mockResolvedValue(undefined);
  const findStaleLeadsMock = jest.fn().mockResolvedValue(
    opts.staleLeads ?? [{ lead_id: LEAD_ID, los_application_id: APP_ID, org_id: ORG }],
  );

  const mirrorRepository = {
    upsertMirror: upsertMirrorMock,
    findByLeadId: jest.fn().mockResolvedValue([]),
    findStaleHandedOffLeads: findStaleLeadsMock,
  } as unknown as LosApplicationMirrorRepository;

  const auditAppend = jest.fn().mockResolvedValue(undefined);
  const audit = { append: auditAppend } as unknown as AuditAppender;

  const gatewayCall = jest.fn();
  if (opts.pollResult instanceof Error) {
    gatewayCall.mockRejectedValue(opts.pollResult);
  } else if (opts.pollResult !== undefined) {
    gatewayCall.mockResolvedValue(opts.pollResult);
  } else {
    gatewayCall.mockResolvedValue({
      httpStatus: 200,
      body: { status: 'CREDIT_APPRAISAL', status_date: '2026-06-09T10:30:00Z' },
      idempotent: false,
    });
  }
  const integrationGateway = { call: gatewayCall } as unknown as IntegrationGateway;

  const losPort = {} as unknown as IntegrationPort;

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger;

  const service = new LosStatusService(
    db,
    losPort,
    uow,
    mirrorRepository,
    audit,
    integrationGateway,
    logger,
  );

  return {
    service,
    db: db as unknown as { selectFrom: jest.Mock; insertInto: jest.Mock },
    uow: uow as unknown as { run: jest.Mock },
    tx: tx as unknown as { insertInto: jest.Mock; selectFrom: jest.Mock },
    mirrorRepository: mirrorRepository as unknown as {
      upsertMirror: jest.Mock;
      findStaleHandedOffLeads: jest.Mock;
    },
    audit: audit as unknown as { append: jest.Mock },
    integrationGateway: integrationGateway as unknown as { call: jest.Mock },
    logger: logger as unknown as { info: jest.Mock; warn: jest.Mock },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LosStatusService — processStatusUpdate', () => {
  // T04 — idempotent replay (duplicate event_id)
  it('returns idempotentReplay=true and makes no DB writes when event_id already exists (T04)', async () => {
    const { service, mirrorRepository, audit } = makeHarness({
      existingIntegrationLog: {
        integration_log_id: 'il-existing',
        status: 'success',
      },
    });

    const result = await service.processStatusUpdate(VALID_DTO, MirrorSource.WEBHOOK, CORR_ID);

    expect(result.idempotentReplay).toBe(true);
    expect(mirrorRepository.upsertMirror).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  // T07 — unknown los_application_id (lead not found)
  it('returns 200 (idempotentReplay=false) and writes failed integration_log when app id unknown (T07)', async () => {
    const { service, db, mirrorRepository } = makeHarness({ lead: null });

    const result = await service.processStatusUpdate(VALID_DTO, MirrorSource.WEBHOOK, CORR_ID);

    expect(result.idempotentReplay).toBe(false);
    expect(mirrorRepository.upsertMirror).not.toHaveBeenCalled();
    // Writes a failed integration_log entry with error_code = UNKNOWN_APP_ID.
    expect(db.insertInto).toHaveBeenCalledWith('integration_logs');
  });

  // T03 — out-of-order delivery (upsertMirror called; WHERE clause in repo skips update)
  it('calls upsertMirror even for older status_date (repo WHERE clause handles skip) (T03)', async () => {
    const { service, mirrorRepository, audit } = makeHarness();

    const result = await service.processStatusUpdate(OLDER_DTO, MirrorSource.WEBHOOK, CORR_ID);

    expect(result.idempotentReplay).toBe(false);
    // The service calls upsertMirror; the repo's WHERE clause prevents the update.
    expect(mirrorRepository.upsertMirror).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OLDER_DTO.status,
        losApplicationId: APP_ID,
        receivedVia: MirrorSource.WEBHOOK,
      }),
      expect.anything(),
    );
    // Audit should still be written (observability, even on no-op upsert).
    expect(audit.append).toHaveBeenCalled();
  });

  // T11 — transaction rollback on DB failure
  it('propagates UoW error (transaction rollback) — no partial state (T11)', async () => {
    const txError = new Error('DB write failed');
    const { service, mirrorRepository } = makeHarness({ uowError: txError });

    await expect(
      service.processStatusUpdate(VALID_DTO, MirrorSource.WEBHOOK, CORR_ID),
    ).rejects.toThrow('DB write failed');
    // upsertMirror is called inside UoW — if UoW throws before fn() runs,
    // it should not have been called.
    expect(mirrorRepository.upsertMirror).not.toHaveBeenCalled();
  });

  // T18 — audit intent written on successful processing
  it('calls AuditAppender.append with action=handoff_success and correct detail (T18)', async () => {
    const { service, audit } = makeHarness();

    await service.processStatusUpdate(VALID_DTO, MirrorSource.WEBHOOK, CORR_ID);

    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.HANDOFF_SUCCESS,
        entity_type: 'los_application_mirrors',
        actor_id: SYSTEM_USER_ID,
        lead_id: LEAD_ID,
        detail: expect.objectContaining({
          los_application_id: APP_ID,
          new_status: VALID_DTO.status,
          status_date: VALID_DTO.status_date,
          received_via: MirrorSource.WEBHOOK,
        }),
      }),
      expect.anything(), // tx
    );
  });

  // T19 — no PII / no secret in logs
  it('does not log status values or any raw webhook payload content (T19)', async () => {
    const { service, logger } = makeHarness();

    await service.processStatusUpdate(VALID_DTO, MirrorSource.WEBHOOK, CORR_ID);

    // Logger was called but must not contain status field value (possible PII risk)
    // or any raw body content.
    const allLogCalls = [
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
    ].flat();

    // No call should contain 'CREDIT_APPRAISAL' (LOS status value) or remarks content.
    for (const arg of allLogCalls) {
      if (typeof arg === 'string') {
        expect(arg).not.toContain('CREDIT_APPRAISAL');
        expect(arg).not.toContain('Moved to credit team');
      } else if (typeof arg === 'object' && arg !== null) {
        expect(JSON.stringify(arg)).not.toContain('CREDIT_APPRAISAL');
        expect(JSON.stringify(arg)).not.toContain('Moved to credit team');
      }
    }
  });

  // Integration_logs insert uses correct fields on success path
  it('inserts integration_logs with direction=inbound, status=success, idempotency_key=event_id', async () => {
    const { service, tx } = makeHarness();

    await service.processStatusUpdate(VALID_DTO, MirrorSource.WEBHOOK, CORR_ID);

    expect(tx.insertInto).toHaveBeenCalledWith('integration_logs');
    const valuesCall = (tx.insertInto as jest.Mock).mock.results[0]?.value;
    const valuesMock = valuesCall?.values as jest.Mock | undefined;
    if (valuesMock) {
      const inserted = valuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(inserted?.['integration']).toBe(IntegrationKind.LOS_STATUS);
      expect(inserted?.['direction']).toBe('inbound');
      expect(inserted?.['status']).toBe('success');
      expect(inserted?.['idempotency_key']).toBe(EVENT_ID);
      expect(inserted?.['lead_id']).toBe(LEAD_ID);
    }
  });

  // Mirror upsert uses correct receivedVia
  it('calls upsertMirror with receivedVia=webhook on webhook path', async () => {
    const { service, mirrorRepository } = makeHarness();

    await service.processStatusUpdate(VALID_DTO, MirrorSource.WEBHOOK, CORR_ID);

    expect(mirrorRepository.upsertMirror).toHaveBeenCalledWith(
      expect.objectContaining({ receivedVia: MirrorSource.WEBHOOK }),
      expect.anything(),
    );
  });

  it('calls upsertMirror with receivedVia=poll on poll path', async () => {
    const pollDto = { ...VALID_DTO, event_id: `poll-${APP_ID}-run123` };
    const { service, mirrorRepository } = makeHarness();

    await service.processStatusUpdate(pollDto, MirrorSource.POLL, CORR_ID);

    expect(mirrorRepository.upsertMirror).toHaveBeenCalledWith(
      expect.objectContaining({ receivedVia: MirrorSource.POLL }),
      expect.anything(),
    );
  });
});

// ── Reconciliation tests ─────────────────────────────────────────────────────

describe('LosStatusService — reconcile', () => {
  // T13 — poll reconcile success path
  it('calls IntegrationGateway and processStatusUpdate for each stale lead (T13)', async () => {
    const { service, integrationGateway, mirrorRepository } = makeHarness({
      staleLeads: [{ lead_id: LEAD_ID, los_application_id: APP_ID, org_id: ORG }],
      pollResult: {
        httpStatus: 200,
        body: { status: 'CREDIT_APPRAISAL', status_date: '2026-06-09T12:00:00Z' },
      },
    });

    const result = await service.reconcile();

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(integrationGateway.call).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        integration: IntegrationKind.LOS_STATUS,
        leadId: LEAD_ID,
      }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining('los-poll-') }),
    );
    // Mirror upsert called for the poll event.
    expect(mirrorRepository.upsertMirror).toHaveBeenCalledWith(
      expect.objectContaining({ receivedVia: MirrorSource.POLL }),
      expect.anything(),
    );
  });

  // T14 — poll reconcile with upstream failure
  it('logs failure, continues batch, increments failed count on upstream error (T14)', async () => {
    const upstreamError = new Error('LOS timeout');
    const { service, integrationGateway, logger, mirrorRepository } = makeHarness({
      staleLeads: [{ lead_id: LEAD_ID, los_application_id: APP_ID, org_id: ORG }],
      pollResult: upstreamError,
    });

    const result = await service.reconcile();

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);
    // No mirror upsert on failure.
    expect(mirrorRepository.upsertMirror).not.toHaveBeenCalled();
    // Logger.warn was called with the failure.
    expect(logger.warn).toHaveBeenCalled();
    // IntegrationGateway.call was attempted.
    expect(integrationGateway.call).toHaveBeenCalled();
  });

  // T15 — LIMIT 100 enforced on stale-leads query
  it('passes staleThresholdDate to findStaleHandedOffLeads (LIMIT enforced in repo) (T15)', async () => {
    const { service, mirrorRepository } = makeHarness({
      staleLeads: [],
    });

    await service.reconcile();

    // Verify the repo was called with a Date argument.
    expect(mirrorRepository.findStaleHandedOffLeads).toHaveBeenCalledWith(
      expect.any(Date),
    );
    // The date should be ~60 minutes in the past.
    const calledWith = mirrorRepository.findStaleHandedOffLeads.mock.calls[0]?.[0] as Date;
    const ageMs = Date.now() - calledWith.getTime();
    expect(ageMs).toBeGreaterThan(59 * 60 * 1000);
    expect(ageMs).toBeLessThan(61 * 60 * 1000);
  });

  // Multi-lead batch: partial failure does not abort the rest
  it('processes other leads even when one fails (partial batch resilience)', async () => {
    const LEAD_2 = 'c0000000-0000-0000-0000-00000000000c';
    const APP_2 = 'LOS-2026-00124';

    const { service, integrationGateway } = makeHarness({
      staleLeads: [
        { lead_id: LEAD_ID, los_application_id: APP_ID, org_id: ORG },
        { lead_id: LEAD_2, los_application_id: APP_2, org_id: ORG },
      ],
    });

    // First call fails; second succeeds.
    (integrationGateway.call as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Timeout on first lead');
    }).mockResolvedValueOnce({
      httpStatus: 200,
      body: { status: 'APPROVED', status_date: '2026-06-09T12:00:00Z' },
    });

    const result = await service.reconcile();

    // Second lead processed despite first failure.
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    expect(integrationGateway.call).toHaveBeenCalledTimes(2);
  });

  // Reconcile-failure observability: the failed integration_log must carry the
  // real lead_id and org_id (not the seed-org default) so it is attributable.
  it('writes a failed integration_log carrying lead_id and org_id on poll failure', async () => {
    const { service, db } = makeHarness({
      staleLeads: [{ lead_id: LEAD_ID, los_application_id: APP_ID, org_id: ORG }],
      pollResult: new Error('LOS unavailable'),
    });

    await service.reconcile();

    const failedValues = (db.insertInto as jest.Mock).mock.results
      .map((r) => ((r.value as { values?: jest.Mock })?.values)?.mock.calls?.[0]?.[0])
      .find((v): v is Record<string, unknown> => !!v && v['status'] === 'failed');

    expect(failedValues?.['lead_id']).toBe(LEAD_ID);
    expect(failedValues?.['org_id']).toBe(ORG);
    expect(failedValues?.['error_code']).toBe(ERROR_CODES.UPSTREAM_UNAVAILABLE);
  });
});

// ── Idempotency safety net (DB unique constraint path) ───────────────────────

describe('LosStatusService — concurrent duplicate delivery (T12)', () => {
  it('returns idempotentReplay=true for a second call with the same event_id (DB unique path)', async () => {
    // Simulate: the second call sees the row created by the first.
    let integrationLogSelectCount = 0;
    const dbSelectFrom = jest.fn().mockImplementation((table: string) => {
      if (table === 'integration_logs') {
        integrationLogSelectCount += 1;
        // First call sees no existing row; second call sees the row.
        const row = integrationLogSelectCount > 1
          ? { integration_log_id: 'il-001', status: 'success' }
          : null;
        return makeChain(row);
      }
      return makeChain({
        lead_id: LEAD_ID, org_id: ORG, stage: 'handed_off', version: 1, los_application_id: APP_ID,
      });
    });
    const db = { selectFrom: dbSelectFrom, insertInto: jest.fn().mockReturnValue(makeChain(null)) } as unknown as KyselyDb;
    const uow = {
      run: jest.fn().mockImplementation(async (fn: (t: DbTransaction) => Promise<unknown>) =>
        fn({ insertInto: jest.fn().mockReturnValue(makeChain(null)), selectFrom: jest.fn().mockReturnValue(makeChain(null)) } as unknown as DbTransaction)
      ),
    } as unknown as UnitOfWork;
    const mirrorRepository = {
      upsertMirror: jest.fn().mockResolvedValue(undefined),
      findStaleHandedOffLeads: jest.fn().mockResolvedValue([]),
    } as unknown as LosApplicationMirrorRepository;
    const audit = { append: jest.fn().mockResolvedValue(undefined) } as unknown as AuditAppender;
    const integrationGateway = { call: jest.fn() } as unknown as IntegrationGateway;
    const losPort = {} as unknown as IntegrationPort;
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as PinoLogger;

    const service = new LosStatusService(db, losPort, uow, mirrorRepository, audit, integrationGateway, logger);

    const result1 = await service.processStatusUpdate(VALID_DTO, MirrorSource.WEBHOOK, CORR_ID);
    const result2 = await service.processStatusUpdate(VALID_DTO, MirrorSource.WEBHOOK, CORR_ID);

    expect(result1.idempotentReplay).toBe(false);
    expect(result2.idempotentReplay).toBe(true);
    // Only one mirror upsert (first call).
    expect((mirrorRepository.upsertMirror as jest.Mock)).toHaveBeenCalledTimes(1);
  });
});
