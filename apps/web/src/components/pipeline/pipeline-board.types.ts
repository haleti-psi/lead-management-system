/**
 * FR-052 — wire types for the Pipeline Board.
 *
 * Board columns come from `GET /api/v1/pipeline-board?stage=<value>` — a masked,
 * scope-filtered projection (FR-052) that carries the lead's requested amount,
 * owner name, ageing and optimistic-lock version on top of the masked identity.
 */

import type { ConsentStatus, KycStatus, LeadStage, ProductCode } from '@lms/shared';

/** One row from `GET /pipeline-board` (snake_case; name/mobile already server-masked). */
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
  requested_amount: string | null;
  owner_name: string | null;
  ageing_days: number;
  version: number;
}

/** One card on the board (camelCase). */
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
  /** INR NUMERIC(15,2) serialised as string by the API (null if unset). */
  requestedAmount: string | null;
  ownerName: string | null;
  ageingDays: number;
  /** Not carried by the board projection; reserved for future use. */
  nextActionAt?: string | null;
  /** Optimistic-lock version for stage moves. */
  version: number;
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
