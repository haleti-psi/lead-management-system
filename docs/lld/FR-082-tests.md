# FR-082: LOS Application Status Mirror — Test Specification

**Tier: 3**
**Source LLD:** `docs/lld/FR-082.md`

---

## Test Cases

| # | Name | Layer | Tool | Scenario | Inputs | Expected |
|---|---|---|---|---|---|---|
| T01 | Happy path — valid webhook, new mirror created | API integration | Jest + supertest | Valid HMAC-signed webhook; `los_application_id` maps to a `handed_off` lead with no existing mirror | `event_id`, `los_application_id`, `status`, `status_date` all valid; correct signature | HTTP 200; `{ data: null, … }`; `los_application_mirrors` row created; `integration_logs` row with `status='success'` and `idempotency_key=event_id` |
| T02 | Happy path — valid webhook, mirror updated (newer `status_date`) | API integration | Jest + supertest | Mirror already exists with older `status_date`; incoming has newer date | Same as T01 with `status_date` 1 hour later than stored | HTTP 200; `los_application_mirrors.status` and `status_date` updated; `integration_logs` row inserted |
| T03 | Out-of-order delivery — older `status_date` than stored mirror | API integration | Jest + supertest | Mirror already exists; incoming `status_date` is 2 hours earlier | Valid signature; older `status_date` | HTTP 200; `los_application_mirrors.status` NOT changed (upsert WHERE skips); `integration_logs` success row still inserted for observability |
| T04 | Idempotent replay — duplicate `event_id` | API integration | Jest + supertest | Same request sent twice with same `event_id` | Identical payload, correct signature, sent twice | Both calls return HTTP 200; only ONE `integration_logs` row exists for that `idempotency_key`; `los_application_mirrors` not double-written |
| T05 | Invalid HMAC signature | API integration | Jest + supertest | Valid payload but signature computed with wrong secret | `X-LOS-Signature: sha256=deadbeef...` | HTTP 403; envelope `{ error: { code: "FORBIDDEN" } }`; no DB writes |
| T06 | Missing `X-LOS-Signature` header | API integration | Jest + supertest | No signature header at all | Valid JSON body; no `X-LOS-Signature` | HTTP 403 `FORBIDDEN`; no DB writes |
| T07 | Unknown `los_application_id` | API integration | Jest + supertest | `los_application_id` does not match any lead | Valid signature; valid body; `los_application_id` = "DOES_NOT_EXIST" | HTTP 200 (acknowledge); `integration_logs` row written with `status='failed'`, `error_code='UNKNOWN_APP_ID'`; no `los_application_mirrors` write |
| T08 | Zod validation — missing required field (`status`) | API integration | Jest + supertest | Valid signature; body missing `status` field | `{ event_id, los_application_id, status_date }` only | HTTP 400 `VALIDATION_ERROR`; `fields[0].field = "status"` |
| T09 | Zod validation — `status_date` not ISO-8601 | API integration | Jest + supertest | Valid signature; `status_date = "not-a-date"` | Valid otherwise | HTTP 400 `VALIDATION_ERROR`; `fields[0].field = "status_date"` |
| T10 | Zod validation — `event_id` exceeds max length | API integration | Jest + supertest | Valid signature; `event_id` is 121 chars | 121-char string | HTTP 400 `VALIDATION_ERROR`; `fields[0].field = "event_id"` |
| T11 | Transaction rollback on mid-write DB failure | Unit | Jest | Simulate DB error on `integration_logs` insert (after mirror upsert) | Mock DB throws on `insertInto('integration_logs')` | Exception propagates; `los_application_mirrors` row NOT committed (full rollback); `INTERNAL_ERROR` returned |
| T12 | Concurrent duplicate delivery — DB unique index deduplication | API integration | Jest + supertest | Two concurrent requests with identical `event_id` reach the service before either checks Redis | Fire both requests in parallel | Exactly ONE `integration_logs` row; second request gets 200 (idempotent); no duplicate mirror row |
| T13 | Reconciliation poll — stale lead updated via poll | Unit | Jest | Lead in `handed_off` with stale `status_date`; `LosMockAdapter` returns new status | Call `LosService.reconcile()` directly | Mirror updated with `received_via='poll'`; `integration_logs` row written |
| T14 | Reconciliation poll — LOS port returns 5xx (upstream failure) | Unit | Jest | `LosMockAdapter` configured to throw UPSTREAM_UNAVAILABLE | Call `LosService.reconcile()` | `integration_logs` row with `status='failed'`; error logged; other leads in batch still processed; Cloud Tasks retry scheduled |
| T15 | Reconciliation poll — LIMIT 100 enforced on stale-leads query | Unit | Jest | 150 handed-off leads with stale mirrors seeded | Call `LosService.reconcile()` | DB query uses `LIMIT 100`; at most 100 leads processed per run |
| T16 | UI — LOS status panel renders mirror data (view_lead authorized) | Frontend component | Vitest + Testing Library | `LosStatusPanel` rendered with mock API data; user has `view_lead` O scope | Mock `GET /leads/{id}/los-status` returning one mirror row | StatusChip, status_date (IST formatted), `received_via` label, correlation_id all rendered |
| T17 | UI — LOS status panel renders EmptyState when no mirror exists | Frontend component | Vitest + Testing Library | Mock API returns empty array for `los_application_mirrors` | `GET /leads/{id}/los-status` → `{ data: [] }` | `EmptyState` rendered with "No LOS application linked" message |
| T18 | Audit intent written on successful webhook processing | Unit | Jest | Successful processStatusUpdate; `AuditAppender.append` is spied | Valid webhook processed | `AuditAppender.append` called once with `action='handoff_success'`, `lead_id`, `los_application_id`, `new_status`, `received_via` |
| T19 | No PII / no secret in application logs | Unit | Jest | Successful webhook processing | Valid webhook with `correlation_id` | Logger (`pino`) called; log objects do NOT contain `status` values that may contain PII, and NEVER contain `LOS_WEBHOOK_HMAC_SECRET` or raw body bytes |
| T20 | E2E — Lead 360 LOS panel visible for RM on own lead | E2E | Playwright | RM user logs in; opens Lead 360 for own handed-off lead that has a mirror record | Navigate to `/leads/{id}` as RM | LOS Status Panel section visible; StatusChip shows correct status; "Read-only" badge present; no edit controls |

---

## SQL Invariant Queries

Run these against the test database after each relevant test scenario. Each must return 0 rows.

```sql
-- INV-1: No los_application_mirrors row without a matching lead
SELECT m.los_mirror_id
FROM los_application_mirrors m
LEFT JOIN leads l ON l.lead_id = m.lead_id
WHERE l.lead_id IS NULL;

-- INV-2: No two los_application_mirrors rows with the same los_application_id
-- (the UNIQUE constraint uq_los_mirror_app must hold; this catches upsert regressions)
SELECT los_application_id, COUNT(*) AS cnt
FROM los_application_mirrors
GROUP BY los_application_id
HAVING COUNT(*) > 1;

-- INV-3: No integration_logs row for los_status without a lead_id when the app id is known
-- (unknown-app-id path writes a log with lead_id=NULL — that is expected; this checks no known-app writes omit lead_id)
SELECT il.integration_log_id
FROM integration_logs il
WHERE il.integration = 'los_status'
  AND il.error_code IS NULL          -- success path
  AND il.lead_id IS NULL;

-- INV-4: Duplicate idempotency keys must not exist (partial unique index uq_integration_idempotency)
SELECT idempotency_key, COUNT(*) AS cnt
FROM integration_logs
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1;

-- INV-5: los_application_mirrors.received_via must be a valid enum value
SELECT los_mirror_id
FROM los_application_mirrors
WHERE received_via NOT IN ('webhook', 'poll');

-- INV-6: los_application_mirrors.status_date must not be in the future by more than 1 minute
-- (guards against clock-skew test data pollution)
SELECT los_mirror_id
FROM los_application_mirrors
WHERE status_date > now() + INTERVAL '1 minute';
```

---

## UI Test Scenarios

| # | Scenario | Component | Tool | Assert |
|---|---|---|---|---|
| U01 | StatusChip renders "CREDIT_APPRAISAL" with correct accessible label | `LosStatusTimeline` | Vitest + Testing Library | `role="status"` element contains "CREDIT_APPRAISAL"; no edit button rendered |
| U02 | `received_via='poll'` shows "Reconciliation poll" label | `LosStatusTimeline` | Vitest + Testing Library | "Reconciliation poll" text visible; "Webhook" not rendered |
| U03 | `status_date` displayed in IST format (dd-MM-yyyy HH:mm) | `LosStatusPanel` | Vitest + Testing Library | `2026-06-09T10:30:00Z` renders as "09-06-2026 16:00" (IST +5:30) |
| U04 | LoadingSkeleton shown while query is in-flight | `LosStatusPanel` | Vitest + Testing Library | React Query in `loading` state → `LoadingSkeleton` rendered; no data visible |
| U05 | ErrorState shown when API returns INTERNAL_ERROR | `LosStatusPanel` | Vitest + Testing Library | Mock apiClient rejects → `ErrorState` rendered; "Something went wrong" text visible |
| U06 | Playwright: RM cannot see another RM's led mirror (scope enforcement) | `Lead360Page` | Playwright | RM-A logs in; navigates to lead owned by RM-B → 403 or redirect; LOS panel not visible |

---

## Coverage Checklist

- [x] Happy path — new mirror created (T01)
- [x] Happy path — mirror updated with newer status (T02)
- [x] Out-of-order delivery ignored (T03)
- [x] Idempotent replay (T04, T12) — no duplicate writes
- [x] `FORBIDDEN` — bad HMAC signature (T05)
- [x] `FORBIDDEN` — missing signature header (T06)
- [x] Unknown `los_application_id` — log + ignore, return 200 (T07)
- [x] `VALIDATION_ERROR` — missing required field (T08)
- [x] `VALIDATION_ERROR` — invalid `status_date` format (T09)
- [x] `VALIDATION_ERROR` — field exceeds max length (T10)
- [x] Transaction rollback on DB failure (T11)
- [x] Concurrent duplicate delivery (T12)
- [x] Reconciliation poll — success path (T13)
- [x] Reconciliation poll — UPSTREAM_UNAVAILABLE (T14)
- [x] LIMIT 100 enforced on unbounded reconcile query (T15)
- [x] UI renders mirror data correctly (T16, U01–U03)
- [x] UI renders EmptyState (T17)
- [x] UI renders LoadingSkeleton (U04)
- [x] UI renders ErrorState (U05)
- [x] Audit intent written (T18)
- [x] No PII / no secrets in logs (T19)
- [x] E2E scope enforcement — RM cannot see another RM's lead (T20, U06)
- [x] SQL invariants — all six checked
- [x] All error codes the FR can raise have tests: `FORBIDDEN` (T05, T06), `VALIDATION_ERROR` (T08–T10), `INTERNAL_ERROR` (T11)
- [x] `received_via` enum values both covered: `webhook` (T01–T12), `poll` (T13–T15, U02)
