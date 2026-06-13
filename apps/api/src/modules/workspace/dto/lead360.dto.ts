import { z } from 'zod';

import type {
  ConsentPurpose,
  ConsentState,
  ConsentStatus,
  CreationChannel,
  CustomerType,
  DupAction,
  DupRecordStatus,
  DupStatus,
  EligibilityStatus,
  KycStatus,
  Lang,
  LeadSource,
  LeadStage,
  MatchConfidence,
  PartnerStatus,
  PartnerType,
  Priority,
  ProductCode,
  ValidationStatus,
} from '@lms/shared';

/**
 * FR-051 — `GET /leads/{id}` (api-contract `getLead`) path params. Validated as
 * an object so a non-UUID reports `fields: [{ field: 'id', … }]` exactly as the
 * LLD §Validation Logic table specifies (400 VALIDATION_ERROR).
 */
export const Lead360ParamsSchema = z.object({
  id: z
    .string({
      required_error: 'id must be a valid UUID',
      invalid_type_error: 'id must be a valid UUID',
    })
    .uuid('id must be a valid UUID'),
});
export type Lead360Params = z.infer<typeof Lead360ParamsSchema>;

/** Parsed JSONB column projection (score_reasons / utm / attributes / conditions). */
export type JsonObject = Record<string, unknown>;

/**
 * Wire shapes for the Lead-360 aggregate — EXACTLY the LLD §Endpoint response
 * (camelCase sections). Raw PII (`name`/`mobile`/`email`) is masked by the
 * service before these leave it; `panMasked` is the at-rest-masked column
 * (`lead_identities.pan_masked` — the raw PAN is never stored or selected).
 * `dob` is omitted (undefined) under the strict (DPO/export) masking level.
 */
export interface Lead360Identity {
  leadIdentityId: string;
  name: string;
  mobile: string;
  email: string | null;
  panMasked: string | null;
  gstin: string | null;
  dob?: Date | null;
  preferredLanguage: Lang | null;
}

export interface Lead360CustomerProfile {
  customerProfileId: string;
  displayName: string;
  customerType: CustomerType;
  isExistingCustomer: boolean;
}

export interface Lead360SourceAttribution {
  source: LeadSource;
  subSource: string | null;
  partnerId: string | null;
  campaignCode: string | null;
  utm: JsonObject | null;
}

export interface Lead360ProductDetail {
  leadProductDetailId: string;
  productCode: ProductCode;
  productConfigId: string;
  attributes: JsonObject;
  validationStatus: ValidationStatus;
}

export interface Lead360Branch {
  branchId: string;
  name: string;
}

export interface Lead360Owner {
  userId: string;
  displayName: string;
}

export interface Lead360Team {
  teamId: string;
  name: string;
}

export interface Lead360StageHistoryItem {
  stageHistoryId: string;
  fromStage: LeadStage | null;
  toStage: LeadStage;
  actorId: string;
  reason: string | null;
  occurredAt: Date;
}

export interface Lead360EligibilitySnapshot {
  eligibilitySnapshotId: string;
  indicativeAmount: string | null;
  tenureMonths: number | null;
  rateRange: string | null;
  conditions: JsonObject | null;
  validityUntil: Date | null;
  status: EligibilityStatus;
  createdAt: Date;
}

export interface Lead360LosMirror {
  losMirrorId: string;
  losApplicationId: string;
  status: string;
  statusDate: Date;
}

export interface Lead360DocumentSummary {
  total: number;
  verified: number;
  pending: number;
  mismatch: number;
}

export interface Lead360KycSummary {
  total: number;
  success: number;
  failed: number;
  exception: number;
  initiated: number;
}

export interface Lead360ConsentSummaryItem {
  purpose: ConsentPurpose;
  state: ConsentState;
}

export interface Lead360Note {
  noteId: string;
  authorId: string;
  body: string;
  isInternal: boolean;
  createdAt: Date;
}

export interface Lead360DuplicateMatch {
  duplicateMatchId: string;
  matchedLeadId: string;
  matchedLeadCode: string;
  confidence: MatchConfidence;
  status: DupRecordStatus;
  action: DupAction;
}

export interface Lead360Partner {
  partnerId: string;
  partnerCode: string;
  legalName: string;
  type: PartnerType;
  status: PartnerStatus;
}

/** The full Lead-360 aggregate (LLD §Endpoint 200 `data`). */
export interface Lead360Dto {
  leadId: string;
  leadCode: string;
  stage: LeadStage;
  priority: Priority;
  isHot: boolean;
  score: number | null;
  scoreReasons: JsonObject | null;
  requestedAmount: string | null;
  channelCreatedBy: CreationChannel;
  consentStatus: ConsentStatus;
  kycStatus: KycStatus;
  duplicateStatus: DupStatus;
  losApplicationId: string | null;
  slaFirstContactDueAt: Date | null;
  reopenedCount: number;
  nurtureNextAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  identity: Lead360Identity;
  customerProfile: Lead360CustomerProfile | null;
  sourceAttribution: Lead360SourceAttribution;
  productDetail: Lead360ProductDetail | null;
  branch: Lead360Branch | null;
  owner: Lead360Owner | null;
  team: Lead360Team | null;
  stageHistory: Lead360StageHistoryItem[];
  eligibilitySnapshot: Lead360EligibilitySnapshot | null;
  losApplicationMirror: Lead360LosMirror | null;
  documentSummary: Lead360DocumentSummary;
  kycSummary: Lead360KycSummary;
  openTaskCount: number;
  consentSummary: Lead360ConsentSummaryItem[];
  notes: Lead360Note[];
  duplicateMatches: Lead360DuplicateMatch[];
  partner: Lead360Partner | null;
}
