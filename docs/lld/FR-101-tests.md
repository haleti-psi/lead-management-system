# FR-101 Test Specification: Communication Templates & Audit

**Tier: 2**
**Source LLD:** `docs/lld/FR-101.md`
**Test stack:** Jest + supertest + Testcontainers-Postgres (API integration); Vitest + Testing-Library (UI unit); Playwright (E2E).

---

## Test Cases

| # | Name | Layer | Scenario | Expected |
|---|---|---|---|---|
| T01 | Happy path — create template | API (e2e-spec) | ADMIN posts valid `CreateTemplateDto` | 201; `status='draft'`; row in `communication_templates` |
| T02 | Happy path — list templates with filters | API (e2e-spec) | ADMIN calls `GET /admin/templates?channel=sms&status=active` | 200; paginated result; all returned rows match filter |
| T03 | Happy path — dispatch transactional SMS | API (e2e-spec) | RM sends SMS to own lead; active template; `lead_contact` consent granted; opt-in preference | 202; `communication_logs` row `status='queued'`; Cloud Tasks job enqueued |
| T04 | Auth — unauthenticated template list | API (e2e-spec) | No JWT on `GET /admin/templates` | 401 `AUTH_REQUIRED` |
| T05 | Auth — non-ADMIN calls `POST /admin/templates` | API (e2e-spec) | RM JWT on `POST /admin/templates` | 403 `FORBIDDEN` |
| T06 | Auth — RM dispatches to out-of-scope lead | API (e2e-spec) | RM A calls `POST /leads/{other_rm_lead_id}/communications` | 403 `FORBIDDEN` |
| T07 | Auth — PARTNER dispatches to own lead | API (e2e-spec) | PARTNER sends to their submitted lead with valid consent | 202; log row created |
| T08 | Consent gate — no ConsentRecord | API (e2e-spec) | Dispatch; no `consent_records` row for `(lead_id, purpose, 'granted')` | 403 `FORBIDDEN`; `detail.reason='CONSENT_MISSING'` |
| T09 | Consent gate — opted-out preference | API (e2e-spec) | `notification_preferences` row with `opted_in=false` for channel+purpose | 403 `FORBIDDEN`; `detail.reason='CONSENT_MISSING'` |
| T10 | Marketing blocked without marketing consent | API (e2e-spec) | Template `category='marketing'`; `consent_basis='lead_contact'` | 403 `FORBIDDEN`; `detail.reason='CONSENT_MISSING'` |
| T11 | Template not active | API (e2e-spec) | Dispatch with `template_id` pointing to `status='draft'` template | 404 `NOT_FOUND` |
| T12 | Channel mismatch | API (e2e-spec) | Template is `sms`; DTO `channel='email'` | 400 `VALIDATION_ERROR` |
| T13 | Invalid recipient format (mobile) | API (e2e-spec) | `recipient='12345'` with `channel='sms'` | 400 `VALIDATION_ERROR`; field `recipient` in `fields[]` |
| T14 | Duplicate template version | API (e2e-spec) | `POST /admin/templates` with same `(code, channel, language, version)` | 409 `CONFLICT` |
| T15 | Provider failure → log updated | Unit | `DispatchCommunicationWorker` with `MockChannelAdapter` throwing 503 | `communication_logs.status='failed'`; `failure_reason` set; no unhandled exception |
| T16 | Masking — recipient masked in list response | API (e2e-spec) | RM reads `communication_logs` for own lead | mobile `recipient` serialized as `98xxxxxx10` |
| T17 | Transaction rollback — DB error after insert | Unit | Mock DB to fail after `INSERT communication_logs` | No `communication_logs` row persists; no Cloud Tasks job enqueued |
| T18 | Pagination defaults | API (e2e-spec) | `GET /admin/templates` with no query params | page=1, limit=25 in meta; at most 25 rows |
| T19 | Pagination max limit enforced | API (e2e-spec) | `GET /admin/templates?limit=999` | limit capped at 100 in response |
| T20 | Rate limit on dispatch | API (e2e-spec) | Same user sends 61 requests in < 60 s | 61st returns 429 `RATE_LIMITED` with `Retry-After` header |

---

## Detailed Test Specifications

### T01 — Create template (happy path)

**Type:** API integration (`template.e2e-spec.ts`)
**Arrange:** Testcontainers Postgres seeded with bootstrap (org, roles, ADMIN user).
**Act:**
```
POST /api/v1/admin/templates
Authorization: Bearer <ADMIN_JWT>
{
  "code": "DOC_REQUEST_SMS_EN",
  "version": 1,
  "channel": "sms",
  "language": "English",
  "category": "transactional",
  "body": "Dear {{name}}, upload your docs."
}
```
**Assert:**
- HTTP 201.
- Body: `data.status === 'draft'`; `data.template_id` is a valid UUID.
- SQL invariant: `SELECT COUNT(*) FROM communication_templates WHERE code='DOC_REQUEST_SMS_EN' AND status='draft'` = 1.
- Audit emit called once with `action='TEMPLATE_CREATED'`.

---

### T03 — Dispatch transactional SMS (happy path)

**Type:** API integration (`communication.e2e-spec.ts`)
**Arrange:**
- Lead owned by RM user; `org_id` set.
- Active `sms` template with `category='transactional'`.
- `consent_records` row: `(lead_id, purpose='lead_contact', state='granted')`.
- No `notification_preferences` row (default = opted-in for transactional).
- `MockChannelAdapter` in place.
**Act:**
```
POST /api/v1/leads/{lead_id}/communications
Authorization: Bearer <RM_JWT>
{
  "template_id": "<active_sms_template_id>",
  "channel": "sms",
  "consent_basis": "lead_contact",
  "recipient": "9876543210"
}
```
**Assert:**
- HTTP 202.
- `data.status === 'queued'`.
- SQL invariant: `SELECT COUNT(*) FROM communication_logs WHERE lead_id='{lead_id}' AND status='queued'` = 1.
- `MockChannelAdapter.sends` length = 0 (sync response returns before async worker runs).
- Audit emit called once with `action='COMMUNICATION_DISPATCHED'`.

---

### T06 — RM dispatches to out-of-scope lead

**Type:** API integration
**Arrange:** RM-A owns lead-A. RM-B (different user) calls dispatch on lead-A.
**Act:** `POST /api/v1/leads/{lead_A_id}/communications` with RM-B JWT.
**Assert:**
- HTTP 403.
- `error.code === 'FORBIDDEN'`.
- `communication_logs` count = 0.

---

### T08 — Consent gate — no ConsentRecord

**Type:** API integration
**Arrange:** Lead with no `consent_records` row for `purpose='lead_contact'`.
**Act:** RM dispatches to own lead with `consent_basis='lead_contact'`.
**Assert:**
- HTTP 403.
- `error.code === 'FORBIDDEN'`.
- `error.detail.reason === 'CONSENT_MISSING'`.
- SQL: `SELECT COUNT(*) FROM communication_logs WHERE lead_id='{lead_id}'` = 0.

---

### T09 — Opted-out preference blocks dispatch

**Type:** API integration
**Arrange:**
- `consent_records` row: `state='granted'` for `purpose='lead_contact'`.
- `notification_preferences` row: `(subject_ref=lead_customer_ref, channel='sms', purpose='lead_contact', opted_in=false)`.
**Act:** Dispatch SMS.
**Assert:**
- HTTP 403; `FORBIDDEN`; `detail.reason='CONSENT_MISSING'`.
- No `communication_logs` row created.

---

### T10 — Marketing blocked without marketing consent

**Type:** Unit (`notification-dispatch.service.spec.ts`)
**Arrange:**
- `template.category = 'marketing'`.
- `dto.consent_basis = 'lead_contact'`.
**Act:** Call `NotificationDispatchService.send(...)`.
**Assert:** Throws `ForbiddenException` with `detail.reason='CONSENT_MISSING'`. No DB insert called.

---

### T15 — Provider failure updates log, no unhandled exception

**Type:** Unit (`dispatch-communication.worker.spec.ts`)
**Arrange:**
- `MockChannelAdapter` configured to throw `UPSTREAM_UNAVAILABLE`.
- `communication_logs` row pre-seeded with `status='queued'`.
**Act:** Execute `DispatchCommunicationWorker.run({ communication_log_id })`.
**Assert:**
- `communication_logs.status` updated to `'failed'`.
- `failure_reason` is non-null string.
- No exception propagated from the worker (Cloud Tasks will retry).
- `MockChannelAdapter.sends` attempted once.

---

### T16 — Recipient masked in list response

**Type:** API integration
**Arrange:**
- `communication_logs` row for lead with `recipient='9876543210'` (mobile) and `channel='sms'`.
- Authenticated as RM (scope = own lead).
**Act:** `GET /api/v1/leads/{lead_id}/communications` (assumes list endpoint exists on lead detail).
**Assert:**
- `data[0].recipient` matches `^9[0-9]{0}xxxxx[0-9]{2}[0-9]{2}$` pattern (i.e., `98xxxxxx10`).
- Raw mobile number `9876543210` does not appear in response body.

---

### T17 — Transaction rollback on DB error

**Type:** Unit (`notification-dispatch.service.spec.ts`)
**Arrange:**
- DB mock: `INSERT INTO communication_logs` succeeds, then mock throws a DB error before commit.
**Act:** Call `NotificationDispatchService.send(...)`.
**Assert:**
- Exception propagated.
- No `communication_logs` row persists (rollback verified via separate read-query mock).
- Cloud Tasks enqueue mock NOT called.

---

### T20 — Rate limit on dispatch mutations

**Type:** API integration
**Arrange:** Redis-backed ThrottlerGuard (mutations = 60/min per user).
**Act:** Send 61 `POST /leads/{id}/communications` requests within 60 s under the same JWT.
**Assert:**
- First 60 return 202.
- 61st returns 429 `RATE_LIMITED`.
- Response includes `Retry-After` header.

---

## SQL Invariant Queries

Run these after each test that writes data. All must return 0 rows (violations fail the test).

```sql
-- INV-01: No communication_log with status='queued' should exist without a corresponding template
SELECT cl.communication_log_id
FROM communication_logs cl
LEFT JOIN communication_templates ct ON ct.template_id = cl.template_id
WHERE cl.template_id IS NOT NULL
  AND ct.template_id IS NULL;
-- Expected: 0 rows

-- INV-02: No communication_log with a lead_id that has no lead record
-- (lead FK is ON DELETE SET NULL, so orphan check is: non-null lead_id with no lead)
SELECT cl.communication_log_id
FROM communication_logs cl
LEFT JOIN leads l ON l.lead_id = cl.lead_id
WHERE cl.lead_id IS NOT NULL
  AND l.lead_id IS NULL;
-- Expected: 0 rows

-- INV-03: No two templates with same (org_id, code, channel, language, version)
SELECT org_id, code, channel, language, version, COUNT(*) AS cnt
FROM communication_templates
GROUP BY org_id, code, channel, language, version
HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- INV-04: No communication_log with status='delivered' that was never 'sent'
-- (business rule: delivered must pass through sent; in practice provider_ref must be set)
SELECT communication_log_id
FROM communication_logs
WHERE status = 'delivered'
  AND provider_ref IS NULL;
-- Expected: 0 rows

-- INV-05: communication_templates must never have status other than 'draft'|'active'|'retired'
SELECT template_id, status
FROM communication_templates
WHERE status NOT IN ('draft', 'active', 'retired');
-- Expected: 0 rows

-- INV-06: No consent_records row with status='granted' should have been UPDATEd (append-only)
-- Tested via REVOKE check: attempt an UPDATE and verify it's rejected by DB role
-- (This is a schema-level guard, verified in the DDL load CI step)
-- Runtime invariant: no consent_records row has updated_at != created_at
SELECT consent_id
FROM consent_records
WHERE updated_at != created_at;
-- Expected: 0 rows (append-only; trigger should not exist; no app UPDATE)
```

---

## UI Test Scenarios

### UI-01 — Template list renders filtered rows (Vitest + Testing-Library)

**Component:** `TemplateListPage`
**Mock:** React Query with canned `GET /admin/templates?channel=sms` response (2 rows, both `sms`).
**Assert:**
- Table renders 2 rows.
- `StatusChip` for each row shows correct `config_status` label.
- `MaskedField` not expected here (no PII in template rows).

### UI-02 — Create template form — validation errors displayed

**Component:** `TemplateCreateModal`
**Act:** Submit with empty `code` field.
**Assert:**
- Inline error `"Template code must be alphanumeric/underscore, max 60 chars."` is present with `role="alert"`.
- Submit button re-enables after field corrected.
- Server `VALIDATION_ERROR.fields` also maps to inline errors.

### UI-03 — Send communication — consent warning shown when not granted

**Component:** `SendCommunicationDrawer`
**Mock:** `consent_records` query returns no `granted` record; `StatusChip` shows "Consent: Not Granted".
**Assert:**
- Alert banner: "Customer has not granted consent for this purpose."
- "Send" button is disabled.

### UI-04 — Communication history — recipient masked (Vitest)

**Component:** `CommunicationHistory`
**Mock:** `communication_logs` list with `recipient='9876543210'`, `channel='sms'`.
**Assert:**
- Rendered cell text matches masked pattern (e.g., `98xxxxxx10`).
- Raw `9876543210` string not present in DOM.

### UI-05 — E2E: ADMIN creates a template (Playwright)

**File:** `apps/web/e2e/templates.spec.ts`
**Flow:**
1. Login as ADMIN.
2. Navigate to `/admin/templates`.
3. Click "New Template".
4. Fill `code="E2E_TEST_TEMPLATE"`, `version=1`, `channel=sms`, `language=English`, `category=transactional`, `body="Test body"`.
5. Submit.
**Assert:**
- Toast "Template created successfully." visible.
- New row with `code="E2E_TEST_TEMPLATE"` and `status="draft"` appears in table.

---

## Coverage Checklist

| Requirement | Tests covering it |
|---|---|
| Happy path — template create | T01 |
| Happy path — template list with filters | T02 |
| Happy path — transactional dispatch | T03 |
| Happy path — PARTNER dispatch to own lead | T07 |
| `AUTH_REQUIRED` (401) | T04 |
| `FORBIDDEN` — wrong role for config | T05 |
| `FORBIDDEN` — out-of-scope lead | T06 |
| `FORBIDDEN` + `CONSENT_MISSING` — no consent record | T08 |
| `FORBIDDEN` + `CONSENT_MISSING` — opted-out preference | T09 |
| `FORBIDDEN` + `CONSENT_MISSING` — marketing/purpose mismatch | T10 |
| `NOT_FOUND` — template not active | T11 |
| `VALIDATION_ERROR` — channel mismatch | T12 |
| `VALIDATION_ERROR` — invalid recipient format | T13 |
| `CONFLICT` — duplicate template version | T14 |
| `UPSTREAM_UNAVAILABLE` — provider failure handling | T15 |
| `RATE_LIMITED` (429) | T20 |
| Masking — recipient in responses | T16 |
| Transaction rollback on DB error | T17 |
| Pagination default (limit=25) | T18 |
| Pagination max (limit capped at 100) | T19 |
| Audit emit on template create | T01 (assert) |
| Audit emit on dispatch | T03 (assert) |
| SQL invariants (append-only, FK integrity, no orphans) | INV-01 to INV-06 |
| UI consent warning | UI-03 |
| UI recipient masking | UI-04 |
| UI validation errors | UI-02 |
| E2E template creation | UI-05 |
