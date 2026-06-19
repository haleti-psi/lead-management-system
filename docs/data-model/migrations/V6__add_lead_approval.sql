-- FR-055 — Lead Approval gate (pre-hand-off).
-- Adds the pending_approval stage, approval event codes, approval status/decision enums,
-- the approval_status summary column on leads, and the lead_approvals history table.
-- ALTER TYPE … ADD VALUE must precede CREATE TYPE / CREATE TABLE within this migration.

-- enum additions
ALTER TYPE lead_stage  ADD VALUE IF NOT EXISTS 'pending_approval';   -- (logically after eligibility_requested)
ALTER TYPE event_code  ADD VALUE IF NOT EXISTS 'LEAD_APPROVED';
ALTER TYPE event_code  ADD VALUE IF NOT EXISTS 'LEAD_REJECTED';
ALTER TYPE capability  ADD VALUE IF NOT EXISTS 'approve_lead';

-- new enums
CREATE TYPE approval_status   AS ENUM ('not_required','pending','approved','rejected');
CREATE TYPE approval_decision AS ENUM ('approved','rejected');   -- stored outcome

-- leads summary column
ALTER TABLE leads ADD COLUMN approval_status approval_status NOT NULL DEFAULT 'not_required';

-- approval history (template: stage_history table)
CREATE TABLE lead_approvals (
  approval_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id),
  lead_id     UUID NOT NULL,
  decision    approval_decision NOT NULL,
  reason      VARCHAR(500),
  decided_by  UUID NOT NULL,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL,
  updated_by  UUID NOT NULL,
  CONSTRAINT fk_lead_approvals_lead_id  FOREIGN KEY (lead_id)    REFERENCES leads(lead_id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_approvals_decided  FOREIGN KEY (decided_by) REFERENCES users(user_id),
  CONSTRAINT ck_lead_approvals_reject_reason CHECK (decision <> 'rejected' OR reason IS NOT NULL)
);
CREATE INDEX ix_lead_approvals_lead ON lead_approvals (lead_id);
CREATE INDEX ix_lead_approvals_decided_at ON lead_approvals (org_id, decided_at DESC);
