/**
 * FR-115 — React Query hook for triggering a retention run.
 * POST /admin/retention/run
 */

import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type { DataCategory, RetentionMode, RetentionRunResult } from './retention.types';

export interface RunRetentionInput {
  mode: RetentionMode;
  data_category?: DataCategory;
}

/** Trigger a retention run (dry-run or apply). */
export function useRetentionRun() {
  return useMutation({
    mutationFn: (input: RunRetentionInput) =>
      apiClient.post<{ data: RetentionRunResult }>('/admin/retention/run', input),
  });
}
