# FR-062 Test Specification: Customer Status Tracking & Callback Self-Service

**Tier: 2**
**Source LLD:** `docs/lld/FR-062.md`
**Module:** M7 Customer Self-Service
**Test stack:** Jest + ts-jest (unit) · Jest + supertest + Testcontainers-Postgres (API integration) · Vitest + Testing-Library (frontend component) · Playwright (E2E)

---

## Test Cases

### Unit Tests (`apps/api/src/modules/self-service/self-service.service.spec.ts`)

| # | describe / it | Type | Scenario | Expected |
|---|---|---|---|---|
| U-01 | `SelfServiceService` / `returns customer-safe status for each internal stage` | Unit | Loop through all 13 `lead_stage` values and call `getLeadStatus` | Each stage maps to the correct `stage_label` and `stage_description` from `CUSTOMER_STAGE_MAP`; no raw `lead_stage` enum value is present in the response |
| U-02 | `SelfServiceService` / `sets is_handed_off = true and hides LOS detail when stage is handed_off` | Unit | `lead.stage = 'handed_off'` | Response `is_handed_off = true`, `los_status_label = null`, no `owner_id` or `los_application_id` in output |
| U-03 | `SelfServiceService` / `includes pending_actions only when stage is documents_pending` | Unit | `lead.stage = 'documents_pending'`; mock `documents` repo returns two rows with `doc_status = 'pending'` | `pending_actions` length is 2; for any other stage, `pending_actions` is empty array |
| U-04 | `SelfServiceService` / `emits audit link_open event on every status view` | Unit | Call `getLeadStatus` | `AuditAppender.emit` called once with `action = 'link_open'`, `entityType = 'customer_link'`, `entityId = customerLinkId` |
| U-05 | `SelfServiceService` / `requestCallback returns IDEMPOTENT_REPLAY on duplicate Idempotency-Key` | Unit | First call creates task; second call with same key hits Redis cache | Second call returns original `task_id` without calling `db.insertInto`; no duplicate row; response includes `meta.detail.reason = 'IDEMPOTENT_REPLAY'` |
| U-06 | `SelfServiceService` / `throws VALIDATION_ERROR when lead stage is handed_off` | Unit | `lead.stage = 'handed_off'` + valid `preferred_slot` | Throws `BadRequestException` with code `VALIDATION_ERROR`, field `preferred_slot` |
| U-07 | `SelfServiceService` / `throws VALIDATION_ERROR when lead stage is rejected` | Unit | `lead.stage = 'rejected'` + valid `preferred_slot` | Throws `BadRequestException` with code `VALIDATION_ERROR`, field `preferred_slot` |
| U-08 | `SelfServiceService` / `sets is_hot flag when lead is not already hot on callback` | Unit | `lead.is_hot = false` | `LeadService.setHotFlag` called with `(leadId, true, ['callback_requested'], tx)` |
| U-09 | `SelfServiceService` / `does not call setHotFlag when lead is already hot` | Unit | `lead.is_hot = true` | `LeadService.setHotFlag` is NOT called; task is still created |
| U-10 | `SelfServiceService` / `assigns task to UNASSIGNED_LEAD_OWNER_ID when lead owner_id is null` | Unit | `lead.owner_id = null` | Task inserted with `owner_id = process.env.UNASSIGNED_LEAD_OWNER_ID`; warning logged |

---

### API Integration Tests (`apps/api/test/self-service.e2e-spec.ts`)

All integration tests use Testcontainers-Postgres with Flyway migrations applied. `CustomerLinkGuard` is exercised using a real token + pre-set `otp_verified_at`.

| # | describe / it | Type | Scenario | Expected |
|---|---|---|---|---|
| A-01 | `GET /c/:token/status` / `returns 200 with customer-safe status for active token` | API happy path | Valid active token, `otp_verified_at` set, lead in stage `'contacted'` | 200; `data.stage_label = 'In Progress'`; no `lead_stage` enum value; no `owner_id`; envelope `{ data, meta, error:null }` |
| A-02 | `GET /c/:token/status` / `returns 200 with pending_actions when stage is documents_pending` | API happy path | Stage `'documents_pending'`; 2 documents with `doc_status='pending'` seeded | 200; `data.pending_actions` length = 2; `data.stage_label = 'Documents Required'` |
| A-03 | `GET /c/:token/status` / `returns 404 for unknown token` | Auth negative | Random token not in DB | 404; `error.code = 'NOT_FOUND'`; no DB row details in response |
| A-04 | `GET /c/:token/status` / `returns 404 for expired link` | Auth negative | `link_status = 'expired'` | 404; `error.code = 'NOT_FOUND'` |
| A-05 | `GET /c/:token/status` / `returns 404 for revoked link` | Auth negative | `link_status = 'revoked'` | 404; `error.code = 'NOT_FOUND'` |
| A-06 | `GET /c/:token/status` / `returns 401 when OTP step-up not completed` | Auth negative | `otp_verified_at IS NULL` | 401; `error.code = 'AUTH_REQUIRED'` |
| A-07 | `GET /c/:token/status` / `returns 429 when rate limit exceeded` | Rate limit | 11 requests in 1 minute from same IP | 11th request returns 429; `error.code = 'RATE_LIMITED'`; `Retry-After` header present |
| A-08 | `GET /c/:token/status` / `response never contains raw lead_stage, owner_id, los_application_id, or score` | Masking/data-leak | Lead has `los_application_id` set, `owner_id` set, `score = 80` | 200; response body stringified does NOT contain any of: `lead_stage`, `owner_id`, `los_application_id`, `score`, `score_reasons` |
| A-09 | `POST /c/:token/callback` / `returns 201 and creates task for valid request` | API happy path | Valid token; `preferred_slot` = now+2h; `note` = "Call after 10 AM" | 201; `data.task_id` is UUID; `tasks` table has 1 row with `type='callback'`, `status='open'`, `priority='high'`, `owner_id = lead.owner_id`; audit row with `action='comm_send'` |
| A-10 | `POST /c/:token/callback` / `sets is_hot on leads when lead was not hot` | API hot-signal | `lead.is_hot = false` before request | 201; `leads.is_hot = true` after request; `leads.score_reasons` contains `callback_requested` |
| A-11 | `POST /c/:token/callback` / `does not duplicate hot flag if already hot` | Idempotency | `lead.is_hot = true` before request | 201; task created; `leads.is_hot` still `true`; no redundant update |
| A-12 | `POST /c/:token/callback` / `returns 200 with original task_id on replayed Idempotency-Key` | Idempotency | Same `Idempotency-Key` sent twice | Second call returns 200; `data.task_id` matches first response; only 1 row in `tasks` table for that lead |
| A-13 | `POST /c/:token/callback` / `returns 400 for missing preferred_slot` | Validation | Body `{}` | 400; `error.code = 'VALIDATION_ERROR'`; `error.fields[0].field = 'preferred_slot'` |
| A-14 | `POST /c/:token/callback` / `returns 400 for preferred_slot in the past` | Validation boundary | `preferred_slot` = now-1h | 400; `error.code = 'VALIDATION_ERROR'`; `error.fields[0].field = 'preferred_slot'` |
| A-15 | `POST /c/:token/callback` / `returns 400 for preferred_slot less than 30 minutes away` | Validation boundary | `preferred_slot` = now+20min | 400; `error.code = 'VALIDATION_ERROR'` |
| A-16 | `POST /c/:token/callback` / `returns 400 for preferred_slot more than 7 days away` | Validation boundary | `preferred_slot` = now+8d | 400; `error.code = 'VALIDATION_ERROR'` |
| A-17 | `POST /c/:token/callback` / `returns 400 for note longer than 500 chars` | Validation | `note` = 501-char string | 400; `error.code = 'VALIDATION_ERROR'`; `error.fields[0].field = 'note'` |
| A-18 | `POST /c/:token/callback` / `returns 400 when lead stage is handed_off` | Stage guard | Lead stage `'handed_off'` | 400; `error.code = 'VALIDATION_ERROR'`; message references "application in this status" |
| A-19 | `POST /c/:token/callback` / `returns 400 when lead stage is rejected` | Stage guard | Lead stage `'rejected'` | 400; `error.code = 'VALIDATION_ERROR'` |
| A-20 | `POST /c/:token/callback` / `returns 404 for expired token` | Auth negative | `link_status = 'expired'` | 404; `error.code = 'NOT_FOUND'` |
| A-21 | `POST /c/:token/callback` / `returns 429 when rate limit exceeded` | Rate limit | 11 POST requests in 1 minute | 11th returns 429; `error.code = 'RATE_LIMITED'` |
| A-22 | `POST /c/:token/callback` / `transaction rolls back on forced audit emit failure` | Transaction rollback | Mock `AuditAppender.emit` to throw after task INSERT | 500; `tasks` table has 0 new rows (rollback confirmed); `leads.is_hot` unchanged |
| A-23 | `POST /c/:token/callback` / `task owner_id falls back to UNASSIGNED_LEAD_OWNER_ID when lead owner is null` | Edge case | Lead with `owner_id = null` | 201; `tasks.owner_id = UNASSIGNED_LEAD_OWNER_ID`; warn log emitted |

---

## SQL Invariant Queries

Run after each API test suite completes. All must return 0 rows.

```sql
-- INV-01: No callback task without a valid (non-deleted) parent lead
SELECT t.task_id
FROM tasks t
LEFT JOIN leads l ON l.lead_id = t.lead_id
WHERE t.type = 'callback'
  AND (l.lead_id IS NULL OR l.deleted_at IS NOT NULL);

-- INV-02: No callback task created for a handed_off or rejected lead (via this FR)
-- (Checks that stage guard is enforced at write time)
SELECT t.task_id
FROM tasks t
JOIN leads l ON l.lead_id = t.lead_id
WHERE t.type = 'callback'
  AND l.stage IN ('handed_off', 'rejected')
  AND t.created_at > NOW() - INTERVAL '1 hour';  -- scope to test run window

-- INV-03: Every callback task has priority = 'high'
SELECT task_id
FROM tasks
WHERE type = 'callback'
  AND priority <> 'high';

-- INV-04: No audit_log row has been updated or deleted (append-only invariant)
-- Verified by checking updated_at = created_at on all rows (schema has no UPDATE trigger,
-- but any test that calls UPDATE on audit_logs should return this)
SELECT audit_id
FROM audit_logs
WHERE updated_at > created_at + INTERVAL '1 second';

-- INV-05: Idempotency — no two tasks of type 'callback' for the same lead
-- created within 5 seconds of each other (duplicate creation guard)
SELECT lead_id, COUNT(*) AS cnt
FROM tasks
WHERE type = 'callback'
GROUP BY lead_id, date_trunc('minute', created_at)
HAVING COUNT(*) > 1;

-- INV-06: Every customer_link used in a callback test is still 'active' (FR-062 does not transition link_status)
SELECT cl.customer_link_id
FROM customer_links cl
JOIN tasks t ON t.lead_id = cl.lead_id
WHERE t.type = 'callback'
  AND cl.status <> 'active';
```

---

## Frontend Component Tests (`apps/web/src/app/customer/status/StatusPage.test.tsx`, `CallbackForm.test.tsx`)

| # | Component | Scenario | Expected |
|---|---|---|---|
| F-01 | `StatusPage` | renders `LoadingSkeleton` while query is loading | Skeleton visible; no stage content rendered |
| F-02 | `StatusPage` | renders stage_label and stage_description on success | `stage_label` text and `stage_description` text appear in DOM |
| F-03 | `StatusPage` | renders `pending_actions` list when stage is documents_pending | List items for each pending action visible |
| F-04 | `StatusPage` | renders `ErrorState` with retry CTA on query error | `ErrorState` component visible; retry button present |
| F-05 | `StatusPage` | hides `CallbackForm` when `is_handed_off = true` | `CallbackForm` not in DOM; "With lending team" message visible |
| F-06 | `CallbackForm` | submit button is disabled while isSubmitting | Button has `disabled` attribute; `<Spinner />` rendered |
| F-07 | `CallbackForm` | shows inline error for missing preferred_slot on blur | ARIA alert with field error message visible |
| F-08 | `CallbackForm` | shows Toast on successful submission | Toast with success message appears after mock POST resolves |
| F-09 | `CallbackForm` | shows RATE_LIMITED error Toast when 429 received | Toast with `t('errors.rate_limited')` text; form is re-enabled |
| F-10 | `CallbackForm` | maps VALIDATION_ERROR fields[] to inline field errors | Field-level error text appears adjacent to `preferred_slot` input |

---

## E2E Test Scenarios (`apps/web/e2e/customer-status.spec.ts`)

| # | Scenario | Steps | Expected |
|---|---|---|---|
| E-01 | Customer views status for an active link (documents_pending stage) | 1. Navigate to `/c/{valid-token}/status` (OTP already done via fixture). 2. Wait for page to load. | Stage label "Documents Required" visible; pending actions list has at least 1 item; no internal field names (stage/owner/score) in page source |
| E-02 | Customer successfully requests a callback | 1. Navigate to status page. 2. Click into date-time picker; select valid slot. 3. Fill optional note. 4. Click "Request Callback". | Success Toast appears; form resets; page still shows status; button re-enabled |
| E-03 | Token-expired URL shows error page | Navigate to `/c/{expired-token}/status` | 404 or token-expired page shown; no lead data displayed |

---

## Coverage Checklist

| Requirement | Covered by |
|---|---|
| Happy path GET status — all stages | U-01, A-01, A-02 |
| Happy path POST callback | A-09, E-02 |
| Auth negative — token not found / expired / revoked / used | A-03, A-04, A-05, E-03 |
| Auth negative — OTP step-up missing | A-06 |
| Rate limit enforcement | A-07, A-21 |
| Masking / data-leak prevention (no internal fields) | A-08, E-01 |
| VALIDATION_ERROR — all validation rules | A-13, A-14, A-15, A-16, A-17 |
| Stage guard — handed_off and rejected | A-18, A-19, U-06, U-07 |
| Idempotency — replayed Idempotency-Key | U-05, A-12 |
| Transaction rollback on failure | A-22 |
| Hot-signal set on callback | U-08, A-10 |
| Hot-signal not duplicated | U-09, A-11 |
| Unassigned lead owner fallback | U-10, A-23 |
| Audit emit on status view | U-04 |
| Audit emit on callback create | A-09 (row verified) |
| Append-only audit_logs | INV-04 |
| SQL invariants (no orphaned tasks, no duplicates) | INV-01 through INV-06 |
| UI loading / error / empty states | F-01, F-04 |
| UI field-level validation errors | F-07, F-10 |
| UI accessibility (disabled submit, ARIA alerts) | F-06, F-07 |
| E2E customer journey | E-01, E-02, E-03 |
| `INTERNAL_ERROR` path (unhandled error) | A-22 (rollback also surfaces 500) |
| `NOT_FOUND` path | A-03, A-04, A-05 |
| `AUTH_REQUIRED` path | A-06 |
| `RATE_LIMITED` path | A-07, A-21, F-09 |
| `VALIDATION_ERROR` path | A-13 through A-19 |
| `IDEMPOTENT_REPLAY` sub-reason | U-05, A-12 |
