import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type { DocumentChecklistResponse } from '@/types/documents';

/** React Query keys for the FR-070 document checklist (single source so mutations
 * can invalidate precisely). */
export const documentKeys = {
  all: ['documents'] as const,
  checklist: (leadId: string) => ['documents', 'checklist', leadId] as const,
};

/** GET /leads/{id}/documents — the merged checklist (LLD §Endpoint 1). */
export function useDocumentChecklist(leadId: string): UseQueryResult<DocumentChecklistResponse> {
  return useQuery({
    queryKey: documentKeys.checklist(leadId),
    queryFn: ({ signal }) =>
      apiClient.get<DocumentChecklistResponse>(`/leads/${leadId}/documents`, { signal }),
    enabled: Boolean(leadId),
  });
}
