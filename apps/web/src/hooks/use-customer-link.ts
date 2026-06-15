import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type { CustomerOpenData, VerifyOtpData } from '@/types/customer-link';

/** Query keys for the public customer micro-site. */
export const customerLinkKeys = {
  open: (token: string) => ['customer-link', token] as const,
};

/**
 * FR-060 — `GET /c/{token}` (public landing). `skipAuthRefresh` is essential: a
 * 404/401 on the customer path must NOT trigger the staff token-refresh →
 * /login redirect (this is an unauthenticated micro-site). No retry — an invalid
 * /expired token (404) is terminal.
 */
export function useCustomerLink(token: string): UseQueryResult<CustomerOpenData> {
  return useQuery({
    queryKey: customerLinkKeys.open(token),
    queryFn: ({ signal }) =>
      apiClient.get<CustomerOpenData>(`/c/${token}`, { signal, skipAuthRefresh: true }),
    enabled: Boolean(token),
    retry: false,
  });
}

/** FR-060 — `POST /c/{token}/otp` step-up. Invalidates the landing on success. */
export function useVerifyOtp(token: string): UseMutationResult<VerifyOtpData, unknown, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (otp: string) =>
      apiClient.post<VerifyOtpData>(`/c/${token}/otp`, { otp }, { skipAuthRefresh: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customerLinkKeys.open(token) });
    },
  });
}
