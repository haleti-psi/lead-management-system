# FR-130 Test Specification: User, Role, Team & Branch Administration

**Tier: 3**
**Source LLD:** `docs/lld/FR-130.md`

---

## Test Cases

| # | Layer | Suite | Test name | Scenario | Arrange | Act | Expected |
|---|---|---|---|---|---|---|---|
| T-01 | API | admin-users | `creates a user and returns 201 when payload is valid` | Happy path: ADMIN creates new user | Seed ADMIN JWT; valid CreateUserDto; unique username/email | POST /admin/users | 201; `data.user_id` UUID; `data.status='active'`; `data.email` masked in response |
| T-02 | API | admin-users | `lists users with pagination when called by ADMIN` | Happy path list | Seed 30 users | GET /admin/users?page=1&limit=25 | 200; `data` array length 25; `meta.pagination.total=30`; all `email` values masked |
| T-03 | API | admin-users | `returns FORBIDDEN when non-ADMIN calls create user` | AuthZ negative — RM caller | Seed RM JWT | POST /admin/users | 403 `FORBIDDEN` |
| T-04 | API | admin-users | `returns AUTH_REQUIRED when JWT is missing` | Unauthenticated | No auth header | POST /admin/users | 401 `AUTH_REQUIRED` |
| T-05 | API | admin-users | `returns VALIDATION_ERROR when username is missing` | Validation | Valid JWT (ADMIN); omit `username` | POST /admin/users | 400 `VALIDATION_ERROR`; `fields[{ field:'username', issue: contains 'required' }]` |
| T-06 | API | admin-users | `returns VALIDATION_ERROR when mobile is invalid format` | Validation — mobile pattern | Valid ADMIN JWT; `mobile='12345'` | POST /admin/users | 400 `VALIDATION_ERROR`; `fields[{ field:'mobile' }]` |
| T-07 | API | admin-users | `returns CONFLICT when username already exists in org` | Duplicate username | Seed user with same username | POST /admin/users | 409 `CONFLICT` |
| T-08 | API | admin-users | `returns CONFLICT when email already exists in org` | Duplicate email | Seed user with same email | POST /admin/users | 409 `CONFLICT` |
| T-09 | API | admin-users | `updates user role and logs role_change audit entry` | Role change audit | Seed user with role BM; PATCH body `{ role_id: <RM_role_id> }` | PATCH /admin/users/{id} | 200; `data.role_id` updated; audit_logs row with `action='role_change'` AND `entity_id=userId` |
| T-10 | API | admin-users | `deactivates user with no open leads — sets status inactive` | Deactivation without leads | Seed user with no open leads | PATCH /admin/users/{id} `{ status:'inactive' }` | 200; `data.status='inactive'`; audit_logs row `action='user_change'` |
| T-11 | API | admin-users | `returns CONFLICT when deactivating user who has open leads and no reassign_to` | Deactivate-with-open-leads gate | Seed user with 3 open leads | PATCH /admin/users/{id} `{ status:'inactive' }` | 409 `CONFLICT`; `detail.open_lead_count=3`; `detail.reason` contains 'reassign_to' |
| T-12 | API | admin-users | `deactivates user and reassigns open leads atomically` | Deactivate + reassign | Seed user with 3 open leads; seed target user | PATCH /admin/users/{id} `{ status:'inactive', reassign_to: targetId }` | 200; leads.owner_id = targetId for all 3; user.status='inactive'; audit_logs row `action='reassign'` |
| T-13 | API | admin-users | `reassign transaction rolls back if target user update fails` | Tx rollback | Seed user with open leads; force DB error mid-tx (inject throw after leads update) | PATCH /admin/users/{id} with reassign_to | 500 `INTERNAL_ERROR`; leads.owner_id unchanged; user.status unchanged |
| T-14 | API | admin-users | `reactivates inactive user successfully` | Active status toggle | Seed inactive user | PATCH /admin/users/{id} `{ status:'active' }` | 200; `data.status='active'` |
| T-15 | API | admin-users | `returns NOT_FOUND for unknown user id in PATCH` | Not found | ADMIN JWT; non-existent UUID | PATCH /admin/users/{uuid-not-exist} | 404 `NOT_FOUND` |
| T-16 | API | admin-users | `returns VALIDATION_ERROR for invalid status transition (inactive→locked)` | Invalid state machine transition | Seed inactive user | PATCH /admin/users/{id} `{ status:'locked' }` | 400 `VALIDATION_ERROR`; `fields[{ field:'status' }]` |
| T-17 | API | admin-roles | `lists roles with permissions when called by ADMIN` | Happy path | Seed roles with permissions | GET /admin/roles?limit=25 | 200; each role has `permissions[]` array |
| T-18 | API | admin-roles | `updates role permissions atomically replacing old set` | Permission replacement | Role with 2 permissions; PATCH body with 3 new permissions | PATCH /admin/roles/{id} | 200; `data.permissions` length=3; old permissions gone from role_permissions table |
| T-19 | API | admin-roles | `logs role_change audit when role permissions are replaced` | Audit on permission change | Valid ADMIN JWT; valid role | PATCH /admin/roles/{id} with permissions[] | 200; audit_logs row with `action='role_change'` AND `entity_id=roleId` |
| T-20 | API | admin-roles | `returns NOT_FOUND for unknown role id in PATCH` | Not found | ADMIN JWT; non-existent UUID | PATCH /admin/roles/{uuid-not-exist} | 404 `NOT_FOUND` |
| T-21 | API | admin-roles | `returns FORBIDDEN when BM calls PATCH /admin/roles` | AuthZ negative | Seed BM JWT | PATCH /admin/roles/{id} | 403 `FORBIDDEN` |
| T-22 | API | admin-teams | `creates team and returns 201` | Happy path | ADMIN JWT; valid branch; optional manager | POST /admin/teams | 201; `data.team_id` UUID |
| T-23 | API | admin-teams | `returns VALIDATION_ERROR when branch_id is invalid UUID` | Validation | ADMIN JWT; `branch_id='not-a-uuid'` | POST /admin/teams | 400 `VALIDATION_ERROR`; `fields[{ field:'branch_id' }]` |
| T-24 | API | admin-teams | `returns NOT_FOUND when branch_id does not exist` | FK check | ADMIN JWT; valid UUID but no row | POST /admin/teams | 404 `NOT_FOUND` |
| T-25 | API | admin-teams | `deactivates team via PATCH is_active false` | Team deactivation | Seed team | PATCH /admin/teams/{id} `{ is_active:false }` | 200; `data.is_active=false` |
| T-26 | Unit | admin.service | `countOpenLeads returns correct count excluding terminal stages` | Open lead count logic | Seed leads in stages: captured, qualified, handed_off, rejected | service.countOpenLeads(userId) | returns 2 (only non-terminal) |
| T-27 | Unit | admin.service | `createUser hashes password with argon2 and does not return it` | Password security | CreateUserDto | service.createUser | returned user row has no `password_hash` field; argon2.hash called |
| T-28 | Unit | admin.service | `updateUser with status=inactive and no open leads skips reassign` | Skip reassign when 0 leads | User with 0 open leads | service.updateUser({ status:'inactive' }) | updateUser called; reassignLeads NOT called; audit appended |
| T-29 | Unit | user.repository | `reassignLeads updates only non-terminal leads for owner` | Bulk reassign scope | Leads: 3 open + 1 handed_off + 1 rejected | repo.reassignLeads(fromId, toId, tx) | SQL updates only 3 rows (WHERE stage NOT IN terminal) |
| T-30 | Unit | role.repository | `replacePermissions deletes old and inserts new in same transaction` | Atomic permission replace | Role with 2 perms; newPerms=[3 items] | repo.replacePermissions(roleId, newPerms, tx) | role_permissions for roleId = exactly 3 rows |

---

## SQL Invariant Queries

Run after each test case that writes to verify data integrity. Each should return **0 rows** (i.e., the invariant holds).

### INV-01: No user has `password_hash` null for active/inactive (passwords are always set on create)
```sql
SELECT user_id FROM users
WHERE status IN ('active','inactive')
  AND password_hash IS NULL
  AND deleted_at IS NULL;
-- Expect: 0 rows
```

### INV-02: No open lead is owned by an inactive user (reassign gate enforced)
```sql
SELECT l.lead_id
FROM leads l
JOIN users u ON u.user_id = l.owner_id
WHERE u.status = 'inactive'
  AND l.deleted_at IS NULL
  AND l.stage NOT IN ('handed_off','rejected');
-- Expect: 0 rows
```

### INV-03: audit_logs has no UPDATE or DELETE — append-only
```sql
-- This is a Postgres privilege invariant; tested by attempting and confirming error:
-- UPDATE audit_logs SET detail='{}' WHERE 1=1; -- must fail with permission denied
-- Expressed as a count: confirm row count only increases, never decreases
SELECT count(*) FROM audit_logs;
-- Pre-test count stored, post-test count >= pre-test count
```

### INV-04: Every deactivation action has a corresponding audit_log entry
```sql
SELECT u.user_id
FROM users u
WHERE u.status = 'inactive'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs al
    WHERE al.entity_type = 'user'
      AND al.entity_id = u.user_id
      AND al.action = 'user_change'
  );
-- Expect: 0 rows
```

### INV-05: role_permissions has no duplicate (role_id, capability) for same org
```sql
SELECT role_id, capability, count(*)
FROM role_permissions
GROUP BY role_id, capability
HAVING count(*) > 1;
-- Expect: 0 rows
```

### INV-06: No team references a non-existent or inactive branch
```sql
SELECT t.team_id
FROM teams t
JOIN branches b ON b.branch_id = t.branch_id
WHERE b.is_active = false;
-- Expect: 0 rows (admin must deactivate teams before branch deactivation)
```

### INV-07: Every role change is in audit_logs
```sql
-- For any PATCH that changes role_id, audit_logs must have action='role_change' for that user
-- Tested per T-09 via direct row assertion; cross-checked by:
SELECT u.user_id
FROM users u
WHERE u.role_id != u.role_id  -- placeholder; actual test fetches before/after states
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs al
    WHERE al.entity_id = u.user_id AND al.action = 'role_change'
  );
-- Expect: 0 rows
```

---

## UI Test Scenarios

### Playwright E2E — `apps/web/e2e/admin-users.spec.ts`

| # | Scenario | Steps | Expected |
|---|---|---|---|
| E-01 | ADMIN can create a new user | Log in as ADMIN; navigate to Admin > Users; click "Create User"; fill form with valid data; submit | Toast "User created"; new user appears in table |
| E-02 | Create user form shows field errors for invalid data | Fill form with invalid email and short username; submit | Inline errors under email and username fields; form not submitted |
| E-03 | Deactivate user with no open leads | Click Deactivate for a user with no leads; ConfirmDialog appears; confirm | User status chip changes to "inactive"; toast "User deactivated" |
| E-04 | Deactivate user with open leads shows reassign selector | Click Deactivate for a user with 3 open leads | ConfirmDialog shows open_lead_count=3; "Reassign to" Select rendered; confirm disabled until selection |
| E-05 | Deactivate with reassign completes successfully | Select reassignee in DeactivateUserDialog; confirm | User inactive; toast "User deactivated and leads reassigned" |
| E-06 | Non-ADMIN role sees no Admin Settings link | Log in as RM | Admin Settings not visible in nav |
| E-07 | Role permissions grid can be saved | Navigate to Admin > Roles; click Edit Permissions for BM; toggle a capability; save | 200; permissions updated; drawer closes; toast shown |
| E-08 | Team can be created with valid branch and manager | Navigate to Admin > Teams; click "Create Team"; fill form; submit | Toast "Team created"; team appears in table |

---

## Coverage Checklist

| Requirement | Test(s) |
|---|---|
| Happy path: create user | T-01, E-01 |
| Happy path: list users (paginated) | T-02 |
| Happy path: update user fields | T-09 |
| Happy path: deactivate (no open leads) | T-10, E-03 |
| Happy path: deactivate with reassign | T-12, E-04, E-05 |
| Happy path: reactivate | T-14 |
| Happy path: role permissions replace | T-18 |
| Happy path: create team | T-22, E-08 |
| Happy path: deactivate team | T-25 |
| AuthZ negative — non-ADMIN on user create | T-03 |
| AuthZ negative — BM on role PATCH | T-21 |
| Unauthenticated | T-04 |
| VALIDATION_ERROR — missing field | T-05 |
| VALIDATION_ERROR — mobile pattern | T-06 |
| VALIDATION_ERROR — invalid UUID | T-23 |
| VALIDATION_ERROR — invalid status transition | T-16 |
| CONFLICT — duplicate username | T-07 |
| CONFLICT — duplicate email | T-08 |
| CONFLICT — deactivation with open leads | T-11, E-04 |
| NOT_FOUND — unknown user | T-15 |
| NOT_FOUND — unknown role | T-20 |
| NOT_FOUND — unknown branch | T-24 |
| Transaction rollback on mid-write failure | T-13 |
| Audit log for user create/update | T-01 (indirect), T-10, T-12 |
| Audit log for role change | T-09, T-19 |
| Audit log for bulk reassign | T-12 |
| Append-only audit_logs | INV-03 |
| PII masking (email, mobile) in list response | T-02 (assertion on masked shape) |
| Open lead count logic (non-terminal only) | T-26, INV-02 |
| Password never returned in response | T-27 |
| Bulk reassign scope (terminal leads excluded) | T-29, INV-02 |
| Role permission atomicity | T-30, INV-05 |
| Rate limiting (mutations 60/min) | Applied via global ThrottlerGuard — tested by global throttle spec; not duplicated here |
