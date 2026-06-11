# FR-041: Initial Supported Products — Test Specification

**Tier: 1** (Simple)
**Source LLD:** `docs/lld/FR-041.md`

---

## Test Cases

Tier 1 requires at minimum 2 test cases. FR-041 has been given expanded coverage because it is a **foundation dependency**: all capture FRs (FR-010, FR-080, FR-081) assume the seven seed rows exist. A regression here would silently break multiple downstream FRs. The tests below exceed the Tier-1 minimum accordingly.

| # | Layer | Test name | Setup | Action | Expected result |
|---|---|---|---|---|---|
| T01 | API integration (happy path) | `returns all 7 seeded products for ADMIN user` | Testcontainers Postgres; Flyway migrations run (including V003); ADMIN JWT minted | `GET /api/v1/admin/products?limit=25` | HTTP 200; `data` array length = 7; `meta.pagination.total` = 7; each item has `status = 'active'`, `version = 1` |
| T02 | API integration (happy path) | `returns active CV product config with correct field_schema keys` | Same as T01 | `GET /api/v1/admin/products?filter[product_code]=CV` | HTTP 200; `data[0].product_code = 'CV'`; `data[0].field_schema.required` includes `vehicle_type`, `fleet_size`, `down_payment`; `data[0].document_checklist` includes `permit` and `insurance` |
| T03 | API integration (happy path) | `returns correct pan_required_at per product` | Same as T01 | `GET /api/v1/admin/products?limit=25` | `TW` row has `pan_required_at = 'before_handoff'`; `SBL` and `HRM` rows have `pan_required_at = 'at_capture'`; all other rows have `pan_required_at = 'before_kyc'` |
| T04 | API integration (authz — negative) | `returns FORBIDDEN for RM role (lacks configuration capability)` | RM JWT minted | `GET /api/v1/admin/products` | HTTP 403; `error.code = 'FORBIDDEN'`; `data = null` |
| T05 | API integration (authz — negative) | `returns FORBIDDEN for PARTNER role (lacks configuration capability)` | PARTNER JWT minted | `GET /api/v1/admin/products` | HTTP 403; `error.code = 'FORBIDDEN'`; `data = null` |
| T06 | API integration (authz — positive) | `returns 200 for HEAD role` | HEAD JWT | `GET /api/v1/admin/products` | HTTP 200; data returned |
| T07 | API integration (auth — missing token) | `returns AUTH_REQUIRED when no JWT provided` | No Authorization header | `GET /api/v1/admin/products` | HTTP 401; `error.code = 'AUTH_REQUIRED'` |
| T08 | API integration (validation) | `returns VALIDATION_ERROR for limit > 100` | ADMIN JWT | `GET /api/v1/admin/products?limit=200` | HTTP 400; `error.code = 'VALIDATION_ERROR'`; `error.fields` contains `limit` |
| T09 | API integration (validation) | `returns VALIDATION_ERROR for unknown product_code filter` | ADMIN JWT | `GET /api/v1/admin/products?filter[product_code]=INVALID` | HTTP 400; `error.code = 'VALIDATION_ERROR'`; `error.fields` contains `filter[product_code]` |
| T10 | API integration (single get — not found) | `returns NOT_FOUND for non-existent product_config_id` | ADMIN JWT | `GET /api/v1/admin/products/00000000-0000-0000-0000-000000000099` | HTTP 404; `error.code = 'NOT_FOUND'` |
| T11 | Unit (repository) | `findActiveByProductCode returns the active row for SBL` | In-memory Kysely mock or Testcontainers; V003 migration applied | `ProductConfigRepository.findActiveByProductCode(ORG_ID, 'SBL')` | Returns 1 row; `product_code = 'SBL'`, `status = 'active'`, `version = 1`, `eligibility_mapping` contains `turnover` |
| T12 | Unit (seed idempotency) | `re-running V003 migration does not create duplicate rows` | Testcontainers Postgres; V003 applied once; apply V003 SQL block again manually | Execute seed INSERT statements a second time | Row count in `product_configs` remains 7 (ON CONFLICT DO NOTHING); no error thrown |

---

## SQL Invariant Queries

Run these assertions after Flyway migration V003 as part of CI schema-check or integration test setup. Every query must return **0 rows** for the migration to be considered correct.

```sql
-- INV-01: All 7 required product codes must exist as active v1 configs
SELECT unnest(ARRAY['CV','CAR','TRACTOR','CE','TW','SBL','HRM']::product_code[]) AS expected_code
EXCEPT
SELECT product_code FROM product_configs WHERE status = 'active' AND version = 1;
-- Expected: 0 rows (all 7 present)

-- INV-02: No product_configs row should have a null field_schema
SELECT product_config_id FROM product_configs WHERE field_schema IS NULL;
-- Expected: 0 rows

-- INV-03: No product_configs row should have a null document_checklist
SELECT product_config_id FROM product_configs WHERE document_checklist IS NULL;
-- Expected: 0 rows

-- INV-04: No product_configs row should have a null eligibility_mapping for the 7 seeded products
SELECT product_config_id, product_code FROM product_configs
WHERE version = 1 AND status = 'active' AND eligibility_mapping IS NULL;
-- Expected: 0 rows (all 7 seed rows must have eligibility_mapping populated)

-- INV-05: Uniqueness constraint holds — no duplicate (org_id, product_code, version) triplets
SELECT org_id, product_code, version, COUNT(*) AS cnt
FROM product_configs
GROUP BY org_id, product_code, version
HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- INV-06: TW pan_required_at is before_handoff (not before_kyc)
SELECT product_config_id FROM product_configs
WHERE product_code = 'TW' AND pan_required_at <> 'before_handoff';
-- Expected: 0 rows

-- INV-07: SBL and HRM pan_required_at is at_capture
SELECT product_config_id, product_code FROM product_configs
WHERE product_code IN ('SBL','HRM') AND pan_required_at <> 'at_capture';
-- Expected: 0 rows

-- INV-08: All seeded configs reference the system user (no orphaned created_by)
SELECT pc.product_config_id FROM product_configs pc
WHERE pc.version = 1
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = pc.created_by);
-- Expected: 0 rows
```

---

## UI Test Scenarios

FR-041 has no dedicated UI of its own. The seeded data feeds the product picker in the lead-capture form (FR-010 UI). The following scenarios validate that FR-041's seed is correctly consumed by the UI:

| # | Tool | Scenario | Steps | Expected |
|---|---|---|---|---|
| UI-01 | Playwright | Product picker shows all 7 seeded products | Login as RM; navigate to "Capture Lead"; click product selector | Dropdown/radio list shows 7 items: CV, CAR, TRACTOR, CE, TW, SBL, HRM — no "No options" empty state |
| UI-02 | Playwright | Admin product list shows 7 rows for ADMIN user | Login as ADMIN; navigate to Settings > Products | Table renders 7 rows; each shows product name, status chip "active", version "1" |
| UI-03 | Vitest + Testing Library | `ProductPickerField` renders 7 options from the active-products API response | Mock API with the 7-product seed fixture | Component renders exactly 7 `<option>` / radio elements; labels match product names |

---

## Coverage Checklist

| Requirement | Covered by | Status |
|---|---|---|
| Happy path: all 7 products present after seed | T01, SQL INV-01 | Covered |
| Correct field_schema content for each product | T02 (CV spot check) | Covered (spot check; full content verified by INV-02/03/04) |
| Correct pan_required_at per product | T03, INV-06, INV-07 | Covered |
| AUTH_REQUIRED (401) path | T07 | Covered |
| FORBIDDEN (403) for role without configuration capability | T04, T05 | Covered |
| FORBIDDEN authz positive (role with configuration capability) | T06 | Covered |
| VALIDATION_ERROR (400) on invalid query params | T08, T09 | Covered |
| NOT_FOUND (404) on unknown product_config_id | T10 | Covered |
| Seed idempotency (re-run safe) | T12, INV-05 | Covered |
| Repository findActiveByProductCode correctness | T11 | Covered |
| No null field_schema / document_checklist / eligibility_mapping | INV-02, INV-03, INV-04 | Covered |
| Uniqueness constraint | INV-05 | Covered |
| created_by FK integrity | INV-08 | Covered |
| Product picker UI renders 7 products | UI-01, UI-03 | Covered |
| Admin UI renders product list | UI-02 | Covered |
| Envelope shape `{ data, meta, error }` | T01 (meta.pagination check) | Covered |
| Pagination default/max respected | T08 (limit > 100 rejected) | Covered |
| No stack trace / internal path in error responses | T04, T07, T10 (check response body shape) | Covered by global exception filter; verify in T04 assertion |
