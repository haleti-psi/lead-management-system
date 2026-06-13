-- =============================================================
-- V3__seed_default_scoring_rules.sql  —  FR-011 (Lead Quality Scoring)
-- Module: M4 Allocation & Prioritisation.  source_fr: FR-011 (data seed).
--
-- Seeds the default scoring rules as an ACTIVE ConfigurationVersion so that
-- ScoringService loads real weights on first boot (no empty-result fallback
-- required, although the code falls back gracefully if this row is absent).
--
-- Arbiter decision D1 (2026-06-12, docs/decisions/seed-config-decisions.md):
--   - One row, default org, config_ref NULL, version 1.
--   - maker_id = system actor '00000000-0000-0000-0000-000000000000'.
--   - checker_id NULL; status 'active'; effective_at = now().
--   - Bypasses maker-checker (FR-132) per FR-041 precedent in V2.
--   - The config_type 'scoring_rules' has no registered activator — governed
--     by FR-132 status lifecycle only.
--
-- Arbiter decision D3: penalised_sources = [] (PENDING-BUSINESS).
--   Business must supply the list of historically-high-rejection source codes
--   as a subsequent FR-132-governed ConfigurationVersion update. Until then the
--   source_high_rejection factor never fires; capture scoring is unaffected.
--
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING.
-- Safe to re-run; a second apply is a no-op.
--
-- Depends on V1__initial_schema.sql having seeded:
--   * default org   '00000000-0000-0000-0000-000000000001'
--   * system user   '00000000-0000-0000-0000-000000000000'
-- =============================================================

INSERT INTO configuration_versions (
  configuration_version_id,
  org_id,
  config_type,
  config_ref,
  version,
  maker_id,
  checker_id,
  status,
  effective_at,
  diff,
  created_by,
  updated_by
)
VALUES (
  '00000000-0000-0000-0011-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'scoring_rules',
  NULL,
  1,
  '00000000-0000-0000-0000-000000000000',
  NULL,
  'active',
  NOW(),
  '{
    "clamp": [0, 100],
    "factors": {
      "mobile_verified": 10,
      "pin_present": 8,
      "requested_amount_present": 7,
      "high_amount": 10,
      "language_preference_set": 5,
      "pan_present": 15,
      "pan_missing_penalty": -15,
      "partner_quality_good": 10,
      "partner_high_risk": -10,
      "source_high_rejection": -10,
      "customer_type_business": 5,
      "employment_type_present": 5,
      "asset_details_present": 5
    },
    "params": {
      "partner_quality_good_min": 70,
      "partner_quality_poor_max": 40,
      "penalised_sources": [],
      "source_rejection_rate_threshold": null
    }
  }'::jsonb,
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000'
)
ON CONFLICT (configuration_version_id) DO NOTHING;
