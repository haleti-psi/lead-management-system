# FR-003-tests: Break-Glass Privileged Access — Test Specification

**Tier: 3**
**Source LLD:** `docs/lld/FR-003.md`

---

## Test Cases

Minimum required for Tier 3: ≥ 10 test cases covering happy paths, every named error code, authz (both ways), validation, state transitions (valid + invalid), idempotency, and the expiry/revocation lifecycle.

| # | Layer | Describe | Scenario (`it(…)`) | Input / Setup | Expected Result | Error code |
|---|---|---|---|---|---|---|
| T01 | API integration | `POST /admin/break-glass` | returns 201 and creates a grant when ADMIN provides valid fields and a different nominated approver | ADMIN JWT; valid body with `granteeId ≠ approverId ≠ requesterId`, `reason`, `scopeType=lead`, `scopeRef=<lead_uuid>`, window ≤ max | HTTP 201; `data.status = 'active'` (logically pending until approve); row in `break_glass_grants`; audit intent queued | — |
| T02 | API integration | `POST /admin/break-glass/{id}/approve` | activates the grant and records approver when correct nominated approver calls approve | Setup: grant from T01 (approver_id set to user B); call approve as user B | HTTP 200; `data.status = 'active'`; `data.approverId = userB.id`; audit intent with `grant_approved` | — |
| T03 | Unit | `BreakGlassService.request` | raises FORBIDDEN when approver equals grantee (self-approval at request time) | `approverId === granteeId` | Throws `ForbiddenException`; no DB write | `FORBIDDEN` 403 |
| T04 | API integration | `POST /admin/break-glass/{id}/approve` | raises FORBIDDEN when the calling user is not the nominated approver | Grant has `approver_id = userB`; call approve as `userC` | HTTP 403; error code `FORBIDDEN` | `FORBIDDEN` 403 |
| T05 | API integration | `POST /admin/break-glass/{id}/approve` | raises FORBIDDEN when the calling approver is the same as the grantee (self-approval at approve time) | Create grant where `grantee_id = userA`; call approve as `userA` (should have been caught at create, but tests the approve guard too) | HTTP 403; error code `FORBIDDEN` | `FORBIDDEN` 403 |
| T06 | API integration | `POST /admin/break-glass` | raises FORBIDDEN when called by a role without break_glass capability (RM) | RM JWT | HTTP 403; error code `FORBIDDEN` | `FORBIDDEN` 403 |
| T07 | API integration | `POST /admin/break-glass` | raises AUTH_REQUIRED when called without a JWT | No `Authorization` header | HTTP 401; error code `AUTH_REQUIRED` | `AUTH_REQUIRED` 401 |
| T08 | Unit | `BreakGlassService` / Zod schema | raises VALIDATION_ERROR when `validUntil <= validFrom` | `validFrom = T`, `validUntil = T` (equal) | 400; `fields[0].field = 'validUntil'`; message about window order | `VALIDATION_ERROR` 400 |
| T09 | Unit | `BreakGlassService` / Zod schema | raises VALIDATION_ERROR when window exceeds BREAK_GLASS_MAX_WINDOW_HOURS | Window = max + 1 hour | 400; `fields[0].field = 'validUntil'`; message includes max hours | `VALIDATION_ERROR` 400 |
| T10 | Unit | `BreakGlassService` / Zod schema | raises VALIDATION_ERROR when reason is blank | `reason = ''` | 400; `fields[0].field = 'reason'` | `VALIDATION_ERROR` 400 |
| T11 | Unit | `BreakGlassService` / Zod schema | raises VALIDATION_ERROR when reason exceeds 500 chars | `reason = 'x'.repeat(501)` | 400; `fields[0].field = 'reason'` | `VALIDATION_ERROR` 400 |
| T12 | Unit | `BreakGlassService` / Zod schema | raises VALIDATION_ERROR when `scopeType = 'lead'` and `scopeRef` is null | `scopeType = 'lead'`, `scopeRef = null` | 400; `fields[0].field = 'scopeRef'` | `VALIDATION_ERROR` 400 |
| T13 | API integration | `POST /admin/break-glass/{id}/approve` | raises NOT_FOUND when grant_id does not exist | Non-existent `grant_id` UUID | HTTP 404; error code `NOT_FOUND` | `NOT_FOUND` 404 |
| T14 | API integration | `POST /admin/break-glass/{id}/approve` | raises CONFLICT when the grant is already active (re-approve attempt) | Call approve twice as the same valid approver | Second call: HTTP 409; error code `CONFLICT` | `CONFLICT` 409 |
| T15 | Unit | `BreakGlassExpiryJob` | sets grant status to `expired` for grants whose `valid_until <= now()` | Grant with `valid_until = past timestamp`, status = `active` | `status = 'expired'` in DB; audit intent with `grant_expired` | — |
| T16 | Unit | `BreakGlassExpiryJob` | does not expire grants whose `valid_until > now()` | Grant with `valid_until = future timestamp`, status = `active` | `status` unchanged | — |
| T17 | Unit | `BreakGlassService.revoke` | sets grant status to `revoked` and emits audit event | Active grant; `revoke(grantId, actorId, tx)` | DB `status = 'revoked'`; audit intent with `grant_revoked` | — |
| T18 | API integration | `EntitlementService.can` (integrated) | ADMIN can access lead content when an active, approved break-glass grant exists covering that lead | Create and approve grant for ADMIN user with `scopeType=lead`, `scopeRef=leadId`; call a lead-read endpoint as ADMIN | HTTP 200; audit_logs row with `action='break_glass_access'`, `entity_id=leadId`, `detail.grant_id=grantId` | — |
| T19 | API integration | `EntitlementService.can` (integrated) | ADMIN is denied lead content when no active break-glass grant exists | ADMIN JWT; no grants in DB for that user | HTTP 403; error code `FORBIDDEN`; no `break_glass_access` audit row | `FORBIDDEN` 403 |
| T20 | API integration | `EntitlementService.can` (integrated) | ADMIN is denied lead content after grant `valid_until` has passed (expired mid-session) | Create and approve grant with `valid_until = now - 1 min`; call lead-read as ADMIN | HTTP 403; error code `FORBIDDEN` | `FORBIDDEN` 403 |
| T21 | API integration | `EntitlementService.can` (integrated) | ADMIN is denied lead content after grant is revoked | Create, approve, then revoke grant; call lead-read as ADMIN | HTTP 403; error code `FORBIDDEN` | `FORBIDDEN` 403 |
| T22 | Unit | `UnitOfWork` / `BreakGlassService.request` | rolls back entirely when AuditAppender.emit throws mid-transaction | Mock `AuditAppender.emit` to throw; call `request()` | No row in `break_glass_grants`; transaction rolled back; no partial state | — |
| T23 | Unit | `UnitOfWork` / `BreakGlassService.approve` | rolls back entirely when the UPDATE fails mid-transaction | Mock DB update to throw; call `approve()` | `status` unchanged in DB; no audit row; transaction rolled back | — |
| T24 | API integration | ABAC scope | DPO (scope M) can request a break-glass grant with valid body | DPO JWT; valid body | HTTP 201; grant created | — |
| T25 | API integration | ABAC scope | RM cannot see the /admin/break-glass endpoint | RM JWT; `POST /admin/break-glass` | HTTP 403 | `FORBIDDEN` 403 |
| T26 | Unit | `BreakGlassService` / Zod schema | raises VALIDATION_ERROR when `scopeType` is not one of the allowed values | `scopeType = 'department'` | 400; `fields[0].field = 'scopeType'` | `VALIDATION_ERROR` 400 |
| T27 | Unit | `BreakGlassRepository.findActiveForUser` | does not return grants for a different org | Two orgs; grant belongs to org A; query with org B user | Returns `undefined` | — |
| T28 | API integration | Audit append-only | UPDATE on `audit_logs` is rejected by the DB | Attempt `UPDATE audit_logs SET detail = '{}' WHERE …` in test tx | DB error (REVOKE UPDATE on the app role); row unchanged | — |

---

## SQL Invariant Queries

Run these after key operations to assert database correctness. Expect **0 rows** from each.

```sql
-- INV-1: No break_glass_grants row where approver_id = grantee_id (four-eyes constraint)
SELECT grant_id FROM break_glass_grants
WHERE approver_id = grantee_id;
-- EXPECT: 0 rows

-- INV-2: No active grant whose valid_until is in the past
-- (after the expiry sweep job has run)
SELECT grant_id FROM break_glass_grants
WHERE status = 'active'
  AND valid_until <= now();
-- EXPECT: 0 rows (post-sweep)

-- INV-3: No grant where valid_until <= valid_from (window constraint)
SELECT grant_id FROM break_glass_grants
WHERE valid_until <= valid_from;
-- EXPECT: 0 rows

-- INV-4: Every break_glass_access audit row references a valid grant
SELECT al.audit_id
FROM audit_logs al
WHERE al.action = 'break_glass_access'
  AND (al.detail->>'grant_id') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM break_glass_grants bgg
    WHERE bgg.grant_id = (al.detail->>'grant_id')::uuid
  );
-- EXPECT: 0 rows

-- INV-5: No break_glass_access audit row with raw PII in detail
-- (detail must not contain 'name', 'mobile', 'pan', 'aadhaar')
SELECT audit_id FROM audit_logs
WHERE action = 'break_glass_access'
  AND (
    detail::text ILIKE '%"name"%'
    OR detail::text ILIKE '%"mobile"%'
    OR detail::text ILIKE '%"pan"%'
    OR detail::text ILIKE '%"aadhaar"%'
  );
-- EXPECT: 0 rows

-- INV-6: No UPDATE on audit_logs (append-only; all rows have created_at = updated_at)
-- (validated by the DB REVOKE; this query is a belt-and-braces check in test data)
SELECT audit_id FROM audit_logs
WHERE updated_at <> created_at;
-- EXPECT: 0 rows

-- INV-7: No break_glass_grants row without org_id
SELECT grant_id FROM break_glass_grants WHERE org_id IS NULL;
-- EXPECT: 0 rows

-- INV-8: No orphaned grantee_id or approver_id
SELECT bgg.grant_id FROM break_glass_grants bgg
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = bgg.grantee_id)
   OR NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = bgg.approver_id);
-- EXPECT: 0 rows
```

---

## UI Test Scenarios (Playwright)

| # | Scenario | Steps | Expected |
|---|---|---|---|
| UI-01 | ADMIN requests a break-glass grant via the modal | Log in as ADMIN; navigate to Compliance Console → Break-Glass; click "Request Grant"; fill all fields (grantee ≠ approver ≠ self, valid window, reason); submit | Grant appears in ApprovalQueueTable for the nominated approver; Toast "Grant requested. Awaiting approver confirmation." |
| UI-02 | Nominated DPO approver sees and approves the pending grant | Log in as nominated DPO approver; navigate to Break-Glass → Approval Queue; click "Approve"; ConfirmDialog appears; confirm | Grant moves to BreakGlassGrantsTable with StatusChip "active"; Toast "Break-glass grant approved and active." |
| UI-03 | Form validation prevents self-approval at request time | As ADMIN; open Request Grant modal; set granteeId = self; attempt submit | Inline error on approverId or granteeId field: "Approver must be different from grantee"; no network call |
| UI-04 | FORBIDDEN state is shown when an RM navigates to the break-glass URL directly | Log in as RM; navigate to `/admin/break-glass` | Page shows `ErrorState` (403) or is not rendered in the role-filtered nav |
| UI-05 | Expired grant shows correct StatusChip | Set `valid_until` to 1 minute in the past; run expiry sweep; reload BreakGlassGrantsTable as ADMIN | Grant row shows StatusChip "expired" (muted); ADMIN cannot use it for lead access |

---

## Coverage Checklist

- [x] Happy path: create grant (T01)
- [x] Happy path: four-eyes approve (T02)
- [x] Error — FORBIDDEN (approver = grantee at create time) (T03)
- [x] Error — FORBIDDEN (wrong approver calls approve) (T04)
- [x] Error — FORBIDDEN (approver = grantee at approve time) (T05)
- [x] Error — FORBIDDEN (role without capability) (T06)
- [x] Error — AUTH_REQUIRED (no JWT) (T07)
- [x] Error — VALIDATION_ERROR: window inverted (T08)
- [x] Error — VALIDATION_ERROR: window exceeds max (T09)
- [x] Error — VALIDATION_ERROR: reason blank (T10)
- [x] Error — VALIDATION_ERROR: reason too long (T11)
- [x] Error — VALIDATION_ERROR: scopeRef missing for scoped type (T12)
- [x] Error — NOT_FOUND: grant not found (T13)
- [x] Error — CONFLICT: re-approve (T14)
- [x] State machine: active → expired (expiry sweep) (T15, T16)
- [x] State machine: active → revoked (early revoke) (T17)
- [x] Valid state: EntitlementService grants access with active grant (T18)
- [x] Invalid state: EntitlementService denies without active grant (T19)
- [x] Invalid state: EntitlementService denies when grant expired (T20)
- [x] Invalid state: EntitlementService denies when grant revoked (T21)
- [x] Transaction rollback on audit-emit failure (T22)
- [x] Transaction rollback on DB update failure (T23)
- [x] Authz negative (RM cannot call endpoint) (T25)
- [x] Authz positive (DPO can request) (T24)
- [x] ABAC scope: cross-org isolation (T27)
- [x] Audit append-only enforcement (T28)
- [x] SQL invariants: four-eyes, no expired-active, window, audit PII masking (INV-1 through INV-8)
- [x] UI: full request→approve workflow (UI-01, UI-02)
- [x] UI: client-side validation prevents self-approval (UI-03)
- [x] UI: role-filtered nav hides break-glass from RM (UI-04)
- [x] UI: expired StatusChip renders correctly (UI-05)
