/**
 * FR-112 — Data-rights resource types shared across web components.
 * Mirror of the API response shape (api-contract.yaml `createDataRights` /
 * `listDataRights` / `processDataRights`).
 */

export type RightsStatus = 'open' | 'in_review' | 'fulfilled' | 'rejected_retained';
export type RightsType =
  | 'access'
  | 'correction'
  | 'update'
  | 'erasure'
  | 'withdrawal'
  | 'grievance';

export interface DataRightsItem {
  dataRightsRequestId: string;
  customerProfileId: string;
  leadId: string | null;
  requestType: RightsType;
  status: RightsStatus;
  ownerId: string | null;
  dueAt: string | null; // ISO8601 string from JSON
  disposition: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface DataRightsListResult {
  data: DataRightsItem[];
  meta: {
    correlation_id: string;
    pagination: { page: number; limit: number; total: number };
  };
  error: null;
}

export interface CreateDataRightsInput {
  customerProfileId: string;
  leadId?: string | null;
  requestType: RightsType;
}

export interface UpdateDataRightsInput {
  status: RightsStatus;
  disposition?: string;
  ownerId?: string;
}

/**
 * Valid forward transitions (state-machines.md §DataRightsRequest).
 * Used to build the StatusTransitionSelect options.
 */
export const VALID_NEXT_STATUSES: Partial<Record<RightsStatus, RightsStatus[]>> = {
  open: ['in_review', 'rejected_retained'],
  in_review: ['fulfilled', 'rejected_retained'],
  fulfilled: [],
  rejected_retained: [],
};

/** Human-readable labels for each rights_type value. */
export const RIGHTS_TYPE_LABELS: Record<RightsType, string> = {
  access: 'Access',
  correction: 'Correction',
  update: 'Update',
  erasure: 'Erasure',
  withdrawal: 'Withdrawal',
  grievance: 'Grievance',
};

/** Human-readable labels for each rights_status value. */
export const RIGHTS_STATUS_LABELS: Record<RightsStatus, string> = {
  open: 'Open',
  in_review: 'In Review',
  fulfilled: 'Fulfilled',
  rejected_retained: 'Rejected / Retained',
};

/** Determine if the given status is a terminal state (no further transitions). */
export function isTerminalStatus(status: RightsStatus): boolean {
  return status === 'fulfilled' || status === 'rejected_retained';
}

/** Determine if the given status requires a disposition field. */
export function requiresDisposition(status: RightsStatus): boolean {
  return status === 'fulfilled' || status === 'rejected_retained';
}
