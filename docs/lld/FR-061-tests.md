# FR-061: Customer Grievance & Service Request — Test Specification

**Tier: 2**  
**Source LLD:** `docs/lld/FR-061.md`

---

## Test Cases

Minimum required for Tier 2: 5 tests covering happy path + every error code the FR raises + authz both ways + validation + state-machine entry. This spec provides 12 tests for full coverage.

| # | Layer | Name | Scenario | Setup | Expected |
|---|-------|------|----------|-------|----------|
| TC-01 | API | Happy path — grievance created | Active OTP-verified token; valid category + description | Active `customer_links` row; active `sla_policies` (grievance); system user seeded | HTTP 201; `data.grievanceNo` matches `GRV-{YYYY}-\d{5}`; `data.status = 'open'`; `data.sla_due_at` is a valid ISO timestamp; one row in `grievances`; one `GRIEVANCE_CREATED` row in `event_outbox` |
| TC-02 | API | Token not found | Non-existent token | No matching `customer_links` row | HTTP 404; `error.code = 'NOT_FOUND'` |
| TC-03 | API | Token expired | Token exists but `expires_at` is in the past | `customer_links.expires_at = now() - 1 day`, `status = 'active'` | HTTP 409; `error.code = 'CONFLICT'`; no `grievances` row inserted |
| TC-04 | API | Token revoked | Token `status = 'revoked'` | `customer_links.status = 'revoked'` | HTTP 409; `error.code = 'CONFLICT'`; no `grievances` row inserted |
| TC-05 | API | OTP not verified | Token active + unexpired but `otp_verified_at IS NULL` | `customer_links.otp_verified_at = null` | HTTP 409; `error.code = 'CONFLICT'`; no `grievances` row inserted |
| TC-06 | API | Validation error — missing description | Valid token; category present; description omitted | Active token | HTTP 400; `error.code = 'VALIDATION_ERROR'`; `error.fields[].field = 'description'` |
| TC-07 | API | Validation error — invalid category | Valid token; `category = 'unknown_value'`; description present | Active token | HTTP 400; `error.code = 'VALIDATION_ERROR'`; `error.fields[].field = 'category'` |
| TC-08 | API | Validation error — description too long | Valid token; description = 2001 chars | Active token | HTTP 400; `error.code = 'VALIDATION_ERROR'`; `error.fields[].field = 'description'` |
| TC-09 | API | Rate limit enforced | 11 rapid requests from the same IP | Active token; Redis ThrottlerGuard | 11th request → HTTP 429; `error.code = 'RATE_LIMITED'` |
| TC-10 | API | Transaction rollback on DB failure | `event_outbox` INSERT forced to fail mid-transaction | Mock `OutboxService.emit` to throw after `grievances` INSERT | HTTP 500; `error.code = 'INTERNAL_ERROR'`; `grievances` table has zero new rows (rollback verified) |
| TC-11 | API | Happy path — no active SLA policy | Active token; no `sla_policies` row for `applies_to = 'grievance'` | `sla_policies` absent for this org | HTTP 201; `data.sla_due_at = null`; row inserted; warn log emitted |
| TC-12 | E2E | Customer complaint flow | Customer opens micro-site link, fills form, submits | Staging: active link, OTP verified | Form submits; success banner shows `grievance_no`; `sla_due_at` displayed in IST |

---

## Detailed Test Case Specifications

### TC-01 — Happy path — grievance created

**Tool:** Jest + supertest (`apps/api/test/self-service/FR-061.e2e-spec.ts`)

```
Setup:
  - Seed org, system user, active calendar.
  - Insert customer_links row: status='active', otp_verified_at=now(), expires_at=+7days, lead_id=<seeded lead>.
  - Insert sla_policies row: applies_to='grievance', threshold_minutes=4320 (3 business days), is_active=true.
  - Compute raw token → sha256 → token_hash stored.

Request:
  POST /api/v1/c/{token}/grievance
  Body: { "category": "service_delay", "description": "Application pending for 2 weeks." }

Assertions:
  - HTTP 201.
  - response.data.grievanceNo matches /^GRV-\d{4}-\d{5}$/.
  - response.data.status === 'open'.
  - response.data.sla_due_at is a valid ISO 8601 string.
  - SELECT COUNT(*) FROM grievances WHERE grievance_no = response.data.grievanceNo → 1.
  - SELECT COUNT(*) FROM event_outbox WHERE event_code = 'GRIEVANCE_CREATED'
      AND aggregate_id = response.data.grievanceId → 1.
  - SELECT category FROM grievances WHERE grievance_id = response.data.grievanceId → 'service_delay'.
  - SELECT source FROM grievances WHERE grievance_id = response.data.grievanceId → 'customer_link'.
  - response.error === null.
```

### TC-02 — Token not found

```
Request: POST /api/v1/c/nonexistent-token-xyz/grievance
Body: { "category": "other", "description": "Test." }

Assertions:
  - HTTP 404.
  - response.error.code === 'NOT_FOUND'.
  - response.data === null.
```

### TC-03 — Token expired

```
Setup:
  - customer_links: status='active', expires_at=now()-1day, otp_verified_at=now()-2days.

Assertions:
  - HTTP 409.
  - response.error.code === 'CONFLICT'.
  - SELECT COUNT(*) FROM grievances WHERE lead_id = <lead_id> AND source='customer_link' → 0.
```

### TC-06 — Validation error — missing description

```
Request:
  POST /api/v1/c/{token}/grievance
  Body: { "category": "service_delay" }     ← description omitted

Assertions:
  - HTTP 400.
  - response.error.code === 'VALIDATION_ERROR'.
  - response.error.fields contains an entry where field === 'description'.
  - No grievances row inserted.
```

### TC-10 — Transaction rollback on mid-write failure

```
Setup:
  - Use Jest module mock: jest.spyOn(OutboxService, 'emit').mockRejectedValue(new Error('DB inject'));
  - Valid token + valid payload.

Assertions:
  - HTTP 500; error.code === 'INTERNAL_ERROR'.
  - No stack trace in response body.
  - SELECT COUNT(*) FROM grievances WHERE lead_id = <lead_id> → 0  (rollback confirmed).
  - SELECT COUNT(*) FROM event_outbox WHERE event_code='GRIEVANCE_CREATED' → 0.
```

---

## SQL Invariant Queries

Run after each relevant test; all must return 0 rows (assertion of the "expect 0 rows" invariant).

```sql
-- INV-01: No grievances row without an org_id
SELECT COUNT(*) FROM grievances WHERE org_id IS NULL;
-- Expected: 0

-- INV-02: No grievances row with status other than allowed enum values
SELECT COUNT(*) FROM grievances
  WHERE status NOT IN ('open','in_progress','escalated','resolved','closed');
-- Expected: 0

-- INV-03: No grievances row with source other than allowed enum values
SELECT COUNT(*) FROM grievances
  WHERE source NOT IN ('customer_link','rm','branch','call_centre','partner','admin');
-- Expected: 0

-- INV-04: No orphaned grievances with a lead_id that does not exist
SELECT COUNT(*) FROM grievances g
  LEFT JOIN leads l ON l.lead_id = g.lead_id
  WHERE g.lead_id IS NOT NULL AND l.lead_id IS NULL;
-- Expected: 0

-- INV-05: No two grievances share the same grievance_no within the same org (unique constraint)
SELECT org_id, grievance_no, COUNT(*) AS cnt
  FROM grievances
  GROUP BY org_id, grievance_no
  HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- INV-06: GRIEVANCE_CREATED outbox event matches a real grievances row
SELECT COUNT(*) FROM event_outbox eo
  WHERE eo.event_code = 'GRIEVANCE_CREATED'
    AND NOT EXISTS (
      SELECT 1 FROM grievances g WHERE g.grievance_id = eo.aggregate_id
    );
-- Expected: 0

-- INV-07: event_outbox is append-only — no updates (status transitions are managed by the outbox publisher)
-- Verify no UPDATE issued on event_outbox during this FR's test run by checking row counts are monotonically
-- increasing; schema-level check via policy enforced at application layer (no DELETE trigger needed here).

-- INV-08: No grievances row with description exceeding 2000 chars
SELECT COUNT(*) FROM grievances WHERE char_length(description) > 2000;
-- Expected: 0

-- INV-09: customer_links token consumed by this FR still has status='active'
-- (FR-061 does NOT mark the token as 'used'; tokens are multi-use until expiry/revocation by FR-060)
SELECT COUNT(*) FROM customer_links
  WHERE token_hash = sha256(<test_token>) AND status != 'active';
-- Expected: 0 (token must remain active after grievance submission)
```

---

## UI Test Scenarios

**Tool:** Vitest + @testing-library/react (unit); Playwright (E2E)

### Component Unit Tests (`GrievanceForm.test.tsx`)

| # | Scenario | Expected |
|---|----------|----------|
| UI-01 | Category select renders all 6 enum options | All 6 `grievance_category` options visible |
| UI-02 | Submit with blank description shows inline error | `role="alert"` error under description field; submit button still visible |
| UI-03 | Submit with valid fields calls mutation hook | `useCreateGrievance` hook invoked with correct payload |
| UI-04 | isSubmitting = true disables submit button | Button has `disabled` attribute + spinner visible |
| UI-05 | Server VALIDATION_ERROR maps to field errors | `error.fields` from server response renders inline under the correct field |
| UI-06 | Success response shows grievance_no in Toast/banner | `GRV-2026-00031` visible after 201 response; form fields cleared or success state shown |

### E2E Test (`apps/web/e2e/grievance.spec.ts`)

```
TC-E2E-01: Customer complaint flow
  1. Navigate to /c/{active_token}/grievance.
  2. Assert GrievanceOfficerInfoBlock is visible (or EmptyState if null).
  3. Select category = "service_delay" from the Select dropdown.
  4. Fill description = "My application has been pending for 15 days."
  5. Click "Submit".
  6. Assert Toast or success banner contains "GRV-" reference number.
  7. Assert sla_due_at displayed in IST format (dd-MM-yyyy HH:mm).

TC-E2E-02: Token expired → error page
  1. Navigate to /c/{expired_token}/grievance.
  2. Assert error state shown (CONFLICT mapped to user-friendly message).
  3. No form rendered.
```

---

## Coverage Checklist

| Requirement | Covered by | Test # |
|---|---|---|
| Happy path — grievance created | TC-01 | TC-01 |
| NOT_FOUND (404) — token not found | TC-02 | TC-02 |
| CONFLICT (409) — token expired | TC-03 | TC-03 |
| CONFLICT (409) — token revoked | TC-04 | TC-04 |
| CONFLICT (409) — OTP not verified | TC-05 | TC-05 |
| VALIDATION_ERROR (400) — missing description | TC-06 | TC-06 |
| VALIDATION_ERROR (400) — invalid category | TC-07 | TC-07 |
| VALIDATION_ERROR (400) — description too long | TC-08 | TC-08 |
| RATE_LIMITED (429) | TC-09 | TC-09 |
| INTERNAL_ERROR (500) | TC-10 | TC-10 |
| Transaction rollback (no partial state) | TC-10 | TC-10 |
| Happy path — missing SLA policy (warn + null sla_due_at) | TC-11 | TC-11 |
| State machine entry: status = 'open' on creation | TC-01 | TC-01 |
| `event_outbox` GRIEVANCE_CREATED emitted in same tx | TC-01 | TC-01 |
| `event_outbox` NOT emitted if tx rolled back | TC-10 | TC-10 |
| `grievances.source = 'customer_link'` set correctly | TC-01 | TC-01 |
| SQL invariant: unique grievance_no | INV-05 | SQL |
| SQL invariant: no orphaned lead FK | INV-04 | SQL |
| SQL invariant: GRIEVANCE_CREATED matches real row | INV-06 | SQL |
| Auth: `@Public()` — no JWT required | TC-01–TC-12 (no Bearer header sent) | TC-01 |
| Auth: CustomerLinkGuard — scope isolation (only own lead) | TC-02, TC-03, TC-04, TC-05 | TC-03 |
| UI: form renders all category options | UI-01 | UI-01 |
| UI: inline validation errors | UI-02, UI-05 | UI-02 |
| UI: submit disabled while submitting | UI-04 | UI-04 |
| UI: success feedback with grievance_no | UI-06, TC-E2E-01 | UI-06 |
| E2E: full customer complaint flow | TC-E2E-01 | E2E |
| E2E: expired token handled gracefully | TC-E2E-02 | E2E |

### Mandatory coverage gates (testing-contract.md)

| Gate | Status | Note |
|---|---|---|
| Every happy path tested | PASS | TC-01, TC-11 |
| Every named error code tested | PASS | TC-02 (404), TC-03/04/05 (409), TC-06/07/08 (400), TC-09 (429), TC-10 (500) |
| Authorization negatives (token-scoped; no JWT) | PASS | TC-02–TC-05 cover token guard rejection |
| Masking | N/A | No PII returned in this endpoint's response (grievance_no, status, sla_due_at only) |
| Idempotency | N/A | No `Idempotency-Key` header on this endpoint per `api-contract.yaml` |
| Transaction rollback | PASS | TC-10 |
| Optimistic lock | N/A | `grievances` has no `version` column; `leads` not written by this FR |
| Consent gate | N/A | Token-scoped public endpoint; no `EntitlementService` consent gate applies |
| Rate limit | PASS | TC-09 |
| Append-only (`audit_logs`, `event_outbox`) | PASS | INV-06, INV-07; TC-10 confirms no partial outbox row |
