# FR-120 Test Specification: Core Report Pack

**Tier: 2**
**Source LLD:** `docs/lld/FR-120.md`

---

## Test Cases

| # | Layer | Name | Description | Expected result |
|---|---|---|---|---|
| T-01 | Unit | Happy path — funnel conversion, HEAD scope | `buildFunnelConversionReport` with no filters, HEAD user, full org scope | Returns rows grouped by `product_code`; every percentage field is either a one-decimal string or `"–"` when denominator = 0; `active_pipeline = captured - handed_off - rejected` |
| T-02 | Unit | Zero-denominator rule | One product has `captured = 0` | `overall_conversion_pct = "–"`, `kyc_conversion_pct = "–"` (not `"0"` or `NaN`) |
| T-03 | Unit | Scope enforcement — RM forced to own leads | `resolveScope` called with RM user; no filters | Scope WHERE adds `owner_id = user.userId`; returned rows only contain leads owned by that RM |
| T-04 | Unit | Scope enforcement — BM branch | `resolveScope` called with BM user | Scope WHERE adds `branch_id = user.branchId` |
| T-05 | Unit | Scope enforcement — RM passes wrong `owner_id` | RM sends `owner_id` of another user | `resolveScope` throws `FORBIDDEN` (403) |
| T-06 | Unit | Scope enforcement — PARTNER passes another partner's `partner_id` | PARTNER user sends a different `partner_id` | `resolveScope` throws `FORBIDDEN` (403) |
| T-07 | Unit | Invalid report code | `code = "invalid_code"` | Zod schema rejects; `VALIDATION_ERROR` 400 with `fields[{field:"code"}]` |
| T-08 | Unit | Date range inversion | `from = "2026-06-01"`, `to = "2026-05-01"` | `VALIDATION_ERROR` 400, field `from` or `to` |
| T-09 | Unit | source_performance — groups by source | `buildSourcePerformanceReport` with period filter | Rows grouped by `lead_source` enum; `handed_off / captured` = `source_conversion_pct` |
| T-10 | Unit | rejection_summary — groups by primary_reason and sub_reason | `buildRejectionSummaryReport` with scope filter | Rows keyed by `primary_reason + sub_reason`; includes only leads with `stage = 'rejected'` |
| T-11 | API | Happy path — funnel_conversion, authenticated HEAD | `GET /api/v1/reports/funnel_conversion?from=2026-05-01&to=2026-05-31` | 200, envelope `data.rows` non-empty, `meta.pagination` present |
| T-12 | API | Happy path — source_performance, BM | `GET /api/v1/reports/source_performance` with BM JWT | 200; rows contain only sources for the BM's branch |
| T-13 | API | Happy path — rm_performance, SM | `GET /api/v1/reports/rm_performance` with SM JWT | 200; rows contain only RMs in the SM's team |
| T-14 | API | Happy path — rejection_summary | `GET /api/v1/reports/rejection_summary` with HEAD JWT | 200; rows grouped by `primary_reason` |
| T-15 | API | Unauthenticated request | No `Authorization` header | 401 `AUTH_REQUIRED` |
| T-16 | API | ADMIN role blocked | Authenticated ADMIN JWT | 403 `FORBIDDEN` — ADMIN has no `reports` capability |
| T-17 | API | CUSTOMER role blocked | Authenticated CUSTOMER JWT | 403 `FORBIDDEN` |
| T-18 | API | RM tries to fetch another RM's data via `owner_id` | RM JWT + `?owner_id=<other_rm_id>` | 403 `FORBIDDEN` |
| T-19 | API | BM tries to pass a different `branch_id` | BM JWT + `?branch_id=<other_branch_id>` | 403 `FORBIDDEN` |
| T-20 | API | Invalid `code` path param | `GET /api/v1/reports/made_up_code` | 400 `VALIDATION_ERROR`, `fields[{field:"code"}]` |
| T-21 | API | Invalid `product_code` enum value | `?product_code=NotARealProduct` | 400 `VALIDATION_ERROR`, `fields[{field:"product_code"}]` |
| T-22 | API | `from` after `to` | `?from=2026-06-15&to=2026-06-01` | 400 `VALIDATION_ERROR` |
| T-23 | API | `limit` exceeds max | `?limit=200` | 400 `VALIDATION_ERROR`, `fields[{field:"limit"}]` |
| T-24 | API | Pagination metadata | `?page=2&limit=3` with 7 total rows | `meta.pagination = {page:2, limit:3, total:7}` |
| T-25 | API | Query timeout | Report repository method artificially delayed beyond `REPORT_TIMEOUT_MS` | 500 `INTERNAL_ERROR`; no stack trace in response body |

---

## SQL Invariant Queries

Run after each API integration test to confirm no writes occurred (all expect 0 rows changed).

```sql
-- INV-01: no stage_history rows written during any report fetch (zero writes expected)
SELECT count(*) FROM stage_history
WHERE created_at > now() - interval '5 seconds';
-- Expected: 0

-- INV-02: no audit_log rows written during any report fetch
SELECT count(*) FROM audit_logs
WHERE created_at > now() - interval '5 seconds';
-- Expected: 0

-- INV-03: no event_outbox rows written during any report fetch
SELECT count(*) FROM event_outbox
WHERE created_at > now() - interval '5 seconds';
-- Expected: 0

-- INV-04: leads rows are not mutated (version unchanged) for any lead touched by the report scope
SELECT count(*) FROM leads
WHERE updated_at > now() - interval '5 seconds';
-- Expected: 0

-- INV-05: reconciliation check — for a given period and scope, captured = active_pipeline + rejected + handed_off
-- (Run with the same org_id / branch_id / period as the test fixture)
SELECT
  COUNT(*) FILTER (WHERE stage NOT IN ('handed_off', 'rejected') AND deleted_at IS NULL)
    + COUNT(*) FILTER (WHERE stage = 'rejected')
    + COUNT(*) FILTER (WHERE stage = 'handed_off')
  - COUNT(*) FILTER (WHERE deleted_at IS NULL)
AS reconciliation_delta
FROM leads
WHERE org_id = '00000000-0000-0000-0000-000000000001'
  AND created_at BETWEEN '2026-05-01' AND '2026-05-31 23:59:59';
-- Expected: 0 (captured = active + rejected + handed_off per §12.5)
```

---

## UI Test Scenarios

| # | Tool | Scenario | Steps | Expected |
|---|---|---|---|---|
| U-01 | Vitest + Testing-Library | ReportFilterBar renders scope-appropriate controls | Mount with HEAD session | All filter controls rendered |
| U-02 | Vitest + Testing-Library | ReportFilterBar hides branch/team/owner selects for RM | Mount with RM session | `BranchSelect`, `TeamSelect`, `OwnerSelect` not in DOM |
| U-03 | Vitest + Testing-Library | DataTable shows "–" for zero-denominator cells | Pass row with `overall_conversion_pct: "–"` | Cell renders literal `–` string, not empty or 0 |
| U-04 | Vitest + Testing-Library | LoadingSkeleton shown while query in-flight | Mock query in pending state | `LoadingSkeleton` present; `DataTable` absent |
| U-05 | Vitest + Testing-Library | EmptyState shown when rows = [] | Mock query returning `data.rows: []` | `EmptyState` present; `DataTable` absent |
| U-06 | Vitest + Testing-Library | ErrorState shown on FORBIDDEN | Mock query returning 403 | `ErrorState` rendered with appropriate message |
| U-07 | Playwright | Full funnel_conversion report journey (HEAD) | Login as HEAD → navigate to /reports → select funnel_conversion → set date range → Apply | Table loads; rows present; pagination controls functional |
| U-08 | Playwright | RM sees only own data | Login as RM → navigate to /reports → select rm_performance | Single row for RM; no other-RM data visible |

---

## Coverage Checklist

- [x] Happy path for each of the four report codes (T-01, T-09, T-10, T-11 – T-14)
- [x] `AUTH_REQUIRED` (401) when unauthenticated (T-15)
- [x] `FORBIDDEN` (403) — role has no `reports` capability (T-16, T-17)
- [x] `FORBIDDEN` (403) — scope violation via `owner_id`, `branch_id`, `partner_id` (T-05, T-06, T-18, T-19)
- [x] `VALIDATION_ERROR` (400) — invalid `code` path param (T-07, T-20)
- [x] `VALIDATION_ERROR` (400) — date range inversion (T-08, T-22)
- [x] `VALIDATION_ERROR` (400) — invalid enum value (T-21)
- [x] `VALIDATION_ERROR` (400) — `limit` out of range (T-23)
- [x] `INTERNAL_ERROR` (500) — query timeout (T-25)
- [x] Zero-denominator rule returns `"–"` (T-02, U-03)
- [x] Pagination metadata correct (T-24)
- [x] Scope enforcement: RM scope O, BM scope B, SM scope T (T-03, T-04, T-12, T-13)
- [x] No writes (stage_history / audit_logs / event_outbox / leads) during any fetch (INV-01 – INV-04)
- [x] Reconciliation: captured = active + rejected + handed_off for same period/scope (INV-05)
- [x] UI loading/empty/error states (U-04, U-05, U-06)
- [x] UI scope-aware filter rendering (U-01, U-02)
- [x] E2E full journey (U-07, U-08)

### Authz negative summary

| Caller | Attempted action | Expected |
|---|---|---|
| Unauthenticated | GET /reports/funnel_conversion | 401 |
| ADMIN | GET /reports/funnel_conversion | 403 |
| CUSTOMER | GET /reports/funnel_conversion | 403 |
| RM | GET /reports/rm_performance?owner_id=\<other\> | 403 |
| BM | GET /reports/funnel_conversion?branch_id=\<other\> | 403 |
| PARTNER | GET /reports/source_performance?partner_id=\<other\> | 403 |
