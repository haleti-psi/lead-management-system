import { useMutation, useQueryClient } from '@tanstack/react-query';

import { isApiClientError } from '@/lib/api';
import { decideLeadApproval } from '@/lib/api/approvals';
import type { ApproveLeadDto, ApprovalResult } from '@/lib/api/approvals';
import { leadKeys } from '@/hooks/use-leads';

/**
 * FR-055 — mutation hook for approving or rejecting a lead.
 *
 * On success: invalidates the lead detail cache (keyed by leadId) and the
 * lead list (so the approvals queue re-fetches and shows the updated stage).
 *
 * Error mapping (user-facing messages):
 *   409 CONFLICT         → Lead is no longer awaiting approval.
 *   403 FORBIDDEN        → You don't have permission to approve this lead.
 *   400 VALIDATION_ERROR → field-level errors from the server (reason missing/too short).
 *   else                 → Could not submit decision. Please try again.
 */
export function useLeadApproval(leadId: string) {
  const queryClient = useQueryClient();

  return useMutation<ApprovalResult, unknown, ApproveLeadDto>({
    mutationFn: (dto: ApproveLeadDto) => decideLeadApproval(leadId, dto),
    onSuccess: () => {
      // Invalidate the lead 360 view so the stage chip and history refresh.
      void queryClient.invalidateQueries({ queryKey: ['lead360', leadId] });
      // Invalidate all lead lists (the approvals queue will drop this row).
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

/** Map an API error to a concise user-facing message. */
export function approvalErrorMessage(error: unknown): string {
  if (isApiClientError(error)) {
    if (error.status === 409) return 'Lead is no longer awaiting approval.';
    if (error.status === 403) return "You don't have permission to approve this lead.";
    if (error.status === 400) {
      const first = error.fields?.[0];
      if (first) return first.issue;
      return error.message;
    }
  }
  return 'Could not submit decision. Please try again.';
}

export type { ApproveLeadDto, ApprovalResult };
