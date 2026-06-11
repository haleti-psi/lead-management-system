import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { AuditAction, DataScope, ERROR_CODES } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { REDIS } from '../../core/redis';
import type { PaginationParams } from '../../core/common';
import {
  IDEM_STATE,
  IDEMPOTENCY_TTL_SECONDS,
  REDIS_KEYS,
} from '../../core/integration/integration.constants';
import { IntegrationRepository } from './integration.repository';
import {
  toIntegrationLogResponse,
  type IntegrationLogResponse,
} from './dto/integration-log-response.dto';
import {
  toWebhookResponse,
  type WebhookResponse,
} from './dto/webhook-response.dto';
import type {
  IntegrationLogFilters,
  IntegrationSort,
} from './dto/integration-monitor-query.dto';
import type { CreateWebhookDto } from './dto/create-webhook.dto';

/** The acting principal, narrowed to what the service needs. */
export interface IntegrationActor {
  readonly userId: string;
  readonly orgId: string;
}

/** A page of rows plus its total (the controller maps this to the envelope). */
export interface Page<T> {
  rows: T[];
  total: number;
}

/**
 * Outcome of {@link IntegrationService.createWebhook}: either a freshly created
 * subscription (HTTP 201) or an idempotent replay of a prior create (HTTP 200 +
 * `IDEMPOTENT_REPLAY`, per CORRECTIONS.md). The controller branches on `replay`.
 */
export interface CreateWebhookOutcome {
  webhook: WebhookResponse;
  replay: boolean;
}

/**
 * FR-140 read/admin service: the integration monitor, webhook listing, and
 * webhook creation. Creation is idempotency-gated in Redis (`idem:webhook:{key}`)
 * and writes the row + its audit intent atomically in one {@link UnitOfWork}
 * (CORRECTIONS.md: audit via `AuditAppender.append`, action `config_change`,
 * entity_type `webhook_subscriptions`). `secret_ref` never enters a response.
 */
@Injectable()
export class IntegrationService {
  constructor(
    private readonly repo: IntegrationRepository,
    private readonly audit: AuditAppender,
    private readonly uow: UnitOfWork,
    @Inject(REDIS) private readonly redis: Redis,
    @InjectPinoLogger(IntegrationService.name) private readonly logger: PinoLogger,
  ) {}

  /** List integration logs (monitor) with filters/sort/paging. Scope-A only. */
  async listLogs(
    filters: IntegrationLogFilters,
    page: PaginationParams,
    sort: IntegrationSort,
    effectiveScope: DataScope | undefined,
  ): Promise<Page<IntegrationLogResponse>> {
    this.requireScopeA(effectiveScope);
    const [rows, total] = await Promise.all([
      this.repo.listLogs(filters, page, sort),
      this.repo.countLogs(filters),
    ]);
    return { rows: rows.map(toIntegrationLogResponse), total };
  }

  /** List webhook subscriptions (without `secret_ref`). Scope-A only. */
  async listWebhooks(
    page: PaginationParams,
    effectiveScope: DataScope | undefined,
  ): Promise<Page<WebhookResponse>> {
    this.requireScopeA(effectiveScope);
    const [rows, total] = await Promise.all([
      this.repo.listWebhooks(page),
      this.repo.countWebhooks(),
    ]);
    return { rows: rows.map(toWebhookResponse), total };
  }

  /**
   * Create a webhook subscription (LLD §Backend Flow — POST /admin/webhooks):
   *   a. Idempotency gate in Redis (replay → original; in-flight → CONFLICT).
   *   b. INSERT + audit append in one UnitOfWork transaction.
   *   c. Post-commit: cache the serialised response under the idempotency key.
   * On any failure the transaction rolls back (no partial row, no orphan audit)
   * and the in-flight marker is released.
   */
  async createWebhook(
    dto: CreateWebhookDto,
    idempotencyKey: string | undefined,
    actor: IntegrationActor,
    effectiveScope: DataScope | undefined,
  ): Promise<CreateWebhookOutcome> {
    this.requireScopeA(effectiveScope);

    // (a) Idempotency gate.
    if (idempotencyKey) {
      const replay = await this.checkWebhookIdempotency(idempotencyKey);
      if (replay) {
        return { webhook: replay, replay: true };
      }
    }

    let created: WebhookResponse;
    try {
      // (b) Atomic INSERT + audit intent.
      created = await this.uow.run(async (tx) => {
        const row = await this.repo.createWebhook(dto, actor.userId, tx);
        await this.audit.append(
          {
            action: AuditAction.CONFIG_CHANGE,
            entity_type: 'webhook_subscriptions',
            entity_id: row.webhook_subscription_id,
            actor_id: actor.userId,
            org_id: actor.orgId,
            detail: { event: 'webhook_subscription_created', event_code: dto.eventCode },
          },
          tx,
        );
        return toWebhookResponse(row);
      });
    } catch (err) {
      // (d) Release the in-flight marker so a corrected retry can proceed.
      if (idempotencyKey) {
        await this.releaseWebhookIdempotency(idempotencyKey);
      }
      throw err;
    }

    // (c) Post-commit cache of the original response for future replays.
    if (idempotencyKey) {
      await this.cacheWebhookSuccess(idempotencyKey, created);
    }
    return { webhook: created, replay: false };
  }

  /**
   * Every FR-140 admin endpoint is scope-A only (ADMIN/HEAD). The
   * `configuration` capability is also held at scope B by BM/KYC/DPO, so the
   * AbacGuard alone would let them through for a non-row-scoped resource; we
   * reject anything but A with FORBIDDEN (LLD §Auth Check; T19/T20/T27).
   */
  private requireScopeA(effectiveScope: DataScope | undefined): void {
    if (effectiveScope !== DataScope.A) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
  }

  // ── idempotency helpers ──────────────────────────────────────

  /**
   * Returns the cached original response on a `success` replay, throws CONFLICT
   * on a concurrent `in_flight` duplicate, or claims `in_flight` and returns
   * undefined on a miss (LLD §Backend Flow 5a).
   */
  private async checkWebhookIdempotency(key: string): Promise<WebhookResponse | undefined> {
    const redisKey = REDIS_KEYS.webhookIdem(key);
    const record = await this.redis.hgetall(redisKey);
    const status = record.status;

    if (status === IDEM_STATE.SUCCESS && typeof record.result === 'string') {
      return JSON.parse(record.result) as WebhookResponse;
    }
    if (status === IDEM_STATE.IN_FLIGHT) {
      throw new DomainException(ERROR_CODES.CONFLICT, 'A duplicate request is already in progress.', {
        detail: { reason: 'IDEMPOTENT_REPLAY' },
      });
    }
    await this.redis.hset(redisKey, 'status', IDEM_STATE.IN_FLIGHT);
    await this.redis.expire(redisKey, IDEMPOTENCY_TTL_SECONDS);
    return undefined;
  }

  private async cacheWebhookSuccess(key: string, webhook: WebhookResponse): Promise<void> {
    const redisKey = REDIS_KEYS.webhookIdem(key);
    await this.redis.hset(redisKey, { status: IDEM_STATE.SUCCESS, result: JSON.stringify(webhook) });
    await this.redis.expire(redisKey, IDEMPOTENCY_TTL_SECONDS);
  }

  private async releaseWebhookIdempotency(key: string): Promise<void> {
    try {
      await this.redis.del(REDIS_KEYS.webhookIdem(key));
    } catch (cause) {
      // Best-effort cleanup; the 24h TTL is the backstop. Log, don't mask the
      // original failure the caller is about to receive.
      this.logger.warn({ err: cause }, 'failed to release webhook idempotency marker');
    }
  }
}
