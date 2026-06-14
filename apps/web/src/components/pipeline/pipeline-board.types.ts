/**
 * FR-052 — wire types for the Pipeline Board.
 *
 * Board columns project from `GET /api/v1/leads` with `filter[stage]=<value>`.
 * The card fields are a subset of the lead list response; PII (customerName) is
 * already server-masked (FR-002) before reaching the client.
 */

import type { ConsentStatus, KycStatus, LeadStage, ProductCode } from '@lms/shared';

/** One card as projected from the GET /leads response for the board. */
export interface PipelineLeadCard {
  leadId: string;
  leadCode: string;
  /** Already server-masked name (FR-002). */
  customerName: string;
  productCode: ProductCode | string;
  /** INR NUMERIC(15,2) serialised as string by the API. */
  requestedAmount: string | null;
  stage: LeadStage;
  isHot: boolean;
  consentStatus: ConsentStatus;
  kycStatus: KycStatus;
  ownerName: string | null;
  ageingDays: number;
  nextActionAt: string | null;
  version: number;
}

/** API list response shape (envelope `data` field). */
export interface LeadListData {
  items: PipelineLeadCard[];
  total: number;
  page: number;
  limit: number;
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
