-- =============================================================
-- V2__seed_product_configs.sql  —  FR-041 (Initial supported products)
-- Module: M5 Product Configuration.  source_fr: FR-041 (data seed only, Tier 1).
--
-- Seeds the seven NBFC launch products as ACTIVE, version 1 product_configs so
-- that lead capture (FR-010) and the product-picker UI function on first boot.
-- These are mandated default configurations (bootstrap data, equivalent to the
-- default business_calendar seeded in V1) — not user-created configs — so they
-- are inserted directly at status='active' and bypass the FR-132 maker-checker
-- draft→pending→active gate. Subsequent version changes go through FR-040/FR-132.
--
-- Idempotent: INSERT ... ON CONFLICT (org_id, product_code, version) DO NOTHING
-- (matches uq_product_configs_version). Safe to re-run; a second apply is a no-op.
--
-- Depends on V1__initial_schema.sql having seeded:
--   * default org   '00000000-0000-0000-0000-000000000001'
--   * system user   '00000000-0000-0000-0000-000000000000' (created_by/updated_by)
--
-- Canonical content per docs/lld/FR-041.md "Seed Data Reference". field_schema
-- carries the key capture fields under .required; document_checklist is the
-- ordered checklist array; eligibility_mapping keys the LOS eligibility inputs to
-- their source field paths. pan_required_at: before_kyc for CV/CAR/TRACTOR/CE,
-- before_handoff for TW (PAN "where available"), at_capture for SBL/HRM (GSTIN/
-- property KYC begins immediately).
-- =============================================================

INSERT INTO product_configs (
  product_config_id,
  org_id,
  product_code,
  name,
  version,
  status,
  field_schema,
  document_checklist,
  sla_config,
  eligibility_mapping,
  pan_required_at,
  created_by,
  updated_by
) VALUES

-- ── CV — Commercial Vehicle ──────────────────────────────────
(
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'CV',
  'Commercial Vehicle',
  1,
  'active',
  '{"required":["vehicle_type","make_model","new_used","invoice_valuation","route_permit","fleet_size","operator_profile","dealer","down_payment"],"optional":[]}'::jsonb,
  '["id","pan","address","income_banking","quotation_invoice","rc_used","permit","insurance","field_visit"]'::jsonb,
  NULL,
  '{"asset_value":"$.field_schema.invoice_valuation","ltv_inputs":"$.field_schema.down_payment","income_cash_flow":"$.field_schema.operator_profile","vintage":"$.field_schema.operator_profile","fleet":"$.field_schema.fleet_size","route_usage":"$.field_schema.route_permit"}'::jsonb,
  'before_kyc',
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000'
),

-- ── CAR — Car ────────────────────────────────────────────────
(
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'CAR',
  'Car',
  1,
  'active',
  '{"required":["make_model","new_used","dealer","quotation","down_payment","employment_business","co_applicant"],"optional":[]}'::jsonb,
  '["id","pan","address","income","bank_statement","quotation","rc_used"]'::jsonb,
  NULL,
  '{"vehicle_cost":"$.field_schema.quotation","down_payment":"$.field_schema.down_payment","income":"$.field_schema.employment_business","foir":"$.field_schema.employment_business","ltv":"$.field_schema.down_payment"}'::jsonb,
  'before_kyc',
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000'
),

-- ── TRACTOR — Tractor ────────────────────────────────────────
(
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'TRACTOR',
  'Tractor',
  1,
  'active',
  '{"required":["make_model","implement","land_holding","crop_pattern","dealer","village_pin","seasonality"],"optional":[]}'::jsonb,
  '["id","pan","land_records","income_agri_proof","quotation","field_visit_photo"]'::jsonb,
  NULL,
  '{"asset_value":"$.field_schema.make_model","land_income":"$.field_schema.land_holding","ltv":"$.field_schema.make_model","seasonality":"$.field_schema.seasonality"}'::jsonb,
  'before_kyc',
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000'
),

-- ── CE — Construction Equipment ──────────────────────────────
(
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'CE',
  'Construction Equipment',
  1,
  'active',
  '{"required":["equipment_type","make_model","contractor_project","new_used","usage_hours","work_order","dealer"],"optional":[]}'::jsonb,
  '["id","pan","financials","bank_statement","quotation","rc_used","work_order"]'::jsonb,
  NULL,
  '{"asset_value":"$.field_schema.make_model","business_cash_flow":"$.field_schema.contractor_project","utilisation":"$.field_schema.usage_hours","ltv":"$.field_schema.make_model"}'::jsonb,
  'before_kyc',
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000'
),

-- ── TW — Two Wheeler ─────────────────────────────────────────
(
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'TW',
  'Two Wheeler',
  1,
  'active',
  '{"required":["make_model","dealer","down_payment","employment","residence_stability","preferred_emi"],"optional":[]}'::jsonb,
  '["id","pan_where_available","address","income_self_declaration","quotation"]'::jsonb,
  NULL,
  '{"vehicle_cost":"$.field_schema.make_model","down_payment":"$.field_schema.down_payment","income":"$.field_schema.employment","ltv":"$.field_schema.down_payment","stability":"$.field_schema.residence_stability"}'::jsonb,
  'before_handoff',
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000'
),

-- ── SBL — Secured Business Loan ──────────────────────────────
(
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'SBL',
  'Secured Business Loan',
  1,
  'active',
  '{"required":["constitution","vintage","turnover","gstin","bank_statement","collateral_property","ownership","purpose"],"optional":[]}'::jsonb,
  '["kyc_applicant_business_bo","gst_itr_bank","property_docs","valuation","title_chain"]'::jsonb,
  NULL,
  '{"turnover":"$.field_schema.turnover","banking":"$.field_schema.bank_statement","gst":"$.field_schema.gstin","property_value":"$.field_schema.collateral_property","ltv":"$.field_schema.collateral_property","vintage":"$.field_schema.vintage"}'::jsonb,
  'at_capture',
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000'
),

-- ── HRM — Home Renovation Mortgage ───────────────────────────
(
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'HRM',
  'Home Renovation Mortgage',
  1,
  'active',
  '{"required":["property_details","ownership","title_status","renovation_purpose","estimate","co_applicant","income"],"optional":[]}'::jsonb,
  '["kyc","property_docs","valuation","title_chain","renovation_estimate","income"]'::jsonb,
  NULL,
  '{"property_value":"$.field_schema.property_details","renovation_estimate":"$.field_schema.estimate","income":"$.field_schema.income","foir":"$.field_schema.income","ltv":"$.field_schema.property_details"}'::jsonb,
  'at_capture',
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000'
)

ON CONFLICT (org_id, product_code, version) DO NOTHING;
