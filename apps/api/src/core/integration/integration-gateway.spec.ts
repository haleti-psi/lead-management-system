import { IntegrationKind } from '@lms/shared';

import { isDomainException } from '../http/domain-exception';
import { CircuitBreakerService } from './circuit-breaker.service';
import { IntegrationGateway } from './integration-gateway';
import {
  CB_OPEN_ERROR_CODE,
  CIRCUIT_BREAKER_THRESHOLD,
  IDEM_STATE,
  MAX_RETRIES,
  REDIS_KEYS,
} from './integration.constants';
import { ProviderCallError } from './ports/provider-response';
import type { IntegrationRequest } from './ports/integration-port';
import {
  FakeIntegrationLogRepo,
  FakePort,
  FakeRedis,
  FakeRetryQueue,
  fakePinoLogger,
} from './integration.test-helpers';

/**
 * FR-140 unit tests for {@link IntegrationGateway} + {@link CircuitBreakerService}
 * (FR-140-tests.md T01–T08, plus the caller-facing UPSTREAM_UNAVAILABLE slice of
 * T29). All collaborators are in-memory typed doubles — no Redis/Postgres/GCP —
 * so the resilience pipeline is asserted deterministically. The Testcontainers
 * tier (true DB invariants INV-01..06) is deferred.
 */

const KIND = IntegrationKind.LOS_HANDOFF;

function baseRequest(overrides: Partial<IntegrationRequest> = {}): IntegrationRequest {
  return {
    integration: KIND,
    leadId: null,
    correlationId: 'corr_test_1',
    maskedRequestRef: 'gcs://masked/los/handoff/ref',
    payload: {},
    ...overrides,
  };
}

function makeGateway() {
  const redis = new FakeRedis();
  const breaker = new CircuitBreakerService(redis.asRedis());
  const logRepo = new FakeIntegrationLogRepo();
  const retryQueue = new FakeRetryQueue();
  const logger = fakePinoLogger();
  const gateway = new IntegrationGateway(
    redis.asRedis(),
    breaker,
    logRepo as unknown as ConstructorParameters<typeof IntegrationGateway>[2],
    retryQueue,
    logger as never,
  );
  return { gateway, redis, breaker, logRepo, retryQueue };
}

async function captureRejection(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to reject, but it resolved');
}

describe('IntegrationGateway', () => {
  // T01 — idempotency replay returns the cached result; adapter never called.
  it('returns the cached result on an idempotency-key replay without calling the adapter', async () => {
    const { gateway, redis, logRepo } = makeGateway();
    redis.seed(REDIS_KEYS.gatewayIdem('KEY1'), {
      status: IDEM_STATE.SUCCESS,
      result: JSON.stringify({ httpStatus: 201, body: { applicationId: 'app-1' } }),
    });
    const port = new FakePort({ status: 500 }); // would fail if called

    const result = await gateway.call(port, baseRequest(), { idempotencyKey: 'KEY1' });

    expect(result.idempotent).toBe(true);
    expect(result.httpStatus).toBe(201);
    expect(result.body).toEqual({ applicationId: 'app-1' });
    expect(port.calls).toBe(0);
    expect(logRepo.createLog).not.toHaveBeenCalled();
  });

  // T02 — a pending integration_logs row is written before the adapter is called.
  it('writes a pending integration_logs row before dispatching to the adapter', async () => {
    const { gateway, logRepo } = makeGateway();
    let createOrder = -1;
    let callOrder = -1;
    let tick = 0;
    logRepo.createLog.mockImplementation(async (params) => {
      createOrder = tick++;
      logRepo.created.push(params);
      return { integration_log_id: 'log-1' };
    });
    const port = new FakePort({ status: 201 });
    port.call.mockImplementation(async () => {
      callOrder = tick++;
      return { httpStatus: 201, body: {} };
    });

    await gateway.call(port, baseRequest(), { idempotencyKey: 'NEW1' });

    expect(logRepo.created[0]).toMatchObject({ idempotencyKey: 'NEW1', integration: KIND });
    expect(createOrder).toBeGreaterThanOrEqual(0);
    expect(callOrder).toBeGreaterThan(createOrder); // pending row precedes the call
  });

  // T03 — success updates the log to success and caches the idempotent result.
  it('updates the log to success on a 2xx and caches the idempotency result', async () => {
    const { gateway, redis, logRepo } = makeGateway();
    const port = new FakePort({ status: 201, body: { ok: 1 } });

    const result = await gateway.call(port, baseRequest(), { idempotencyKey: 'KEY3' });

    expect(result.idempotent).toBe(false);
    const update = logRepo.lastStatusFor('log-1');
    expect(update).toMatchObject({ status: 'success', httpStatus: 201 });
    const cached = await redis.hgetall(REDIS_KEYS.gatewayIdem('KEY3'));
    expect(cached.status).toBe(IDEM_STATE.SUCCESS);
    expect(JSON.parse(cached.result)).toEqual({ httpStatus: 201, body: { ok: 1 } });
  });

  // T04 — a provider 5xx with retries remaining → retrying + Cloud Tasks retry.
  it('sets the log to retrying and enqueues a Cloud Tasks retry on a 5xx (retry_count < max)', async () => {
    const { gateway, logRepo, retryQueue } = makeGateway();
    const port = new FakePort({ throwError: new ProviderCallError('UPSTREAM_503') });

    const err = await captureRejection(() =>
      gateway.call(port, baseRequest(), { retryCount: 0 }),
    );

    expect(isDomainException(err)).toBe(true);
    expect((err as { code: string }).code).toBe('UPSTREAM_UNAVAILABLE');
    expect((err as { httpStatus: number }).httpStatus).toBe(503);
    expect(logRepo.lastStatusFor('log-1')).toMatchObject({ status: 'retrying', retryCount: 1 });
    expect(retryQueue.enqueueRetry).toHaveBeenCalledTimes(1);
    expect(retryQueue.retries[0]).toMatchObject({ integration: KIND, retryCount: 1 });
    expect(retryQueue.enqueueDeadLetter).not.toHaveBeenCalled();
  });

  // T05 — at max retries, the log goes failed (final) and a dead-letter is enqueued.
  it('sets the log to failed and enqueues a dead-letter task when retries are exhausted', async () => {
    const { gateway, logRepo, retryQueue } = makeGateway();
    const port = new FakePort({ throwError: new ProviderCallError('UPSTREAM_503') });

    const err = await captureRejection(() =>
      gateway.call(port, baseRequest(), { retryCount: MAX_RETRIES }),
    );

    expect((err as { code: string }).code).toBe('UPSTREAM_UNAVAILABLE');
    expect(logRepo.lastStatusFor('log-1')).toMatchObject({ status: 'failed' });
    expect(retryQueue.enqueueRetry).not.toHaveBeenCalled();
    expect(retryQueue.enqueueDeadLetter).toHaveBeenCalledTimes(1);
    expect(retryQueue.deadLetters[0]).toMatchObject({ integration: KIND, retryCount: MAX_RETRIES });
  });

  // T06 — the circuit opens after the threshold of consecutive failures.
  it('opens the circuit after the threshold of consecutive failures', async () => {
    const { gateway, redis } = makeGateway();
    // Seed the counter so the NEXT failure reaches the threshold.
    redis.seedCounter(REDIS_KEYS.circuitFailures(KIND), CIRCUIT_BREAKER_THRESHOLD - 1);
    const port = new FakePort({ throwError: new ProviderCallError('UPSTREAM_503') });

    await captureRejection(() => gateway.call(port, baseRequest(), { retryCount: 0 }));

    const state = await redis.hgetall(REDIS_KEYS.circuitState(KIND));
    expect(state.state).toBe('open');
    expect(Number(state.opens_at)).toBeGreaterThan(Date.now());
  });

  // T07 — an open circuit fast-fails with 503 + CB_OPEN, never calling the adapter.
  it('fast-fails with UPSTREAM_UNAVAILABLE (CB_OPEN) when the circuit is open, without calling the adapter', async () => {
    const { gateway, redis, logRepo } = makeGateway();
    redis.seed(REDIS_KEYS.circuitState(KIND), {
      state: 'open',
      opens_at: String(Date.now() + 60_000),
    });
    const port = new FakePort({ status: 200 });

    const err = await captureRejection(() => gateway.call(port, baseRequest()));

    expect((err as { code: string }).code).toBe('UPSTREAM_UNAVAILABLE');
    expect((err as { detail?: { reason?: string } }).detail?.reason).toBe(CB_OPEN_ERROR_CODE);
    expect(port.calls).toBe(0);
    expect(logRepo.createFailFastLog).toHaveBeenCalledTimes(1);
    expect(logRepo.failFast[0]).toMatchObject({ errorCode: CB_OPEN_ERROR_CODE });
    // No normal pending row is created on a fast-fail.
    expect(logRepo.createLog).not.toHaveBeenCalled();
  });

  // T08 — a successful half-open probe clears the breaker state and counter.
  it('clears the circuit state and failure counter on a successful half-open probe', async () => {
    const { gateway, redis, logRepo } = makeGateway();
    redis.seed(REDIS_KEYS.circuitState(KIND), { state: 'half_open' });
    redis.seedCounter(REDIS_KEYS.circuitFailures(KIND), 3);
    const port = new FakePort({ status: 200 });

    const result = await gateway.call(port, baseRequest());

    expect(result.httpStatus).toBe(200);
    expect(logRepo.lastStatusFor('log-1')).toMatchObject({ status: 'success' });
    expect(redis.store.has(REDIS_KEYS.circuitState(KIND))).toBe(false);
    expect(redis.store.has(REDIS_KEYS.circuitFailures(KIND))).toBe(false);
  });

  // Provider 5xx (HTTP, not thrown) is classified as a failure too (T29 slice).
  it('treats a non-2xx provider HTTP status as a failure and throws UPSTREAM_UNAVAILABLE', async () => {
    const { gateway, logRepo } = makeGateway();
    const port = new FakePort({ status: 503, body: { error: 'down' } });

    const err = await captureRejection(() => gateway.call(port, baseRequest(), { retryCount: 0 }));

    expect((err as { code: string }).code).toBe('UPSTREAM_UNAVAILABLE');
    expect(logRepo.lastStatusFor('log-1')).toMatchObject({ status: 'retrying', httpStatus: 503 });
  });

  // A concurrent in-flight duplicate (same key) → CONFLICT (409).
  it('throws CONFLICT when an idempotency key is already in flight', async () => {
    const { gateway, redis } = makeGateway();
    redis.seed(REDIS_KEYS.gatewayIdem('BUSY'), { status: IDEM_STATE.IN_FLIGHT });
    const port = new FakePort({ status: 200 });

    const err = await captureRejection(() => gateway.call(port, baseRequest(), { idempotencyKey: 'BUSY' }));

    expect((err as { code: string }).code).toBe('CONFLICT');
    expect((err as { httpStatus: number }).httpStatus).toBe(409);
    expect(port.calls).toBe(0);
  });

  // A malformed idempotency key is rejected as VALIDATION_ERROR before any work.
  it('rejects a malformed idempotency key with VALIDATION_ERROR', async () => {
    const { gateway, logRepo } = makeGateway();
    const port = new FakePort({ status: 200 });

    const err = await captureRejection(() =>
      gateway.call(port, baseRequest(), { idempotencyKey: 'has spaces & symbols!' }),
    );

    expect((err as { code: string }).code).toBe('VALIDATION_ERROR');
    expect((err as { httpStatus: number }).httpStatus).toBe(400);
    expect(port.calls).toBe(0);
    expect(logRepo.createLog).not.toHaveBeenCalled();
  });
});
