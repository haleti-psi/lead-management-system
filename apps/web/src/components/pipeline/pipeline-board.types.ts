/**
 * FR-052 — wire types for the Pipeline Board.
 *
 * Board columns project from `GET /api/v1/leads` (the FR-050 contract `Lead`
 * list shape) with `filter[stage]=<value>`. PII (name/mobile) is already
 * server-masked (FR-002) before it reaches the client.
 *
 * The contract `Lead` list projection does NOT carry the lead's requested
 * amount, owner, ageing, next-action or version — so those card fields are
 * OPTIONAL and render only when a richer projection (a future dedicated board
 * endpoint) supplies them. The stage-move `version` is fetched just-in-time
 * from `GET /leads/:id` at drop time (see KanbanBoard / `fetchLeadVersion`).
 */

import type { ConsentStatus, KycStatus, LeadStage, ProductCode } from '@lms/shared';

/** One row as returned by `GET /leads` (api-contract `Lead`; snake_case, masked). */
export interface BoardLeadRow {
  lead_id: string;
  lead_code: string;
  stage: LeadStage;
  product_code: ProductCode | string;
  is_hot: boolean;
  score: number | null;
  consent_status: ConsentStatus;
  kyc_status: KycStatus;
  name_masked: string | null;
  mobile_masked: string | null;
}

/**
 * One card on the board. The first block mirrors the contract `Lead` list shape;
 * the optional block is populated only when a richer projection provides it
 * (kept optional so the card lights up automatically if a board endpoint lands).
 */
export interface PipelineLeadCard {
  leadId: string;
  leadCode: string;
  /** Already server-masked name (FR-002). */
  customerName: string;
  productCode: ProductCode | string;
  stage: LeadStage;
  isHot: boolean;
  consentStatus: ConsentStatus;
  kycStatus: KycStatus;
  score?: number | null;
  /** INR NUMERIC(15,2) serialised as string by the API (not in the list projection). */
  requestedAmount?: string | null;
  ownerName?: string | null;
  ageingDays?: number;
  nextActionAt?: string | null;
  version?: number;
}

/** Result of PATCH /leads/{id}/stage (envelope `data` field). */
export interface StageTransitionResult {
  leadId: string;
  leadCode: string;
  stage: LeadStage;
  version: number;
  updatedAt: string;
}

/** Body sent to PATCH /leads/{id}/stage. */
export interface StageChangeBody {
  to: string;
  expected_version: number;
  reason?: string;
}
