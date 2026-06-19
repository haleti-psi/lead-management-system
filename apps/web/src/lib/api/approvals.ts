import type { ApprovalDecision, ApprovalStatus, LeadStage } from '@lms/shared';

import { apiClient } from './apiClient';

/**
 * FR-055 — typed API client wrapper for the Lead Approval endpoint.
 * `POST /api/v1/leads/{id}/approval`
 *
 * Decision body: `{ decision: 'approve'|'reject', reason?: string }`
 * Reason is required (5–500 chars) when decision is 'reject'.
 *
 * Error taxonomy:
 *   400 VALIDATION_ERROR — missing/invalid reason or bad decision value
 *   403 FORBIDDEN        — caller lacks approve_lead for this lead's scope
 *   404 NOT_FOUND        — lead not found
 *   409 CONFLICT         — lead is not in pending_approval stage
 */

export interface ApproveLeadDto {
  decision: ApprovalDecision;
  /** Required and 5–500 chars when decision === 'reject'. */
  reason?: string;
}

export interface ApprovalResult {
  lead_id: string;
  lead_code: string;
  stage: LeadStage;
  approval_status: ApprovalStatus;
  decision: ApprovalDecision;
  decided_by: string;
  decided_at: string;
}

/**
 * POST /api/v1/leads/{id}/approval
 * Returns the updated lead summary on 200.
 * Rejects with ApiClientError on 400/403/404/409.
 */
export async function decideLeadApproval(leadId: string, dto: ApproveLeadDto): Promise<ApprovalResult> {
  return apiClient.post<ApprovalResult>(`/leads/${leadId}/approval`, dto);
}
