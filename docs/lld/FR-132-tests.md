# FR-132: Configuration Governance — Test Specification

**Tier: 3**
**Source LLD:** `docs/lld/FR-132.md`

---

## Test Cases

| # | Layer | Scenario | Input / Setup | Expected outcome |
|---|---|---|---|---|
| T01 | API integration | Happy path — approve a pending config version (immediate activation) | POST `/admin/config/{id}/approve` with `action: "approved"`, `comment: "Looks good"`. Version in `pending`, `effective_at` null, checker ≠ maker. | 200 OK; `data.status = "active"`; `checker_id` set to caller; `audit_logs` row inserted (action `config_change`); `event_outbox` row inserted (event_code `CONFIG_CHANGED`). |
| T02 | API integration | Happy path — reject a pending config version | POST `/admin/config/{id}/approve` with `action: "rejected"`. | 200 OK; `data.status = "rejected"`; audit + outbox written. |
| T03 | API integration | Happy path — rollback an active config version with a prior rollback_ref | POST `/admin/config/{id}/rollback` with `reason: "Reverting bad config"`. Active version has `rollback_ref` pointing to a prior version. | 200 OK; `data.status = "rolled_back"`, `data.restoredVersionId` = prior version UUID; prior version now `active`; audit + outbox written; no other versions affected. |
| T04 | API integration | Rollback with no rollback_ref (first version) | POST `/admin/config/{id}/rollback`. Active version has `rollback_ref = null`. | 200 OK; `data.status = "rolled_back"`, `data.restoredVersionId = null`; no second UPDATE issued. |
| T05 | API integration | Happy path — approve with future effective_at | POST `/admin/config/{id}/approve`, `action: "approved"`, version has `effective_at` = tomorrow. | 200 OK; `data.status = "approved"` (not yet `active`); audit + outbox written. |
| T06 | API integration | Self-approval blocked (checker == maker) | POST `/admin/config/{id}/approve`. The caller's `userId` matches `maker_id` on the version. | 403 FORBIDDEN; `error.code = "FORBIDDEN"`; version remains `pending`; no audit or outbox row inserted. |
| T07 | API integration | Approve a version not in pending state (already active) | POST `/admin/config/{id}/approve` where version `status = "active"`. | 409 CONFLICT; `error.code = "CONFLICT"`; no state change. |
| T08 | API integration | Rollback a version not in active state (pending) | POST `/admin/config/{id}/rollback` where version `status = "pending"`. | 409 CONFLICT; `error.code = "CONFLICT"`; no state change. |
| T09 | API integration | Approve: id not found | POST `/admin/config/{uuid-that-does-not-exist}/approve`. | 404 NOT_FOUND; `error.code = "NOT_FOUND"`. |
| T10 | API integration | Rollback: id not found | POST `/admin/config/{uuid-that-does-not-exist}/rollback`. | 404 NOT_FOUND; `error.code = "NOT_FOUND"`. |
| T11 | API integration | Unauthenticated request (no JWT) | POST `/admin/config/{id}/approve` without `Authorization` header. | 401 AUTH_REQUIRED; `error.code = "AUTH_REQUIRED"`. |
| T12 | API integration | Authorisation negative — role without `configuration` capability (e.g. RM) | POST `/admin/config/{id}/approve` as RM user. | 403 FORBIDDEN; `error.code = "FORBIDDEN"`; no state change. |
| T13 | API integration | Authorisation negative — PARTNER role | POST `/admin/config/{id}/rollback` as PARTNER user. | 403 FORBIDDEN. PARTNER has no `configuration` capability in auth-matrix. |
| T14 | API integration | Validation error — approve with invalid `action` value | POST `/admin/config/{id}/approve` body `{ "action": "do_it" }`. | 400 VALIDATION_ERROR; `error.fields[0].field = "action"`. |
| T15 | API integration | Validation error — rollback with missing `reason` | POST `/admin/config/{id}/rollback` body `{}`. | 400 VALIDATION_ERROR; `error.fields[0].field = "reason"`. |
| T16 | API integration | Validation error — rollback with `reason` exceeding 500 chars | Body `{ "reason": "x".repeat(501) }`. | 400 VALIDATION_ERROR; `error.fields[0].field = "reason"`. |
| T17 | API integration | Validation error — invalid UUID path parameter | POST `/admin/config/not-a-uuid/approve`. | 400 VALIDATION_ERROR; `error.fields[0].field = "id"`. |
| T18 | Unit | Transaction rollback — approve writes DB but audit emit throws | Mock `AuditAppender.emit` to throw inside the UnitOfWork. | Exception propagates; entire tx rolled back; `configuration_versions.status` remains `pending`; `event_outbox` has no new row. |
| T19 | Unit | Transaction rollback — rollback writes config but outbox INSERT throws | Mock `OutboxService.emit` to throw inside the UnitOfWork for rollback. | Transaction rolled back; version remains `active`; `rollback_ref` version not re-activated. |
| T20 | API integration | Concurrent checker — optimistic guard fires | Two checkers approve the same pending version concurrently; the second UPDATE finds zero rows (status already changed). | Second request receives 409 CONFLICT. |
| T21 | Unit | State machine — valid `pending → active` transition (approve, immediate) | `ConfigGovernanceService.approve` with `action="approved"`, `effective_at=null`. | `newStatus = "active"`; `checkerId` set; no exception thrown. |
| T22 | Unit | State machine — valid `pending → rejected` transition | `ConfigGovernanceService.approve` with `action="rejected"`. | `newStatus = "rejected"`; `checkerId` set. |
| T23 | Unit | State machine — valid `active → rolled_back` + rollback_ref reactivation | `ConfigGovernanceService.rollback` with an `active` version having `rollback_ref`. | Two DB updates issued within same tx: current `→ rolled_back`, rollback_ref `→ active`. |
| T24 | Unit | State machine — invalid self-approval (`pending`, checker == maker) | `ConfigGovernanceService.approve` where `user.userId === cv.maker_id`. | Throws `ForbiddenException` before any DB write. |
| T25 | API integration | Rate limit — mutations throttled at 60/min per user | Submit 61 approve requests in under 60 seconds for the same user. | 61st request → 429 RATE_LIMITED; `error.code = "RATE_LIMITED"`. |
| T26 | API integration | Append-only guard — attempt direct UPDATE on audit_logs | Execute `UPDATE audit_logs SET …` via test DB connection (app role). | DB rejects; `audit_logs` row count unchanged (REVOKE UPDATE enforced). |
| T27 | API integration | Outbox event written atomically with approval | Approve a pending version. | A single `event_outbox` row with `event_code = "CONFIG_CHANGED"`, `aggregate_type = "configuration_versions"`, `aggregate_id = versionId` exists after commit. |
| T28 | API integration | Audit record written for approval action | Approve a pending version. | An audit row exists with `action = "config_change"`, `entity_type = "configuration_versions"`, `entity_id = versionId`, `actor_id = checkerId`. |
| T29 | API integration | Audit record written for rollback action | Rollback an active version. | An audit row exists with `action = "config_change"`, `detail.new_status = "rolled_back"`, `detail.reason` contains the provided reason. |
| T30 | E2E (Playwright) | Full maker-checker workflow: pending → checker approves → active | Log in as maker; navigate to config; create a pending version via FR-131 path; log in as checker; open Approval queue at `/admin/config`; click "Review"; set action=Approve; confirm dialog; submit. | Version row in DataTable shows `StatusChip` = active; Toast "Configuration approved" displayed; page reflects updated status on refresh. |
| T31 | E2E (Playwright) | Rollback workflow with confirm dialog | Log in as ADMIN; find an active version; click "Rollback"; `RollbackConfirmDialog` appears; type reason; confirm. | Toast "Configuration rolled back"; row `StatusChip` = rolled_back; if rollback_ref existed, prior row shows active. |
| T32 | E2E (Playwright) | Approval queue shows empty state when no pending versions | Navigate to `/admin/config` with no pending versions in DB. | `EmptyState` component visible with appropriate message. |

---

## SQL Invariant Queries

Run after each test that should not modify state. All must return 0 rows.

```sql
-- INV-01: No configuration_versions row should have checker_id = maker_id
-- (validates DB constraint ck_config_maker_checker holds)
SELECT configuration_version_id
FROM configuration_versions
WHERE checker_id IS NOT NULL
  AND checker_id = maker_id;

-- INV-02: After a successful approve (action=approved), no version should remain pending
-- that was targeted in the approve call (parameterised by :versionId)
SELECT configuration_version_id
FROM configuration_versions
WHERE configuration_version_id = :versionId
  AND status = 'pending';

-- INV-03: No two active versions for the same config_type + config_ref combination
-- (only one active version per config entity at a time)
SELECT config_type, config_ref, COUNT(*) AS cnt
FROM configuration_versions
WHERE status = 'active'
  AND config_ref IS NOT NULL
GROUP BY config_type, config_ref
HAVING COUNT(*) > 1;

-- INV-04: For a rolled_back version whose rollback_ref was re-activated,
-- the rollback_ref row must be active
SELECT cv_rollback.configuration_version_id
FROM configuration_versions cv_target
JOIN configuration_versions cv_rollback
  ON cv_rollback.configuration_version_id = cv_target.rollback_ref
WHERE cv_target.status = 'rolled_back'
  AND cv_target.rollback_ref IS NOT NULL
  AND cv_rollback.status <> 'active';

-- INV-05: After a transaction rollback test (T18/T19), the version must remain in its pre-action status
SELECT configuration_version_id
FROM configuration_versions
WHERE configuration_version_id = :versionId
  AND status NOT IN ('pending', 'active');  -- adjust to pre-action status per test

-- INV-06: audit_logs rows for config_change must never have lead_id set
-- (config changes are not lead-scoped)
SELECT audit_id
FROM audit_logs
WHERE action = 'config_change'
  AND lead_id IS NOT NULL;

-- INV-07: Each approve/rollback action produces exactly one event_outbox row with CONFIG_CHANGED
-- (run immediately after the action, parameterised by :aggregateId = versionId)
SELECT COUNT(*) AS cnt
FROM event_outbox
WHERE aggregate_type = 'configuration_versions'
  AND aggregate_id = :aggregateId
  AND event_code = 'CONFIG_CHANGED'
HAVING COUNT(*) <> 1;
```

---

## UI Test Scenarios

| # | Scenario | Component | Steps | Assertion |
|---|---|---|---|---|
| UI-01 | Pending row shows "Review" action only for checker (not maker) | `ConfigApprovalTable` | Render table with a row where `maker_id = currentUser.id`; render with different user who is a checker. | "Review" button absent for maker; present for checker. |
| UI-02 | ApproveDrawer — FORBIDDEN response maps to toast | `ApproveDrawer` | Mock `apiClient.post` to return `{ error: { code: "FORBIDDEN" } }`; submit. | Toast with "You don't have access to this." visible. |
| UI-03 | ApproveDrawer — CONFLICT response maps to toast | `ApproveDrawer` | Mock `apiClient.post` to return `{ error: { code: "CONFLICT" } }`; submit. | Toast with "This action conflicts with the current state. Refresh and retry." visible. |
| UI-04 | RollbackConfirmDialog — submit disabled until reason entered | `RollbackConfirmDialog` | Render dialog; inspect confirm button before and after typing reason. | Confirm button disabled when reason empty; enabled once reason has ≥ 1 char. |
| UI-05 | StatusChip renders correct colour per status | `StatusChip` | Render with each `config_change_status` value. | `pending` = yellow, `active` = green, `rejected` = red, `rolled_back` = grey, `approved` = blue. |
| UI-06 | Empty state when no pending versions | `ConfigGovernancePage` | Mock query returning empty list. | `EmptyState` component renders with non-empty heading and description. |
| UI-07 | LoadingSkeleton shown during fetch | `ConfigApprovalTable` | Set query to loading state (`isLoading=true`). | `LoadingSkeleton` rendered; no table rows. |
| UI-08 | WCAG — all buttons keyboard reachable | `ConfigGovernancePage` | Run automated a11y (axe or Playwright `checkAccessibility`). | No accessibility violations at AA level. |

---

## Coverage Checklist

- [x] Happy path: approve (immediate activation) — T01
- [x] Happy path: approve (future effective_at → approved status) — T05
- [x] Happy path: reject — T02
- [x] Happy path: rollback with rollback_ref — T03
- [x] Happy path: rollback without rollback_ref — T04
- [x] Error code AUTH_REQUIRED (401) — T11
- [x] Error code FORBIDDEN (403) — T12, T13 (role-based authz negative)
- [x] Error code FORBIDDEN (403) — T06 (self-approval)
- [x] Error code NOT_FOUND (404) — T09, T10
- [x] Error code CONFLICT (409) — T07, T08, T20
- [x] Error code VALIDATION_ERROR (400) — T14, T15, T16, T17
- [x] Error code RATE_LIMITED (429) — T25
- [x] Authorization negatives (RM, PARTNER) — T12, T13
- [x] State machine transitions (valid: pending→active, pending→rejected, active→rolled_back) — T21, T22, T23
- [x] State machine invalid transitions (self-approval, wrong-status) — T24, T07, T08
- [x] Transaction rollback on mid-write failure — T18, T19
- [x] Concurrent checker optimistic guard — T20
- [x] Append-only audit_logs guard — T26
- [x] Outbox event written atomically — T27
- [x] Audit record created for approve — T28
- [x] Audit record created for rollback — T29
- [x] SQL invariants (no checker=maker, no dual-active, rollback_ref consistency) — INV-01..INV-07
- [x] E2E: full maker-checker workflow — T30
- [x] E2E: rollback workflow with confirm dialog — T31
- [x] E2E: empty state — T32
- [x] UI: WCAG 2.1 AA keyboard accessibility — UI-08
- [x] UI: error code → user message mapping — UI-02, UI-03
- [x] UI: destructive action uses ConfirmDialog with reason — UI-04, T31
