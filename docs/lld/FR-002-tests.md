# FR-002 — Attribute-Based Access Control (ABAC) — Test Specification

**Tier: 2 (Moderate)**
**Source LLD:** `docs/lld/FR-002.md`

All tests follow naming convention `describe('<unit>') > it('<does X> when <scenario>')`. Every error code FR-002 can raise has at least one test. Authz negative tests cover both sides (grant and deny) for every scoped capability.

---

## Test Cases

### Group A — `EntitlementService.can()` unit tests (`entitlement.service.spec.ts`)

| # | Test name | Type | Inputs | Expected output |
|---|---|---|---|---|
| A-01 | `returns granted=true with scope=O when RM has view_lead and resource owned by RM` | Unit | user=RM (branch_X, team_Y), capability=`view_lead`, resource `ownerId=user.user_id` | `{ granted: true, scope: 'O', scopePredicate: { type: 'own', userId } }` |
| A-02 | `returns granted=false (NO_CAPABILITY) when user role has no role_permission for capability` | Unit | user=ADMIN (no `view_lead` entry in role_permissions), capability=`view_lead`, resource=any lead | `{ granted: false, reason: 'NO_CAPABILITY' }` |
| A-03 | `returns granted=false (OUT_OF_SCOPE) when RM requests view_lead on a lead owned by another RM` | Unit | user=RM, capability=`view_lead`, resource `ownerId=other_user_id` | `{ granted: false, reason: 'OUT_OF_SCOPE' }` |
| A-04 | `returns granted=false (SUSPENDED_USER) when user.status = inactive` | Unit | user with `status='inactive'`, any capability | `{ granted: false, reason: 'SUSPENDED_USER' }` |
| A-05 | `returns granted=true with scope=B when BM requests view_lead on lead in own branch` | Unit | user=BM (branch_id=B1), capability=`view_lead`, resource `branchId=B1` | `{ granted: true, scope: 'B', scopePredicate: { type: 'branch', branchId: 'B1' } }` |
| A-06 | `returns granted=false (OUT_OF_SCOPE) when BM requests view_lead on lead in different branch` | Unit | user=BM (branch_id=B1), capability=`view_lead`, resource `branchId=B2` | `{ granted: false, reason: 'OUT_OF_SCOPE' }` |
| A-07 | `returns granted=true with scope=T when SM requests view_lead on lead owned by team member` | Unit | user=SM (team_id=T1), capability=`view_lead`, resource `ownerId=team_member_user_id` (in T1) | `{ granted: true, scope: 'T', scopePredicate: { type: 'team', userIds: [...] } }` |
| A-08 | `returns granted=false (OUT_OF_SCOPE) when SM requests view_lead on lead outside their team` | Unit | user=SM (team_id=T1), capability=`view_lead`, resource `ownerId=user_not_in_T1` | `{ granted: false, reason: 'OUT_OF_SCOPE' }` |
| A-09 | `returns granted=false (ADMIN_LEAD_BLOCKED) when ADMIN requests view_lead without break-glass` | Unit | user=ADMIN (no active break_glass_grant), capability=`view_lead` | `{ granted: false, reason: 'ADMIN_LEAD_BLOCKED' }` |
| A-10 | `returns granted=true when ADMIN has an active break-glass grant in scope` | Unit | user=ADMIN with `activeBreakGlassGrant = { scope_type: 'all', valid_until: future }`, capability=`view_lead` | `{ granted: true, scope: 'A', ... }` |
| A-11 | `returns granted=false (PARTNER_CROSS_ACCESS) when PARTNER requests view_lead on another partner's lead` | Unit | user=PARTNER (partner_id=P1), capability=`view_lead`, resource `partnerId=P2` | `{ granted: false, reason: 'PARTNER_CROSS_ACCESS' }` |
| A-12 | `returns granted=true with scope=P when PARTNER requests view_lead on own submitted lead` | Unit | user=PARTNER (partner_id=P1), capability=`view_lead`, resource `partnerId=P1` | `{ granted: true, scope: 'P', scopePredicate: { type: 'partner', partnerId: 'P1' } }` |
| A-13 | `returns granted=true with scope=M (masked) for DPO view_lead` | Unit | user=DPO, capability=`view_lead`, resource any lead | `{ granted: true, scope: 'M', scopePredicate: { type: 'masked', orgId } }` |
| A-14 | `deny-by-default: unknown capability string returns VALIDATION_ERROR before evaluation` | Unit | capability=`'fly_to_moon'` (not in enum) | `VALIDATION_ERROR` (400) — guard never calls EntitlementService |
| A-15 | `returns granted=false (OUT_OF_SCOPE) for user with locked status` | Unit | user `status='locked'`, valid capability | `{ granted: false, reason: 'SUSPENDED_USER' }` |

### Group B — `AbacGuard` unit tests (`abac.guard.spec.ts`)

| # | Test name | Type | Inputs | Expected |
|---|---|---|---|---|
| B-01 | `throws ForbiddenException (403) when EntitlementService returns granted=false (OUT_OF_SCOPE)` | Unit | Mock EntitlementService returning `{ granted: false, reason: 'OUT_OF_SCOPE' }` | `ForbiddenException` thrown; `AuditAppender.emit` called once |
| B-02 | `throws NotFoundException (404) when denial reason is PARTNER_CROSS_ACCESS` | Unit | Mock EntitlementService returning `{ granted: false, reason: 'PARTNER_CROSS_ACCESS' }` | `NotFoundException` thrown (existence hidden per §8.4) |
| B-03 | `attaches scopePredicate to request context on grant` | Unit | Mock EntitlementService returning `{ granted: true, scope: 'O', scopePredicate: { type: 'own', userId: 'u1' } }` | `req.scopePredicate` = `{ type: 'own', userId: 'u1' }` |
| B-04 | `does not attach scopePredicate when denied` | Unit | Mock EntitlementService returning deny | `req.scopePredicate` remains undefined |
| B-05 | `calls AuditAppender.emit on every deny path` | Unit | Any deny scenario | `AuditAppender.emit` called with deny audit record |

### Group C — `MaskingService` unit tests (`masking.service.spec.ts`)

| # | Test name | Type | Inputs | Expected |
|---|---|---|---|---|
| C-01 | `masks mobile as first-2 + Xs + last-2 for RM scope O` | Unit | mobile=`'9876543210'`, scope=`O` | `'98xxxxxx10'` |
| C-02 | `masks PAN as first-3 + Xs + last-2 for RM scope O` | Unit | pan=`'ABCDE1234F'`, scope=`O` | `'ABCxxxx4F'` |
| C-03 | `masks mobile for DPO scope M` | Unit | mobile=`'9876543210'`, scope=`M` | `'98xxxxxx10'` (same masking; DPO never gets raw) |
| C-04 | `returns last-4 token suffix only for aadhaar_ref_token at every scope` | Unit | aadhaar_ref_token=`'TOKEN_ABCD_1234'`, any scope | suffix `'1234'` or equivalent last-4 |
| C-05 | `applies strictest masking on export for DPO scope M` | Unit | pan=`'ABCDE1234F'`, scope=`M`, context=`export` | masked value (no unmasked PII in export) |
| C-06 | `returns full mobile for active break-glass grant holder` | Unit | mobile=`'9876543210'`, scope=`A`, `breakGlassActive=true` | `'9876543210'` (full; audit required separately) |
| C-07 | `masks email as first-2 chars + **** + @domain` | Unit | email=`'abc@example.com'`, scope=`O` | `'ab****@example.com'` |

### Group D — `MaskedField` component tests (`MaskedField.test.tsx`)

| # | Test name | Type | Inputs | Expected |
|---|---|---|---|---|
| D-01 | `renders masked PAN value by default` | Component | `maskedValue='ABCxxxx4F'`, `canUnmask=false` | renders `'ABCxxxx4F'`; no Reveal button |
| D-02 | `renders Reveal button when canUnmask=true` | Component | `maskedValue='98xxxxxx10'`, `canUnmask=true` | Reveal button present with `aria-label="Reveal mobile"` |
| D-03 | `calls unmask API and displays raw value on Reveal click` | Component | `canUnmask=true`; mock `apiClient.post` returns `{ rawValue: '9876543210' }` | After click: `'9876543210'` shown; skeleton displayed during load |
| D-04 | `shows Toast error when unmask API fails` | Component | `canUnmask=true`; mock `apiClient.post` throws 403 | Toast with error message shown |
| D-05 | `MaskedField renders LoadingSkeleton while unmask in flight` | Component | `canUnmask=true`; mock API delayed | Skeleton rendered during loading state |

### Group E — API integration tests (supertest, `abac.e2e-spec.ts` — Testcontainers-Postgres)

| # | Test name | Type | Setup | Expected HTTP | Expected body |
|---|---|---|---|---|---|
| E-01 | `GET /leads returns 401 AUTH_REQUIRED when no JWT present` | API | No auth header | 401 | `{ error: { code: 'AUTH_REQUIRED' } }` |
| E-02 | `GET /leads returns 403 FORBIDDEN when RM requests leads not assigned to them (OUT_OF_SCOPE)` | API | RM_A JWT; seed lead with `owner_id=RM_B` | 403 | `{ error: { code: 'FORBIDDEN' } }` — lead list filtered to zero, not leaked |
| E-03 | `GET /leads returns 403 FORBIDDEN when ADMIN requests leads without break-glass` | API | ADMIN JWT (no break_glass_grant) | 403 | `{ error: { code: 'FORBIDDEN' } }` |
| E-04 | `GET /leads/{id} returns 404 NOT_FOUND when PARTNER requests lead belonging to other partner` | API | PARTNER_P1 JWT; lead seeded with `partner_id=P2` | 404 | `{ error: { code: 'NOT_FOUND' } }` (existence hidden per PARTNER_CROSS_ACCESS rule) |
| E-05 | `GET /leads returns scope-filtered list: RM sees only own leads` | API | RM_A JWT; seed 3 leads (1 owned by RM_A, 2 by others in same branch) | 200 | `data` array has exactly 1 lead; `lead_id` = RM_A's lead |
| E-06 | `GET /leads returns scope-filtered list: BM sees all branch leads` | API | BM JWT (branch B1); seed 3 leads all in B1 | 200 | `data` has 3 leads |
| E-07 | `GET /leads/{id} returns masked PAN for RM scope` | API | RM JWT; lead with `pan_masked='ABCDE1234F'` | 200 | `lead_identities.pan_masked` = `'ABCxxxx4F'` (masked) |
| E-08 | `GET /leads returns masked mobile for DPO scope M` | API | DPO JWT; lead with mobile=`9876543210` | 200 | `lead_identities.mobile` = `'98xxxxxx10'` |
| E-09 | `GET /leads returns 403 FORBIDDEN when suspended user attempts access` | API | Seed user with `status='locked'`; generate JWT | 403 | `{ error: { code: 'FORBIDDEN' } }` |
| E-10 | `POST /leads returns 403 FORBIDDEN when RM attempts create_lead for a lead outside own scope` | API | RM_A JWT; payload assigns `branch_id` of branch not matching RM_A | 403 | `{ error: { code: 'FORBIDDEN' } }` |
| E-11 | `PATCH /leads/{id} returns 403 FORBIDDEN when SM attempts edit_lead on lead outside their team` | API | SM_T1 JWT; seed lead `owner_id` not in T1 | 403 | `{ error: { code: 'FORBIDDEN' } }` |
| E-12 | `GET /leads scope T: SM sees only team members' leads` | API | SM_T1 JWT (members: RM_A, RM_B); seed 4 leads (2 in T1, 2 in T2) | 200 | `data` has exactly 2 leads |
| E-13 | `deny event is written to audit_logs on FORBIDDEN` | API | RM_B requests RM_A's lead | 403 | Verify `SELECT COUNT(*) FROM audit_logs WHERE actor_id=$RM_B AND …` = 1 |
| E-14 | `GET /leads returns 403 when role has no view_lead permission (ADMIN without break-glass)` | API | ADMIN JWT, no break_glass_grant | 403 | `{ error: { code: 'FORBIDDEN' } }` |

---

## SQL Invariant Queries

These queries must return **0 rows** after any test run that exercises FR-002. Run against the Testcontainers database after each API integration test.

```sql
-- INV-1: No audit_log row for a deny event should have a NULL actor_id
SELECT COUNT(*)
FROM audit_logs
WHERE action IN ('lead_view','lead_update','lead_create')
  AND detail->>'denied' = 'true'
  AND actor_id IS NULL;
-- Expected: 0

-- INV-2: No lead returned in a scope-O query should have owner_id != the requesting user
-- (Verified by E-05: asserted in the test; this SQL form for post-test DB check)
-- Run parameterised with the RM's user_id as $1:
SELECT COUNT(*)
FROM leads l
WHERE l.owner_id <> $1
  AND l.deleted_at IS NULL
  AND l.org_id = '00000000-0000-0000-0000-000000000001';
-- Expected: 0 (zero rows should match an RM's view outside their scope)

-- INV-3: No lead_identities row with unmasked mobile or pan should appear in DPO-scope API responses
-- (Enforced structurally by MaskingInterceptor; SQL check is that pan/mobile columns in the
--  test-seeded data are never equal to the raw value in any API response payload.
--  This invariant is validated via the E-08 assertion, not a DB-only query.)

-- INV-4: role_permissions has no duplicate (role_id, capability) combinations
SELECT role_id, capability, COUNT(*)
FROM role_permissions
GROUP BY role_id, capability
HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- INV-5: Every user references a role that exists in role_permissions
SELECT COUNT(*)
FROM users u
LEFT JOIN role_permissions rp ON rp.role_id = u.role_id
WHERE rp.role_permission_id IS NULL
  AND u.status = 'active';
-- Expected: 0 (every active user has at least one capability defined for their role)

-- INV-6: No break_glass_grant row has approver_id = grantee_id (four-eyes constraint)
SELECT COUNT(*)
FROM break_glass_grants
WHERE approver_id = grantee_id;
-- Expected: 0 (enforced by DB CHECK constraint ck_break_glass_four_eyes; SQL is the test)
```

---

## UI Test Scenarios (Playwright, `apps/web/e2e/abac.spec.ts`)

| # | Scenario | Steps | Expected |
|---|---|---|---|
| UI-01 | RM sees masked PAN on Lead 360 page | Login as RM; navigate to a lead they own; inspect the `MaskedField` for PAN | PAN displayed as `'ABCxxxx4F'`; no Reveal button (canUnmask=false for RM) |
| UI-02 | DPO sees masked mobile on lead list | Login as DPO; open lead list; check mobile column | Mobile displayed as `'98xxxxxx10'`; no Reveal button without active break-glass |
| UI-03 | Lead outside RM's scope is absent from lead list | Login as RM_A; verify RM_B's lead `lead_code` is not present in list | `lead_code` not found in list items; no 403 visible to user (filtered silently) |
| UI-04 | ADMIN is redirected/shown FORBIDDEN when attempting lead list | Login as ADMIN (no break-glass); navigate to `/leads` | UI shows `ErrorState` with generic "You don't have access to this." message |

---

## Coverage Checklist

| Requirement | Tests |
|---|---|
| Happy path — granted access (scope O) | A-01, E-05 |
| Happy path — granted access (scope B) | A-05, E-06 |
| Happy path — granted access (scope T) | A-07, E-12 |
| Happy path — granted access (scope M, DPO) | A-13, E-08 |
| Happy path — PARTNER own-scope granted | A-12 |
| Happy path — break-glass grant enables ADMIN | A-10 |
| `AUTH_REQUIRED` (401) — no/invalid JWT | E-01 |
| `FORBIDDEN` (403) — no capability | A-02, E-14 |
| `FORBIDDEN` (403) — out of scope (O) | A-03, E-02 |
| `FORBIDDEN` (403) — out of scope (T) | A-08, E-11 |
| `FORBIDDEN` (403) — out of scope (B) | A-06, E-10 |
| `FORBIDDEN` (403) — suspended user | A-04, A-15, E-09 |
| `FORBIDDEN` (403) — ADMIN without break-glass | A-09, E-03, E-14 |
| `NOT_FOUND` (404) — PARTNER cross-access (existence hidden) | A-11, E-04 |
| Masking — PAN server-side | C-02, E-07 |
| Masking — mobile server-side | C-01, E-08 |
| Masking — aadhaar token (last-4 only) | C-04 |
| Masking — email | C-07 |
| Masking — export strictest | C-05 |
| Masking — break-glass unmasked | A-10, C-06 |
| `MaskedField` component renders masked value | D-01 |
| `MaskedField` Reveal button (canUnmask=true) | D-02 |
| `MaskedField` calls unmask API and shows raw value | D-03 |
| `MaskedField` shows error toast on unmask failure | D-04 |
| `MaskedField` shows skeleton during unmask loading | D-05 |
| Authz negative — RM cannot see another RM's lead | A-03, E-02, UI-03 |
| Authz negative — PARTNER cannot see other partner's lead | A-11, E-04 |
| Authz negative — ADMIN blocked from lead content | A-09, E-03 |
| Deny events written to `audit_logs` | B-05, E-13 |
| `AbacGuard` attaches `scopePredicate` on grant | B-03 |
| `AbacGuard` throws `ForbiddenException` on deny | B-01 |
| `AbacGuard` throws `NotFoundException` on PARTNER_CROSS_ACCESS | B-02 |
| scope predicate injected into Kysely queries (scope-filtered list) | E-05, E-06, E-12 |
| SQL invariant — no orphaned users without role_permissions | INV-5 |
| SQL invariant — no duplicate role_permissions | INV-4 |
| SQL invariant — four-eyes on break_glass_grants | INV-6 |
| E2E — RM sees masked PAN on Lead 360 | UI-01 |
| E2E — DPO sees masked mobile | UI-02 |
| E2E — ADMIN shown FORBIDDEN on lead list | UI-04 |
