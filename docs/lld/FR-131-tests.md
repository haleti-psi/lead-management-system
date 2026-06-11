# FR-131: Master Configuration — Test Specification

**Tier: 3**
**Source LLD:** `docs/lld/FR-131.md`

---

## Test Cases

| # | Layer | Test name | Scenario | Expected result |
|---|---|---|---|---|
| T01 | API integration | `listMaster returns paginated rejection reasons for ADMIN` | ADMIN actor, GET `/admin/rejection-reasons?page=1&limit=10` | 200; `data` array with up to 10 items; `meta.pagination.total` > 0; all items have `rejectionReasonId`, `primaryReason`, `isActive` |
| T02 | API integration | `listMaster applies is_active filter` | ADMIN, GET `/admin/rejection-reasons?filter[is_active]=false` | 200; all returned records have `isActive = false` |
| T03 | API integration | `listMaster defaults to page=1 limit=25` | ADMIN, GET `/admin/rejection-reasons` with no pagination params | 200; `meta.pagination.page=1`, `meta.pagination.limit=25` |
| T04 | API integration | `listMaster enforces max limit=100` | ADMIN, GET `/admin/rejection-reasons?limit=200` | 400 `VALIDATION_ERROR`; `fields[0].field='limit'` |
| T05 | API integration | `listMaster rejects unknown masterResource` | ADMIN, GET `/admin/nonexistent-type` | 400 `VALIDATION_ERROR`; `fields[0].field='masterResource'` |
| T06 | API integration | `listMaster denied for RM (no configuration capability)` | Authenticated RM, GET `/admin/rejection-reasons` | 403 `FORBIDDEN` |
| T07 | API integration | `listMaster denied for unauthenticated request` | No JWT, GET `/admin/rejection-reasons` | 401 `AUTH_REQUIRED` |
| T08 | API integration | `listMaster denied for PARTNER actor` | PARTNER actor, GET `/admin/sla-policies` | 403 `FORBIDDEN` |
| T09 | API integration | `createMaster creates rejection reason for ADMIN` | ADMIN, POST `/admin/rejection-reasons` with valid body `{primaryReason: "out_of_area", subReason: "pin not serviceable", requiresRemarks: true}` | 201; response has `rejectionReasonId` (UUID), `isActive=true`, `configVersionId` (UUID); DB: row exists in `rejection_reasons`; `configuration_versions` row exists with `config_type='rejection_reason'`, `maker_id=actorId`; `event_outbox` has `event_code='CONFIG_CHANGED'` |
| T10 | API integration | `createMaster creates allocation rule for HEAD` | HEAD actor, POST `/admin/allocation-rules` with valid body | 201; DB: row in `allocation_rules`; `configuration_versions` row; `event_outbox` CONFIG_CHANGED |
| T11 | API integration | `createMaster creates SLA policy for ADMIN` | ADMIN, POST `/admin/sla-policies` with `{name, appliesTo:"first_contact", thresholdMinutes:60, escalationChain:[]}` | 201; `slaPolicyId` UUID; DB: row in `sla_policies` with `threshold_minutes=60` |
| T12 | API integration | `createMaster creates business calendar with working hours and holidays` | ADMIN, POST `/admin/business-calendars` with full `workingHours` object and `holidays` array | 201; DB: row in `business_calendars` with `working_hours` and `holidays` as JSONB |
| T13 | API integration | `createMaster creates branch linked to existing region` | ADMIN, POST `/admin/branches` with valid `regionId` | 201; DB: row in `branches` with `region_id` set |
| T14 | API integration | `createMaster creates scheme with valid date range` | ADMIN, POST `/admin/schemes` with `validFrom="2026-01-01"`, `validTo="2026-12-31"` | 201; DB: row in `schemes`; `valid_from <= valid_to` |
| T15 | API integration | `createMaster returns CONFLICT on duplicate code` | ADMIN, POST `/admin/business-calendars` with a `code` that already exists in the org | 409 `CONFLICT`; DB: only one `business_calendars` row with that code |
| T16 | API integration | `createMaster returns CONFLICT on duplicate allocation_rule priority_order` | ADMIN, POST `/admin/allocation-rules` with a `priorityOrder` already used by another active rule | 409 `CONFLICT` |
| T17 | API integration | `createMaster returns VALIDATION_ERROR for missing required field` | ADMIN, POST `/admin/sla-policies` body omitting `thresholdMinutes` | 400 `VALIDATION_ERROR`; `fields` contains `{field:'thresholdMinutes', issue: ...}` |
| T18 | API integration | `createMaster returns VALIDATION_ERROR for invalid enum value` | ADMIN, POST `/admin/rejection-reasons` with `primaryReason: "invalid_value"` | 400 `VALIDATION_ERROR`; `fields[0].field='primaryReason'` |
| T19 | API integration | `createMaster returns VALIDATION_ERROR for branch with non-existent regionId` | ADMIN, POST `/admin/branches` with `regionId` that does not exist in the org | 400 `VALIDATION_ERROR`; `fields[0].field='regionId'` |
| T20 | API integration | `createMaster returns VALIDATION_ERROR for scheme with validTo before validFrom` | ADMIN, POST `/admin/schemes` with `validFrom="2026-12-31"`, `validTo="2026-01-01"` | 400 `VALIDATION_ERROR`; `fields` contains `validTo` |
| T21 | API integration | `createMaster denied for RM` | RM actor, POST `/admin/rejection-reasons` | 403 `FORBIDDEN` |
| T22 | API integration | `createMaster denied without JWT` | No token, POST `/admin/rejection-reasons` | 401 `AUTH_REQUIRED` |
| T23 | API integration | `updateMaster patches rejection reason isActive for ADMIN` | ADMIN, PATCH `/admin/rejection-reasons/{id}` with `{isActive: false}` on a rejection reason not referenced by any active lead | 200; `data.isActive=false`; DB: `is_active=false`; `configuration_versions` diff row with `op='update'`; `event_outbox` CONFIG_CHANGED |
| T24 | API integration | `updateMaster patches SLA policy thresholdMinutes` | ADMIN, PATCH `/admin/sla-policies/{id}` with `{thresholdMinutes: 180}` | 200; `data.thresholdMinutes=180`; DB: `threshold_minutes=180` |
| T25 | API integration | `updateMaster returns NOT_FOUND for unknown id` | ADMIN, PATCH `/admin/rejection-reasons/00000000-0000-0000-0000-000000000099` | 404 `NOT_FOUND` |
| T26 | API integration | `updateMaster returns CONFLICT when deactivating rejection reason referenced by active lead` | ADMIN, PATCH `/admin/rejection-reasons/{id}` with `{isActive: false}` where a lead has `rejection_reason_id = id` and `stage != 'handed_off'` | 409 `CONFLICT`; DB: `is_active` unchanged |
| T27 | API integration | `updateMaster returns CONFLICT with LEGAL_HOLD when deactivating retention policy with legal_hold=true` | ADMIN, PATCH `/admin/retention-policies/{id}` with `{isActive: false}` on a policy where `legal_hold=true` | 409 `CONFLICT`; `error.detail.reason = 'LEGAL_HOLD'` |
| T28 | API integration | `updateMaster denied for RM` | RM actor, PATCH `/admin/sla-policies/{id}` | 403 `FORBIDDEN` |
| T29 | API integration | `updateMaster denied for BM on org-global resource` | BM actor (scope B), PATCH `/admin/rejection-reasons/{id}` where `rejection_reasons` has no `branch_id` column (org-global) | 403 `FORBIDDEN` |
| T30 | Unit | `MasterResourceRegistry.resolve throws VALIDATION_ERROR for unknown type` | Call `registry.resolve('unknown')` | Throws a typed error with `code='VALIDATION_ERROR'` and `field='masterResource'` |
| T31 | Unit | `AdminMasterService.create inserts master row and configuration_version in same transaction` | Mock `db.insertInto` for both tables; confirm both called within the same `tx` object (UnitOfWork mock) | Both inserts invoked; neither throws; transaction committed |
| T32 | Unit | `AdminMasterService.create rolls back if event_outbox insert fails` | Mock `OutboxService.emit` to throw; wrap in `UnitOfWork.run` | Transaction rolls back; no master row in DB; no configuration_versions row |
| T33 | Unit | `AdminMasterService.update rolls back if configuration_versions insert fails` | Mock `db.insertInto('configuration_versions')` to throw after master update | Transaction rolls back; master row unchanged; no configuration_versions row |
| T34 | Unit | `inUseCheck for rejection_reason returns true when active lead references it` | Seed DB with one lead where `rejection_reason_id = id` and `stage='rejected'` (active-ish); call `inUseCheck` | Returns `true`; service throws CONFLICT |
| T35 | Unit | `SlaPolicyDto validation rejects thresholdMinutes=0` | Parse `{..., thresholdMinutes: 0}` through Zod schema | ZodError with path `['thresholdMinutes']` |
| T36 | Unit | `BusinessCalendarDto validation rejects invalid timezone` | Parse `{..., timezone: 'Invalid/Zone'}` through Zod schema | ZodError with path `['timezone']` |
| T37 | Unit | `SchemeDto validation rejects validTo before validFrom` | Parse `{..., validFrom:'2026-12-31', validTo:'2026-01-01'}` | ZodError with path `['validTo']` |
| T38 | API integration | `createMaster enforces mutation rate limit 60/min` | Submit 61 POST requests in 1 minute as the same user | 61st returns 429 `RATE_LIMITED` |
| T39 | API integration | `createMaster writes CONFIG_CHANGED to event_outbox in same transaction` | ADMIN creates a new scheme; query `event_outbox` immediately after response | `event_outbox` row exists with `event_code='CONFIG_CHANGED'`, `aggregate_type='scheme'`, `aggregate_id={new schemeId}`, `status='pending'` |
| T40 | API integration | `createMaster writes audit intent via AuditAppender` | ADMIN creates retention policy; query `audit_logs` (or assert AuditAppender mock called) | AuditAppender called with `action='config_change'`, `entity_type='retention_policy'`, `entity_id={new id}` |
| T41 | E2E (Playwright) | `Admin can create and list a rejection reason` | Log in as ADMIN; navigate to Admin > Configuration > Rejection Reasons; click Create; fill form; submit | New rejection reason appears in the list table with correct values |
| T42 | E2E (Playwright) | `Admin sees Deactivate dialog with reason before deactivating a scheme` | Log in as ADMIN; navigate to Schemes list; click Deactivate on a scheme; proceed through ConfirmDialog | ConfirmDialog appears; after confirm, scheme row shows isActive=false (or disappears from active filter) |
| T43 | E2E (Playwright) | `RM cannot see Admin Configuration nav item` | Log in as RM; check sidebar nav | Admin > Configuration is not rendered in the nav |

---

## SQL Invariant Queries

These queries must return 0 rows at any point after any FR-131 write. Run in the test Testcontainers-Postgres instance after each relevant test.

```sql
-- INV-01: Every configuration_versions row created by FR-131 must have a valid maker_id
SELECT COUNT(*)
FROM configuration_versions cv
WHERE cv.config_type IN (
  'region','branch','team','partner','scheme','product_config',
  'rejection_reason','allocation_rule','sla_policy','business_calendar',
  'communication_template','dla_registry','retention_policy'
)
AND cv.maker_id IS NULL;
-- expect: 0

-- INV-02: No configuration_versions row should have checker_id = maker_id (four-eyes constraint)
SELECT COUNT(*)
FROM configuration_versions
WHERE checker_id IS NOT NULL
  AND checker_id = maker_id;
-- expect: 0

-- INV-03: Every FR-131-created event_outbox row must reference a valid aggregate_id
-- (config_ref must correspond to an existing row in the target table)
SELECT COUNT(*)
FROM event_outbox eo
WHERE eo.event_code = 'CONFIG_CHANGED'
  AND eo.aggregate_type = 'rejection_reason'
  AND NOT EXISTS (
    SELECT 1 FROM rejection_reasons rr
    WHERE rr.rejection_reason_id = eo.aggregate_id
  );
-- expect: 0

-- INV-04: No rejection_reason may be hard-deleted if it is referenced by any lead
SELECT COUNT(*)
FROM leads l
WHERE l.rejection_reason_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM rejection_reasons rr
    WHERE rr.rejection_reason_id = l.rejection_reason_id
  );
-- expect: 0

-- INV-05: No branch may exist without a valid, existing region
SELECT COUNT(*)
FROM branches b
WHERE NOT EXISTS (
  SELECT 1 FROM regions r
  WHERE r.region_id = b.region_id
);
-- expect: 0

-- INV-06: Every allocation_rule priority_order is unique per org
SELECT org_id, priority_order, COUNT(*)
FROM allocation_rules
WHERE is_active = true
GROUP BY org_id, priority_order
HAVING COUNT(*) > 1;
-- expect: 0 rows

-- INV-07: No sla_policy has threshold_minutes <= 0
SELECT COUNT(*)
FROM sla_policies
WHERE threshold_minutes <= 0;
-- expect: 0

-- INV-08: No scheme has valid_to < valid_from
SELECT COUNT(*)
FROM schemes
WHERE valid_to < valid_from;
-- expect: 0

-- INV-09: No business_calendar code is duplicated within an org
SELECT org_id, code, COUNT(*)
FROM business_calendars
GROUP BY org_id, code
HAVING COUNT(*) > 1;
-- expect: 0 rows

-- INV-10: retention_policies with legal_hold=true must never have is_active=false (they cannot be deactivated)
-- (This is a business invariant enforced by FR-131's in-use check — verify it holds)
SELECT COUNT(*)
FROM retention_policies
WHERE legal_hold = true
  AND is_active = false;
-- Note: If the system allows legal_hold policies to be deactivated via other means this would catch it.
-- expect: 0

-- INV-11: audit_logs rows for config_change are append-only (no updates)
-- Verify no audit_log row for config_change has updated_at significantly > created_at
-- (should differ only by clock skew < 1s)
SELECT COUNT(*)
FROM audit_logs
WHERE action = 'config_change'
  AND (updated_at - created_at) > INTERVAL '5 seconds';
-- expect: 0
```

---

## UI Test Scenarios

| # | Type | Scenario | Assertion |
|---|---|---|---|
| UI-01 | Vitest/RTL | `AdminConfigPage renders DataTable with loading skeleton while fetching` | Mock `useQuery` in loading state; render `AdminConfigPage`; expect `LoadingSkeleton` to appear |
| UI-02 | Vitest/RTL | `AdminConfigPage renders EmptyState when list returns 0 items` | Mock `useQuery` returning `{ data: [], meta: { pagination: { total: 0 } } }`; render page; expect `EmptyState` component |
| UI-03 | Vitest/RTL | `AdminConfigPage does not render Create button for non-configuration roles` | Render with RM session context; confirm Create button is absent from DOM |
| UI-04 | Vitest/RTL | `CreateMasterDrawer maps VALIDATION_ERROR.fields to inline field errors` | Submit form; mock API returns 400 `VALIDATION_ERROR` with `fields:[{field:'primaryReason',issue:'...'}]`; expect inline error text adjacent to the primaryReason input |
| UI-05 | Vitest/RTL | `DeactivateConfirmDialog prevents submission without reason text` | Render `ConfirmDialog` with `requiresReason`; click confirm without typing reason; expect submit disabled |
| UI-06 | Vitest/RTL | `Toast displays CONFLICT error message on deactivation of in-use record` | Mock PATCH returning 409 CONFLICT; submit deactivation; expect `Toast` with "Refresh and retry" text |
| UI-07 | Playwright | `Admin creates business calendar and it appears in list` | Navigate to business calendars; create with working hours; assert new row in table |
| UI-08 | Playwright | `Admin deactivates SLA policy; list shows isActive=false` | ADMIN, click Deactivate on SLA policy not in use; ConfirmDialog; confirm; row reflects deactivated status |

---

## Coverage Checklist

- [ ] Happy path: list (with pagination + active filter) for at least 3 resource types
- [ ] Happy path: create for at least 5 different resource types
- [ ] Happy path: patch (field update) for at least 3 resource types
- [ ] Error: `AUTH_REQUIRED` (401) — no JWT on list + create + patch
- [ ] Error: `FORBIDDEN` (403) — RM/SM/PARTNER attempt on list/create/patch
- [ ] Error: `FORBIDDEN` (403) — BM attempts to modify org-global resource
- [ ] Error: `VALIDATION_ERROR` (400) — unknown `{masterResource}` path
- [ ] Error: `VALIDATION_ERROR` (400) — missing required field on create
- [ ] Error: `VALIDATION_ERROR` (400) — invalid enum value on create
- [ ] Error: `VALIDATION_ERROR` (400) — FK reference not found (regionId on branch)
- [ ] Error: `VALIDATION_ERROR` (400) — date range invalid (scheme validTo < validFrom)
- [ ] Error: `VALIDATION_ERROR` (400) — limit > 100 query param
- [ ] Error: `NOT_FOUND` (404) — PATCH on non-existent ID
- [ ] Error: `CONFLICT` (409) — duplicate unique code on create
- [ ] Error: `CONFLICT` (409) — deactivation of in-use record
- [ ] Error: `CONFLICT` (409) — `LEGAL_HOLD` sub-reason on retention policy deactivation
- [ ] Error: `RATE_LIMITED` (429) — mutations tier exceeded (60/min)
- [ ] Transaction rollback: forced mid-write failure rolls back master row + configuration_versions + event_outbox atomically
- [ ] Outbox: `CONFIG_CHANGED` event written to `event_outbox` in same transaction as master row
- [ ] Audit: `config_change` audit intent emitted via `AuditAppender` on every write
- [ ] SQL invariants: INV-01 through INV-11 return 0 rows after test suite
- [ ] UI: loading skeleton shown while fetching
- [ ] UI: empty state shown when no records
- [ ] UI: VALIDATION_ERROR.fields mapped to per-field inline errors in form
- [ ] UI: ConfirmDialog shown before deactivation
- [ ] UI: Create/Edit buttons absent for non-configuration roles
- [ ] Authz negative: RM cannot list, create, or patch any master resource
- [ ] Authz negative: PARTNER cannot list, create, or patch any master resource
- [ ] Authz negative: BM cannot modify org-global resources (no branch_id scope)
