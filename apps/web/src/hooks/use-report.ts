import { useQuery } from '@tanstack/react-query';

import { isApiClientError } from '@/lib/api';
import { fetchReport } from '@/lib/api/reports';
import type { FetchReportResult, ReportCode, ReportData, ReportParams } from '@/lib/api/reports';

/**
 * FR-120 — TanStack Query hook for `GET /api/v1/reports/{code}`.
 * Caches per `[report, code, ...params]` key so different filter combinations
 * are cached independently. No auto-refresh (reports are user-initiated;
 * staleTime=0 so a fresh fetch runs on every mount/filter change).
 */
export function useReport(
  code: ReportCode,
  params: ReportParams = {},
  options?: { enabled?: boolean },
): {
  data: ReportData | undefined;
  total: number;
  isLoading: boolean;
  isError: boolean;
  errorCode: string | null;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: ['report', code, params],
    queryFn: ({ signal }): Promise<FetchReportResult> => fetchReport(code, params, signal),
    enabled: options?.enabled ?? true,
    staleTime: 0,
    retry: (failureCount, error) => {
      // Never retry on 400/403/404 — user must change filters
      if (isApiClientError(error) && [400, 403, 404].includes(error.status)) return false;
      return failureCount < 1;
    },
  });

  const errorCode =
    query.error && isApiClientError(query.error)
      ? (query.error.code ?? null)
      : query.isError
        ? 'INTERNAL_ERROR'
        : null;

  return {
    data: query.data?.data,
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    errorCode,
    refetch: query.refetch,
  };
}
