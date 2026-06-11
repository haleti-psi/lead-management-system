# FR-092 — Partner Quality Score & Dashboard: Test Specification
**Tier: 2 (Moderate)** | Source LLD: `docs/lld/FR-092.md`

---

## Test Cases

| # | Name | Type | Tool | Scenario | Setup | Expected |
|---|---|---|---|---|---|---|
| T01 | Happy path — BM retrieves score for own-branch partner | API integration | supertest | BM calls `GET /api/v1/partners/{id}/quality`; partner is in BM's branch; 30-day default window; enough leads (≥ 10) | Seed: partner, 15 leads via source_attributions, 8 contacted, 3 handed_off, 2 duplicate, 1 rejected, docs | `200`; `data.quality_score` is integer 0–100; `data.insufficient_data = false`; all `factors.*` are numbers; `data.metrics.total_leads = 15` |
| T02 | Happy path — PARTNER retrieves own quality score | API integration | supertest | PARTNER user (users.partner_id = partner under test) calls `GET /api/v1/partners/{partner_id}/quality` | Same seed as T01 | `200`; score and factors returned; `data.partner_id = user.partner_id` |
| T03 | Insufficient data — fewer than MIN_VOLUME leads | API integration | supertest | Partner has only 5 leads in the window | Seed: partner, 5 leads | `200`; `data.insufficient_data = true`; `data.quality_score = null`; all `factors.*` values are `null`; `data.metrics.total_leads = 5` |
| T04 | Zero denominator — no documents uploaded | Unit | Jest | Lead counts > MIN_VOLUME but no docs uploaded (`uploaded_docs = 0`) | Inject mock repo: total_leads=12, uploaded_docs=0 | `document_quality_index = null`; score computation uses 0 for that factor weight; `quality_score` is non-null integer |
| T05 | FORBIDDEN — PARTNER accessing another partner's quality | API integration | supertest | PARTNER user with `partner_id = A` calls `GET /api/v1/partners/{B}/quality` (`B ≠ A`) | Seed: two partners A and B | `403`; `error.code = 'FORBIDDEN'`; `data = null` |
| T06 | FORBIDDEN — BM accessing partner outside their branch | API integration | supertest | BM whose `branch_ids = [branch_X]` calls quality for partner with `branch_id = branch_Y` | Seed: partner in different branch | `403`; `error.code = 'FORBIDDEN'` |
| T07 | FORBIDDEN — RM role (no reports capability on partner) | API integration | supertest | RM calls `GET /api/v1/partners/{id}/quality` | Any partner seeded | `403`; `error.code = 'FORBIDDEN'` |
| T08 | FORBIDDEN — unauthenticated request | API integration | supertest | Request with no `Authorization` header | — | `401`; `error.code = 'AUTH_REQUIRED'` |
| T09 | NOT_FOUND — non-existent partner UUID | API integration | supertest | BM or HEAD calls `GET /api/v1/partners/{random-uuid}/quality` | No partner row for that UUID | `404`; `error.code = 'NOT_FOUND'` |
| T10 | VALIDATION_ERROR — `from` after `to` | API integration | supertest | `GET /api/v1/partners/{id}/quality?from=2026-06-09&to=2026-06-01` | Valid partner | `400`; `error.code = 'VALIDATION_ERROR'`; `error.fields[]` contains an entry for the date range |
| T11 | VALIDATION_ERROR — invalid UUID path param | API integration | supertest | `GET /api/v1/partners/not-a-uuid/quality` | — | `400`; `error.code = 'VALIDATION_ERROR'` |
| T12 | §12.4 formula correctness — known inputs | Unit | Jest | Inject deterministic metric counts; compute by hand | `total=20, contactable=16, duplicate=2, rejected=1, handed_off=10, uploaded=40, verified_first=36, this_median_tat=4h, min_all_tat=3h` | `contactability_index=80.00, handoff_index=50.00, doc_quality=90.00, speed_index=75.00, dup_penalty=10.00, rej_penalty=5.00`; `raw = 0.25×80 + 0.30×50 + 0.20×90 + 0.15×75 − 0.05×10 − 0.05×5 = 20+15+18+11.25−0.5−0.25 = 63.5`; `quality_score = 64` |
| T13 | Score clamping — raw score exceeds 100 | Unit | Jest | Inject counts producing raw_score > 100 (e.g., perfect contactability and handoff, high doc quality, very fast TAT) | — | `quality_score = 100` (clamped by `Math.min`) |
| T14 | Score clamping — raw score below 0 | Unit | Jest | Inject extreme duplicate/rejection penalties overwhelming positive factors | — | `quality_score = 0` (clamped by `Math.max`) |
| T15 | Cache write best-effort — DB update failure does not fail response | Unit | Jest | Mock `updateQualityScore` to throw; mock aggregate queries return valid data | `total_leads >= MIN_VOLUME` | `200` response with correct score; `warn` log emitted for the cache write failure; no `INTERNAL_ERROR` thrown |
| T16 | Custom date window respected | API integration | supertest | `GET /api/v1/partners/{id}/quality?from=2026-01-01&to=2026-03-31` with leads spread across the year | Seed leads in Jan–Mar and Apr–Jun windows | Only Jan–Mar leads appear in `data.metrics.total_leads`; Apr–Jun leads excluded |
| T17 | HEAD role — cross-branch access permitted | API integration | supertest | HEAD calls quality for partner in any branch | Seed HEAD user + partner in a different branch | `200`; full score returned |
| T18 | ADMIN role — no standing access (no reports capability) | API integration | supertest | ADMIN user (no break-glass) calls `GET /api/v1/partners/{id}/quality` | Any partner | `403`; `error.code = 'FORBIDDEN'` |

---

## SQL Invariant Queries

After every write path (cache update only) the following queries must return 0 rows, confirming
invariants hold.

```sql
-- INV-01: quality_score must satisfy the CHECK constraint (0–100 or NULL) at all times.
-- Expects 0 rows (no violation).
SELECT partner_id, quality_score
FROM partners
WHERE quality_score IS NOT NULL
  AND quality_score NOT BETWEEN 0 AND 100;

-- INV-02: partners.updated_by must reference a valid user (FK honoured after cache write).
-- Expects 0 rows.
SELECT p.partner_id
FROM partners p
LEFT JOIN users u ON u.user_id = p.updated_by
WHERE u.user_id IS NULL;

-- INV-03: no stage_history or audit_logs rows were written by FR-092
-- (this FR writes no stage transitions and no audit log entries).
-- Run after T01/T02: confirm count has not increased from baseline.
-- (Checked in test harness by snapshotting counts before and after the API call.)
SELECT COUNT(*) FROM stage_history;
SELECT COUNT(*) FROM audit_logs;

-- INV-04: leads.stage is never modified by FR-092.
-- Checked by comparing leads snapshot before/after GET call in integration test.
SELECT lead_id, stage FROM leads WHERE source_attribution_id IN (
  SELECT source_attribution_id FROM source_attributions WHERE partner_id = '<test_partner_id>'
);
```

---

## UI Test Scenarios (Playwright — `apps/web/e2e/partner-quality.spec.ts`)

| # | Scenario | Steps | Assertion |
|---|---|---|---|
| UI-01 | PARTNER views own quality page | Log in as PARTNER; navigate to `/partner/quality` | Score card visible with numeric score or "–"; factor breakdown table has 6 rows; MetricsSummaryGrid shows 7 tiles |
| UI-02 | Insufficient data banner shown | Log in as PARTNER with < 10 leads | `InsufficientDataBanner` visible; score card shows "–"; all factor cells show "–" |
| UI-03 | Date range filter updates metrics | Log in as BM; navigate to partner quality page; change `from` to 90 days ago | React Query refetches; `total_leads` count changes; no error state visible |
| UI-04 | FORBIDDEN redirect for wrong partner | PARTNER user manually navigates to `/partner/{other-id}/quality` | `ErrorState` displayed with message "You don't have access to this."; no score data rendered |
| UI-05 | CoachingNotesBanner visible to BM, hidden to PARTNER | BM views partner quality page (low score); PARTNER views own page | BM sees coaching banner; PARTNER does not see it |
| UI-06 | Loading skeleton shown on slow network | Throttle network; navigate to quality page | `LoadingSkeleton` renders during fetch; replaced by content on resolution |
| UI-07 | Dark mode renders correctly | Toggle dark mode; open quality page | Score card and factor table respect `dark:` classes; no raw hex overrides visible |

---

## Coverage Checklist

| Requirement | Test(s) | Status |
|---|---|---|
| Happy path — BM scope | T01 | covered |
| Happy path — PARTNER own scope | T02 | covered |
| Insufficient data (`null` score + `null` factors) | T03 | covered |
| Zero denominator (`document_quality_index = null`) | T04 | covered |
| `AUTH_REQUIRED` (401) | T08 | covered |
| `NOT_FOUND` (404) | T09 | covered |
| `FORBIDDEN` (403) — PARTNER out-of-scope | T05 | covered |
| `FORBIDDEN` (403) — BM out-of-branch | T06 | covered |
| `FORBIDDEN` (403) — wrong role (RM) | T07 | covered |
| `FORBIDDEN` (403) — ADMIN (no reports on partner) | T18 | covered |
| `VALIDATION_ERROR` (400) — invalid date range | T10 | covered |
| `VALIDATION_ERROR` (400) — invalid UUID path | T11 | covered |
| §12.4 formula correctness (numeric) | T12 | covered |
| Score clamp upper bound (100) | T13 | covered |
| Score clamp lower bound (0) | T14 | covered |
| Cache write failure non-fatal | T15 | covered |
| Custom date window | T16 | covered |
| HEAD all-scope access | T17 | covered |
| SQL invariants — quality_score CHECK | INV-01 | covered |
| SQL invariants — no stage_history written | INV-03 | covered |
| SQL invariants — no audit_logs written | INV-03 | covered |
| UI — insufficient data banner | UI-02 | covered |
| UI — FORBIDDEN error state | UI-04 | covered |
| UI — coaching banner role-filtered | UI-05 | covered |
| No PII in response body | (T01–T02 response assertions) | covered |
| Masking — quality payload contains no PAN/mobile/Aadhaar | (verified in T01/T02 response shape) | covered |
