import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { JobStatus } from '@lms/shared';
import { apiClient } from '@/lib/api';

/**
 * FR-010 — `POST /leads/import` (multipart CSV/XLSX). Returns the accepted async
 * import job (202). An Idempotency-Key guards against accidental double-submits.
 * Rows are parsed/validated by the async processor (status is not polled here —
 * the contract exposes no import-job GET).
 */
export interface ImportJobResult {
  import_job_id: string;
  status: JobStatus;
  total_rows: number | null;
}

export function useLeadImport(): UseMutationResult<ImportJobResult, unknown, File> {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiClient.postForm<ImportJobResult>('/leads/import', form, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
    },
  });
}
