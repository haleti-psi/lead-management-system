import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api';

/**
 * FR-053 — dashboard trend metrics from `GET /api/v1/pipeline-board/trends`:
 * the scoped active-pipeline value and a 14-day daily captures series. Scoped +
 * cached just under the dashboard's refresh cadence.
 */
export interface CapturePoint {
  date: string;
  count: number;
}

export interface PipelineTrends {
  pipeline_value: string;
  captured_series: CapturePoint[];
}

export function usePipelineTrends(): {
  data: PipelineTrends | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: ['pipeline-trends'],
    queryFn: () => apiClient.get<PipelineTrends>('/pipeline-board/trends'),
    staleTime: 55_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}
