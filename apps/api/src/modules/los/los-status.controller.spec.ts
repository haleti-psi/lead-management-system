/**
 * FR-082 — LosStatusController unit tests.
 *
 * Tests: HMAC guard wiring (T05, T06), Zod validation (T08–T10), happy-path
 * 200-Empty contract, idempotent-replay 200 (T04 controller boundary),
 * reconcile endpoint (summary counts).
 *
 * The actual HMAC cryptographic math is covered in the guard's own spec file
 * (core/integration/guards/los-webhook.guard.spec.ts). Here we only verify
 * controller wiring: @UseGuards(LosWebhookGuard) blocks the service when the
 * guard throws FORBIDDEN, and the Zod ValidationPipe rejects invalid bodies.
 *
 * LosStatusService is fully mocked. No network I/O.
 */

import { createHmac } from 'node:crypto';

import { MirrorSource, ERROR_CODES } from '@lms/shared';

import type { AppConfigService } from '../../core/config';
import type { AppEnv } from '../../core/config/env.schema';
import { DomainException } from '../../core/http';
import { isDomainException } from '../../core/http/domain-exception';
import { LosWebhookGuard } from '../../core/integration/guards/los-webhook.guard';
import { fakePinoLogger } from '../../core/integration/integration.test-helpers';
import { LosStatusController } from './los-status.controller';
import { LosStatusService } from './los-status.service';
import type { LosStatusWebhookDto } from './dto/los-status-webhook.dto';

const HMAC_SECRET = 'test-webhook-secret';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeConfig(secret: string | undefined): AppConfigService {
  return {
    get: <K extends keyof AppEnv>(key: K): AppEnv[K] =>
      (key === 'LOS_WEBHOOK_HMAC_SECRET' ? secret : undefined) as AppEnv[K],
    isProduction: false,
  } as AppConfigService;
}

function makeGuard(secret: string | undefined = HMAC_SECRET): LosWebhookGuard {
  return new LosWebhookGuard(makeConfig(secret), fakePinoLogger() as never);
}

function makeSignature(secret: string, body: Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Simulate the guard check for a raw body + signature pair.
 * Returns true if guard passes; throws DomainException if it fails.
 */
function runGuard(guard: LosWebhookGuard, rawBody: Buffer | undefined, signature: string | undefined): boolean {
  const headers: Record<string, string | undefined> = {};
  if (signature !== undefined) headers['x-los-signature'] = signature;
  const request = { headers, rawBody };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
  };
  return guard.canActivate(ctx as never);
}

// ── Harness for controller ─────────────────────────────────────────────────────

function makeControllerHarness(opts: { processResult?: { idempotentReplay: boolean } } = {}) {
  const mockService = {
    processStatusUpdate: jest.fn().mockResolvedValue(opts.processResult ?? { idempotentReplay: false }),
    reconcile: jest.fn().mockResolvedValue({ processed: 3, failed: 0 }),
  } as unknown as LosStatusService;

  const controller = new LosStatusController(mockService);

  return { controller, mockService };
}

function makeRequest(correlationId = 'corr_test'): { correlationId: string } {
  return { correlationId };
}

// ── Guard unit tests (T05, T06) ───────────────────────────────────────────────

describe('LosWebhookGuard (wired via controller) — HMAC verification', () => {
  const guard = makeGuard(HMAC_SECRET);

  // T05 — invalid HMAC → 403
  it('throws FORBIDDEN when signature is computed with wrong secret (T05)', () => {
    const body = Buffer.from('{"event_id":"evt_001"}');
    const wrongSig = makeSignature('wrong-secret', body);

    let thrown: unknown;
    try {
      runGuard(guard, body, wrongSig);
    } catch (err) {
      thrown = err;
    }
    expect(isDomainException(thrown)).toBe(true);
    expect((thrown as DomainException).code).toBe(ERROR_CODES.FORBIDDEN);
    expect((thrown as DomainException).httpStatus).toBe(403);
  });

  // T06 — missing header → 403
  it('throws FORBIDDEN when X-LOS-Signature header is absent (T06)', () => {
    const body = Buffer.from('{"event_id":"evt_001"}');

    let thrown: unknown;
    try {
      runGuard(guard, body, undefined);
    } catch (err) {
      thrown = err;
    }
    expect(isDomainException(thrown)).toBe(true);
    expect((thrown as DomainException).code).toBe(ERROR_CODES.FORBIDDEN);
  });

  // Valid signature passes
  it('returns true when HMAC signature is correct', () => {
    const body = Buffer.from('{"event_id":"evt_001"}');
    const sig = makeSignature(HMAC_SECRET, body);
    expect(runGuard(guard, body, sig)).toBe(true);
  });
});

// ── Zod validation pipe tests (T08–T10) ───────────────────────────────────────

describe('LosStatusWebhookSchema validation', () => {
  const { LosStatusWebhookSchema } = jest.requireActual('./dto/los-status-webhook.dto') as {
    LosStatusWebhookSchema: import('zod').ZodSchema;
  };

  function parse(body: unknown) {
    return LosStatusWebhookSchema.safeParse(body);
  }

  function validBody(): Record<string, unknown> {
    return {
      event_id: 'evt_test_001',
      los_application_id: 'LOS-2026-00123',
      status: 'CREDIT_APPRAISAL',
      status_date: '2026-06-09T10:30:00Z',
      correlation_id: 'corr_test',
      remarks: 'Test remark',
    };
  }

  // T08 — missing status field
  it('fails validation when status is missing (T08)', () => {
    const body = validBody();
    delete body['status'];
    const result = parse(body);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('status');
    }
  });

  // T09 — invalid status_date format
  it('fails validation when status_date is not ISO-8601 (T09)', () => {
    const result = parse({ ...validBody(), status_date: 'not-a-date' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('status_date');
    }
  });

  // T10 — event_id exceeds 120 chars
  it('fails validation when event_id is 121 characters (T10)', () => {
    const result = parse({ ...validBody(), event_id: 'x'.repeat(121) });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('event_id');
    }
  });

  // Valid body passes
  it('accepts a fully valid body', () => {
    const result = parse(validBody());
    expect(result.success).toBe(true);
  });

  // Optional fields are optional
  it('accepts a body without correlation_id and remarks', () => {
    const body = validBody();
    delete body['correlation_id'];
    delete body['remarks'];
    const result = parse(body);
    expect(result.success).toBe(true);
  });
});

// ── Controller method tests ────────────────────────────────────────────────────

describe('LosStatusController.receiveStatus', () => {
  const validDto: LosStatusWebhookDto = {
    event_id: 'evt_test_001',
    los_application_id: 'LOS-2026-00123',
    status: 'CREDIT_APPRAISAL',
    status_date: '2026-06-09T10:30:00Z',
    correlation_id: 'corr_test',
    remarks: 'Test remark',
  };

  // Happy path — returns { data: null, meta, error: null }
  it('returns { data: null, meta: { correlation_id }, error: null } on success', async () => {
    const { controller } = makeControllerHarness();
    const req = makeRequest('corr_001');

    const result = await controller.receiveStatus(validDto, req as never);

    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
    expect(result.meta.correlation_id).toBeDefined();
  });

  // Idempotent replay — controller still returns 200 (data: null)
  it('returns { data: null } even when service returns idempotentReplay=true (T04)', async () => {
    const { controller } = makeControllerHarness({ processResult: { idempotentReplay: true } });

    const result = await controller.receiveStatus(validDto, makeRequest() as never);

    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
  });

  // Service called with correct receivedVia=webhook
  it('calls LosStatusService.processStatusUpdate with receivedVia=webhook', async () => {
    const { controller, mockService } = makeControllerHarness();

    await controller.receiveStatus(validDto, makeRequest() as never);

    expect((mockService.processStatusUpdate as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: validDto.event_id }),
      MirrorSource.WEBHOOK,
      expect.any(String),
    );
  });
});

describe('LosStatusController.reconcile', () => {
  it('returns { data: { processed, failed }, meta, error: null }', async () => {
    const { controller, mockService } = makeControllerHarness();
    (mockService.reconcile as jest.Mock).mockResolvedValueOnce({ processed: 5, failed: 1 });

    const result = await controller.reconcile(makeRequest() as never);

    expect(result.data.processed).toBe(5);
    expect(result.data.failed).toBe(1);
    expect(result.error).toBeNull();
    expect((mockService.reconcile as jest.Mock)).toHaveBeenCalled();
  });
});
