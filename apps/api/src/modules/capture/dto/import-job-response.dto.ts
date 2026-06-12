import type { JobStatus } from '@lms/shared';

/**
 * FR-010 — response payload for `POST /api/v1/leads/import` (api-contract
 * `ImportJobEnvelope`). `total_rows` is unknown until the async processor parses
 * the file, so the 202 response always carries `null`.
 */
export interface ImportJobResponseDto {
  import_job_id: string;
  status: JobStatus;
  total_rows: number | null;
}
