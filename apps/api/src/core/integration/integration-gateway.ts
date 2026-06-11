import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { ERROR_CODES } from '@lms/shared';

import { DomainException } from '../http/domain-exception';
import { REDIS } from '../redis';
import { CircuitBreakerService } from './circuit-breaker.service';
import {
  BACKOFF_BASE_MS,
  BACKOFF_JITTER_RATIO,
  CB_OPEN_ERROR_CODE,
  IDEM_STATE,
  IDEMPOTENCY_TTL_SECONDS,
  MAX_RETRIES,
  REDIS_KEYS,
  REQUEST_TIMEOUT_MS,
} from './integration.constants';
import { IntegrationLogRepository } from './integration-log.repository';
import type { IntegrationPort, IntegrationRequest } from './ports/integration-port';
import {
  ProviderCallError,
  isSuccessStatus,
  type ProviderResponse,
} from './ports/provider-response';
import {
  RETRY_QUEUE_PORT,
  type RetryQueuePort,
} from './retry-queue.port';

/** Per-call options for {@link IntegrationGateway.call}. */
export interface GatewayOptions {
  /**
   * Client/caller idempotency key. When present, a replay returns the original
   * cached result without re-dispatching to the provider (LLD §Summary 1).
   */
  idempotencyKey?: string;
  /**
   * The attempt this invocation represents (Cloud Tasks retries pass the row's
   * current `retry_count`). Defaults to 0 for a first call. Drives backoff and
   * the retry-vs-dead-letter decision.
   */
  retryCount?: number;
  /**
   * Pre-created `integration_logs` row id (Cloud Tasks retries reuse the
   * original row instead of inserting a new one). When omitted, a fresh `pending`
   * row is created.
   */
  integrationLogId?: string;
}

/** The gateway result: the provider response plus replay provenance. */
export interface GatewayResult<TBody = unknown> {
  /** Status the provider returned (or the cached original on replay). */
  httpStatus: number;
  /** Provider/cached response body. */
  body: TBody;
  /** True when served from the idempotency cache (no provider call was made). */
  idempotent: boolean;
}

/** Idempotency-Key format (LLD §Validation Logic — IdempotencyKeySchema). */
export const IdempotencyKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Idempotency-Key must be alphanumeric with - or _');

/** The cached idempotency record we serialise into Redis on success. */
interface CachedGatewayResult {
  httpStatus: number;
  body: unknown;
}

/**
 * FR-140 — the IntegrationGateway: the single chokepoint every module uses to
 * call an external provider (shared-utilities.md: `IntegrationGateway.call(port,
 * req, { idempotencyKey })`). It owns, in one place:
 *   1. Idempotency  — Redis `idem:gw:{key}` dedupe + replay (LLD §Summary 1).
 *   2. Observability — an `integration_logs` lifecycle row per call.
 *   3. Circuit breaker — fast-fail when a kind is failing (via
 *      {@link CircuitBreakerService}).
 *   4. Retry/backoff — Cloud Tasks retry on failure, exponential backoff + jitter.
 *   5. Dead-letter   — poison-message routing after {@link MAX_RETRIES}.
 *
 * The gateway does NOT enlist in the caller's UnitOfWork (LLD §Transaction
 * Boundaries): its DB writes are standalone so the caller's connection is never
 * held open across the network round-trip. On any provider failure it throws
 * {@link DomainException} `UPSTREAM_UNAVAILABLE` (503) — the only external-failure
 * code in the taxonomy. No secrets, tokens, or raw payloads are logged.
 */
@Injectable()
export class IntegrationGateway {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly breaker: CircuitBreakerService,
    private readonly logRepo: IntegrationLogRepository,
    @Inject(RETRY_QUEUE_PORT) private readonly retryQueue: RetryQueuePort,
    @InjectPinoLogger(IntegrationGateway.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Execute one outbound provider call through the full resilience pipeline.
   *
   * @throws DomainException VALIDATION_ERROR  — malformed idempotency key.
   * @throws DomainException CONFLICT (409)    — a concurrent in-flight duplicate.
   * @throws DomainException UPSTREAM_UNAVAILABLE (503) — circuit open, provider
   *         error/timeout, or transport fault. (The row is set retrying/failed
   *         and a retry/dead-letter task is enqueued as appropriate.)
   */
  async call<TPayload, TBody>(
    port: IntegrationPort<TPayload, TBody>,
    request: IntegrationRequest<TPayload>,
    options: GatewayOptions = {},
  ): Promise<GatewayResult<TBody>> {
    const idempotencyKey = this.validateKey(options.idempotencyKey);
    const retryCount = options.retryCount ?? 0;

    // 2. Idempotency check (replay / in-flight) — only on the first attempt.
    if (idempotencyKey && retryCount === 0) {
      const replay = await this.checkIdempotency<TBody>(idempotencyKey);
      if (replay) {
        return replay;
      }
    }

    const kind = request.integration;

    // 3. Circuit-breaker gate — fast-fail without touching the provider.
    const decision = await this.breaker.check(kind);
    if (decision.open) {
      await this.logRepo.createFailFastLog(
        {
          integration: kind,
          leadId: request.leadId,
          correlationId: this.correlationId(request),
          idempotencyKey,
          maskedRequestRef: request.maskedRequestRef,
        },
        CB_OPEN_ERROR_CODE,
      );
      if (idempotencyKey) {
        await this.markIdempotency(idempotencyKey, IDEM_STATE.FAILED);
      }
      throw new DomainException(ERROR_CODES.UPSTREAM_UNAVAILABLE, undefined, {
        detail: { reason: CB_OPEN_ERROR_CODE },
      });
    }

    // 4. Ensure a pending log row exists (reuse the row on a Cloud Tasks retry).
    const logId =
      options.integrationLogId ??
      (
        await this.logRepo.createLog({
          integration: kind,
          leadId: request.leadId,
          correlationId: this.correlationId(request),
          idempotencyKey,
          maskedRequestRef: request.maskedRequestRef,
        })
      ).integration_log_id;

    // 5. Dispatch to the adapter (timeout enforced by the adapter's fetch).
    let response: ProviderResponse<TBody>;
    try {
      response = await this.dispatch(port, request);
    } catch (cause) {
      return this.onFailure(kind, logId, retryCount, idempotencyKey, this.failureCode(cause), cause);
    }

    // 6/7. Classify the provider HTTP outcome.
    if (isSuccessStatus(response.httpStatus)) {
      return this.onSuccess<TBody>(kind, logId, retryCount, idempotencyKey, response);
    }
    return this.onFailure(
      kind,
      logId,
      retryCount,
      idempotencyKey,
      `HTTP_${response.httpStatus}`,
      undefined,
      response.httpStatus,
    );
  }

  // ── pipeline steps ───────────────────────────────────────────

  /** 5. Adapter dispatch wrapped in an AbortController timeout (REQUEST_TIMEOUT_MS). */
  private async dispatch<TPayload, TBody>(
    port: IntegrationPort<TPayload, TBody>,
    request: IntegrationRequest<TPayload>,
  ): Promise<ProviderResponse<TBody>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      // Adapters honour `AbortSignal` on their fetch; we also guard with a race
      // so a non-cooperating adapter still times out into a transport fault.
      return await Promise.race([
        port.call(request),
        this.timeoutGuard<TBody>(controller.signal),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Rejects with a transport-fault when the abort signal fires. */
  private timeoutGuard<TBody>(signal: AbortSignal): Promise<ProviderResponse<TBody>> {
    return new Promise<ProviderResponse<TBody>>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new ProviderCallError('TIMEOUT', `Provider call exceeded ${REQUEST_TIMEOUT_MS}ms`)),
        { once: true },
      );
    });
  }

  /** 6. Success path: update log, reset breaker, cache idempotent result. */
  private async onSuccess<TBody>(
    kind: string,
    logId: string,
    retryCount: number,
    idempotencyKey: string | undefined,
    response: ProviderResponse<TBody>,
  ): Promise<GatewayResult<TBody>> {
    await this.logRepo.updateLogStatus(logId, {
      status: 'success',
      httpStatus: response.httpStatus,
      retryCount,
    });
    await this.breaker.recordSuccess(kind);
    if (idempotencyKey) {
      await this.cacheSuccess(idempotencyKey, { httpStatus: response.httpStatus, body: response.body });
    }
    return { httpStatus: response.httpStatus, body: response.body, idempotent: false };
  }

  /**
   * 7. Failure path: record the failure on the breaker, decide retry vs.
   * dead-letter, update the log accordingly, then always throw
   * UPSTREAM_UNAVAILABLE (503) to the caller.
   */
  private async onFailure(
    kind: string,
    logId: string,
    retryCount: number,
    idempotencyKey: string | undefined,
    errorCode: string,
    cause: unknown,
    httpStatus?: number,
  ): Promise<never> {
    await this.breaker.recordFailure(kind);

    if (retryCount < MAX_RETRIES) {
      const nextAttempt = retryCount + 1;
      await this.logRepo.updateLogStatus(logId, {
        status: 'retrying',
        httpStatus: httpStatus ?? null,
        errorCode,
        retryCount: nextAttempt,
      });
      await this.retryQueue.enqueueRetry({
        integrationLogId: logId,
        integration: kind as IntegrationRequest['integration'],
        retryCount: nextAttempt,
        delayMs: this.backoffMs(retryCount),
      });
    } else {
      await this.logRepo.updateLogStatus(logId, {
        status: 'failed',
        httpStatus: httpStatus ?? null,
        errorCode,
        retryCount,
      });
      await this.retryQueue.enqueueDeadLetter({
        integrationLogId: logId,
        integration: kind as IntegrationRequest['integration'],
        retryCount,
        errorCode,
      });
    }

    if (idempotencyKey) {
      await this.markIdempotency(idempotencyKey, IDEM_STATE.FAILED);
    }

    this.logger.warn({ integration: kind, integration_log_id: logId, error_code: errorCode }, 'integration call failed');
    throw new DomainException(ERROR_CODES.UPSTREAM_UNAVAILABLE, undefined, { cause });
  }

  // ── idempotency cache ────────────────────────────────────────

  /**
   * Returns the cached result on a `success` replay, throws CONFLICT on an
   * `in_flight` duplicate, or marks `in_flight` and returns undefined on a miss
   * (LLD §Backend Flow step 2).
   */
  private async checkIdempotency<TBody>(key: string): Promise<GatewayResult<TBody> | undefined> {
    const redisKey = REDIS_KEYS.gatewayIdem(key);
    const record = await this.redis.hgetall(redisKey);
    const status = record.status;

    if (status === IDEM_STATE.SUCCESS && typeof record.result === 'string') {
      const cached = JSON.parse(record.result) as CachedGatewayResult;
      return { httpStatus: cached.httpStatus, body: cached.body as TBody, idempotent: true };
    }
    if (status === IDEM_STATE.IN_FLIGHT) {
      throw new DomainException(ERROR_CODES.CONFLICT, 'A duplicate request is already in progress.', {
        detail: { reason: 'IDEMPOTENT_REPLAY' },
      });
    }
    // Miss (or a prior `failed` we allow to be retried) → claim in-flight.
    await this.redis.hset(redisKey, 'status', IDEM_STATE.IN_FLIGHT);
    await this.redis.expire(redisKey, IDEMPOTENCY_TTL_SECONDS);
    return undefined;
  }

  /** Persist the original result so future replays return it verbatim. */
  private async cacheSuccess(key: string, result: CachedGatewayResult): Promise<void> {
    const redisKey = REDIS_KEYS.gatewayIdem(key);
    await this.redis.hset(redisKey, { status: IDEM_STATE.SUCCESS, result: JSON.stringify(result) });
    await this.redis.expire(redisKey, IDEMPOTENCY_TTL_SECONDS);
  }

  /** Flip an idempotency record to a terminal non-success state (e.g. failed). */
  private async markIdempotency(key: string, state: string): Promise<void> {
    const redisKey = REDIS_KEYS.gatewayIdem(key);
    await this.redis.hset(redisKey, 'status', state);
    await this.redis.expire(redisKey, IDEMPOTENCY_TTL_SECONDS);
  }

  // ── helpers ──────────────────────────────────────────────────

  private validateKey(key: string | undefined): string | undefined {
    if (key === undefined) {
      return undefined;
    }
    const parsed = IdempotencyKeySchema.safeParse(key);
    if (!parsed.success) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Please correct the highlighted fields.', {
        fields: [{ field: 'Idempotency-Key', issue: parsed.error.issues[0]?.message ?? 'invalid' }],
      });
    }
    return parsed.data;
  }

  /** exp backoff: BASE * 2^retryCount, then ± JITTER_RATIO (LLD §Summary 2). */
  private backoffMs(retryCount: number): number {
    const base = BACKOFF_BASE_MS * 2 ** retryCount;
    const jitter = base * BACKOFF_JITTER_RATIO * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(base + jitter));
  }

  /** error_code for a thrown adapter fault (≤60 chars; no PII). */
  private failureCode(cause: unknown): string {
    if (cause instanceof ProviderCallError) {
      return cause.errorCode.slice(0, 60);
    }
    return 'PROVIDER_ERROR';
  }

  /**
   * Correlation id for the log row: the caller-propagated value when present
   * (LLD step 1), else a synthetic system id (Cloud Tasks retries run with no
   * inbound request). Bounded to the column width (VARCHAR(120)).
   */
  private correlationId(request: IntegrationRequest): string {
    const value = request.correlationId?.trim();
    return value && value.length > 0 ? value.slice(0, 120) : 'corr_system';
  }
}
