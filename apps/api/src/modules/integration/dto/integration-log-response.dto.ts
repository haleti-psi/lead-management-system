import type {
  IntegrationDirection,
  IntegrationKind,
  IntegrationStatus,
} from '@lms/shared';

/** API representation of an `integration_logs` row (LLD §Endpoints 1). */
export interface IntegrationLogResponse {
  integrationLogId: string;
  integration: IntegrationKind;
  direction: IntegrationDirection;
  leadId: string | null;
  correlationId: string;
  idempotencyKey: string | null;
  requestRef: string | null;
  status: IntegrationStatus;
  httpStatus: number | null;
  retryCount: number;
  errorCode: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** The columns the monitor selects (DB snake_case). */
export interface IntegrationLogListRow {
  integration_log_id: string;
  integration: IntegrationKind;
  direction: IntegrationDirection;
  lead_id: string | null;
  correlation_id: string;
  idempotency_key: string | null;
  request_ref: string | null;
  status: IntegrationStatus;
  http_status: number | null;
  retry_count: number;
  error_code: string | null;
  completed_at: Date | null;
  created_at: Date;
}

/** Map a DB row to the API shape (no PII — request_ref is a GCS path/summary). */
export function toIntegrationLogResponse(row: IntegrationLogListRow): IntegrationLogResponse {
  return {
    integrationLogId: row.integration_log_id,
    integration: row.integration,
    direction: row.direction,
    leadId: row.lead_id,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    requestRef: row.request_ref,
    status: row.status,
    httpStatus: row.http_status,
    retryCount: row.retry_count,
    errorCode: row.error_code,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}
