import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { IntegrationKind, IntegrationStatus } from '@lms/shared';

import { KYSELY, type KyselyDb } from '../db';
import { SYSTEM_USER_ID } from './integration.constants';

/** Parameters for the pre-dispatch `pending` row (LLD §Data Operations). */
export interface CreateLogParams {
  integration: IntegrationKind;
  leadId?: string | null;
  correlationId: string;
  idempotencyKey?: string | null;
  maskedRequestRef?: string | null;
}

/** Fields mutated when a call completes / is retried (LLD updateLogStatus). */
export interface UpdateLogParams {
  status: IntegrationStatus;
  httpStatus?: number | null;
  errorCode?: string | null;
  retryCount: number;
}

/** The created log row id the gateway threads through the call. */
export interface IntegrationLogRow {
  integration_log_id: string;
}

/**
 * Owner-writes repository for `integration_logs` (writer: M15, this FR). It is
 * deliberately STANDALONE — its writes do NOT enlist in any caller's UnitOfWork
 * (LLD §State Machine + Transaction Boundaries): the gateway must not hold the
 * caller's DB connection open across a network round-trip to the provider, so
 * each write is its own short-lived statement on the pool.
 *
 * Every statement is parameterised Kysely; `correlation_id` comes from the
 * request context; `request_ref` is only ever a GCS path / masked summary —
 * never a raw payload (LLD §Not applicable — masking). The partial unique index
 * `uq_integration_idempotency` is the DB-level safety net behind the Redis dedupe.
 */
@Injectable()
export class IntegrationLogRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** Insert the `pending` lifecycle row before the provider is dispatched. */
  async createLog(params: CreateLogParams): Promise<IntegrationLogRow> {
    const row = await this.db
      .insertInto('integration_logs')
      .values({
        integration_log_id: randomUUID(),
        integration: params.integration,
        direction: 'outbound',
        lead_id: params.leadId ?? null,
        correlation_id: params.correlationId,
        idempotency_key: params.idempotencyKey ?? null,
        request_ref: params.maskedRequestRef ?? null,
        status: 'pending',
        retry_count: 0,
        created_by: SYSTEM_USER_ID,
        updated_by: SYSTEM_USER_ID,
        // org_id, http_status, error_code, completed_at, created_at, updated_at: DB defaults / null.
      })
      .returning('integration_log_id')
      .executeTakeFirstOrThrow();
    return { integration_log_id: row.integration_log_id };
  }

  /**
   * Insert a terminal `failed` row for a call that never reached the provider
   * (circuit open). Mirrors {@link createLog} but lands directly in `failed`
   * with the supplied `error_code` and no `http_status` (LLD step 3 / T07).
   */
  async createFailFastLog(params: CreateLogParams, errorCode: string): Promise<IntegrationLogRow> {
    const row = await this.db
      .insertInto('integration_logs')
      .values({
        integration_log_id: randomUUID(),
        integration: params.integration,
        direction: 'outbound',
        lead_id: params.leadId ?? null,
        correlation_id: params.correlationId,
        idempotency_key: params.idempotencyKey ?? null,
        request_ref: params.maskedRequestRef ?? null,
        status: 'failed',
        retry_count: 0,
        error_code: errorCode,
        created_by: SYSTEM_USER_ID,
        updated_by: SYSTEM_USER_ID,
      })
      .returning('integration_log_id')
      .executeTakeFirstOrThrow();
    return { integration_log_id: row.integration_log_id };
  }

  /**
   * Update a log row to its outcome. `completed_at` is set only on `success`
   * (INV-05); `retry_count` is written explicitly so a `retrying` row always has
   * `retry_count >= 1` (INV-06). Parameterised by primary key.
   */
  async updateLogStatus(logId: string, params: UpdateLogParams): Promise<void> {
    await this.db
      .updateTable('integration_logs')
      .set({
        status: params.status,
        http_status: params.httpStatus ?? null,
        error_code: params.errorCode ?? null,
        retry_count: params.retryCount,
        completed_at: params.status === 'success' ? new Date() : null,
        updated_at: new Date(),
        updated_by: SYSTEM_USER_ID,
      })
      .where('integration_log_id', '=', logId)
      .execute();
  }
}
