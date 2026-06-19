import type {
  ApprovalStatus,
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
 * FR-051 — wire types for `GET /api/v1/leads/{id}` (the api `Lead360Dto`).
 * Timestamps arrive as ISO strings; PII fields (`name`/`mobile`/`email`) are
 * already server-masked (FR-002 masks on serialisation — the UI NEVER receives
 * raw PII); `panMasked` is the at-rest-masked PAN; `dob` is absent for the DPO
 * masked view.
 */
export interface Lead360Identity {
  leadIdentityId: string;
  name: string;
  mobile: string;
  email: string | null;
  panMasked: string | null;
  gstin: string | null;
  dob?: string | null;
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
  utm: Record<string, unknown> | null;
}

export interface Lead360ProductDetail {
  leadProductDetailId: string;
  productCode: ProductCode;
  productConfigId: string;
  attributes: Record<string, unknown>;
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
  occurredAt: string;
}

export interface Lead360EligibilitySnapshot {
  eligibilitySnapshotId: string;
  indicativeAmount: string | null;
  tenureMonths: number | null;
  rateRange: string | null;
  conditions: Record<string, unknown> | null;
  validityUntil: string | null;
  status: EligibilityStatus;
  createdAt: string;
}

export interface Lead360LosMirror {
  losMirrorId: string;
  losApplicationId: string;
  status: string;
  statusDate: string;
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
  createdAt: string;
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

export interface Lead360Response {
  leadId: string;
  leadCode: string;
  stage: LeadStage;
  approvalStatus: ApprovalStatus;
  priority: Priority;
  isHot: boolean;
  score: number | null;
  scoreReasons: Record<string, unknown> | null;
  requestedAmount: string | null;
  channelCreatedBy: CreationChannel;
  consentStatus: ConsentStatus;
  kycStatus: KycStatus;
  duplicateStatus: DupStatus;
  losApplicationId: string | null;
  slaFirstContactDueAt: string | null;
  reopenedCount: number;
  nurtureNextAt: string | null;
  createdAt: string;
  updatedAt: string;
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
