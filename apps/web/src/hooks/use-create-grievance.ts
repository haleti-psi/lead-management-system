import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface CreateGrievanceBody {
  category: string;
  description: string;
  attachmentNote?: string;
}

export interface CreateGrievanceData {
  grievanceId: string;
  grievanceNo: string;
  status: string;
  sla_due_at: string | null;
  message: string;
}

/**
 * FR-061 — `POST /c/{token}/grievance` (public). `skipAuthRefresh` so a 404 on
 * the customer path never triggers the staff token-refresh → /login redirect.
 */
export function useCreateGrievance(
  token: string,
): UseMutationResult<CreateGrievanceData, unknown, CreateGrievanceBody> {
  return useMutation({
    mutationFn: (body: CreateGrievanceBody) =>
      apiClient.post<CreateGrievanceData>(`/c/${token}/grievance`, body, { skipAuthRefresh: true }),
  });
}
