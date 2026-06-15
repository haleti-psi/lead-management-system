import type { JobStatus, MaskingLevel } from '@lms/shared';

import { apiClient } from './apiClient';
import type { PageResult, QueryParams } from './apiClient';

/**
 * FR-122 — typed API client wrapper for the Export Governance endpoints.
 * `POST /api/v1/exports`, `GET /api/v1/exports`, `GET /api/v1/exports/{id}`,
 * `POST /api/v1/exports/{id}/approve`.
 */

export interface ExportJob {
  export_job_id: string;
  report_code: string;
  status: JobStatus;
  masking_level: MaskingLevel;
  scope: string;
  row_count: number | null;
  approver_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExportJobDetail extends ExportJob {
  download_url: string | null;
  download_url_expires_at: string | null;
}

export interface CreateExportRequest {
  report_code: string;
  filters: Record<string, unknown>;
  scope: string;
  masking_level: MaskingLevel;
  purpose: string;
}

export interface ListExportsParams {
  page?: number;
  limit?: number;
  'filter[status]'?: JobStatus;
}

/**
 * POST /api/v1/exports — create export job.
 * Returns the created job on 202 success.
 * On 409 EXPORT_APPROVAL_REQUIRED the caller receives an ApiClientError
 * with code CONFLICT and `detail.export_job_id`.
 */
export async function createExport(
  req: CreateExportRequest,
  idempotencyKey?: string,
): Promise<ExportJob> {
  return apiClient.post<ExportJob>('/exports', req, {
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  });
}

/** GET /api/v1/exports — list export jobs (scope-filtered, paginated). */
export async function listExports(
  params: ListExportsParams = {},
  signal?: AbortSignal,
): Promise<PageResult<ExportJob>> {
  return apiClient.getPage<ExportJob>('/exports', {
    query: params as QueryParams,
    signal,
  });
}

/** GET /api/v1/exports/{id} — get export job + on-demand signed download URL. */
export async function getExport(id: string, signal?: AbortSignal): Promise<ExportJobDetail> {
  return apiClient.get<ExportJobDetail>(`/exports/${id}`, { signal });
}

/** POST /api/v1/exports/{id}/approve — approve an awaiting_approval export job. */
export async function approveExport(id: string): Promise<ExportJob> {
  return apiClient.post<ExportJob>(`/exports/${id}/approve`, {});
}
