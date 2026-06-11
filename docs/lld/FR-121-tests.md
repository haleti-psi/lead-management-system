# FR-121 — NBFC Differentiator Reports: Test Specification
**Tier: 2 (Moderate)** | Source LLD: `docs/lld/FR-121.md`

All tests use **Jest + supertest** (API integration, `apps/api/test/reporting.e2e-spec.ts`) and **Jest** (unit, `apps/api/src/modules/reporting/reporting.service.spec.ts`). Frontend component tests use **Vitest + @testing-library/react** (`apps/web/src/components/reports/ReportViewer.test.tsx`). Test DB is Testcontainers-Postgres; Flyway migrations + bootstrap seed applied per run. No real external providers are called. Factories are in `apps/api/test/factories/`.

---

## Test Cases

| # | Type | Layer | Scenario | Setup | Expected result |
|---|---|---|---|---|---|
| T01 | Happy path | API | HEAD role retrieves `first_contact_sla` for org-wide scope | Seed: 10 leads (5 past first-contact stage, 3 SLA breached, 2 pending); HEAD JWT | 200; `data.code = 'first_contact_sla'`; `summary.contacted_in_sla` = 5; `summary.sla_breached` = 3; `summary.sla_compliance_pct` non-null; `meta.pagination` present |
| T02 | Happy path | API | BM role retrieves `kyc_doc_ageing` filtered to own branch | Seed: 8 leads in branch A, 4 in branch B with docs/stage_history rows; BM JWT scoped to branch A | 200; `rows` contain only branch A data; branch B leads absent from response |
| T03 | Happy path | API | `dsa_dealer_quality` returns ranked partner list with §12.4 factors | Seed: 2 active DSA partners with 15+ leads each; HEAD JWT | 200; `rows` has 2 entries; each has `quality_score`, `metrics`, `factors`; ordered desc by `quality_score` |
| T04 | Happy path | API | PARTNER role retrieves `contactability` report auto-bound to own partner | Seed: partner P1 and P2 with comm_log rows; PARTNER P1 JWT | 200; only P1 leads appear in rows; no P2 data |
| T05 | Happy path | API | `duplicate_leakage` returns grouped source/confidence breakdown | Seed: 10 `duplicate_matches` rows across 3 sources; HEAD JWT | 200; `rows` grouped by source and confidence; total matches reconcile to seeded count |
| T06 | Happy path | API | `handoff_failure` returns LOS failure breakdown | Seed: 7 `integration_logs` with `status=failed`, `integration=LOS`; HEAD JWT | 200; `rows` group by `error_code`; `summary.failure_count` = 7 |
| T07 | Happy path | API | `product_branch_heatmap` returns product × branch cross with conversion | Seed: 3 products × 2 branches, varied stages; HEAD JWT | 200; rows have `product_code`, `branch_id`, `volume`, `converted`, `rejected`; rates null when denominator = 0 |
| T08 | Happy path | API | `rm_capacity_load` returns RM workload with overdue task count | Seed: 3 RMs with open leads; 2 tasks `due_at < now()` for RM1; HEAD JWT | 200; RM1 row has `overdue_tasks` = 2; `active_leads` matches seeded count |
| T09 | Happy path | API | `consent_privacy_ops` returns consent_status breakdown + open rights requests | Seed: 6 leads with `consent_status` split across `pending/partial/captured`; 2 open `data_rights_requests`; DPO JWT | 200; `summary` shows counts per `consent_status`; `open_data_rights_requests` = 2 |
| T10 | Happy path | API | `source_roi` returns conversion rate per source; `cost_data_available: false` | Seed: leads across 3 sources with varying `stage`; HEAD JWT | 200; `rows` per source include `total_leads`, `converted`, `rejected`, `conversion_rate_pct`; `cost_data_available = false` on each row |
| T11 | Authz negative | API | Role without `reports` capability is denied | RM scoped to own leads attempts `first_contact_sla` without `reports`; Note: RM has reports=O per auth-matrix; test with `ADMIN` JWT (no `reports` capability on lead data) | 403 `FORBIDDEN` |
| T12 | Authz negative | API | PARTNER accesses another partner's report via `partner_id` filter | PARTNER P1 JWT; `partner_id=<P2 UUID>` query param | 403 `FORBIDDEN` |
| T13 | Authz negative | API | BM requests `branch_id` outside their scope | BM scoped to branch A; `branch_id=<branch B UUID>` filter | 403 `FORBIDDEN` |
| T14 | Authz negative | API | Unauthenticated request | No JWT | 401 `AUTH_REQUIRED` |
| T15 | Validation | API | Unknown report code | `GET /reports/not_a_real_code` | 400 `VALIDATION_ERROR`; `fields[0].field = 'code'` |
| T16 | Validation | API | `from` > `to` | `from=2026-06-09&to=2026-05-01` | 400 `VALIDATION_ERROR`; `fields` contains `from`/`to` pair |
| T17 | Validation | API | Invalid date format for `from` | `from=09-06-2026` (dd-MM-yyyy) | 400 `VALIDATION_ERROR`; `fields[0].field = 'from'` |
| T18 | Validation | API | `limit` = 101 | `limit=101` | 400 `VALIDATION_ERROR`; `fields[0].field = 'limit'` |
| T19 | Validation | API | Invalid UUID for `branch_id` | `branch_id=not-a-uuid` | 400 `VALIDATION_ERROR`; `fields[0].field = 'branch_id'` |
| T20 | Zero-denominator | Unit | Rate field returns `null` when denominator is 0 | Call `computeSlaCompliance({ totalLeads: 0, pending: 0 })` | Returns `{ sla_compliance_pct: null }`; not `0` or `NaN` |
| T21 | Zero-denominator | Unit | Contactability rate is `null` when no comm attempts | `computeContactabilityRate({ totalAttempts: 0, delivered: 0 })` | Returns `{ contactability_rate_pct: null }` |
| T22 | Zero-denominator | Unit | Source ROI conversion rate `null` when no leads | `computeConversionRate({ total: 0, converted: 0 })` | Returns `{ conversion_rate_pct: null }` |
| T23 | Reconciliation | API | Reconciliation block always present | Any successful report | `data.reconciliation.numerator` and `data.reconciliation.denominator` are integers; rate = numerator / denominator matches `summary.*_pct` (within float epsilon) |
| T24 | Reconciliation | Unit | §12.5: rates recomputed from summed numerator/denominator, not averaged | Three groups with rates [50%, 75%, 100%]; correct total = (sum_numerators)/(sum_denominators) | Returned rate equals correct summed fraction, not average of rates |
| T25 | Async threshold | API | Large result set triggers 202 async response | Configure threshold = 1; seed 2 leads | 202; `data.export_endpoint = 'POST /api/v1/exports'`; `data.suggested_body.report_code` matches requested code |
| T26 | Async threshold | API | Result under threshold returns 200 synchronously | Configure threshold = 10000; seed 5 leads | 200; normal report payload; `meta.async_threshold_hit = false` |
| T27 | DPO scope | API | DPO can access `consent_privacy_ops` with masked PII | DPO JWT; `consent_privacy_ops` code | 200; lead-level identifiers (if any) are masked per `MaskingService` |
| T28 | DPO authz | API | DPO is denied a non-compliance report (e.g. `rm_capacity_load`) | DPO JWT; `rm_capacity_load` code | 403 `FORBIDDEN` |
| T29 | Scope filtering | API | `from`/`to` window excludes leads outside the date range | Seed: 3 leads created before `from`; 5 within window | 200; `summary.total_leads_in_scope` = 5; no out-of-window leads in rows |
| T30 | Pagination | API | Second page returns next batch of rows | Seed: 30 partner rows for `dsa_dealer_quality`; `page=2&limit=10` | 200; `data.rows` has 10 items; `meta.pagination.page = 2`; row ids do not overlap with page 1 |
| T31 | Pagination | API | `limit` defaults to 25 when not supplied | Seed: 30 rows | 200; `data.rows.length` ≤ 25; `meta.pagination.limit = 25` |
| T32 | DSA quality formula | Unit | §12.4 formula computed correctly | Mock `PartnerQualityService.computeScoreBatch` returning fixture; assert `ReportingService` passes correct `partnerIds` and `window` | Service calls `partnerQualityService.computeScoreBatch` with correct args; returned rows include `quality_score` from mock |
| T33 | DSA quality delegation | Unit | Formula is not duplicated in `ReportingService` | Code review: `ReportingService.dsaDealerQualityReport` must call `PartnerQualityService.computeScoreBatch`, not recompute factors | No §12.4 formula logic (`contactability_index`, etc.) exists in `reporting.service.ts` |
| T34 | Masking | API | PII fields masked per role in response | HEAD JWT requests `rm_capacity_load`; response includes RM `full_name` (non-PII) but not mobile/PAN | Mobile and PAN fields absent from aggregate response rows; `full_name` present |
| T35 | Rate limit | API | Reports endpoint enforces reads rate limit (300/min) | Send 301 requests in 60 s from same user | 429 `RATE_LIMITED` on 301st request; `Retry-After` header present |
| T36 | INTERNAL_ERROR | API | DB failure returns `INTERNAL_ERROR` (500) | Mock `Db` to throw an uncaught error during aggregate query | 500 `INTERNAL_ERROR`; no stack trace / SQL in response; error logged server-side with `correlation_id` |
| T37 | SM scope | API | SM retrieves `first_contact_sla` for own team only | Seed: 6 leads, 3 in team A (SM), 3 in team B; SM JWT for team A | 200; only team A leads contribute to `summary` counts |
| T38 | PARTNER own scope | API | PARTNER retrieves `dsa_dealer_quality`; sees only own partner row | Seed: 2 partners; PARTNER P1 JWT | 200; `data.rows` has 1 entry matching P1's `partner_id` |

---

## SQL Invariant Queries

Run after each API write-path test to verify no unexpected mutations occurred. FR-121 is read-only; all of these must return 0 rows.

```sql
-- INV-1: No new lead rows created during a reporting request
SELECT COUNT(*) FROM leads
WHERE created_at > :test_start_ts;
-- expect: 0

-- INV-2: No stage_history rows written during a reporting request
SELECT COUNT(*) FROM stage_history
WHERE created_at > :test_start_ts;
-- expect: 0

-- INV-3: No audit_logs rows written by the reporting module
SELECT COUNT(*) FROM audit_logs
WHERE created_at > :test_start_ts
  AND action NOT IN ('report_viewed');  -- report_viewed is NOT emitted by FR-121 (no audit write spec'd)
-- expect: 0

-- INV-4: No event_outbox rows created during a reporting request
SELECT COUNT(*) FROM event_outbox
WHERE created_at > :test_start_ts;
-- expect: 0

-- INV-5: partners.quality_score not changed by ReportingService directly
-- (only PartnerQualityService is the writer; check no direct UPDATE from reporting module)
-- Seed: record partners.quality_score before test; verify unchanged after
SELECT COUNT(*) FROM partners
WHERE updated_at > :test_start_ts
  AND updated_by = :test_user_id;  -- reporting controller user
-- expect: 0
```

---

## UI Test Scenarios

| # | Tool | Scenario | Expected |
|---|---|---|---|
| U01 | Vitest / Testing Library | `ReportViewer` renders `LoadingSkeleton` while query is in-flight | `LoadingSkeleton` present; no table rows yet |
| U02 | Vitest / Testing Library | `ReportViewer` renders `EmptyState` when `data.rows = []` | `EmptyState` component visible; `DataTable` absent |
| U03 | Vitest / Testing Library | `ReportViewer` renders `ErrorState` when API returns `INTERNAL_ERROR` | `ErrorState` visible with user-facing message; no stack trace |
| U04 | Vitest / Testing Library | Null rate (`null`) renders as `"–"` in `DataTable` cell | Cell text is `"–"`, not `"0%"`, `"null"`, or empty |
| U05 | Vitest / Testing Library | `AsyncThresholdBanner` is shown when `meta.async_threshold_hit = true` | Banner visible with link/button pointing to export screen |
| U06 | Vitest / Testing Library | `ProductBranchHeatmap` falls back to `DataTable` when `low-bandwidth` mode active | Chart element absent; `DataTable` visible with same data |
| U07 | Vitest / Testing Library | PARTNER role — `PartnerSelector` is hidden in `ReportFilterBar` | Selector element not rendered in DOM for PARTNER role |
| U08 | Vitest / Testing Library | Submitting invalid `from` > `to` date range shows inline error | Error message "from must not be after to." visible; form not submitted |

---

## Coverage Checklist

| Requirement | Covered by |
|---|---|
| Happy path — all 10 report codes return 200 with correct structure | T01–T10 |
| `AUTH_REQUIRED` (401) raised when no JWT | T14 |
| `FORBIDDEN` (403) — role has no `reports` capability | T11 |
| `FORBIDDEN` (403) — PARTNER cross-scope | T12 |
| `FORBIDDEN` (403) — BM out-of-scope branch filter | T13 |
| `FORBIDDEN` (403) — DPO accessing non-compliance report | T28 |
| `VALIDATION_ERROR` (400) — unknown report code | T15 |
| `VALIDATION_ERROR` (400) — `from` > `to` | T16 |
| `VALIDATION_ERROR` (400) — invalid date format | T17 |
| `VALIDATION_ERROR` (400) — `limit` > 100 | T18 |
| `VALIDATION_ERROR` (400) — invalid UUID filter | T19 |
| `INTERNAL_ERROR` (500) — unhandled DB error | T36 |
| `RATE_LIMITED` (429) | T35 |
| Zero-denominator → `null` (not 0%) per §12.5 | T20–T22, U04 |
| §12.5 reconciliation block always present and correct | T23, T24 |
| §12.5 rates from summed numerators/denominators, not averaged | T24 |
| Async threshold: 202 when result too large | T25, T26 |
| Scope filtering: BM/SM/RM/PARTNER see only their data | T02, T04, T13, T37, T38 |
| Date window filtering works correctly | T29 |
| Pagination — page 2, default limit | T30, T31 |
| `dsa_dealer_quality` delegates to `PartnerQualityService` (no formula duplication) | T32, T33 |
| PII masking in response | T27, T34 |
| DPO consent report access allowed | T09, T27 |
| Read-only — no writes to DB during report fetch | INV-1 to INV-5 |
| UI loading / empty / error / null-rate states | U01–U04 |
| UI async threshold banner | U05 |
| UI low-bandwidth chart fallback | U06 |
| UI PARTNER role hides partner filter selector | U07 |
| UI date range validation feedback | U08 |
