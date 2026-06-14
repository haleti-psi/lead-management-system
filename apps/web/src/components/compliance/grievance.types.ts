/**
 * FR-114 — Grievance resource types shared across web components.
 * Mirror of the API response shape (api-contract.yaml `createGrievance` / `listGrievances`).
 */

export type GrievanceStatus = 'open' | 'in_progress' | 'escalated' | 'resolved' | 'closed';
export type GrievanceSource = 'customer_link' | 'rm' | 'branch' | 'call_centre' | 'partner' | 'admin';
export type GrievanceCategory = 'service_delay' | 'mis_selling' | 'data_privacy' | 'document_issue' | 'staff_conduct' | 'other';

export interface GrievanceItem {
  grievanceId: string;
  grievanceNo: string;
  leadId: string | null;
  source: GrievanceSource;
  category: GrievanceCategory;
  description: string;
  ownerId: string | null;
  slaDueAt: string | null;  // ISO8601 string from JSON
  status: GrievanceStatus;
  response: string | null;
  closureProofRef: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface GrievanceListResult {
  data: GrievanceItem[];
  meta: {
    correlation_id: string;
    pagination: { page: number; limit: number; total: number };
  };
  error: null;
}

export interface CreateGrievanceInput {
  leadId?: string | null;
  source: GrievanceSource;
  category: GrievanceCategory;
  description: string;
  ownerId?: string | null;
}

export interface UpdateGrievanceInput {
  status?: GrievanceStatus;
  response?: string;
  closureProofRef?: string;
  ownerId?: string;
}

/** Valid status transitions per state machine (state-machines.md §Grievance). */
export const VALID_NEXT_STATUSES: Partial<Record<GrievanceStatus, GrievanceStatus[]>> = {
  open: ['in_progress'],
  in_progress: ['escalated', 'resolved'],
  escalated: ['resolved'],
  resolved: ['closed'],
  closed: [],
};
