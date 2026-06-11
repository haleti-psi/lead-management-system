# FR-053 — Role-Based Dashboard & Home (Test Specification)

**Tier: 2 (Moderate)**
**Source LLD:** `docs/lld/FR-053.md`

---

## Test Cases

Minimum required for Tier 2: ≥ 5 cases. This specification defines 14 cases covering all error codes the FR can raise, both authz directions, validation, widget degradation, scope isolation, PII masking, and cache behaviour.

| # | Test name | Layer | Scenario | Input | Expected outcome |
|---|---|---|---|---|---|
| TC-01 | Happy path — BM receives full widget set | API integration | Authenticated BM makes `GET /dashboard` with no query params | JWT for BM role, branch has 5 active leads, 2 SLA-breached, 1 hot lead, 3 open tasks, 2 source rows, 1 failed hand-off | 200; `data.widgets.kpi.active_pipeline = 5`; `sla_alerts` has 2 entries; `hot_leads` has 1 entry; `my_tasks` has 3 entries; `handoff_failures.count = 1`; `widget_errors` is empty; envelope `error: null` |
| TC-02 | Happy path — RM sees only own-scoped data | API integration | Two RMs exist; RM-A has 3 leads; RM-B has 5 leads | JWT for RM-A | 200; `kpi.active_pipeline = 3` (RM-B's leads not included); `hot_leads` and `sla_alerts` contain only RM-A's leads; `my_tasks` contains only tasks where `owner_id = RM-A.user_id` |
| TC-03 | Authz negative — PARTNER role is FORBIDDEN | API integration | PARTNER user calls `GET /dashboard` | Valid JWT for PARTNER role | 403 `FORBIDDEN`; `data: null`; no widget data leaked |
| TC-04 | Authz negative — ADMIN role is FORBIDDEN | API integration | ADMIN user calls `GET /dashboard` | Valid JWT for ADMIN role | 403 `FORBIDDEN`; `data: null` (ADMIN has no `reports` capability for lead content per auth-matrix) |
| TC-05 | AUTH_REQUIRED — expired JWT | API integration | Request with expired JWT | `Authorization: Bearer <expired_token>` | 401 `AUTH_REQUIRED`; uniform error envelope |
| TC-06 | VALIDATION_ERROR — both `branch_id` and `team_id` supplied | API integration | Valid JWT for HEAD; both scope override params present | `?branch_id=<uuid>&team_id=<uuid>` | 400 `VALIDATION_ERROR`; `fields[0].field = "branch_id"` or `"team_id"`; message "Provide branch_id or team_id, not both." |
| TC-07 | VALIDATION_ERROR — `as_of` in the future | API integration | Valid JWT for HEAD | `?as_of=2099-01-01T00:00:00Z` | 400 `VALIDATION_ERROR`; `fields[0].field = "as_of"`; message includes "must not be a future timestamp" |
| TC-08 | FORBIDDEN — scope override out of caller's entitlement | API integration | BM from Branch-A attempts to use `branch_id` of Branch-B | JWT for BM (Branch-A); `?branch_id=<Branch-B uuid>` | 403 `FORBIDDEN`; no widget data |
| TC-09 | Widget-level degradation — one DB query fails | API integration | Mock `dashboard.repository.getHandoffFailures` to throw; all other queries succeed | JWT for BM | 200 overall; `widgets.handoff_failures = null`; `widget_errors` contains `{ widget: "handoff_failures", error_code: "INTERNAL_ERROR" }`; all other widgets populated normally |
| TC-10 | RATE_LIMITED — read throttle exceeded | API integration | Make 301 requests within one minute for the same user | JWT for RM; 301 rapid `GET /dashboard` calls | 301st request → 429 `RATE_LIMITED`; `Retry-After` header present |
| TC-11 | PII masking — DPO scope receives masked fields | API integration | DPO user calls `GET /dashboard` | Valid JWT for DPO | 200; all `name_masked` and `mobile_masked` fields in `hot_leads` and `sla_alerts` are masked (e.g. `"Am***** P****"`, `"98xxxxxx21"`); no raw `mobile` or `name` values present in response body |
| TC-12 | Cache hit — second request within TTL returns cached payload | API integration | BM calls `GET /dashboard` twice within 60 s | JWT for BM; same request twice | First response: `cache_hit: false`; second response: `cache_hit: true`; `data` object identical; DB query count on second request = 0 (verified via mock/spy) |
| TC-13 | Redis unavailable — graceful fallback to live DB | Unit | `RedisService.get` throws; DB queries succeed | JWT for BM | 200; `cache_hit: false`; widget data populated from DB; no 503; Redis error logged at `warn` level |
| TC-14 | Empty state — new user, no data | API integration | Fresh RM user with no leads, tasks, or attribution rows | JWT for new RM | 200; all KPI counts = 0; `sla_alerts = []`; `hot_leads = []`; `my_tasks = []`; `source_summary = []`; `handoff_failures.count = 0`; response still valid envelope (no nulls in top-level fields) |

---

## Unit Tests (`dashboard.service.spec.ts`)

### DashboardService — scope resolution

```
describe('DashboardService.resolveScope')
  it('resolves O scope for RM role')
  it('resolves B scope for BM role from user.branchIds')
  it('resolves T scope for SM role from user.teamIds')
  it('resolves A scope for HEAD role')
  it('throws FORBIDDEN when branch_id override is outside BM scope')
  it('throws FORBIDDEN when team_id override is outside SM scope')
  it('throws VALIDATION_ERROR when both branch_id and team_id supplied')
```

### DashboardService — widget assembly with Promise.allSettled

```
describe('DashboardService.getWidgets')
  it('returns full widget payload when all queries succeed')
  it('populates widget_errors when getHandoffFailures rejects; other widgets unaffected')
  it('populates widget_errors for multiple failed widgets; response still 200-shaped')
  it('returns cache_hit=true on second call within TTL (Redis mock returns cached value)')
  it('falls back to DB when RedisService.get throws; logs warn')
```

### DashboardRepository — scope predicate helper

```
describe('applyScopeFilter')
  it('adds WHERE owner_id = userId for RM scope')
  it('adds WHERE team_id IN teamIds for SM scope')
  it('adds WHERE branch_id IN branchIds for BM scope')
  it('adds no predicate for HEAD scope (org-wide)')
```

---

## API Integration Tests (`dashboard.e2e-spec.ts`)

Uses Jest + Supertest + Testcontainers-Postgres. Each test seeds its own isolated data via factories (`apps/api/test/factories/`).

### Auth & authz

```
describe('GET /api/v1/dashboard — auth')
  it('returns 401 AUTH_REQUIRED when no JWT provided')
  it('returns 401 AUTH_REQUIRED when JWT is expired')
  it('returns 403 FORBIDDEN for PARTNER role')
  it('returns 403 FORBIDDEN for ADMIN role')
  it('returns 403 FORBIDDEN for CUSTOMER role')
  it('returns 200 for RM role')
  it('returns 200 for BM role')
  it('returns 200 for SM role')
  it('returns 200 for HEAD role')
```

### Validation

```
describe('GET /api/v1/dashboard — validation')
  it('returns 400 VALIDATION_ERROR when both branch_id and team_id are supplied')
  it('returns 400 VALIDATION_ERROR when as_of is a future timestamp')
  it('returns 400 VALIDATION_ERROR when branch_id is not a valid UUID')
  it('returns 403 FORBIDDEN when branch_id is outside BM scope')
```

### Scope isolation

```
describe('GET /api/v1/dashboard — scope isolation')
  it('RM-A cannot see RM-B leads in kpi.active_pipeline')
  it('BM-Branch-A cannot see leads from Branch-B')
  it('SM sees only team leads in kpi counts')
  it('HEAD sees all-org kpi counts')
```

### Widget correctness & reconciliation

```
describe('GET /api/v1/dashboard — widget correctness')
  it('kpi.active_pipeline excludes handed_off and rejected leads')
  it('kpi.sla_breached counts only first_contact_pending leads past sla_first_contact_due_at')
  it('sla_alerts returns max 10 entries ordered by sla_first_contact_due_at asc')
  it('hot_leads returns max 10 entries ordered by score desc')
  it('my_tasks returns only tasks with status in [open, in_progress, overdue]')
  it('source_summary covers last 30 days only')
  it('kpi counts reconcile with GET /leads counts for same scope (§12.5 rule)')
```

### Widget degradation

```
describe('GET /api/v1/dashboard — widget degradation')
  it('returns 200 with widget_errors when one query fails')
  it('sets failed widget key to null in response payload')
  it('all other widgets populate normally when one fails')
```

---

## UI Test Scenarios

### Frontend unit tests (`DashboardPage.test.tsx`, Vitest + Testing-Library)

| Scenario | Assertion |
|---|---|
| Loading state | `LoadingSkeleton` renders for each of the 6 widget card positions while `isLoading = true` |
| Empty state | When all KPI counts are 0, `EmptyState` with "Welcome, set up your first lead" and CTA renders |
| Widget error state | When `widget_errors` contains an entry for `handoff_failures`, `WidgetErrorState` renders inside the HandoffFailureWidget card |
| PII masking in UI | `MaskedField` component receives `name_masked` and `mobile_masked`; no raw name/mobile in rendered DOM |
| Role-based widget visibility | For RM role: `HandoffFailureWidget` and `SourceSummaryWidget` are not rendered; `SlaAlertWidget` is rendered |
| Drill-through links | Each KPI card renders a `<Link>` with the correct filter query string per the LLD drill-through table |
| Low-bandwidth source summary | When `useLowBandwidth()` returns `true`, `MiniChart` is replaced by a `<table>` |
| 403 redirect | When API returns 403, `useDashboard` hook triggers `navigate('/forbidden')` |

### Playwright E2E (`apps/web/e2e/dashboard.spec.ts`)

| Scenario | Steps | Expected |
|---|---|---|
| BM full dashboard renders | Login as BM; navigate to `/dashboard` | Page title "Home"; all 6 widget cards visible; KPI numbers > 0; no error state |
| Drill-through from hot lead | Login as BM; click a hot lead row in HotLeadsWidget | Navigates to `/leads/{lead_id}` (Lead 360 page) |
| Drill-through from KPI card | Login as RM; click "Active Pipeline" KPI card | Navigates to `/leads` with filter excluding handed_off/rejected |
| Empty-state for new user | Login as freshly-created RM with no leads | `EmptyState` component visible with "Capture a lead" CTA |
| Keyboard navigation | Login as BM; Tab through all interactive elements on dashboard | Every widget card link/button reachable by Tab; `:focus-visible` visible on each |

---

## SQL Invariant Queries

Run against the test DB after every test run. Each must return 0 rows.

```sql
-- INV-1: Dashboard data must not surface deleted leads
-- Expectation: widget queries always include deleted_at IS NULL
SELECT lead_id FROM leads WHERE deleted_at IS NOT NULL AND lead_id IN (
  -- substitute: any lead_id observed in a dashboard response during test
  SELECT lead_id FROM leads WHERE deleted_at IS NOT NULL LIMIT 1
);
-- Expected: 0 rows (dashboard never returns deleted leads)

-- INV-2: SLA alerts must only reference first_contact_pending leads
-- (validated by the query WHERE clause; this invariant checks the test seed data is clean)
SELECT l.lead_id
FROM leads l
JOIN lead_identities li ON li.lead_identity_id = l.lead_identity_id
WHERE l.sla_first_contact_due_at < now()
  AND l.stage != 'first_contact_pending'
  AND l.deleted_at IS NULL
LIMIT 10;
-- Expected: 0 rows (if any exist, the SLA-alert widget query may over-count)

-- INV-3: Hot leads widget must not include handed_off or rejected leads
SELECT lead_id FROM leads
WHERE is_hot = true
  AND stage IN ('handed_off', 'rejected')
  AND deleted_at IS NULL
LIMIT 10;
-- Expected: 0 rows (active_pipeline and hot_leads exclude terminal stages)

-- INV-4: Hand-off failure widget must not surface leads with no integration_log failures
SELECT DISTINCT il.lead_id
FROM integration_logs il
WHERE il.integration = 'los'
  AND il.direction = 'outbound'
  AND il.status NOT IN ('failed', 'retrying')
  AND il.lead_id IN (
    SELECT lead_id FROM integration_logs
    WHERE integration = 'los' AND direction = 'outbound'
      AND status IN ('failed', 'retrying')
  )
LIMIT 1;
-- Expected: 0 rows (a lead cannot be in both failure and success buckets for this widget)
```

---

## Coverage Checklist

| Requirement | Covered by |
|---|---|
| Happy path (BM full widget set, correct counts) | TC-01, API integration `widget correctness` |
| Happy path (RM own-scope isolation) | TC-02, API `scope isolation` |
| `AUTH_REQUIRED` (401) | TC-05, API auth group |
| `FORBIDDEN` (403) — PARTNER | TC-03, API auth group |
| `FORBIDDEN` (403) — ADMIN | TC-04, API auth group |
| `FORBIDDEN` (403) — scope override | TC-08, API validation group |
| `VALIDATION_ERROR` (400) — both branch_id + team_id | TC-06, API validation group |
| `VALIDATION_ERROR` (400) — future `as_of` | TC-07, API validation group |
| `RATE_LIMITED` (429) | TC-10 |
| `INTERNAL_ERROR` (500) — all queries fail | (implicit via widget degradation; total failure mapped by `AllExceptionsFilter`) |
| Widget-level degradation (partial failure, still 200) | TC-09, API `widget degradation` group |
| PII masking per role | TC-11, UI unit test (MaskedField) |
| Cache hit/miss behaviour | TC-12 |
| Redis unavailable graceful fallback | TC-13 |
| Empty state (new user, no data) | TC-14, Playwright empty-state |
| Scope isolation RM / BM / SM / HEAD | TC-02, API `scope isolation` |
| Reconciliation with reports (§12.5) | API `kpi counts reconcile with GET /leads` |
| Drill-through links correct | UI unit test; Playwright drill-through |
| Role-based widget visibility | UI unit test `Role-based widget visibility` |
| Keyboard accessibility | Playwright `keyboard navigation` |
| Low-bandwidth fallback | UI unit test `Low-bandwidth source summary` |
| SQL invariants (no deleted/terminal leads in widget data) | INV-1 through INV-4 |
