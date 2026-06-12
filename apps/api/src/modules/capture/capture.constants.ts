import { ConsentPurpose, LeadStage } from '@lms/shared';

/**
 * Reserved system actor seeded by schema.sql §bootstrap ("Reserved system actor
 * (used as created_by/updated_by/actor for system-originated rows). Not a
 * login."). Public/QR submissions and system jobs write rows as this actor.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

/** Single-org MVP default (schema.sql `org_id` DEFAULT; outbox uses the same). */
export const ORG_ID_DEFAULT = '00000000-0000-0000-0000-000000000001';

/** ABAC resource type for the capture endpoints (auth-matrix `resources`). */
export const LEADS_RESOURCE_TYPE = 'leads';

/** Redis idempotency scopes (FR-010 LLD §Data Operations step A/G). */
export const IDEMPOTENCY_SCOPE_CREATE_LEAD = 'create_lead';
export const IDEMPOTENCY_SCOPE_IMPORT_LEADS = 'import_leads';
/** 24 h TTL for cached idempotent responses (LLD step G). */
export const IDEMPOTENCY_TTL_SECONDS = 86_400;

/**
 * Purposes whose latest state must all be `granted` for the derived
 * `leads.consent_status` to be `captured`. Canonical default per the FR-110 LLD
 * (§Consent status derivation — "configurable but default to" this set); FR-010
 * applies the same algorithm at intake so the two derivations never diverge.
 */
export const REQUIRED_CONSENT_PURPOSES: readonly ConsentPurpose[] = [
  ConsentPurpose.LEAD_CONTACT,
  ConsentPurpose.PRODUCT_ELIGIBILITY,
  ConsentPurpose.KYC,
  ConsentPurpose.DOCUMENT_PROCESSING,
  ConsentPurpose.LOS_HANDOFF,
];

/**
 * Stages with no active LMS ownership (state-machines.md §Lead: `handed_off` is
 * terminal in LMS; `rejected` is terminal unless reopened). Bulk reassignment on
 * user deactivation skips these (mirrors FR-130's TERMINAL_LEAD_STAGES).
 */
export const TERMINAL_LEAD_STAGES: readonly LeadStage[] = [
  LeadStage.HANDED_OFF,
  LeadStage.REJECTED,
];

/** Hard cap per `LeadService.bulkReassign` call (shared-utilities.md: LIMIT-bounded ≤100). */
export const BULK_REASSIGN_MAX_IDS = 100;

/** Largest sequence representable in the `LD-{YYYY}-{seq6}` lead-code format. */
export const LEAD_CODE_MAX_SEQ = 999_999;

/** GCS-style object prefix for bulk-import artifacts. */
export const IMPORT_FILE_PREFIX = 'imports';
