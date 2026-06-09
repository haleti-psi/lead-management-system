-- Flyway / Cloud SQL migration
-- V1__initial_schema.sql
-- Created: 2026-06-08
-- Generated from docs/brd.md (BRD v5.2). Identical DDL to ../schema.sql.

-- =============================================================
-- Lead Management System for NBFCs (India) â€” PostgreSQL Schema
-- Generated from: docs/brd.md (BRD v5.1, Gate A PASS) â€” Â§5 Holistic Data Model
-- Target: PostgreSQL 15+ / Google Cloud SQL
-- Generated: 2026-06-08
-- Auth model: application-level RBAC/ABAC (NestJS EntitlementService, Â§4.7) â€” NOT Postgres RLS.
-- Conventions (Â§5.1): every business table has org_id, created_at, updated_at, created_by, updated_by;
--   mutable lead/config rows carry version (optimistic lock). All enums come from Â§5.5.
-- =============================================================

-- â”€â”€ 0. Extensions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- fuzzy name match for duplicate detection (FR-020)
CREATE EXTENSION IF NOT EXISTS "btree_gin";   -- composite/JSONB GIN indexes

-- â”€â”€ 1. Custom Types / Enumerations (Â§5.5 catalog) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Identity & access
CREATE TYPE role_code            AS ENUM ('RM','BM','SM','HEAD','KYC','DPO','PARTNER','ADMIN','CUSTOMER');
CREATE TYPE data_scope           AS ENUM ('O','T','B','R','A','P','C','M','X');
CREATE TYPE capability           AS ENUM ('create_lead','view_lead','edit_lead','upload_doc','verify_doc','kyc_signoff','move_stage','hand_off','allocate','bulk_action','customer_comm','reports','export','consent_ledger','audit_trail','user_mgmt','configuration','break_glass');
CREATE TYPE user_status          AS ENUM ('active','inactive','locked');
CREATE TYPE grant_status         AS ENUM ('active','expired','revoked');

-- Lead lifecycle & capture
CREATE TYPE lead_stage           AS ENUM ('captured','consent_pending','assigned','first_contact_pending','contacted','qualified','documents_pending','kyc_in_progress','eligibility_requested','ready_for_handoff','handed_off','rejected','dormant');
CREATE TYPE priority             AS ENUM ('low','normal','high');
CREATE TYPE creation_channel     AS ENUM ('manual','bulk','api','qr','partner','website','telecalling','missed_call');
CREATE TYPE consent_status       AS ENUM ('pending','partial','captured','withdrawn');
CREATE TYPE kyc_status           AS ENUM ('not_started','in_progress','verified','exception','waived');
CREATE TYPE dup_status           AS ENUM ('none','flagged','linked','merged');

-- Identity resolution
CREATE TYPE match_confidence     AS ENUM ('strong','medium','weak');
CREATE TYPE dup_action           AS ENUM ('blocked','warned','queued','linked','merged','overridden');
CREATE TYPE dup_record_status    AS ENUM ('open','resolved');

-- Product / config
CREATE TYPE product_code         AS ENUM ('CV','CAR','TRACTOR','CE','TW','SBL','HRM');   -- Â§5.5 "product"
CREATE TYPE pan_timing           AS ENUM ('at_capture','before_kyc','before_handoff');
CREATE TYPE config_status        AS ENUM ('draft','active','retired');
CREATE TYPE validation_status    AS ENUM ('incomplete','valid','invalid');
CREATE TYPE config_change_status AS ENUM ('pending','approved','rejected','active','rolled_back');

-- Allocation
CREATE TYPE allocation_method    AS ENUM ('round_robin','capacity','specialist','branch','partner','escalation');

-- Partner / source
CREATE TYPE partner_type         AS ENUM ('DSA','Dealer','Connector','OEM','Aggregator','Referral');
CREATE TYPE partner_status       AS ENUM ('active','suspended','expired');
CREATE TYPE risk_band            AS ENUM ('low','medium','high');
CREATE TYPE lead_source          AS ENUM ('DSA','Dealer','Branch','Website','Referral','Telecalling','Field');  -- Â§5.5 "source"
CREATE TYPE attribution_status   AS ENUM ('original','reassigned','merged_into');

-- Customer self-service
CREATE TYPE link_status          AS ENUM ('active','expired','revoked','used');

-- Documents & KYC
CREATE TYPE doc_type             AS ENUM ('id','pan','address','income','bank','quotation','rc','permit','insurance','land_record','property','valuation','title','work_order','gst','itr','photo','other');
CREATE TYPE applicant_scope      AS ENUM ('applicant','co_applicant','guarantor','business');
CREATE TYPE doc_status           AS ENUM ('not_required','pending','uploaded','under_review','verified','mismatch','waived','expired');
CREATE TYPE upload_channel       AS ENUM ('rm','customer_link','partner','digilocker');
CREATE TYPE scan_status          AS ENUM ('pending','clean','infected');
CREATE TYPE kyc_type             AS ENUM ('pan','ckyc','digilocker','aadhaar_otp','vcip','manual');
CREATE TYPE kyc_check_status     AS ENUM ('initiated','success','failed','exception','waived');
CREATE TYPE kyc_exception        AS ENUM ('pan_mismatch','name_mismatch','expired','unreadable','address_mismatch','ckyc_unavailable','duplicate_ckyc','vcip_failed','provider_down');

-- Tasks & communication
CREATE TYPE task_type            AS ENUM ('call','visit','doc_request','kyc_appt','dealer_followup','callback','approval','handoff_retry','nurture');
CREATE TYPE task_status          AS ENUM ('open','in_progress','done','overdue','cancelled');
CREATE TYPE disposition          AS ENUM ('connected','no_answer','wrong_number','not_interested','visited','rescheduled','callback_requested','docs_promised');
CREATE TYPE comm_channel         AS ENUM ('in_app','email','sms','whatsapp');   -- Â§5.5 "channel"
CREATE TYPE comm_category        AS ENUM ('transactional','marketing');
CREATE TYPE delivery_status      AS ENUM ('queued','sent','delivered','failed');
CREATE TYPE subject_type         AS ENUM ('user','customer');

-- Consent, privacy, grievance
CREATE TYPE consent_purpose      AS ENUM ('lead_contact','product_eligibility','kyc','document_processing','los_handoff','communication','partner_sharing','aa_bank_data','gst_business_data','marketing','grievance');
CREATE TYPE consent_state        AS ENUM ('granted','denied','withdrawn','expired','superseded');
CREATE TYPE consent_actor        AS ENUM ('customer','rm','partner','system');
CREATE TYPE data_category        AS ENUM ('identity','contact','financial','kyc_doc','asset','consent','behavioural');
CREATE TYPE data_classification  AS ENUM ('public','internal','confidential','pii','sensitive','restricted');
CREATE TYPE share_status         AS ENUM ('shared','failed');
CREATE TYPE grievance_source     AS ENUM ('customer_link','rm','branch','call_centre','partner','admin');
CREATE TYPE grievance_category   AS ENUM ('service_delay','mis_selling','data_privacy','document_issue','staff_conduct','other');
CREATE TYPE grievance_status     AS ENUM ('open','in_progress','escalated','resolved','closed');
CREATE TYPE rights_type          AS ENUM ('access','correction','update','erasure','withdrawal','grievance');
CREATE TYPE rights_status        AS ENUM ('open','in_review','fulfilled','rejected_retained');
CREATE TYPE dla_type             AS ENUM ('dla','lsp','partner');
CREATE TYPE lead_outcome         AS ENUM ('rejected','handed_off','dormant','any');
CREATE TYPE retention_action     AS ENUM ('purge','anonymise');

-- LOS integration
CREATE TYPE eligibility_status   AS ENUM ('pending','received','failed');
CREATE TYPE mirror_source        AS ENUM ('webhook','poll');

-- Reporting / governance / jobs
CREATE TYPE masking_level        AS ENUM ('full','partial','unmasked');
CREATE TYPE job_status           AS ENUM ('queued','running','completed','failed','awaiting_approval');
CREATE TYPE rejection_primary    AS ENUM ('no_response','not_interested','duplicate','product_unsuitable','low_income','out_of_area','document_incomplete','kyc_mismatch','asset_unacceptable','partner_withdrawal','consent_withdrawn','other');
CREATE TYPE sla_target           AS ENUM ('first_contact','document','kyc_exception','grievance','handoff_retry');

-- Integration & events
CREATE TYPE integration_kind     AS ENUM ('los_eligibility','los_handoff','los_status','pan','ckyc','digilocker','aadhaar','vcip','comm','cti','aa','gst','asset','bureau_via_los','campaign');  -- Â§5.5 "integration"
CREATE TYPE integration_direction AS ENUM ('outbound','inbound');   -- Â§5.5 "direction"
CREATE TYPE integration_status   AS ENUM ('pending','success','failed','retrying');
CREATE TYPE outbox_status        AS ENUM ('pending','published','failed');

-- Misc reference
CREATE TYPE customer_type        AS ENUM ('individual','business');
CREATE TYPE lang                 AS ENUM ('English','Hindi','Marathi','Tamil','Telugu','Kannada','Gujarati','Bengali');  -- Â§5.5 "language"
CREATE TYPE event_code           AS ENUM ('LEAD_CREATED','LEAD_ASSIGNED','HOT_LEAD','FIRST_CONTACT_DUE','FIRST_CONTACT_BREACH','DOC_REQUEST','DOC_UPLOADED','DOC_MISMATCH','CONSENT_PENDING','CONSENT_WITHDRAWN','KYC_EXCEPTION','ELIGIBILITY_RECEIVED','HANDOFF_READY','HANDOFF_FAILED','LEAD_HANDED_OFF','LEAD_STAGE_CHANGED','GRIEVANCE_CREATED','DATA_RIGHT_REQUEST','EXPORT_COMPLETED','CONFIG_CHANGED');
CREATE TYPE audit_action         AS ENUM ('login','logout','login_failed','mfa_failed','lead_create','lead_update','lead_merge','lead_override','attribution_change','consent_grant','consent_withdraw','consent_expire','doc_upload','doc_view','doc_download','doc_verify','doc_waive','doc_delete','kyc_request','kyc_response','kyc_exception','stage_transition','rejection','reopen','nurture','allocate','reassign','link_create','link_open','link_revoke','comm_send','eligibility_request','handoff_attempt','handoff_success','handoff_failure','export_generate','export_download','config_change','user_change','role_change','break_glass_access');

-- â”€â”€ 2. Shared trigger function â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Reserved identifiers used by seed data and the application:
--   System actor user_id : 00000000-0000-0000-0000-000000000000
--   Default org_id       : 00000000-0000-0000-0000-000000000001

-- â”€â”€ 3. Tables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Convention: org_id and audit-column (created_by/updated_by) FKs are inline (auto-named) to keep a
-- 45-table schema readable; primary business-relationship FKs are explicitly named fk_<table>_<column>.
-- Audit FKs are DEFERRABLE INITIALLY DEFERRED to permit the BRD's atomic multi-entity writes and seed bootstrap.

-- 3.0 orgs â€” single-tenant seam (Â§4.3 reserved org_id). Infra table; not a BRD entity.
CREATE TABLE orgs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(40) NOT NULL UNIQUE,
  name        VARCHAR(120) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3.1 regions (M1) â€” source_fr: FR-130/131
CREATE TABLE regions (
  region_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  code        VARCHAR(20) NOT NULL,
  name        VARCHAR(80) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL,
  updated_by  UUID NOT NULL,
  CONSTRAINT uq_regions_code UNIQUE (org_id, code)
);

-- 3.2 roles (M1) â€” source_fr: FR-130
CREATE TABLE roles (
  role_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  code          role_code NOT NULL,
  name          VARCHAR(80) NOT NULL,
  default_scope data_scope NOT NULL,
  is_external   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL,
  updated_by    UUID NOT NULL,
  CONSTRAINT uq_roles_code UNIQUE (org_id, code)
);

-- 3.3 branches (M1) â€” source_fr: FR-130/131
CREATE TABLE branches (
  branch_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  code        VARCHAR(20) NOT NULL,
  name        VARCHAR(120) NOT NULL,
  region_id   UUID NOT NULL,
  pin_codes   JSONB,
  address     VARCHAR(255),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL,
  updated_by  UUID NOT NULL,
  CONSTRAINT uq_branches_code UNIQUE (org_id, code),
  CONSTRAINT fk_branches_region_id FOREIGN KEY (region_id) REFERENCES regions(region_id) ON DELETE RESTRICT
);

-- 3.4 users (M1) â€” source_fr: FR-001/002/003/130
CREATE TABLE users (
  user_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  username             VARCHAR(150) NOT NULL,
  email                VARCHAR(255) NOT NULL,
  full_name            VARCHAR(150) NOT NULL,
  mobile               VARCHAR(10),
  password_hash        VARCHAR(255),
  role_id              UUID NOT NULL,
  branch_id            UUID,
  team_id              UUID,
  region_id            UUID,
  partner_id           UUID,
  product_skills       JSONB,
  mfa_enabled          BOOLEAN NOT NULL DEFAULT false,
  status               user_status NOT NULL DEFAULT 'active',
  reporting_manager_id UUID,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by           UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_users_username UNIQUE (org_id, username),
  CONSTRAINT uq_users_email UNIQUE (org_id, email),
  CONSTRAINT ck_users_mobile CHECK (mobile IS NULL OR mobile ~ '^[6-9][0-9]{9}$'),
  CONSTRAINT fk_users_role_id FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE RESTRICT,
  CONSTRAINT fk_users_branch_id FOREIGN KEY (branch_id) REFERENCES branches(branch_id) ON DELETE SET NULL,
  CONSTRAINT fk_users_region_id FOREIGN KEY (region_id) REFERENCES regions(region_id) ON DELETE SET NULL,
  CONSTRAINT fk_users_reporting_manager_id FOREIGN KEY (reporting_manager_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Audit FKs for tables created before users()
ALTER TABLE regions  ADD CONSTRAINT fk_regions_created_by  FOREIGN KEY (created_by) REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
                     ADD CONSTRAINT fk_regions_updated_by  FOREIGN KEY (updated_by) REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE roles    ADD CONSTRAINT fk_roles_created_by    FOREIGN KEY (created_by) REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
                     ADD CONSTRAINT fk_roles_updated_by    FOREIGN KEY (updated_by) REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE branches ADD CONSTRAINT fk_branches_created_by FOREIGN KEY (created_by) REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
                     ADD CONSTRAINT fk_branches_updated_by FOREIGN KEY (updated_by) REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED;

-- 3.5 role_permissions (M1) â€” source_fr: FR-002/130
CREATE TABLE role_permissions (
  role_permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  role_id     UUID NOT NULL,
  capability  capability NOT NULL,
  max_scope   data_scope NOT NULL,
  conditions  JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by  UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_role_permissions UNIQUE (role_id, capability),
  CONSTRAINT fk_role_permissions_role_id FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE
);

-- 3.6 teams (M1) â€” source_fr: FR-130
CREATE TABLE teams (
  team_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  name        VARCHAR(120) NOT NULL,
  branch_id   UUID NOT NULL,
  manager_id  UUID,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by  UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_teams_branch_id FOREIGN KEY (branch_id) REFERENCES branches(branch_id) ON DELETE RESTRICT,
  CONSTRAINT fk_teams_manager_id FOREIGN KEY (manager_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Resolve users -> teams cycle
ALTER TABLE users ADD CONSTRAINT fk_users_team_id FOREIGN KEY (team_id) REFERENCES teams(team_id) ON DELETE SET NULL;

-- 3.7 partners (M10) â€” source_fr: FR-090/091/092
CREATE TABLE partners (
  partner_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  partner_code   VARCHAR(20) NOT NULL,
  type           partner_type NOT NULL,
  legal_name     VARCHAR(150) NOT NULL,
  branch_id      UUID,
  products       JSONB,
  contact_person VARCHAR(150),
  contact_mobile VARCHAR(10),
  status         partner_status NOT NULL DEFAULT 'active',
  agreement_ref  VARCHAR(80),
  commission_flag BOOLEAN NOT NULL DEFAULT false,
  mapped_rm_id   UUID,
  risk_category  risk_band,
  quality_score  INTEGER,
  valid_until    DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by     UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_partners_code UNIQUE (org_id, partner_code),
  CONSTRAINT ck_partners_quality CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 100),
  CONSTRAINT fk_partners_branch_id FOREIGN KEY (branch_id) REFERENCES branches(branch_id) ON DELETE SET NULL,
  CONSTRAINT fk_partners_mapped_rm_id FOREIGN KEY (mapped_rm_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Resolve users -> partners cycle (PARTNER users)
ALTER TABLE users ADD CONSTRAINT fk_users_partner_id FOREIGN KEY (partner_id) REFERENCES partners(partner_id) ON DELETE SET NULL;

-- 3.8 break_glass_grants (M1) â€” source_fr: FR-003
CREATE TABLE break_glass_grants (
  grant_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  grantee_id  UUID NOT NULL,
  approver_id UUID NOT NULL,
  scope_type  VARCHAR(20) NOT NULL,
  scope_ref   UUID,
  reason      VARCHAR(500) NOT NULL,
  status      grant_status NOT NULL DEFAULT 'active',
  valid_from  TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by  UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT ck_break_glass_window CHECK (valid_until > valid_from),
  CONSTRAINT ck_break_glass_four_eyes CHECK (approver_id <> grantee_id),
  CONSTRAINT fk_bgg_grantee_id FOREIGN KEY (grantee_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_bgg_approver_id FOREIGN KEY (approver_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_bgg_scope_type CHECK (scope_type IN ('lead','branch','all'))
);

-- 3.9 customer_profiles (M2) â€” source_fr: FR-010/051/062/112
CREATE TABLE customer_profiles (
  customer_profile_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  primary_mobile       VARCHAR(10) NOT NULL,
  display_name         VARCHAR(150) NOT NULL,
  customer_type        customer_type NOT NULL,
  is_existing_customer BOOLEAN NOT NULL DEFAULT false,
  address              JSONB,
  preferred_language   lang,
  deleted_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by           UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_customer_profiles_mobile UNIQUE (org_id, primary_mobile),
  CONSTRAINT ck_customer_profiles_mobile CHECK (primary_mobile ~ '^[6-9][0-9]{9}$')
);

-- 3.10 lead_identities (M2) â€” source_fr: FR-010/020/071. PII; raw Aadhaar never stored (Â§5.6.9)
CREATE TABLE lead_identities (
  lead_identity_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  name               VARCHAR(150) NOT NULL,
  mobile             VARCHAR(10) NOT NULL,
  email              VARCHAR(255),
  pan_token          VARCHAR(64),
  pan_masked         VARCHAR(12),
  ckyc_id            VARCHAR(20),
  gstin              VARCHAR(15),
  dob                DATE,
  aadhaar_ref_token  VARCHAR(64),
  address            JSONB,
  preferred_language lang,
  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by         UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT ck_lead_identities_mobile CHECK (mobile ~ '^[6-9][0-9]{9}$'),
  CONSTRAINT ck_lead_identities_gstin CHECK (gstin IS NULL OR gstin ~ '^[0-9A-Z]{15}$')
);

-- 3.11 product_configs (M5) â€” source_fr: FR-040/041/132
CREATE TABLE product_configs (
  product_config_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  product_code       product_code NOT NULL,
  name               VARCHAR(120) NOT NULL,
  version            INTEGER NOT NULL,
  status             config_status NOT NULL DEFAULT 'draft',
  field_schema       JSONB NOT NULL,
  document_checklist JSONB NOT NULL,
  sla_config         JSONB,
  eligibility_mapping JSONB,
  pan_required_at    pan_timing NOT NULL DEFAULT 'before_kyc',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by         UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_product_configs_version UNIQUE (org_id, product_code, version)
);

-- 3.12 schemes (M5) â€” source_fr: FR-042/131
CREATE TABLE schemes (
  scheme_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  code            VARCHAR(40) NOT NULL,
  name            VARCHAR(120) NOT NULL,
  product_code    product_code,
  subvention_flag BOOLEAN NOT NULL DEFAULT false,
  valid_from      DATE NOT NULL,
  valid_to        DATE NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by      UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_schemes_code UNIQUE (org_id, code),
  CONSTRAINT ck_schemes_validity CHECK (valid_to >= valid_from)
);

-- 3.13 rejection_reasons (M14) â€” source_fr: FR-131
CREATE TABLE rejection_reasons (
  rejection_reason_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  primary_reason   rejection_primary NOT NULL,
  sub_reason       VARCHAR(80),
  requires_remarks BOOLEAN NOT NULL DEFAULT false,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by       UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED
);

-- 3.14 allocation_rules (M4) â€” source_fr: FR-030/131
CREATE TABLE allocation_rules (
  allocation_rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  name           VARCHAR(120) NOT NULL,
  priority_order INTEGER NOT NULL,
  method         allocation_method NOT NULL,
  criteria       JSONB NOT NULL,
  target         JSONB NOT NULL,
  capacity_limit INTEGER,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by     UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_allocation_rules_order UNIQUE (org_id, priority_order)
);

-- 3.15 sla_policies (M14) â€” source_fr: FR-104/131
CREATE TABLE sla_policies (
  sla_policy_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  name              VARCHAR(120) NOT NULL,
  applies_to        sla_target NOT NULL,
  condition         JSONB,
  threshold_minutes INTEGER NOT NULL,
  escalation_chain  JSONB NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by        UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT ck_sla_threshold CHECK (threshold_minutes > 0)
);

-- 3.15b business_calendars (M14) â€” source_fr: FR-104 (SLA/TAT business-time source); resolves ADR-6 / DATA_MODEL #10
CREATE TABLE business_calendars (
  business_calendar_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  code          VARCHAR(40) NOT NULL,
  name          VARCHAR(120) NOT NULL,
  timezone      VARCHAR(40) NOT NULL DEFAULT 'Asia/Kolkata',
  branch_id     UUID,
  region_id     UUID,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  working_hours JSONB NOT NULL,   -- per weekday: {"mon":{"start":"09:30","end":"18:30"},...,"sun":null}
  holidays      JSONB,            -- array of {"date":"2026-10-21","name":"Diwali"}
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by    UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_business_calendars_code UNIQUE (org_id, code),
  CONSTRAINT fk_business_calendars_branch_id FOREIGN KEY (branch_id) REFERENCES branches(branch_id) ON DELETE SET NULL,
  CONSTRAINT fk_business_calendars_region_id FOREIGN KEY (region_id) REFERENCES regions(region_id) ON DELETE SET NULL
);

-- 3.16 communication_templates (M11) â€” source_fr: FR-101/131
CREATE TABLE communication_templates (
  template_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  code         VARCHAR(60) NOT NULL,
  version      INTEGER NOT NULL,
  channel      comm_channel NOT NULL,
  language     lang NOT NULL,
  category     comm_category NOT NULL,
  product_code product_code,
  body         TEXT NOT NULL,
  status       config_status NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by   UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_comm_templates UNIQUE (org_id, code, channel, language, version)
);

-- 3.17 dla_registry (M12) â€” source_fr: FR-113
CREATE TABLE dla_registry (
  dla_registry_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  name              VARCHAR(150) NOT NULL,
  type              dla_type NOT NULL,
  owner             VARCHAR(120),
  url               VARCHAR(255),
  grievance_officer JSONB,
  enabled_products  JSONB,
  data_collected    JSONB,
  storage_location  VARCHAR(120),
  status            config_status NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by        UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED
);

-- 3.18 retention_policies (M12) â€” source_fr: FR-115/131
CREATE TABLE retention_policies (
  retention_policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  data_category data_category NOT NULL,
  lead_outcome  lead_outcome,
  retain_days   INTEGER NOT NULL,
  action        retention_action NOT NULL,
  legal_hold    BOOLEAN NOT NULL DEFAULT false,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by    UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT ck_retention_days CHECK (retain_days >= 0)
);

-- 3.19 webhook_subscriptions (M15) â€” source_fr: FR-140
CREATE TABLE webhook_subscriptions (
  webhook_subscription_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  event_code  event_code NOT NULL,
  target_url  VARCHAR(255) NOT NULL,
  secret_ref  VARCHAR(120) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  last_status delivery_status,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by  UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT ck_webhook_https CHECK (target_url LIKE 'https://%')
);

-- 3.20 source_attributions (M2) â€” source_fr: FR-010/021
CREATE TABLE source_attributions (
  source_attribution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  source             lead_source NOT NULL,
  sub_source         VARCHAR(80),
  partner_id         UUID,
  campaign_code      VARCHAR(40),
  utm                JSONB,
  creator_channel    creation_channel NOT NULL,
  attribution_status attribution_status NOT NULL DEFAULT 'original',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by         UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_source_attr_partner_id FOREIGN KEY (partner_id) REFERENCES partners(partner_id) ON DELETE RESTRICT,
  CONSTRAINT ck_source_attr_partner CHECK (source NOT IN ('DSA','Dealer') OR partner_id IS NOT NULL)
);

-- 3.21 leads (M2) â€” central entity â€” source_fr: FR-010..082 (see Â§5.4)
-- Design note: product_code (denormalized enum, fast filter/report) + product_config_id (FK to pinned
-- version row) resolve the BRD product_id/product_config_version ambiguity flagged by the council.
CREATE TABLE leads (
  lead_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  lead_code                VARCHAR(20) NOT NULL,
  stage                    lead_stage NOT NULL DEFAULT 'captured',
  product_code             product_code NOT NULL,
  product_config_id        UUID NOT NULL,
  branch_id                UUID,
  pin_code                 VARCHAR(6),
  owner_id                 UUID,
  team_id                  UUID,
  source_attribution_id    UUID NOT NULL,
  customer_profile_id      UUID,
  lead_identity_id         UUID NOT NULL,
  priority                 priority NOT NULL DEFAULT 'normal',
  is_hot                   BOOLEAN NOT NULL DEFAULT false,
  score                    INTEGER,
  score_reasons            JSONB,
  requested_amount         NUMERIC(15,2),
  channel_created_by       creation_channel NOT NULL,
  consent_status           consent_status NOT NULL DEFAULT 'pending',
  kyc_status               kyc_status NOT NULL DEFAULT 'not_started',
  duplicate_status         dup_status NOT NULL DEFAULT 'none',
  master_lead_id           UUID,
  sla_first_contact_due_at TIMESTAMPTZ,
  rejection_reason_id      UUID,
  reopened_count           INTEGER NOT NULL DEFAULT 0,
  nurture_next_at          TIMESTAMPTZ,
  los_application_id        VARCHAR(64),
  import_job_id            UUID,
  version                  INTEGER NOT NULL DEFAULT 1,
  deleted_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by               UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_leads_code UNIQUE (org_id, lead_code),
  CONSTRAINT ck_leads_score CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  CONSTRAINT ck_leads_requested_amount CHECK (requested_amount IS NULL OR requested_amount >= 0),
  CONSTRAINT ck_leads_pin CHECK (pin_code IS NULL OR pin_code ~ '^[0-9]{6}$'),
  CONSTRAINT fk_leads_product_config_id FOREIGN KEY (product_config_id) REFERENCES product_configs(product_config_id) ON DELETE RESTRICT,
  CONSTRAINT fk_leads_branch_id FOREIGN KEY (branch_id) REFERENCES branches(branch_id) ON DELETE SET NULL,
  CONSTRAINT fk_leads_owner_id FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_leads_team_id FOREIGN KEY (team_id) REFERENCES teams(team_id) ON DELETE SET NULL,
  CONSTRAINT fk_leads_source_attribution_id FOREIGN KEY (source_attribution_id) REFERENCES source_attributions(source_attribution_id) ON DELETE RESTRICT,
  CONSTRAINT fk_leads_customer_profile_id FOREIGN KEY (customer_profile_id) REFERENCES customer_profiles(customer_profile_id) ON DELETE SET NULL,
  CONSTRAINT fk_leads_lead_identity_id FOREIGN KEY (lead_identity_id) REFERENCES lead_identities(lead_identity_id) ON DELETE RESTRICT,
  CONSTRAINT fk_leads_master_lead_id FOREIGN KEY (master_lead_id) REFERENCES leads(lead_id) ON DELETE SET NULL,
  CONSTRAINT fk_leads_rejection_reason_id FOREIGN KEY (rejection_reason_id) REFERENCES rejection_reasons(rejection_reason_id) ON DELETE SET NULL
);

-- 3.22 integration_logs (M15) â€” source_fr: FR-140 (created before kyc_verifications which reference it)
CREATE TABLE integration_logs (
  integration_log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  integration     integration_kind NOT NULL,
  direction       integration_direction NOT NULL,
  lead_id         UUID,
  correlation_id  VARCHAR(120) NOT NULL,
  idempotency_key VARCHAR(120),
  request_ref     VARCHAR(255),
  status          integration_status NOT NULL DEFAULT 'pending',
  http_status     INTEGER,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  error_code      VARCHAR(60),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by      UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_integration_logs_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE SET NULL
);
-- Idempotency uniqueness (where a key is present) enforced via partial unique index in Â§4.

-- 3.23 lead_product_details (M5) â€” source_fr: FR-040/051/080
CREATE TABLE lead_product_details (
  lead_product_detail_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  lead_id           UUID NOT NULL,
  product_config_id UUID NOT NULL,
  attributes        JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_status validation_status NOT NULL DEFAULT 'incomplete',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by        UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_lead_product_details_lead UNIQUE (lead_id),
  CONSTRAINT fk_lpd_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE,
  CONSTRAINT fk_lpd_product_config_id FOREIGN KEY (product_config_id) REFERENCES product_configs(product_config_id) ON DELETE RESTRICT
);

-- 3.24 duplicate_matches (M3) â€” Lead<->Lead junction â€” source_fr: FR-020/021
CREATE TABLE duplicate_matches (
  duplicate_match_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  lead_id         UUID NOT NULL,
  matched_lead_id UUID NOT NULL,
  confidence      match_confidence NOT NULL,
  matched_on      JSONB NOT NULL,
  action          dup_action NOT NULL DEFAULT 'warned',
  action_by       UUID,
  action_reason   VARCHAR(500),
  status          dup_record_status NOT NULL DEFAULT 'open',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by      UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT ck_dup_distinct CHECK (lead_id <> matched_lead_id),
  CONSTRAINT uq_dup_pair UNIQUE (lead_id, matched_lead_id),
  CONSTRAINT fk_dup_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE,
  CONSTRAINT fk_dup_matched_lead_id FOREIGN KEY (matched_lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE,
  CONSTRAINT fk_dup_action_by FOREIGN KEY (action_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- 3.25 documents (M8) â€” source_fr: FR-070/060
CREATE TABLE documents (
  document_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  lead_id          UUID NOT NULL,
  doc_type         doc_type NOT NULL,
  applicant_scope  applicant_scope NOT NULL,
  status           doc_status NOT NULL DEFAULT 'pending',
  storage_ref      VARCHAR(255),
  file_type        VARCHAR(10),
  file_size_kb     INTEGER,
  version          INTEGER NOT NULL DEFAULT 1,
  uploaded_via     upload_channel,
  verified_by      UUID,
  waiver_reason    VARCHAR(500),
  classification   data_classification NOT NULL DEFAULT 'pii',
  virus_scan_status scan_status NOT NULL DEFAULT 'pending',
  expires_at       TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by       UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_documents_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE,
  CONSTRAINT fk_documents_verified_by FOREIGN KEY (verified_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- 3.26 customer_links (M7) â€” source_fr: FR-060/062
CREATE TABLE customer_links (
  customer_link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  lead_id         UUID NOT NULL,
  token_hash      VARCHAR(255) NOT NULL,
  purpose         JSONB NOT NULL,
  status          link_status NOT NULL DEFAULT 'active',
  otp_verified_at TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  opened_at       TIMESTAMPTZ,
  revoked_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by      UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_customer_links_token UNIQUE (token_hash),
  CONSTRAINT fk_customer_links_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE,
  CONSTRAINT fk_customer_links_revoked_by FOREIGN KEY (revoked_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- 3.27 kyc_verifications (M8) â€” source_fr: FR-071/072. masked_response only; no raw Aadhaar (Â§5.6.9)
CREATE TABLE kyc_verifications (
  kyc_verification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  lead_id             UUID NOT NULL,
  kyc_type            kyc_type NOT NULL,
  provider            VARCHAR(60),
  status              kyc_check_status NOT NULL DEFAULT 'initiated',
  reference           VARCHAR(120),
  masked_response     JSONB,
  exception_type      kyc_exception,
  exception_owner_id  UUID,
  exception_sla_due_at TIMESTAMPTZ,
  resolution_code     VARCHAR(40),
  integration_log_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by          UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_kyc_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE,
  CONSTRAINT fk_kyc_exception_owner_id FOREIGN KEY (exception_owner_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_kyc_integration_log_id FOREIGN KEY (integration_log_id) REFERENCES integration_logs(integration_log_id) ON DELETE SET NULL
);

-- 3.28 tasks (M11) â€” source_fr: FR-100/102
CREATE TABLE tasks (
  task_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  lead_id        UUID,
  type           task_type NOT NULL,
  owner_id       UUID NOT NULL,
  due_at         TIMESTAMPTZ NOT NULL,
  priority       priority NOT NULL DEFAULT 'normal',
  sla_policy_id  UUID,
  status         task_status NOT NULL DEFAULT 'open',
  disposition    disposition,
  result_note    VARCHAR(1000),
  geo            JSONB,
  next_action_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by     UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_tasks_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE,
  CONSTRAINT fk_tasks_owner_id FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_tasks_sla_policy_id FOREIGN KEY (sla_policy_id) REFERENCES sla_policies(sla_policy_id) ON DELETE SET NULL
);

-- 3.29 consent_records (M12) â€” APPEND-ONLY (Â§5.6.3) â€” source_fr: FR-110
CREATE TABLE consent_records (
  consent_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  lead_id              UUID NOT NULL,
  customer_profile_id  UUID,
  purpose              consent_purpose NOT NULL,
  data_category        data_category,
  state                consent_state NOT NULL,
  channel              creation_channel NOT NULL,
  language             lang,
  notice_version       VARCHAR(40) NOT NULL,
  consent_text_version VARCHAR(40) NOT NULL,
  actor                consent_actor NOT NULL,
  ip_device            JSONB,
  expires_at           TIMESTAMPTZ,
  superseded_by        UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_consent_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE RESTRICT,
  CONSTRAINT fk_consent_customer_profile_id FOREIGN KEY (customer_profile_id) REFERENCES customer_profiles(customer_profile_id) ON DELETE SET NULL,
  CONSTRAINT fk_consent_superseded_by FOREIGN KEY (superseded_by) REFERENCES consent_records(consent_id) ON DELETE SET NULL
);

-- 3.30 data_sharing_logs (M12) â€” source_fr: FR-080/081/111
CREATE TABLE data_sharing_logs (
  data_sharing_log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  lead_id       UUID NOT NULL,
  recipient     VARCHAR(120) NOT NULL,
  purpose       consent_purpose NOT NULL,
  data_category data_category NOT NULL,
  consent_id    UUID,
  status        share_status NOT NULL DEFAULT 'shared',
  shared_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by    UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_dsl_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE RESTRICT,  -- compliance evidence: preserve
  CONSTRAINT fk_dsl_consent_id FOREIGN KEY (consent_id) REFERENCES consent_records(consent_id) ON DELETE SET NULL
);

-- 3.31 communication_logs (M11) â€” source_fr: FR-101
CREATE TABLE communication_logs (
  communication_log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  lead_id        UUID,
  template_id    UUID,
  channel        comm_channel NOT NULL,
  recipient      VARCHAR(255) NOT NULL,
  consent_basis  consent_purpose,
  status         delivery_status NOT NULL DEFAULT 'queued',
  provider_ref   VARCHAR(120),
  failure_reason VARCHAR(255),
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by     UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_comm_logs_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE SET NULL,
  CONSTRAINT fk_comm_logs_template_id FOREIGN KEY (template_id) REFERENCES communication_templates(template_id) ON DELETE SET NULL
);

-- 3.32 notifications (M11) â€” source_fr: FR-053 + all dispatch
CREATE TABLE notifications (
  notification_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  recipient_user_id  UUID NOT NULL,
  event_code         event_code NOT NULL,
  lead_id            UUID,
  title              VARCHAR(150) NOT NULL,
  body               VARCHAR(500) NOT NULL,
  is_read            BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE
);

-- 3.33 notification_preferences (M11) â€” source_fr: FR-103. subject_ref is polymorphic (user|customer); no FK.
CREATE TABLE notification_preferences (
  notification_preference_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  subject_type subject_type NOT NULL,
  subject_ref  UUID NOT NULL,
  channel      comm_channel NOT NULL,
  purpose      consent_purpose NOT NULL,
  opted_in     BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by   UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_notif_pref UNIQUE (subject_type, subject_ref, channel, purpose)
);

-- 3.34 grievances (M12) â€” source_fr: FR-061/114
CREATE TABLE grievances (
  grievance_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  grievance_no      VARCHAR(20) NOT NULL,
  lead_id           UUID,
  source            grievance_source NOT NULL,
  category          grievance_category NOT NULL,
  description       VARCHAR(2000) NOT NULL,
  owner_id          UUID,
  sla_due_at        TIMESTAMPTZ,
  status            grievance_status NOT NULL DEFAULT 'open',
  response          VARCHAR(2000),
  closure_proof_ref VARCHAR(255),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by        UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_grievances_no UNIQUE (org_id, grievance_no),
  CONSTRAINT fk_grievances_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE SET NULL,
  CONSTRAINT fk_grievances_owner_id FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- 3.35 data_rights_requests (M12) â€” source_fr: FR-112
CREATE TABLE data_rights_requests (
  data_rights_request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  customer_profile_id UUID NOT NULL,
  lead_id             UUID,
  request_type        rights_type NOT NULL,
  status              rights_status NOT NULL DEFAULT 'open',
  owner_id            UUID,
  due_at              TIMESTAMPTZ,
  disposition         VARCHAR(500),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by          UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_drr_customer_profile_id FOREIGN KEY (customer_profile_id) REFERENCES customer_profiles(customer_profile_id) ON DELETE CASCADE,
  CONSTRAINT fk_drr_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE SET NULL,
  CONSTRAINT fk_drr_owner_id FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- 3.36 eligibility_snapshots (M9) â€” read-only LOS response â€” source_fr: FR-080
CREATE TABLE eligibility_snapshots (
  eligibility_snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  lead_id          UUID NOT NULL,
  request_ref      VARCHAR(120) NOT NULL,
  indicative_amount NUMERIC(15,2),
  tenure_months    INTEGER,
  rate_range       VARCHAR(40),
  conditions       JSONB,
  validity_until   TIMESTAMPTZ,
  status           eligibility_status NOT NULL DEFAULT 'pending',
  response_basis   VARCHAR(40),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by       UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_elig_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE
);

-- 3.37 los_application_mirrors (M9) â€” read-only LOS status â€” source_fr: FR-082
CREATE TABLE los_application_mirrors (
  los_mirror_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  lead_id            UUID NOT NULL,
  los_application_id VARCHAR(64) NOT NULL,
  status             VARCHAR(40) NOT NULL,
  status_date        TIMESTAMPTZ NOT NULL,
  correlation_id     VARCHAR(120),
  received_via       mirror_source NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by         UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_los_mirror_app UNIQUE (los_application_id),
  CONSTRAINT fk_los_mirror_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE
);

-- 3.38 saved_views (M6) â€” source_fr: FR-050
CREATE TABLE saved_views (
  saved_view_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  owner_id    UUID NOT NULL,
  name        VARCHAR(120) NOT NULL,
  filter_json JSONB NOT NULL,
  is_shared   BOOLEAN NOT NULL DEFAULT false,
  scope       data_scope NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by  UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_saved_views_owner_id FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 3.39 stage_history (M2) â€” APPEND-ONLY reporting read-model â€” source_fr: FR-052 + Â§10.3
CREATE TABLE stage_history (
  stage_history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  lead_id     UUID NOT NULL,
  from_stage  lead_stage,
  to_stage    lead_stage NOT NULL,
  actor_id    UUID NOT NULL,
  reason      VARCHAR(500),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_stage_history_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE,
  CONSTRAINT fk_stage_history_actor_id FOREIGN KEY (actor_id) REFERENCES users(user_id) ON DELETE RESTRICT
);

-- 3.40 notes (M6) â€” source_fr: FR-051
CREATE TABLE notes (
  note_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  lead_id     UUID NOT NULL,
  author_id   UUID NOT NULL,
  body        VARCHAR(2000) NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by  UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_notes_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE,
  CONSTRAINT fk_notes_author_id FOREIGN KEY (author_id) REFERENCES users(user_id) ON DELETE RESTRICT
);

-- 3.41 import_jobs (M2) â€” source_fr: FR-010
CREATE TABLE import_jobs (
  import_job_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  file_ref       VARCHAR(255) NOT NULL,
  status         job_status NOT NULL DEFAULT 'queued',
  total_rows     INTEGER,
  success_rows   INTEGER,
  failed_rows    INTEGER,
  error_file_ref VARCHAR(255),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by     UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED
);

-- Realize ImportJob 1->* Lead (bulk-created) relationship (Â§5.3); data-model addition (see DATA_MODEL.md #13)
ALTER TABLE leads ADD CONSTRAINT fk_leads_import_job_id FOREIGN KEY (import_job_id) REFERENCES import_jobs(import_job_id) ON DELETE SET NULL;

-- 3.42 export_jobs (M13) â€” source_fr: FR-122
CREATE TABLE export_jobs (
  export_job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  requested_by  UUID NOT NULL,
  report_code   VARCHAR(60) NOT NULL,
  filters       JSONB NOT NULL,
  scope         data_scope NOT NULL,
  masking_level masking_level NOT NULL,
  row_count     INTEGER,
  status        job_status NOT NULL DEFAULT 'queued',
  approver_id   UUID,
  artefact_ref  VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by    UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_export_jobs_requested_by FOREIGN KEY (requested_by) REFERENCES users(user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_export_jobs_approver_id FOREIGN KEY (approver_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- 3.43 configuration_versions (M14) â€” source_fr: FR-132. config_ref is polymorphic (any config row); no FK.
CREATE TABLE configuration_versions (
  configuration_version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  config_type   VARCHAR(40) NOT NULL,
  config_ref    UUID,
  version       INTEGER NOT NULL,
  maker_id      UUID NOT NULL,
  checker_id    UUID,
  status        config_change_status NOT NULL DEFAULT 'pending',
  effective_at  TIMESTAMPTZ,
  rollback_ref  UUID,
  diff          JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  updated_by    UUID NOT NULL REFERENCES users(user_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT ck_config_maker_checker CHECK (checker_id IS NULL OR checker_id <> maker_id),
  CONSTRAINT fk_config_maker_id FOREIGN KEY (maker_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_config_checker_id FOREIGN KEY (checker_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_config_rollback_ref FOREIGN KEY (rollback_ref) REFERENCES configuration_versions(configuration_version_id) ON DELETE SET NULL
);

-- 3.44 audit_logs (M13) â€” source_fr: FR-123 (+ all FRs append audit events) â€” APPEND-ONLY, hash-chained (Â§5.2.35). entity_id is polymorphic; no FK.
CREATE TABLE audit_logs (
  audit_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  actor_id        UUID NOT NULL,
  action          audit_action NOT NULL,
  entity_type     VARCHAR(50) NOT NULL,
  entity_id       UUID,
  lead_id         UUID,
  before_hash     VARCHAR(64),
  after_hash      VARCHAR(64),
  prev_audit_hash VARCHAR(64),
  detail          JSONB,
  ip_device       JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_audit_actor_id FOREIGN KEY (actor_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_audit_lead_id FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE SET NULL
);

-- 3.45 event_outbox (M15) â€” source_fr: FR-141 (+ all state-changing FRs emit events) â€” transactional outbox (Â§5.6.4). aggregate_id polymorphic; no FK.
CREATE TABLE event_outbox (
  event_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  event_code     event_code NOT NULL,
  aggregate_type VARCHAR(40) NOT NULL,
  aggregate_id   UUID NOT NULL,
  payload        JSONB NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  status         outbox_status NOT NULL DEFAULT 'pending',
  published_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- â”€â”€ 4. Indexes (Â§5 index notes + FK/query/partial/GIN) â”€â”€â”€â”€â”€â”€â”€â”€
-- Identity & access
CREATE INDEX ix_users_scope            ON users (role_id, branch_id, team_id);
CREATE INDEX ix_users_partner          ON users (partner_id);
CREATE INDEX ix_users_team             ON users (team_id);
CREATE INDEX ix_branches_pin_codes     ON branches USING GIN (pin_codes);
CREATE INDEX ix_teams_branch           ON teams (branch_id);
CREATE INDEX ix_teams_manager          ON teams (manager_id);
CREATE INDEX ix_role_perm_role         ON role_permissions (role_id);
CREATE INDEX ix_bgg_active             ON break_glass_grants (grantee_id, status, valid_until);

-- Capture / identity / attribution
CREATE INDEX ix_lead_identities_mobile ON lead_identities (mobile);
CREATE INDEX ix_lead_identities_pan    ON lead_identities (pan_token);
CREATE INDEX ix_lead_identities_ckyc   ON lead_identities (ckyc_id);
CREATE INDEX ix_lead_identities_gstin  ON lead_identities (gstin);
CREATE INDEX ix_lead_identities_name_trgm ON lead_identities USING GIN (name gin_trgm_ops);  -- fuzzy match FR-020
CREATE INDEX ix_source_attr_src        ON source_attributions (source, partner_id);
CREATE INDEX ix_source_attr_campaign   ON source_attributions (campaign_code);
CREATE INDEX ix_partners_type_status   ON partners (type, status);

-- Leads (central)
CREATE INDEX ix_leads_stage_branch     ON leads (stage, branch_id);
CREATE INDEX ix_leads_owner_stage      ON leads (owner_id, stage);
CREATE INDEX ix_leads_product_stage    ON leads (product_code, stage);
CREATE INDEX ix_leads_source_attr      ON leads (source_attribution_id);
CREATE INDEX ix_leads_master           ON leads (master_lead_id);
CREATE INDEX ix_leads_sla_first        ON leads (sla_first_contact_due_at);
CREATE INDEX ix_leads_identity         ON leads (lead_identity_id);
CREATE INDEX ix_leads_customer         ON leads (customer_profile_id);
CREATE INDEX ix_leads_team             ON leads (team_id);
CREATE INDEX ix_leads_product_config   ON leads (product_config_id);
CREATE INDEX ix_leads_score_reasons    ON leads USING GIN (score_reasons);
CREATE INDEX ix_leads_active           ON leads (stage) WHERE deleted_at IS NULL;

-- Product / config
CREATE INDEX ix_product_configs_status ON product_configs (product_code, status);
CREATE INDEX ix_allocation_rules_order ON allocation_rules (is_active, priority_order);
CREATE INDEX ix_sla_policies_target    ON sla_policies (applies_to);
CREATE UNIQUE INDEX uq_business_calendars_default ON business_calendars (org_id) WHERE is_default;
CREATE INDEX ix_business_calendars_branch ON business_calendars (branch_id);
CREATE INDEX ix_business_calendars_region ON business_calendars (region_id);

-- Identity resolution
CREATE INDEX ix_dup_lead_status        ON duplicate_matches (lead_id, status);
CREATE INDEX ix_dup_matched            ON duplicate_matches (matched_lead_id);

-- Product detail / docs / KYC
CREATE INDEX ix_lpd_attributes         ON lead_product_details USING GIN (attributes);
CREATE INDEX ix_documents_lead_type    ON documents (lead_id, doc_type, applicant_scope);
CREATE INDEX ix_documents_status       ON documents (status);
CREATE INDEX ix_kyc_lead_type          ON kyc_verifications (lead_id, kyc_type);
CREATE INDEX ix_kyc_status             ON kyc_verifications (status);
CREATE INDEX ix_kyc_exception          ON kyc_verifications (exception_type, status);
CREATE INDEX ix_kyc_integration        ON kyc_verifications (integration_log_id);

-- Customer self-service
CREATE INDEX ix_customer_links_lead    ON customer_links (lead_id, status);

-- Tasks & communication
CREATE INDEX ix_tasks_owner            ON tasks (owner_id, status, due_at);
CREATE INDEX ix_tasks_lead             ON tasks (lead_id);
CREATE INDEX ix_tasks_overdue          ON tasks (status, due_at);
CREATE INDEX ix_comm_logs_lead         ON communication_logs (lead_id);
CREATE INDEX ix_comm_logs_status       ON communication_logs (status);
CREATE INDEX ix_comm_logs_channel      ON communication_logs (channel, sent_at);
CREATE INDEX ix_notifications_recipient ON notifications (recipient_user_id, is_read, created_at);

-- Consent, sharing, grievance, rights
CREATE INDEX ix_consent_lead_purpose   ON consent_records (lead_id, purpose, state);
CREATE INDEX ix_consent_customer       ON consent_records (customer_profile_id, purpose);
CREATE INDEX ix_dsl_lead               ON data_sharing_logs (lead_id);
CREATE INDEX ix_dsl_recipient          ON data_sharing_logs (recipient, shared_at);
CREATE INDEX ix_grievances_status      ON grievances (status, sla_due_at);
CREATE INDEX ix_grievances_lead        ON grievances (lead_id);
CREATE INDEX ix_drr_status             ON data_rights_requests (status, due_at);
CREATE INDEX ix_drr_customer           ON data_rights_requests (customer_profile_id);

-- LOS
CREATE INDEX ix_elig_lead              ON eligibility_snapshots (lead_id);
CREATE INDEX ix_los_mirror_lead        ON los_application_mirrors (lead_id, status_date);

-- Workspace / history / notes
CREATE INDEX ix_saved_views_owner      ON saved_views (owner_id);
CREATE INDEX ix_saved_views_shared     ON saved_views (is_shared);
CREATE INDEX ix_stage_history_lead     ON stage_history (lead_id, occurred_at);
CREATE INDEX ix_stage_history_to       ON stage_history (to_stage, occurred_at);
CREATE INDEX ix_notes_lead             ON notes (lead_id, created_at);

-- Jobs / governance / audit / integration / events
CREATE INDEX ix_import_jobs_status     ON import_jobs (status, created_at);
CREATE INDEX ix_export_jobs_requested  ON export_jobs (requested_by, status);
CREATE INDEX ix_config_versions_type   ON configuration_versions (config_type, status);
CREATE INDEX ix_audit_lead             ON audit_logs (lead_id, created_at);
CREATE INDEX ix_audit_actor            ON audit_logs (actor_id, created_at);
CREATE INDEX ix_audit_action           ON audit_logs (action, created_at);
CREATE INDEX ix_integration_logs_kind  ON integration_logs (integration, status);
CREATE INDEX ix_integration_logs_lead  ON integration_logs (lead_id);
CREATE UNIQUE INDEX uq_integration_idempotency ON integration_logs (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_event_outbox_status    ON event_outbox (status, created_at);
CREATE INDEX ix_event_outbox_aggregate ON event_outbox (aggregate_type, aggregate_id);
-- Additional FK-path indexes (query-relevant; audit created_by/updated_by FKs intentionally not indexed)
CREATE INDEX ix_leads_rejection        ON leads (rejection_reason_id);
CREATE INDEX ix_leads_import_job        ON leads (import_job_id);
CREATE INDEX ix_tasks_sla_policy        ON tasks (sla_policy_id);
CREATE INDEX ix_comm_logs_template      ON communication_logs (template_id);
CREATE INDEX ix_dsl_consent            ON data_sharing_logs (consent_id);
CREATE INDEX ix_kyc_exc_owner          ON kyc_verifications (exception_owner_id);
CREATE INDEX ix_grievances_owner       ON grievances (owner_id);
CREATE INDEX ix_drr_lead               ON data_rights_requests (lead_id);
CREATE INDEX ix_drr_owner              ON data_rights_requests (owner_id);
CREATE INDEX ix_config_versions_maker  ON configuration_versions (maker_id);
CREATE INDEX ix_partners_branch        ON partners (branch_id);
CREATE INDEX ix_partners_mapped_rm     ON partners (mapped_rm_id);

-- â”€â”€ 5. updated_at triggers (one per table) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TRIGGER trg_orgs_updated_at BEFORE UPDATE ON orgs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_regions_updated_at BEFORE UPDATE ON regions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_role_permissions_updated_at BEFORE UPDATE ON role_permissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_branches_updated_at BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_partners_updated_at BEFORE UPDATE ON partners FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_break_glass_grants_updated_at BEFORE UPDATE ON break_glass_grants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_customer_profiles_updated_at BEFORE UPDATE ON customer_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_lead_identities_updated_at BEFORE UPDATE ON lead_identities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_product_configs_updated_at BEFORE UPDATE ON product_configs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_schemes_updated_at BEFORE UPDATE ON schemes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_rejection_reasons_updated_at BEFORE UPDATE ON rejection_reasons FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_allocation_rules_updated_at BEFORE UPDATE ON allocation_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sla_policies_updated_at BEFORE UPDATE ON sla_policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_business_calendars_updated_at BEFORE UPDATE ON business_calendars FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_communication_templates_updated_at BEFORE UPDATE ON communication_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_dla_registry_updated_at BEFORE UPDATE ON dla_registry FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_retention_policies_updated_at BEFORE UPDATE ON retention_policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_webhook_subscriptions_updated_at BEFORE UPDATE ON webhook_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_source_attributions_updated_at BEFORE UPDATE ON source_attributions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_integration_logs_updated_at BEFORE UPDATE ON integration_logs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_lead_product_details_updated_at BEFORE UPDATE ON lead_product_details FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_duplicate_matches_updated_at BEFORE UPDATE ON duplicate_matches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_documents_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_customer_links_updated_at BEFORE UPDATE ON customer_links FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_kyc_verifications_updated_at BEFORE UPDATE ON kyc_verifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_data_sharing_logs_updated_at BEFORE UPDATE ON data_sharing_logs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_communication_logs_updated_at BEFORE UPDATE ON communication_logs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_notification_preferences_updated_at BEFORE UPDATE ON notification_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_grievances_updated_at BEFORE UPDATE ON grievances FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_data_rights_requests_updated_at BEFORE UPDATE ON data_rights_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_eligibility_snapshots_updated_at BEFORE UPDATE ON eligibility_snapshots FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_los_application_mirrors_updated_at BEFORE UPDATE ON los_application_mirrors FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_saved_views_updated_at BEFORE UPDATE ON saved_views FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_notes_updated_at BEFORE UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_import_jobs_updated_at BEFORE UPDATE ON import_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_export_jobs_updated_at BEFORE UPDATE ON export_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_configuration_versions_updated_at BEFORE UPDATE ON configuration_versions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_event_outbox_updated_at BEFORE UPDATE ON event_outbox FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Append-only tables (consent_records, stage_history, audit_logs): no updated_at trigger by design (INSERT-only, Â§5.6.3).

-- â”€â”€ 6. Seed / bootstrap reference data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Deferred audit FKs let this bootstrap commit atomically (system user references itself; roles reference system user).
BEGIN;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO orgs (id, code, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'DEFAULT', 'Default NBFC Org');

INSERT INTO roles (role_id, code, name, default_scope, is_external, created_by, updated_by) VALUES
  ('00000000-0000-0000-0000-0000000000a1','RM','Relationship Manager','O',false,'00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-0000000000a2','BM','Branch Manager','B',false,'00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-0000000000a3','SM','Sales Manager','T',false,'00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-0000000000a4','HEAD','Sales / Business Head','A',false,'00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-0000000000a5','KYC','KYC / Operations User','B',false,'00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-0000000000a6','DPO','Compliance / DPO User','M',false,'00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-0000000000a7','PARTNER','DSA / Dealer / Connector','P',true,'00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-0000000000a8','ADMIN','System Administrator','A',false,'00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-0000000000a9','CUSTOMER','Customer / Prospect','C',true,'00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000');

-- Reserved system actor (used as created_by/updated_by/actor for system-originated rows). Not a login.
INSERT INTO users (user_id, username, email, full_name, role_id, status, mfa_enabled, created_by, updated_by)
VALUES ('00000000-0000-0000-0000-000000000000','system','system@internal.local','System Actor',
        '00000000-0000-0000-0000-0000000000a8','inactive',false,
        '00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000');

INSERT INTO business_calendars (business_calendar_id, code, name, is_default, working_hours, created_by, updated_by)
VALUES ('00000000-0000-0000-0000-0000000000b1','DEFAULT','Default (Mon-Sat 09:30-18:30 IST)', true,
  '{"mon":{"start":"09:30","end":"18:30"},"tue":{"start":"09:30","end":"18:30"},"wed":{"start":"09:30","end":"18:30"},"thu":{"start":"09:30","end":"18:30"},"fri":{"start":"09:30","end":"18:30"},"sat":{"start":"09:30","end":"18:30"},"sun":null}'::jsonb,
  '00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000');

COMMIT;

-- =============================================================
-- End of schema. 47 tables (46 BRD entities + orgs seam), 69 enums.
-- Apply downstream: role_permissions seed from Â§3.3, branches/teams/users, product_configs (7, FR-041),
-- sla_policies, rejection_reasons, communication_templates, retention_policies â€” loaded via FR-130/131.
-- =============================================================




