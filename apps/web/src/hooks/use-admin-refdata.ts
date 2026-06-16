import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiClient, type PageResult } from '@/lib/api';
import type { RefDataOption } from '@/types/admin';

/**
 * FR-130 reference data — branches & regions for the user/team assignment
 * Selects. Branches and regions are FR-131 master resources served at
 * `GET /admin/branches` / `GET /admin/regions` (capability `configuration`,
 * which ADMIN also holds — auth-matrix). The master record carries more fields;
 * we project just `{ id, code, name }` for the dropdowns. Fetched at the page's
 * max list size (100) — these catalogues are small.
 */
interface MasterRecord {
  id: string;
  code?: string;
  name?: string;
}

const REF_LIMIT = 100;

function toOption(r: MasterRecord): RefDataOption {
  return { id: r.id, code: r.code ?? '', name: r.name ?? r.code ?? r.id };
}

export const adminRefDataKeys = {
  branches: ['admin', 'refdata', 'branches'] as const,
  regions: ['admin', 'refdata', 'regions'] as const,
};

/** List branches as `{ id, code, name }` options. */
export function useBranchOptions(enabled = true): UseQueryResult<RefDataOption[]> {
  return useQuery({
    queryKey: adminRefDataKeys.branches,
    enabled,
    queryFn: async ({ signal }) => {
      const page: PageResult<MasterRecord> = await apiClient.getPage<MasterRecord>('/admin/branches', {
        query: { page: 1, limit: REF_LIMIT },
        signal,
      });
      return page.data.map(toOption);
    },
  });
}

/** List regions as `{ id, code, name }` options. */
export function useRegionOptions(enabled = true): UseQueryResult<RefDataOption[]> {
  return useQuery({
    queryKey: adminRefDataKeys.regions,
    enabled,
    queryFn: async ({ signal }) => {
      const page: PageResult<MasterRecord> = await apiClient.getPage<MasterRecord>('/admin/regions', {
        query: { page: 1, limit: REF_LIMIT },
        signal,
      });
      return page.data.map(toOption);
    },
  });
}
