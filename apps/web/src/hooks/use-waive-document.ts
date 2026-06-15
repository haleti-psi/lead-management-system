import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { documentKeys } from '@/hooks/use-document-checklist';
import type { WaiverBody, WaiverData } from '@/types/documents';

export interface WaiveInput {
  documentId: string;
  body: WaiverBody;
}

/**
 * POST /leads/{id}/documents/{did}/waive — authorised waiver (LLD §Endpoint 3;
 * KYC/BM only, enforced server-side). Invalidates the lead's checklist on success.
 */
export function useWaiveDocument(
  leadId: string,
): UseMutationResult<WaiverData, unknown, WaiveInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, body }: WaiveInput) =>
      apiClient.post<WaiverData>(`/leads/${leadId}/documents/${documentId}/waive`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentKeys.checklist(leadId) });
    },
  });
}
