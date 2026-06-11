# FR-010: Omnichannel Lead Capture — Test Specification

**Tier: 2** (Moderate)
**Source LLD:** `docs/lld/FR-010.md`

---

## Test Stack

| Layer | Tool | Location |
|---|---|---|
| Backend unit (service/validation logic) | **Jest** + ts-jest | `apps/api/src/modules/capture/*.spec.ts` |
| Backend API integration | **Jest + supertest** + **Testcontainers-Postgres** | `apps/api/test/capture/capture.e2e-spec.ts` |
| Frontend component | **Vitest** + `@testing-library/react` | `apps/web/src/components/capture/*.test.tsx` |
| E2E (browser) | **Playwright** | `apps/web/e2e/lead-capture.spec.ts` |

All tests use isolated Postgres (Testcontainers) and mock all external adapters. No real provider is called.

---

## Test Cases

### Unit Tests — `capture.service.spec.ts`

| # | Name | Type | Scenario | Expected outcome |
|---|---|---|---|---|
| U-01 | `derives consent_status=pending when no consents provided` | Unit | `CaptureService.deriveConsentStatus([])` | Returns `'pending'` |
| U-02 | `derives consent_status=partial when lead_contact granted` | Unit | `deriveConsentStatus([{purpose:'lead_contact', state:'granted'}])` | Returns `'partial'` |
| U-03 | `derives consent_status=captured when all required purposes granted` | Unit | All required purposes for product granted | Returns `'captured'` |
| U-04 | `validates PAN required at_capture when ProductConfig.pan_required_at=at_capture` | Unit | `validatePanTiming(config, dto)` with `pan_required_at='at_capture'` and no `pan_token` | Throws `VALIDATION_ERROR` with `fields: [{field:'identity.pan_token'}]` |
| U-05 | `allows PAN absent when pan_required_at=before_kyc` | Unit | `validatePanTiming(config, dto)` with `pan_required_at='before_kyc'` and no `pan_token` | No error |
| U-06 | `requires partner_code when source is DSA` | Unit | Zod schema parse with `source='DSA'` and no `partner_code` | Zod error on `source.partner_code` |
| U-07 | `requires partner_code when source is Dealer` | Unit | Zod schema parse with `source='Dealer'` and no `partner_code` | Zod error on `source.partner_code` |
| U-08 | `partner_code optional when source is Branch` | Unit | Zod schema parse with `source='Branch'` and no `partner_code` | Valid parse |
| U-09 | `mobile regex rejects 5-digit number` | Unit | `MobileSchema.parse('12345')` | Zod error |
| U-10 | `mobile regex rejects number starting with 1` | Unit | `MobileSchema.parse('1234567890')` | Zod error |
| U-11 | `mobile regex accepts valid Indian mobile` | Unit | `MobileSchema.parse('9876543210')` | Valid parse |
| U-12 | `lead_code generated in LD-YYYY-seq6 format` | Unit | `CodeGenerator.nextLeadCode(tx, orgId)` | Matches `/^LD-\d{4}-\d{6}$/` |
| U-13 | `generateLeadCode increments sequence atomically` | Unit | Two concurrent calls | Unique codes (sequence conflict test) |

---

### API Integration Tests — `capture.e2e-spec.ts`

All API tests use `supertest` against the Nest app with Testcontainers-Postgres and seeded fixtures (org, roles, users, product_configs, partners).

#### Happy Path

| # | Name | Endpoint | Setup | Request | Expected response |
|---|---|---|---|---|---|
| A-01 | `creates lead successfully (RM manual create)` | POST /leads | RM user JWT; active CV ProductConfig; Branch | Valid LeadCreate DTO | 201; `data.lead_code` matches `LD-YYYY-xxxxxx`; `data.stage='captured'`; `data.mobile_masked` format correct |
| A-02 | `creates lead with partner (BM, source=DSA)` | POST /leads | BM JWT; active DSA partner | `source.source='DSA'`, `partner_code` valid | 201; DB: `source_attributions.partner_id` set |
| A-03 | `returns 200 on idempotent replay` | POST /leads | RM JWT; first call succeeds | Same `Idempotency-Key`, same body | 200; `data.lead_id` = original `lead_id`; DB: exactly ONE leads row for that mobile |
| A-04 | `creates public lead via /public/leads` | POST /public/leads | No JWT; valid captcha mock; branch with matching pin_code | Minimal body (name, mobile, product_code, consent) | 201; `data.stage='captured'`; `data.channel_created_by='website'` |
| A-05 | `accepts bulk import file and returns 202` | POST /leads/import | BM JWT; valid CSV (5 rows) | multipart/form-data CSV | 202; `data.status='queued'`; `data.import_job_id` is UUID |
| A-06 | `creates customer_profile row on first mobile seen` | POST /leads | RM JWT | Valid create with new mobile | DB: `customer_profiles` has 1 row for that mobile |
| A-07 | `links to existing customer_profile on same mobile` | POST /leads | RM JWT | Second lead with same mobile | DB: `leads.customer_profile_id` = same UUID; `customer_profiles` still has 1 row |
| A-08 | `stores consent_records rows for each consent provided` | POST /leads | RM JWT; 2 consent purposes | 2 consent objects in `consents[]` | DB: 2 rows in `consent_records` for that `lead_id`; both append-only |
| A-09 | `LEAD_CREATED event written to event_outbox` | POST /leads | RM JWT | Valid create | DB: `event_outbox` has 1 row with `event_code='LEAD_CREATED'` and `aggregate_id=lead_id`; `status='pending'` |
| A-10 | `audit_log row written with action=lead_create` | POST /leads | RM JWT | Valid create | DB: `audit_logs` has 1 row with `action='lead_create'` and `lead_id` set |
| A-11 | `stage_history row written (from_stage=null, to_stage=captured)` | POST /leads | RM JWT | Valid create | DB: `stage_history` has 1 row with `from_stage IS NULL` and `to_stage='captured'` |

#### Error Path — Validation

| # | Name | Endpoint | Request | Expected response |
|---|---|---|---|---|
| A-12 | `returns 400 when mobile is missing` | POST /leads | Body without `identity.mobile` | 400; `error.code='VALIDATION_ERROR'`; `fields` contains `identity.mobile` |
| A-13 | `returns 400 when mobile format invalid (starts with 1)` | POST /leads | `mobile='1234567890'` | 400; `fields` contains `identity.mobile` |
| A-14 | `returns 400 when source is not in enum` | POST /leads | `source.source='Instagram'` | 400; `fields` contains `source.source` |
| A-15 | `returns 400 when source=DSA but partner_code absent` | POST /leads | `source.source='DSA'`, no `partner_code` | 400; `fields` contains `source.partner_code` |
| A-16 | `returns 400 when product_code not in enum` | POST /leads | `product_code='BOAT'` | 400; `fields` contains `product_code` |
| A-17 | `returns 400 when PAN required at_capture but absent` | POST /leads | Config has `pan_required_at='at_capture'`; no `pan_token` | 400; `fields` contains `identity.pan_token` |
| A-18 | `returns 400 when pin_code is wrong format` | POST /leads | `pin_code='ABC123'` | 400; `fields` contains `pin_code` |
| A-19 | `returns 413 when import file exceeds 10 MB` | POST /leads/import | File > 10 MB | 413; `error.code='PAYLOAD_TOO_LARGE'` |
| A-20 | `returns 415 when import file is not CSV or XLSX` | POST /leads/import | PDF file | 415; `error.code='UNSUPPORTED_MEDIA'` |

#### Error Path — Authorisation

| # | Name | Endpoint | Setup | Expected response |
|---|---|---|---|---|
| A-21 | `returns 401 when JWT missing on /leads` | POST /leads | No Authorization header | 401; `error.code='AUTH_REQUIRED'` |
| A-22 | `returns 401 when JWT expired on /leads` | POST /leads | Expired token | 401; `error.code='AUTH_REQUIRED'` |
| A-23 | `returns 403 when role lacks create_lead capability (KYC role)` | POST /leads | KYC user JWT (no `create_lead` in matrix) | 403; `error.code='FORBIDDEN'` |
| A-24 | `returns 403 when PARTNER submits with another partner's partner_code` | POST /leads | PARTNER user JWT; partner_code of a different partner | 403; `error.code='FORBIDDEN'` |
| A-25 | `returns 403 when captcha invalid on /public/leads` | POST /public/leads | Invalid `X-Captcha-Token` (mock returns fail) | 403; `error.code='FORBIDDEN'` |
| A-26 | `returns 403 when role lacks bulk_action capability (RM role)` | POST /leads/import | RM user JWT | 403; `error.code='FORBIDDEN'` |

#### Error Path — Conflict / Duplicate

| # | Name | Endpoint | Setup | Expected response |
|---|---|---|---|---|
| A-27 | `returns 409 DUPLICATE_BLOCKED on strong duplicate (same PAN+mobile)` | POST /leads | Existing lead with same mobile+PAN; config action=blocked | 409; `error.code='CONFLICT'`; `error.detail.reason='DUPLICATE_BLOCKED'`; `error.detail.matches` array non-empty with `confidence='strong'` |
| A-28 | `creates lead successfully on weak duplicate (warn-only config)` | POST /leads | Existing lead with fuzzy name+pin match; config action=warned | 201; `data.duplicate_status` may be `none` at return (async scan); no 409 |

#### Rate Limit

| # | Name | Endpoint | Setup | Expected response |
|---|---|---|---|---|
| A-29 | `returns 429 after 11 requests/min from same IP on /public/leads` | POST /public/leads | 10 successful requests; 11th request same IP | 429; `error.code='RATE_LIMITED'`; `Retry-After` header present |

#### Transaction Integrity

| # | Name | Scenario | Expected outcome |
|---|---|---|---|
| A-30 | `rolls back all inserts when outbox emit fails mid-transaction` | Force `OutboxService.emit` to throw inside the UoW | DB: no leads row, no lead_identities row, no source_attributions row, no stage_history row — all absent; 500 INTERNAL_ERROR returned |
| A-31 | `rolls back all inserts when audit_logs append fails mid-transaction` | Force `AuditAppender.append` to throw inside the UoW | Same as A-30: zero rows in all tables for that attempt |

---

### Masking Tests

| # | Name | Scenario | Expected outcome |
|---|---|---|---|
| M-01 | `RM sees masked mobile in response` | POST /leads as RM; mobile=`9876543210` | `data.mobile_masked='98xxxxxx10'`; raw `mobile` field absent from response |
| M-02 | `RM sees masked name in response` | POST /leads as RM; name=`Ramesh Kumar` | `data.name_masked` applied per masking rule; raw `name` absent |
| M-03 | `DPO receives masked view (scope M)` | GET /leads/{id} as DPO (not covered by FR-010 endpoint, documented for regression) | N/A for this FR's endpoint; logged for cross-FR |

---

### Idempotency Tests

| # | Name | Scenario | Expected outcome |
|---|---|---|---|
| I-01 | `second call with same Idempotency-Key returns HTTP 200 with original data` | POST /leads twice with same `Idempotency-Key` | Second call: HTTP 200; `data.lead_id` = first call's `lead_id`; DB: exactly 1 leads row |
| I-02 | `idempotent replay creates no additional audit or outbox rows` | POST /leads twice with same `Idempotency-Key` | DB: `audit_logs` count = 1; `event_outbox` count = 1; `consent_records` count = consents provided once |
| I-03 | `different Idempotency-Key creates a new lead` | POST /leads twice with different `Idempotency-Key` but same body | Two different `lead_id`s returned (unless strong dup blocks second) |

---

### Append-Only Invariant Tests

| # | Name | SQL Invariant Query | Expected result |
|---|---|---|---|
| AO-01 | `audit_logs are never updated after insert` | See SQL Invariants section | UPDATE rejected by DB permission / Nest never issues UPDATE on audit_logs |
| AO-02 | `consent_records are never updated after insert` | See SQL Invariants section | UPDATE rejected |
| AO-03 | `stage_history rows are never updated after insert` | See SQL Invariants section | UPDATE rejected |

---

### Bulk Import Tests

| # | Name | Scenario | Expected outcome |
|---|---|---|---|
| B-01 | `valid CSV — all rows committed, success_rows count correct` | 3-row CSV, all valid | `import_jobs.success_rows=3`; `failed_rows=0`; 3 leads in DB |
| B-02 | `partial failure — valid rows committed, error CSV generated` | 3-row CSV: rows 1+3 valid, row 2 invalid mobile | `success_rows=2`; `failed_rows=1`; error CSV GCS ref set; row 2 in error file with `VALIDATION_ERROR` |
| B-03 | `error CSV contains row number, column, code, message` | Row with missing name | Error CSV row: `(2, identity.name, VALIDATION_ERROR, "Name is required.")` |
| B-04 | `bulk import is idempotent on same Idempotency-Key` | POST /leads/import twice with same key | Second call returns 200 with original `import_job_id`; no second import_job row |

---

### E2E / UI Tests — `lead-capture.spec.ts` (Playwright)

| # | Name | Flow | Expected outcome |
|---|---|---|---|
| E-01 | `RM can complete the quick-create form and see the lead` | Login as RM → click Quick-Create → fill name/mobile/product/source → submit | Lead created; Toast "Lead created successfully"; Drawer closes; lead appears in leads list |
| E-02 | `QR capture page submits without login` | Navigate to `/public/capture?channel=qr` → fill name/mobile/product/consent → submit | Lead created; success confirmation shown; no JWT required |
| E-03 | `form shows inline error when mobile is invalid` | Submit form with mobile=`123` | Field-level error shown below mobile input; form not submitted |
| E-04 | `partner autocomplete appears when source=DSA selected` | Select source=DSA in capture form | `PartnerAutocomplete` input becomes visible; required indicator shown |

---

## SQL Invariant Queries

Run after each write test to verify structural guarantees. Each query must return **0 rows** (verified in API integration tests via direct DB assertions).

```sql
-- INV-01: No lead exists with a stage other than 'captured' after FR-010 creation
-- (FR-010 only creates leads at stage=captured)
SELECT lead_id FROM leads
WHERE created_at >= :test_start
  AND stage <> 'captured'
  AND import_job_id IS NULL;   -- exclude async bulk re-checks if stage advanced

-- INV-02: Every lead created by FR-010 has a corresponding stage_history row (from_stage=null, to_stage=captured)
SELECT l.lead_id FROM leads l
WHERE l.created_at >= :test_start
AND NOT EXISTS (
  SELECT 1 FROM stage_history sh
  WHERE sh.lead_id = l.lead_id
    AND sh.from_stage IS NULL
    AND sh.to_stage = 'captured'
);

-- INV-03: Every lead created by FR-010 has exactly one source_attribution row
SELECT l.lead_id FROM leads l
WHERE l.created_at >= :test_start
AND (
  SELECT COUNT(*) FROM source_attributions sa
  WHERE sa.source_attribution_id = l.source_attribution_id
) <> 1;

-- INV-04: Every lead created by FR-010 has exactly one lead_identity row
SELECT l.lead_id FROM leads l
WHERE l.created_at >= :test_start
AND (
  SELECT COUNT(*) FROM lead_identities li
  WHERE li.lead_identity_id = l.lead_identity_id
) <> 1;

-- INV-05: Every lead has a lead_product_details stub row
SELECT l.lead_id FROM leads l
WHERE l.created_at >= :test_start
AND NOT EXISTS (
  SELECT 1 FROM lead_product_details lpd
  WHERE lpd.lead_id = l.lead_id
);

-- INV-06: Every lead created by FR-010 has exactly one LEAD_CREATED outbox event (pending or published)
SELECT l.lead_id FROM leads l
WHERE l.created_at >= :test_start
AND (
  SELECT COUNT(*) FROM event_outbox eo
  WHERE eo.aggregate_id = l.lead_id
    AND eo.event_code = 'LEAD_CREATED'
) <> 1;

-- INV-07: Every lead created by FR-010 has at least one audit_log row with action=lead_create
SELECT l.lead_id FROM leads l
WHERE l.created_at >= :test_start
AND NOT EXISTS (
  SELECT 1 FROM audit_logs al
  WHERE al.lead_id = l.lead_id
    AND al.action = 'lead_create'
);

-- INV-08: No duplicate customer_profile row for the same org_id + primary_mobile
-- (uniqueness constraint test — should already be enforced by the DB, but validated here)
SELECT org_id, primary_mobile, COUNT(*) AS cnt
FROM customer_profiles
GROUP BY org_id, primary_mobile
HAVING COUNT(*) > 1;

-- INV-09: source=DSA or Dealer leads always have a non-null partner_id in source_attributions
SELECT sa.source_attribution_id FROM source_attributions sa
JOIN leads l ON l.source_attribution_id = sa.source_attribution_id
WHERE sa.source IN ('DSA', 'Dealer')
  AND sa.partner_id IS NULL;

-- INV-10: No leads.version < 1
SELECT lead_id FROM leads WHERE version < 1;
```

---

## Coverage Checklist

| Requirement | Covered by | Status |
|---|---|---|
| Happy path: manual create (RM) | A-01 | Required |
| Happy path: partner create (BM, DSA) | A-02 | Required |
| Happy path: idempotent replay returns original | A-03, I-01, I-02 | Required |
| Happy path: public / QR submission | A-04 | Required |
| Happy path: bulk import accepted (202) | A-05 | Required |
| Happy path: customer_profile upsert | A-06, A-07 | Required |
| Happy path: consent_records written | A-08 | Required |
| LEAD_CREATED outbox event written | A-09 | Required |
| audit_log written | A-10 | Required |
| stage_history written (from=null, to=captured) | A-11 | Required |
| VALIDATION_ERROR — missing mobile | A-12 | Required |
| VALIDATION_ERROR — invalid mobile format | A-13, U-09, U-10 | Required |
| VALIDATION_ERROR — unknown source | A-14 | Required |
| VALIDATION_ERROR — missing partner for DSA | A-15, U-06 | Required |
| VALIDATION_ERROR — invalid product_code | A-16 | Required |
| VALIDATION_ERROR — PAN required at_capture | A-17, U-04 | Required |
| VALIDATION_ERROR — invalid pin_code | A-18 | Required |
| PAYLOAD_TOO_LARGE — file > 10 MB | A-19 | Required |
| UNSUPPORTED_MEDIA — wrong file type | A-20 | Required |
| AUTH_REQUIRED — no JWT | A-21 | Required |
| AUTH_REQUIRED — expired JWT | A-22 | Required |
| FORBIDDEN — role lacks create_lead | A-23 | Required |
| FORBIDDEN — PARTNER cross-partner | A-24 | Required |
| FORBIDDEN — captcha invalid | A-25 | Required |
| FORBIDDEN — role lacks bulk_action | A-26 | Required |
| CONFLICT / DUPLICATE_BLOCKED | A-27 | Required |
| Weak duplicate allowed through (warn config) | A-28 | Required |
| RATE_LIMITED — /public/leads | A-29 | Required |
| Transaction rollback on outbox failure | A-30 | Required |
| Transaction rollback on audit failure | A-31 | Required |
| Masking — mobile masked in response | M-01 | Required |
| Masking — name masked in response | M-02 | Required |
| Idempotency — no duplicate rows | I-01, I-02 | Required |
| Idempotency — different key = new lead | I-03 | Required |
| Append-only audit_logs | AO-01 | Required |
| Append-only consent_records | AO-02 | Required |
| Append-only stage_history | AO-03 | Required |
| Bulk partial failure — error CSV | B-01, B-02, B-03 | Required |
| Bulk idempotency | B-04 | Required |
| E2E: RM quick-create | E-01 | Required |
| E2E: QR public capture | E-02 | Required |
| E2E: inline field error | E-03 | Required |
| E2E: partner autocomplete conditional | E-04 | Required |
| PAN timing before_kyc allows absent | U-05 | Required |
| SQL invariant: stage=captured only | INV-01 | Required |
| SQL invariant: stage_history (null→captured) | INV-02 | Required |
| SQL invariant: source_attribution FK | INV-03 | Required |
| SQL invariant: lead_identity FK | INV-04 | Required |
| SQL invariant: lead_product_details stub | INV-05 | Required |
| SQL invariant: LEAD_CREATED outbox | INV-06 | Required |
| SQL invariant: audit lead_create | INV-07 | Required |
| SQL invariant: no duplicate customer_profile | INV-08 | Required |
| SQL invariant: DSA/Dealer partner_id set | INV-09 | Required |
| SQL invariant: version >= 1 | INV-10 | Required |

**Minimum required test count (Tier 2): 5 API integration tests, key journey E2E.** This spec defines 48 distinct test cases (13 unit + 31 API integration + 3 masking + 4 bulk + 4 E2E) and 10 SQL invariants, satisfying the Tier 2 floor and the mandatory coverage items from `testing-contract.md`.
