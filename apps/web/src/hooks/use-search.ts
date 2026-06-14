import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiClient } from '@/lib/api';

/** Mirrored response shape from FR-054 GET /search. */
export interface SearchLeadItem {
  lead_id: string;
  lead_code: string;
  stage: string;
  product_code: string;
  applicant_name: string | null;
  mobile: string | null;
  pan_masked: string | null;
  owner_id: string;
  branch_id: string | null;
  created_at: string;
}

export interface SearchPartnerItem {
  partner_id: string;
  partner_code: string;
  legal_name: string;
  type: string;
  status: string;
}

export interface SearchTaskItem {
  task_id: string;
  type: string;
  lead_id: string;
  lead_code: string;
  due_at: string;
  status: string;
  priority: string;
}

export interface SearchResponse {
  leads: SearchLeadItem[];
  partners: SearchPartnerItem[];
  tasks: SearchTaskItem[];
  top_n: number;
  query: string;
  counts: { leads: number; partners: number; tasks: number };
}

/**
 * FR-054 — TanStack Query hook for `GET /api/v1/search?q=`.
 * Query is enabled only when `q.length >= 2` (LLD §UI: debounce + min-length gate).
 * Errors bubble to the caller as a thrown `ApiClientError` (taxonomy code); the
 * palette renders the appropriate error state.
 */
export function useSearch(q: string): UseQueryResult<SearchResponse> {
  return useQuery({
    queryKey: ['search', q],
    queryFn: ({ signal }) => apiClient.get<SearchResponse>('/search', { query: { q }, signal }),
    enabled: q.length >= 2,
    staleTime: 10_000,
    retry: false,
  });
}
