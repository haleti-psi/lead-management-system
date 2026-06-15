// Enums — the single source of truth for both apps/api and apps/web.
// Hand-authored in Stage 7 from every `CREATE TYPE … AS ENUM (…)` in
// docs/data-model/schema.sql (BRD §5.5 catalog). Each PostgreSQL enum maps to a
// frozen `const` object (value === DB literal) plus a PascalCase string-union type.
// Never redefine an enum locally in a module; import from `@lms/shared`.
// See docs/contracts/shared-utilities.md ("Shared enums").

// ── 1. Identity / RBAC ────────────────────────────────────────
export const RoleCode = {
  RM: 'RM',
  BM: 'BM',
  SM: 'SM',
  HEAD: 'HEAD',
  KYC: 'KYC',
  DPO: 'DPO',
  PARTNER: 'PARTNER',
  ADMIN: 'ADMIN',
  CUSTOMER: 'CUSTOMER',
} as const;
export type RoleCode = typeof RoleCode[keyof typeof RoleCode];

export const DataScope = {
  O: 'O',
  T: 'T',
  B: 'B',
  R: 'R',
  A: 'A',
  P: 'P',
  C: 'C',
  M: 'M',
  X: 'X',
} as const;
export type DataScope = typeof DataScope[keyof typeof DataScope];

export const Capability = {
  CREATE_LEAD: 'create_lead',
  VIEW_LEAD: 'view_lead',
  EDIT_LEAD: 'edit_lead',
  UPLOAD_DOC: 'upload_doc',
  VERIFY_DOC: 'verify_doc',
  KYC_SIGNOFF: 'kyc_signoff',
  MOVE_STAGE: 'move_stage',
  HAND_OFF: 'hand_off',
  ALLOCATE: 'allocate',
  BULK_ACTION: 'bulk_action',
  CUSTOMER_COMM: 'customer_comm',
  REPORTS: 'reports',
  EXPORT: 'export',
  CONSENT_LEDGER: 'consent_ledger',
  AUDIT_TRAIL: 'audit_trail',
  USER_MGMT: 'user_mgmt',
  CONFIGURATION: 'configuration',
  BREAK_GLASS: 'break_glass',
} as const;
export type Capability = typeof Capability[keyof typeof Capability];

export const UserStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  LOCKED: 'locked',
} as const;
export type UserStatus = typeof UserStatus[keyof typeof UserStatus];

export const GrantStatus = {
  PENDING: 'pending',
  ACTIVE: 'active',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
} as const;
export type GrantStatus = typeof GrantStatus[keyof typeof GrantStatus];

// ── 2. Lead core ──────────────────────────────────────────────
export const LeadStage = {
  CAPTURED: 'captured',
  CONSENT_PENDING: 'consent_pending',
  ASSIGNED: 'assigned',
  FIRST_CONTACT_PENDING: 'first_contact_pending',
  CONTACTED: 'contacted',
  QUALIFIED: 'qualified',
  DOCUMENTS_PENDING: 'documents_pending',
  KYC_IN_PROGRESS: 'kyc_in_progress',
  ELIGIBILITY_REQUESTED: 'eligibility_requested',
  READY_FOR_HANDOFF: 'ready_for_handoff',
  HANDED_OFF: 'handed_off',
  REJECTED: 'rejected',
  DORMANT: 'dormant',
} as const;
export type LeadStage = typeof LeadStage[keyof typeof LeadStage];

export const Priority = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
} as const;
export type Priority = typeof Priority[keyof typeof Priority];

export const CreationChannel = {
  MANUAL: 'manual',
  BULK: 'bulk',
  API: 'api',
  QR: 'qr',
  PARTNER: 'partner',
  WEBSITE: 'website',
  TELECALLING: 'telecalling',
  MISSED_CALL: 'missed_call',
} as const;
export type CreationChannel = typeof CreationChannel[keyof typeof CreationChannel];

export const ConsentStatus = {
  PENDING: 'pending',
  PARTIAL: 'partial',
  CAPTURED: 'captured',
  WITHDRAWN: 'withdrawn',
} as const;
export type ConsentStatus = typeof ConsentStatus[keyof typeof ConsentStatus];

export const KycStatus = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  VERIFIED: 'verified',
  EXCEPTION: 'exception',
  WAIVED: 'waived',
} as const;
export type KycStatus = typeof KycStatus[keyof typeof KycStatus];

export const DupStatus = {
  NONE: 'none',
  FLAGGED: 'flagged',
  LINKED: 'linked',
  MERGED: 'merged',
} as const;
export type DupStatus = typeof DupStatus[keyof typeof DupStatus];

// ── 3. Duplicate detection ────────────────────────────────────
export const MatchConfidence = {
  STRONG: 'strong',
  MEDIUM: 'medium',
  WEAK: 'weak',
} as const;
export type MatchConfidence = typeof MatchConfidence[keyof typeof MatchConfidence];

export const DupAction = {
  BLOCKED: 'blocked',
  WARNED: 'warned',
  QUEUED: 'queued',
  LINKED: 'linked',
  MERGED: 'merged',
  OVERRIDDEN: 'overridden',
} as const;
export type DupAction = typeof DupAction[keyof typeof DupAction];

export const DupRecordStatus = {
  OPEN: 'open',
  RESOLVED: 'resolved',
} as const;
export type DupRecordStatus = typeof DupRecordStatus[keyof typeof DupRecordStatus];

// ── 4. Product config ─────────────────────────────────────────
export const ProductCode = {
  CV: 'CV',
  CAR: 'CAR',
  TRACTOR: 'TRACTOR',
  CE: 'CE',
  TW: 'TW',
  SBL: 'SBL',
  HRM: 'HRM',
} as const;
export type ProductCode = typeof ProductCode[keyof typeof ProductCode];

export const PanTiming = {
  AT_CAPTURE: 'at_capture',
  BEFORE_KYC: 'before_kyc',
  BEFORE_HANDOFF: 'before_handoff',
} as const;
export type PanTiming = typeof PanTiming[keyof typeof PanTiming];

export const ConfigStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  RETIRED: 'retired',
} as const;
export type ConfigStatus = typeof ConfigStatus[keyof typeof ConfigStatus];

export const ValidationStatus = {
  INCOMPLETE: 'incomplete',
  VALID: 'valid',
  INVALID: 'invalid',
} as const;
export type ValidationStatus = typeof ValidationStatus[keyof typeof ValidationStatus];

export const ConfigChangeStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ACTIVE: 'active',
  ROLLED_BACK: 'rolled_back',
} as const;
export type ConfigChangeStatus = typeof ConfigChangeStatus[keyof typeof ConfigChangeStatus];

// ── 5. Allocation ─────────────────────────────────────────────
export const AllocationMethod = {
  ROUND_ROBIN: 'round_robin',
  CAPACITY: 'capacity',
  SPECIALIST: 'specialist',
  BRANCH: 'branch',
  PARTNER: 'partner',
  ESCALATION: 'escalation',
} as const;
export type AllocationMethod = typeof AllocationMethod[keyof typeof AllocationMethod];

// ── 6. Partner / source ───────────────────────────────────────
export const PartnerType = {
  DSA: 'DSA',
  DEALER: 'Dealer',
  CONNECTOR: 'Connector',
  OEM: 'OEM',
  AGGREGATOR: 'Aggregator',
  REFERRAL: 'Referral',
} as const;
export type PartnerType = typeof PartnerType[keyof typeof PartnerType];

export const PartnerStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  EXPIRED: 'expired',
} as const;
export type PartnerStatus = typeof PartnerStatus[keyof typeof PartnerStatus];

export const RiskBand = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const;
export type RiskBand = typeof RiskBand[keyof typeof RiskBand];

export const LeadSource = {
  DSA: 'DSA',
  DEALER: 'Dealer',
  BRANCH: 'Branch',
  WEBSITE: 'Website',
  REFERRAL: 'Referral',
  TELECALLING: 'Telecalling',
  FIELD: 'Field',
} as const;
export type LeadSource = typeof LeadSource[keyof typeof LeadSource];

export const AttributionStatus = {
  ORIGINAL: 'original',
  REASSIGNED: 'reassigned',
  MERGED_INTO: 'merged_into',
} as const;
export type AttributionStatus = typeof AttributionStatus[keyof typeof AttributionStatus];

// ── 7. Customer link ──────────────────────────────────────────
export const LinkStatus = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  USED: 'used',
} as const;
export type LinkStatus = typeof LinkStatus[keyof typeof LinkStatus];

// ── 8. Documents / KYC ────────────────────────────────────────
export const DocType = {
  ID: 'id',
  PAN: 'pan',
  ADDRESS: 'address',
  INCOME: 'income',
  BANK: 'bank',
  QUOTATION: 'quotation',
  RC: 'rc',
  PERMIT: 'permit',
  INSURANCE: 'insurance',
  LAND_RECORD: 'land_record',
  PROPERTY: 'property',
  VALUATION: 'valuation',
  TITLE: 'title',
  WORK_ORDER: 'work_order',
  GST: 'gst',
  ITR: 'itr',
  PHOTO: 'photo',
  OTHER: 'other',
} as const;
export type DocType = typeof DocType[keyof typeof DocType];

export const ApplicantScope = {
  APPLICANT: 'applicant',
  CO_APPLICANT: 'co_applicant',
  GUARANTOR: 'guarantor',
  BUSINESS: 'business',
} as const;
export type ApplicantScope = typeof ApplicantScope[keyof typeof ApplicantScope];

export const DocStatus = {
  NOT_REQUIRED: 'not_required',
  PENDING: 'pending',
  UPLOADED: 'uploaded',
  UNDER_REVIEW: 'under_review',
  VERIFIED: 'verified',
  MISMATCH: 'mismatch',
  WAIVED: 'waived',
  EXPIRED: 'expired',
} as const;
export type DocStatus = typeof DocStatus[keyof typeof DocStatus];

export const UploadChannel = {
  RM: 'rm',
  CUSTOMER_LINK: 'customer_link',
  PARTNER: 'partner',
  DIGILOCKER: 'digilocker',
} as const;
export type UploadChannel = typeof UploadChannel[keyof typeof UploadChannel];

export const ScanStatus = {
  PENDING: 'pending',
  CLEAN: 'clean',
  INFECTED: 'infected',
} as const;
export type ScanStatus = typeof ScanStatus[keyof typeof ScanStatus];

export const KycType = {
  PAN: 'pan',
  CKYC: 'ckyc',
  DIGILOCKER: 'digilocker',
  AADHAAR_OTP: 'aadhaar_otp',
  VCIP: 'vcip',
  MANUAL: 'manual',
} as const;
export type KycType = typeof KycType[keyof typeof KycType];

export const KycCheckStatus = {
  INITIATED: 'initiated',
  SUCCESS: 'success',
  FAILED: 'failed',
  EXCEPTION: 'exception',
  WAIVED: 'waived',
} as const;
export type KycCheckStatus = typeof KycCheckStatus[keyof typeof KycCheckStatus];

export const KycException = {
  PAN_MISMATCH: 'pan_mismatch',
  NAME_MISMATCH: 'name_mismatch',
  EXPIRED: 'expired',
  UNREADABLE: 'unreadable',
  ADDRESS_MISMATCH: 'address_mismatch',
  CKYC_UNAVAILABLE: 'ckyc_unavailable',
  DUPLICATE_CKYC: 'duplicate_ckyc',
  VCIP_FAILED: 'vcip_failed',
  PROVIDER_DOWN: 'provider_down',
} as const;
export type KycException = typeof KycException[keyof typeof KycException];

// ── 9. Tasks / engagement ─────────────────────────────────────
export const TaskType = {
  CALL: 'call',
  VISIT: 'visit',
  DOC_REQUEST: 'doc_request',
  KYC_APPT: 'kyc_appt',
  DEALER_FOLLOWUP: 'dealer_followup',
  CALLBACK: 'callback',
  APPROVAL: 'approval',
  HANDOFF_RETRY: 'handoff_retry',
  NURTURE: 'nurture',
} as const;
export type TaskType = typeof TaskType[keyof typeof TaskType];

export const TaskStatus = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled',
} as const;
export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

export const Disposition = {
  CONNECTED: 'connected',
  NO_ANSWER: 'no_answer',
  WRONG_NUMBER: 'wrong_number',
  NOT_INTERESTED: 'not_interested',
  VISITED: 'visited',
  RESCHEDULED: 'rescheduled',
  CALLBACK_REQUESTED: 'callback_requested',
  DOCS_PROMISED: 'docs_promised',
} as const;
export type Disposition = typeof Disposition[keyof typeof Disposition];

export const CommChannel = {
  IN_APP: 'in_app',
  EMAIL: 'email',
  SMS: 'sms',
  WHATSAPP: 'whatsapp',
} as const;
export type CommChannel = typeof CommChannel[keyof typeof CommChannel];

export const CommCategory = {
  TRANSACTIONAL: 'transactional',
  MARKETING: 'marketing',
} as const;
export type CommCategory = typeof CommCategory[keyof typeof CommCategory];

export const DeliveryStatus = {
  QUEUED: 'queued',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
} as const;
export type DeliveryStatus = typeof DeliveryStatus[keyof typeof DeliveryStatus];

export const SubjectType = {
  USER: 'user',
  CUSTOMER: 'customer',
} as const;
export type SubjectType = typeof SubjectType[keyof typeof SubjectType];

// ── 10. Consent / compliance ──────────────────────────────────
export const ConsentPurpose = {
  LEAD_CONTACT: 'lead_contact',
  PRODUCT_ELIGIBILITY: 'product_eligibility',
  KYC: 'kyc',
  DOCUMENT_PROCESSING: 'document_processing',
  LOS_HANDOFF: 'los_handoff',
  COMMUNICATION: 'communication',
  PARTNER_SHARING: 'partner_sharing',
  AA_BANK_DATA: 'aa_bank_data',
  GST_BUSINESS_DATA: 'gst_business_data',
  MARKETING: 'marketing',
  GRIEVANCE: 'grievance',
} as const;
export type ConsentPurpose = typeof ConsentPurpose[keyof typeof ConsentPurpose];

export const ConsentState = {
  GRANTED: 'granted',
  DENIED: 'denied',
  WITHDRAWN: 'withdrawn',
  EXPIRED: 'expired',
  SUPERSEDED: 'superseded',
} as const;
export type ConsentState = typeof ConsentState[keyof typeof ConsentState];

export const ConsentActor = {
  CUSTOMER: 'customer',
  RM: 'rm',
  PARTNER: 'partner',
  SYSTEM: 'system',
} as const;
export type ConsentActor = typeof ConsentActor[keyof typeof ConsentActor];

export const DataCategory = {
  IDENTITY: 'identity',
  CONTACT: 'contact',
  FINANCIAL: 'financial',
  KYC_DOC: 'kyc_doc',
  ASSET: 'asset',
  CONSENT: 'consent',
  BEHAVIOURAL: 'behavioural',
} as const;
export type DataCategory = typeof DataCategory[keyof typeof DataCategory];

export const DataClassification = {
  PUBLIC: 'public',
  INTERNAL: 'internal',
  CONFIDENTIAL: 'confidential',
  PII: 'pii',
  SENSITIVE: 'sensitive',
  RESTRICTED: 'restricted',
} as const;
export type DataClassification = typeof DataClassification[keyof typeof DataClassification];

export const ShareStatus = {
  SHARED: 'shared',
  FAILED: 'failed',
} as const;
export type ShareStatus = typeof ShareStatus[keyof typeof ShareStatus];

export const GrievanceSource = {
  CUSTOMER_LINK: 'customer_link',
  RM: 'rm',
  BRANCH: 'branch',
  CALL_CENTRE: 'call_centre',
  PARTNER: 'partner',
  ADMIN: 'admin',
} as const;
export type GrievanceSource = typeof GrievanceSource[keyof typeof GrievanceSource];

export const GrievanceCategory = {
  SERVICE_DELAY: 'service_delay',
  MIS_SELLING: 'mis_selling',
  DATA_PRIVACY: 'data_privacy',
  DOCUMENT_ISSUE: 'document_issue',
  STAFF_CONDUCT: 'staff_conduct',
  OTHER: 'other',
} as const;
export type GrievanceCategory = typeof GrievanceCategory[keyof typeof GrievanceCategory];

export const GrievanceStatus = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  ESCALATED: 'escalated',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
} as const;
export type GrievanceStatus = typeof GrievanceStatus[keyof typeof GrievanceStatus];

export const RightsType = {
  ACCESS: 'access',
  CORRECTION: 'correction',
  UPDATE: 'update',
  ERASURE: 'erasure',
  WITHDRAWAL: 'withdrawal',
  GRIEVANCE: 'grievance',
} as const;
export type RightsType = typeof RightsType[keyof typeof RightsType];

export const RightsStatus = {
  OPEN: 'open',
  IN_REVIEW: 'in_review',
  FULFILLED: 'fulfilled',
  REJECTED_RETAINED: 'rejected_retained',
} as const;
export type RightsStatus = typeof RightsStatus[keyof typeof RightsStatus];

export const DlaType = {
  DLA: 'dla',
  LSP: 'lsp',
  PARTNER: 'partner',
} as const;
export type DlaType = typeof DlaType[keyof typeof DlaType];

export const LeadOutcome = {
  REJECTED: 'rejected',
  HANDED_OFF: 'handed_off',
  DORMANT: 'dormant',
  ANY: 'any',
} as const;
export type LeadOutcome = typeof LeadOutcome[keyof typeof LeadOutcome];

export const RetentionAction = {
  PURGE: 'purge',
  ANONYMISE: 'anonymise',
} as const;
export type RetentionAction = typeof RetentionAction[keyof typeof RetentionAction];

// ── 11. LOS ───────────────────────────────────────────────────
export const EligibilityStatus = {
  PENDING: 'pending',
  RECEIVED: 'received',
  FAILED: 'failed',
} as const;
export type EligibilityStatus = typeof EligibilityStatus[keyof typeof EligibilityStatus];

export const MirrorSource = {
  WEBHOOK: 'webhook',
  POLL: 'poll',
} as const;
export type MirrorSource = typeof MirrorSource[keyof typeof MirrorSource];

// ── 12. Reporting / jobs ──────────────────────────────────────
export const MaskingLevel = {
  FULL: 'full',
  PARTIAL: 'partial',
  UNMASKED: 'unmasked',
} as const;
export type MaskingLevel = typeof MaskingLevel[keyof typeof MaskingLevel];

export const JobStatus = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  AWAITING_APPROVAL: 'awaiting_approval',
} as const;
export type JobStatus = typeof JobStatus[keyof typeof JobStatus];

export const RejectionPrimary = {
  NO_RESPONSE: 'no_response',
  NOT_INTERESTED: 'not_interested',
  DUPLICATE: 'duplicate',
  PRODUCT_UNSUITABLE: 'product_unsuitable',
  LOW_INCOME: 'low_income',
  OUT_OF_AREA: 'out_of_area',
  DOCUMENT_INCOMPLETE: 'document_incomplete',
  KYC_MISMATCH: 'kyc_mismatch',
  ASSET_UNACCEPTABLE: 'asset_unacceptable',
  PARTNER_WITHDRAWAL: 'partner_withdrawal',
  CONSENT_WITHDRAWN: 'consent_withdrawn',
  OTHER: 'other',
} as const;
export type RejectionPrimary = typeof RejectionPrimary[keyof typeof RejectionPrimary];

export const SlaTarget = {
  FIRST_CONTACT: 'first_contact',
  DOCUMENT: 'document',
  KYC_EXCEPTION: 'kyc_exception',
  GRIEVANCE: 'grievance',
  HANDOFF_RETRY: 'handoff_retry',
} as const;
export type SlaTarget = typeof SlaTarget[keyof typeof SlaTarget];

// ── 13. Integration / outbox ──────────────────────────────────
export const IntegrationKind = {
  LOS_ELIGIBILITY: 'los_eligibility',
  LOS_HANDOFF: 'los_handoff',
  LOS_STATUS: 'los_status',
  PAN: 'pan',
  CKYC: 'ckyc',
  DIGILOCKER: 'digilocker',
  AADHAAR: 'aadhaar',
  VCIP: 'vcip',
  COMM: 'comm',
  CTI: 'cti',
  AA: 'aa',
  GST: 'gst',
  ASSET: 'asset',
  BUREAU_VIA_LOS: 'bureau_via_los',
  CAMPAIGN: 'campaign',
} as const;
export type IntegrationKind = typeof IntegrationKind[keyof typeof IntegrationKind];

export const IntegrationDirection = {
  OUTBOUND: 'outbound',
  INBOUND: 'inbound',
} as const;
export type IntegrationDirection = typeof IntegrationDirection[keyof typeof IntegrationDirection];

export const IntegrationStatus = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  RETRYING: 'retrying',
} as const;
export type IntegrationStatus = typeof IntegrationStatus[keyof typeof IntegrationStatus];

export const OutboxStatus = {
  PENDING: 'pending',
  PUBLISHED: 'published',
  FAILED: 'failed',
} as const;
export type OutboxStatus = typeof OutboxStatus[keyof typeof OutboxStatus];

// ── 14. Misc reference ────────────────────────────────────────
export const CustomerType = {
  INDIVIDUAL: 'individual',
  BUSINESS: 'business',
} as const;
export type CustomerType = typeof CustomerType[keyof typeof CustomerType];

export const Lang = {
  ENGLISH: 'English',
  HINDI: 'Hindi',
  MARATHI: 'Marathi',
  TAMIL: 'Tamil',
  TELUGU: 'Telugu',
  KANNADA: 'Kannada',
  GUJARATI: 'Gujarati',
  BENGALI: 'Bengali',
} as const;
export type Lang = typeof Lang[keyof typeof Lang];

export const EventCode = {
  LEAD_CREATED: 'LEAD_CREATED',
  LEAD_ASSIGNED: 'LEAD_ASSIGNED',
  HOT_LEAD: 'HOT_LEAD',
  FIRST_CONTACT_DUE: 'FIRST_CONTACT_DUE',
  FIRST_CONTACT_BREACH: 'FIRST_CONTACT_BREACH',
  DOC_REQUEST: 'DOC_REQUEST',
  DOC_UPLOADED: 'DOC_UPLOADED',
  DOC_MISMATCH: 'DOC_MISMATCH',
  CONSENT_PENDING: 'CONSENT_PENDING',
  CONSENT_WITHDRAWN: 'CONSENT_WITHDRAWN',
  KYC_EXCEPTION: 'KYC_EXCEPTION',
  ELIGIBILITY_RECEIVED: 'ELIGIBILITY_RECEIVED',
  HANDOFF_READY: 'HANDOFF_READY',
  HANDOFF_FAILED: 'HANDOFF_FAILED',
  LEAD_HANDED_OFF: 'LEAD_HANDED_OFF',
  LEAD_STAGE_CHANGED: 'LEAD_STAGE_CHANGED',
  GRIEVANCE_CREATED: 'GRIEVANCE_CREATED',
  DATA_RIGHT_REQUEST: 'DATA_RIGHT_REQUEST',
  EXPORT_COMPLETED: 'EXPORT_COMPLETED',
  CONFIG_CHANGED: 'CONFIG_CHANGED',
  DUPLICATE_FLAGGED: 'DUPLICATE_FLAGGED',
  TASK_OVERDUE: 'TASK_OVERDUE',
} as const;
export type EventCode = typeof EventCode[keyof typeof EventCode];

// ── 15. Scoring (FR-011) ─────────────────────────────────────
export { ScoreReasonCode } from './score-reason-code.enum';
export type { ScoreReasonCode as ScoreReasonCodeType } from './score-reason-code.enum';

// ── 16. Hot-lead rules (FR-031) ──────────────────────────────
export { HotReasonCode } from './score-reason-code.enum';
export type { HotReasonCode as HotReasonCodeType } from './score-reason-code.enum';

export const AuditAction = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  LOGIN_FAILED: 'login_failed',
  MFA_FAILED: 'mfa_failed',
  LEAD_CREATE: 'lead_create',
  LEAD_UPDATE: 'lead_update',
  LEAD_MERGE: 'lead_merge',
  LEAD_OVERRIDE: 'lead_override',
  ATTRIBUTION_CHANGE: 'attribution_change',
  CONSENT_GRANT: 'consent_grant',
  CONSENT_WITHDRAW: 'consent_withdraw',
  CONSENT_EXPIRE: 'consent_expire',
  DOC_UPLOAD: 'doc_upload',
  DOC_VIEW: 'doc_view',
  DOC_DOWNLOAD: 'doc_download',
  DOC_VERIFY: 'doc_verify',
  DOC_WAIVE: 'doc_waive',
  DOC_DELETE: 'doc_delete',
  KYC_REQUEST: 'kyc_request',
  KYC_RESPONSE: 'kyc_response',
  KYC_EXCEPTION: 'kyc_exception',
  STAGE_TRANSITION: 'stage_transition',
  REJECTION: 'rejection',
  REOPEN: 'reopen',
  NURTURE: 'nurture',
  ALLOCATE: 'allocate',
  REASSIGN: 'reassign',
  LINK_CREATE: 'link_create',
  LINK_OPEN: 'link_open',
  LINK_REVOKE: 'link_revoke',
  COMM_SEND: 'comm_send',
  ELIGIBILITY_REQUEST: 'eligibility_request',
  HANDOFF_ATTEMPT: 'handoff_attempt',
  HANDOFF_SUCCESS: 'handoff_success',
  HANDOFF_FAILURE: 'handoff_failure',
  EXPORT_GENERATE: 'export_generate',
  EXPORT_DOWNLOAD: 'export_download',
  CONFIG_CHANGE: 'config_change',
  USER_CHANGE: 'user_change',
  ROLE_CHANGE: 'role_change',
  BREAK_GLASS_ACCESS: 'break_glass_access',
  ABAC_DENY: 'abac_deny',
  VIEW_SENSITIVE: 'view_sensitive',
} as const;
export type AuditAction = typeof AuditAction[keyof typeof AuditAction];
