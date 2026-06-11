import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import { toOffset, type PaginationParams } from '../../core/common';
import type {
  IntegrationLogFilters,
  IntegrationSort,
} from './dto/integration-monitor-query.dto';
import type { IntegrationLogListRow } from './dto/integration-log-response.dto';
import type { WebhookRow } from './dto/webhook-response.dto';
import type { CreateWebhookDto } from './dto/create-webhook.dto';

/** The safe-to-return webhook columns (never selects `secret_ref`). */
const WEBHOOK_COLUMNS = [
  'ws.webhook_subscription_id',
  'ws.event_code',
  'ws.target_url',
  'ws.is_active',
  'ws.last_status',
  'ws.created_at',
  'ws.updated_at',
] as const;

/** A created webhook row plus the value we audit (id) — secret_ref excluded. */
export interface CreateWebhookResult {
  row: WebhookRow;
}

/** Resolves a sort token to a (column, direction) pair for an allow-listed ORDER BY. */
function resolveSort(sort: IntegrationSort): { column: 'created_at' | 'retry_count'; dir: 'asc' | 'desc' } {
  switch (sort) {
    case 'created_at':
      return { column: 'created_at', dir: 'asc' };
    case '-retry_count':
      return { column: 'retry_count', dir: 'desc' };
    case '-created_at':
    default:
      return { column: 'created_at', dir: 'desc' };
  }
}

/**
 * Reads `integration_logs` and reads/writes `webhook_subscriptions` (owner:
 * M15, this FR). Every query is parameterised Kysely (no string interpolation),
 * single-tenant `org_id` is the DB default, and every list path applies a LIMIT
 * (≤100, enforced upstream by {@link PaginationParams}). `secret_ref` is never
 * selected. The webhook INSERT accepts the ambient `tx` so it enlists in the
 * caller's {@link UnitOfWork}.
 */
@Injectable()
export class IntegrationRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** List integration logs with optional filters, allow-listed sort, and paging. */
  async listLogs(
    filters: IntegrationLogFilters,
    page: PaginationParams,
    sort: IntegrationSort,
  ): Promise<IntegrationLogListRow[]> {
    const { column, dir } = resolveSort(sort);
    const rows = await this.db
      .selectFrom('integration_logs as il')
      .select([
        'il.integration_log_id',
        'il.integration',
        'il.direction',
        'il.lead_id',
        'il.correlation_id',
        'il.idempotency_key',
        'il.request_ref',
        'il.status',
        'il.http_status',
        'il.retry_count',
        'il.error_code',
        'il.completed_at',
        'il.created_at',
      ])
      .$if(filters.integration !== undefined, (qb) => qb.where('il.integration', '=', filters.integration!))
      .$if(filters.status !== undefined, (qb) => qb.where('il.status', '=', filters.status!))
      .$if(filters.direction !== undefined, (qb) => qb.where('il.direction', '=', filters.direction!))
      .$if(filters.leadId !== undefined, (qb) => qb.where('il.lead_id', '=', filters.leadId!))
      .orderBy(`il.${column}`, dir)
      .limit(page.limit)
      .offset(toOffset(page))
      .execute();
    return rows as IntegrationLogListRow[];
  }

  /** Count integration logs matching the same filters (pagination total). */
  async countLogs(filters: IntegrationLogFilters): Promise<number> {
    const { count } = await this.db
      .selectFrom('integration_logs as il')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .$if(filters.integration !== undefined, (qb) => qb.where('il.integration', '=', filters.integration!))
      .$if(filters.status !== undefined, (qb) => qb.where('il.status', '=', filters.status!))
      .$if(filters.direction !== undefined, (qb) => qb.where('il.direction', '=', filters.direction!))
      .$if(filters.leadId !== undefined, (qb) => qb.where('il.lead_id', '=', filters.leadId!))
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  /** List webhook subscriptions (newest first), excluding `secret_ref`. */
  async listWebhooks(page: PaginationParams): Promise<WebhookRow[]> {
    const rows = await this.db
      .selectFrom('webhook_subscriptions as ws')
      .select(WEBHOOK_COLUMNS)
      .orderBy('ws.created_at', 'desc')
      .limit(page.limit)
      .offset(toOffset(page))
      .execute();
    return rows as WebhookRow[];
  }

  /** Count webhook subscriptions (pagination total). */
  async countWebhooks(): Promise<number> {
    const { count } = await this.db
      .selectFrom('webhook_subscriptions as ws')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  /**
   * Insert a webhook subscription within the caller's transaction. `secret_ref`
   * stores only the Secret Manager path. The returned row is re-selected WITHOUT
   * `secret_ref`, so the secret path never travels back through the service/API.
   */
  async createWebhook(dto: CreateWebhookDto, actorId: string, tx: DbTransaction): Promise<WebhookRow> {
    const id = randomUUID();
    await tx
      .insertInto('webhook_subscriptions')
      .values({
        webhook_subscription_id: id,
        event_code: dto.eventCode,
        target_url: dto.targetUrl,
        secret_ref: dto.secretRef,
        is_active: true,
        created_by: actorId,
        updated_by: actorId,
        // org_id, last_status, created_at, updated_at: DB defaults / null.
      })
      .execute();

    const row = await tx
      .selectFrom('webhook_subscriptions as ws')
      .select(WEBHOOK_COLUMNS)
      .where('ws.webhook_subscription_id', '=', id)
      .limit(1)
      .executeTakeFirstOrThrow();
    return row as WebhookRow;
  }
}
