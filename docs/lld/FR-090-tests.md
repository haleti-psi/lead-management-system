# FR-090 — Partner Master & Onboarding Metadata: Test Specification

**Tier: 2** | Source LLD: `docs/lld/FR-090.md`

---

## Test Cases

Minimum required for Tier 2: 5. This specification provides 14 to cover all error codes, auth paths, state transitions, validation boundaries, and the happy paths for all three endpoints.

| # | Layer | Type | Description | Setup | Action | Expected |
|---|---|---|---|---|---|---|
| TC-01 | API | Happy path | ADMIN creates a new partner successfully | Seed org; create ADMIN user JWT | `POST /api/v1/partners` with valid `CreatePartnerDto` | HTTP 201; `data.partnerId` present; `data.status = "active"`; `data.partnerCode = "DSA-002"` |
| TC-02 | API | Happy path | ADMIN lists partners with pagination | Seed 30 partner rows; ADMIN JWT | `GET /api/v1/partners?page=1&limit=10` | HTTP 200; `data.length = 10`; `meta.pagination.total = 30`; `meta.pagination.limit = 10` |
| TC-03 | API | Happy path | ADMIN updates partner metadata | Seed one active partner; ADMIN JWT | `PATCH /api/v1/partners/{id}` with `{ legalName: "Updated Name" }` | HTTP 200; `data.legalName = "Updated Name"`; `data.updatedAt` changed |
| TC-04 | API | Happy path | ADMIN suspends an active partner | Seed one active partner; ADMIN JWT | `PATCH /api/v1/partners/{id}` with `{ status: "suspended", statusReason: "Compliance review" }` | HTTP 200; `data.status = "suspended"`; audit log row exists with `action = "partner_status_changed"` |
| TC-05 | API | Authz — negative | RM cannot access partner management | Seed one RM user JWT | `GET /api/v1/partners` | HTTP 403; `error.code = "FORBIDDEN"` |
| TC-06 | API | Authz — negative | Unauthenticated request is rejected | No JWT | `POST /api/v1/partners` with valid body | HTTP 401; `error.code = "AUTH_REQUIRED"` |
| TC-07 | API | Authz — negative | PARTNER role cannot create partners | PARTNER user JWT | `POST /api/v1/partners` with valid body | HTTP 403; `error.code = "FORBIDDEN"` |
| TC-08 | API | Error path — CONFLICT | Duplicate `partner_code` within org is rejected | Seed partner with `partner_code = "DSA-001"`; ADMIN JWT | `POST /api/v1/partners` with `partner_code = "DSA-001"` | HTTP 409; `error.code = "CONFLICT"` |
| TC-09 | API | Error path — VALIDATION | Past `validUntil` date is rejected | ADMIN JWT | `POST /api/v1/partners` with `validUntil = "2020-01-01"` | HTTP 400; `error.code = "VALIDATION_ERROR"`; `fields[0].field = "validUntil"` |
| TC-10 | API | Error path — VALIDATION | Invalid state transition `expired → active` is rejected | Seed one expired partner; ADMIN JWT | `PATCH /api/v1/partners/{id}` with `{ status: "active" }` | HTTP 400; `error.code = "VALIDATION_ERROR"`; `fields[0].field = "status"` |
| TC-11 | API | Error path — VALIDATION | Suspend without `statusReason` is rejected | Seed one active partner; ADMIN JWT | `PATCH /api/v1/partners/{id}` with `{ status: "suspended" }` (no `statusReason`) | HTTP 400; `error.code = "VALIDATION_ERROR"`; `fields[0].field = "statusReason"` |
| TC-12 | API | Error path — NOT_FOUND | Non-existent partner ID returns 404 | ADMIN JWT | `PATCH /api/v1/partners/00000000-0000-0000-0000-000000000099` with valid body | HTTP 404; `error.code = "NOT_FOUND"` |
| TC-13 | API | Authz — BM scope | BM can list only own-branch partners | Seed partners: 2 with `branch_id = branchA`, 1 with `branch_id = branchB`, 1 with `branch_id = NULL`; BM user from branchA | `GET /api/v1/partners` | HTTP 200; `data.length = 3` (2 branchA + 1 null-branch); branchB partner absent |
| TC-14 | Unit | Masking | `contact_mobile` is masked in list response | Seed partner with `contact_mobile = "9876543210"` | Call `PartnerService.list(...)` and inspect serialised output | Returned `contactMobile` matches `^[6-9][0-9]{2}x{6}[0-9]{2}$` pattern (masked); raw value not present |

---

## Unit Test Cases (Jest — `partner.service.spec.ts`)

| # | Suite | Test name | What it verifies |
|---|---|---|---|
| U-01 | `PartnerService.create` | `creates partner and emits audit + outbox in one transaction` | Calls `PartnerRepository.create`, `AuditAppender.append`, `OutboxService.emit` with the same `tx` object; commit is called once |
| U-02 | `PartnerService.create` | `throws ConflictException when DB unique constraint fires` | Mocks `PartnerRepository.create` to throw a Postgres 23505 error; asserts service throws `ConflictException` |
| U-03 | `PartnerService.update` | `throws NotFoundException when partner not found for org` | Mocks `PartnerRepository.findById` returning `undefined`; asserts `NotFoundException` |
| U-04 | `PartnerService.update` | `rejects invalid status transition expired → active` | Mocks repo returning partner with `status = "expired"`; calls update with `status = "active"`; asserts `VALIDATION_ERROR` |
| U-05 | `PartnerService.update` | `rejects suspension without statusReason` | Calls update with `{ status: "suspended" }` and no `statusReason`; asserts `VALIDATION_ERROR` with field `statusReason` |
| U-06 | `PartnerService.update` | `rejects immutable field partnerCode in update payload` | DTO with `partnerCode` present; Zod parse rejects at DTO boundary |
| U-07 | `PartnerService.update` | `writes audit log with masked contact_mobile` | Spy on `AuditAppender.append`; assert the `detail.after.contactMobile` value is masked, not raw |

---

## SQL Invariant Queries

Run after each write-path test. A passing test expects **0 rows** for each invariant.

```sql
-- INV-01: No two partners share the same partner_code within the same org
SELECT org_id, partner_code, COUNT(*) AS cnt
FROM partners
GROUP BY org_id, partner_code
HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- INV-02: No partner record with quality_score outside [0, 100]
SELECT partner_id, quality_score
FROM partners
WHERE quality_score IS NOT NULL
  AND quality_score NOT BETWEEN 0 AND 100;
-- Expected: 0 rows

-- INV-03: audit_logs rows for partner events have no raw mobile number
-- (masked format is 'XX...XX', raw is digits only, 10 chars)
SELECT audit_log_id
FROM audit_logs
WHERE entity_type = 'partner'
  AND detail::text ~ '"contactMobile"\s*:\s*"[6-9][0-9]{9}"';
-- Expected: 0 rows (raw 10-digit mobile must never appear in audit chain)

-- INV-04: Every created partner row has created_by and updated_by set to a valid user
SELECT p.partner_id
FROM partners p
LEFT JOIN users cb ON cb.user_id = p.created_by
LEFT JOIN users ub ON ub.user_id = p.updated_by
WHERE cb.user_id IS NULL OR ub.user_id IS NULL;
-- Expected: 0 rows

-- INV-05: No UPDATE or DELETE on audit_logs (append-only guarantee)
-- Verified by DB privilege: app role has REVOKE UPDATE, DELETE on audit_logs
-- Confirm at schema-level: run this query against pg_class / has_table_privilege
SELECT has_table_privilege('lms_app', 'audit_logs', 'UPDATE') AS can_update,
       has_table_privilege('lms_app', 'audit_logs', 'DELETE') AS can_delete;
-- Expected: can_update = false, can_delete = false
```

---

## UI Test Scenarios (Vitest + Testing Library)

### `PartnerForm.test.tsx`

| # | Scenario | Action | Expected |
|---|---|---|---|
| UI-01 | Renders create form with all required fields visible | Mount `PartnerForm` in create mode | All labelled inputs present; `partnerCode` and `type` are enabled |
| UI-02 | Renders edit form with immutable fields disabled | Mount `PartnerForm` in edit mode with existing partner | `partnerCode` input is disabled; `type` select is disabled |
| UI-03 | Submit with missing `legalName` shows inline error | Fill all fields except `legalName`; click Submit | Inline error `role="alert"` with "Legal name is required" text visible; form not submitted |
| UI-04 | Status change to `suspended` opens ConfirmDialog | Mount edit form with active partner; change status to `suspended` | `ConfirmDialog` renders; `statusReason` input visible |
| UI-05 | Contact mobile displayed masked in read-only row | Render `DataTable` row with `contactMobile = "98xxxxxx10"` | Cell shows masked format; no raw digits in DOM |

### `partner-management.spec.ts` (Playwright)

| # | Scenario | Steps | Expected |
|---|---|---|---|
| E2E-01 | Full create-and-list journey (ADMIN) | Login as ADMIN; navigate to `/admin/partners`; click "Add Partner"; fill form; submit; verify new row in table | New partner appears in `DataTable` with `StatusChip` showing "Active" |
| E2E-02 | Suspend partner and verify chip update | Login as ADMIN; open existing active partner; change status to `suspended`; confirm in `ConfirmDialog` | `StatusChip` changes to amber "Suspended"; toast "Partner updated" visible |
| E2E-03 | RM user cannot see Partner Management nav item | Login as RM user | `/admin/partners` link absent from `AppShell` nav; direct navigation to `/admin/partners` redirected or shows 403 page |

---

## Coverage Checklist

| Requirement | Covered by |
|---|---|
| Happy path — list | TC-02 |
| Happy path — create | TC-01 |
| Happy path — update metadata | TC-03 |
| Happy path — status change (suspend) | TC-04 |
| `AUTH_REQUIRED` (401) | TC-06 |
| `FORBIDDEN` (403) — no capability | TC-05, TC-07 |
| `NOT_FOUND` (404) | TC-12 |
| `CONFLICT` (409) — duplicate code | TC-08 |
| `VALIDATION_ERROR` (400) — field validation | TC-09 |
| `VALIDATION_ERROR` (400) — invalid status transition | TC-10 |
| `VALIDATION_ERROR` (400) — missing statusReason | TC-11 |
| Authz negative — RM denied | TC-05 |
| Authz negative — PARTNER denied | TC-07 |
| Authz negative — unauthenticated | TC-06 |
| Authz positive — BM branch scope enforced | TC-13 |
| Masking — contact_mobile masked in response | TC-14, UI-05 |
| Masking — no raw PII in audit chain | INV-03, U-07 |
| Append-only — audit_logs not updatable | INV-05 |
| Transaction rollback — atomic write | U-01 |
| State machine — valid transitions | TC-04 |
| State machine — invalid transitions | TC-10 |
| Immutable field rejection on PATCH | TC (covered by Zod DTO); U-06 |
| SQL invariants — no duplicate codes | INV-01 |
| SQL invariants — quality_score range | INV-02 |
| SQL invariants — FK integrity | INV-04 |
| UI — form validation inline errors | UI-03 |
| UI — ConfirmDialog for destructive action | UI-04 |
| UI — all view states (loading/empty/error) | UI-01, E2E-01 |
| E2E — full create-and-list journey | E2E-01 |
| E2E — suspend partner end-to-end | E2E-02 |
| E2E — RM cannot access partner management | E2E-03 |
