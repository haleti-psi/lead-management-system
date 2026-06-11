# FR-040: Product Configuration Without Credit BRE — Test Specification

**Tier: 3** (Complex)
**Source LLD:** `docs/lld/FR-040.md`

---

## Test Stack

| Layer | Tool | Location |
|---|---|---|
| Backend unit (service, guard, validation) | Jest + ts-jest | `apps/api/src/modules/product-config/*.spec.ts` |
| Backend API integration | Jest + supertest + Testcontainers-Postgres | `apps/api/test/product-config.e2e-spec.ts` |
| Frontend component | Vitest + @testing-library/react | `apps/web/src/components/product-config/*.test.tsx` |
| E2E (full UI workflow) | Playwright | `apps/web/e2e/product-config.spec.ts` |

---

## Test Cases

### Unit Tests (`product-config.service.spec.ts`)

These tests cover the `ProductConfigService` in isolation with mocked repository and core services.

#### TC-U01 — createDraft: happy path with full valid input

**Scenario:** ADMIN user submits a valid `CreateProductConfigDto` for product_code `CV` with a well-formed `field_schema`, `document_checklist`, `sla_config`, `eligibility_mapping`, and `pan_required_at='before_kyc'`.

**Arrange:** Repository mock returns `max_version = 2`. UnitOfWork mock resolves.

**Assert:**
- `product_configs` INSERT called with `status='draft'`, `version=3`, correct `org_id`, `created_by=userId`.
- `configuration_versions` INSERT called with `status='pending'`, `maker_id=userId`, `config_type='product_config'`.
- `AuditAppender.emit` called once with `action='config_change'`.
- `OutboxService.emit` called once with `event_code='CONFIG_CHANGED'`.
- Returns `{ product_config_id, version:3, status:'draft', configuration_version_id, config_version_status:'pending' }`.

---

#### TC-U02 — createDraft: first version for a product_code

**Scenario:** No existing `product_configs` rows for `(org_id, product_code='TW')`. `MAX(version)` returns null.

**Assert:** `version` field on the new `product_configs` row is `1`.

---

#### TC-U03 — createDraft: eligibility_mapping references undeclared lms_field

**Scenario:** `field_schema` declares fields `['vehicle_type', 'make_model']`. `eligibility_mapping.fields` includes `{ lms_field: 'unknown_field', los_field: 'assetCode' }`.

**Assert:** Throws `VALIDATION_ERROR` (400) with `fields: [{ field: 'eligibility_mapping.fields[0].lms_field', issue: 'not declared in field_schema' }]`. No DB writes occur.

---

#### TC-U04 — editActive: creates a new draft row without mutating the active row

**Scenario:** Repository returns an existing row with `status='active'`, `version=3`. User submits a partial `UpdateProductConfigDto` with only `name` changed.

**Assert:**
- Repository `INSERT` called with `version=4`, `status='draft'`, `name=<new name>`.
- Repository `UPDATE` is **not** called on the original `product_config_id` row (immutability invariant).
- `configuration_versions` INSERT called with the new `config_ref` pointing to the new row.
- Returns `{ product_config_id: <new-id>, version:4, status:'draft', based_on_version:3 }`.

---

#### TC-U05 — editActive: blocked when target config is not active (status=draft)

**Scenario:** Repository returns a row with `status='draft'`.

**Assert:** Throws `CONFLICT` (409). No INSERTs occur.

---

#### TC-U06 — editActive: blocked when target config is not active (status=retired)

**Scenario:** Repository returns a row with `status='retired'`.

**Assert:** Throws `CONFLICT` (409).

---

#### TC-U07 — processCheckerDecision (approve): happy path — no eligibility mapping change

**Scenario:** `configuration_versions` row has `status='pending'`, `maker_id='user-A'`. Current user is `user-B` (ADMIN, scope=A). `diff` does not contain `eligibility_mapping`. `action='approved'`.

**Assert:**
- `configuration_versions` updated to `status='active'`, `checker_id='user-B'`, `effective_at` set.
- Previously active `product_configs` row for same product_code set to `status='retired'`.
- New draft `product_configs` row set to `status='active'`.
- `AuditAppender.emit` called with `action='config_change'`.
- `OutboxService.emit` called with `event_code='CONFIG_CHANGED'`, `status='active'`.
- Returns `{ configuration_version_id, status:'active', product_config_status:'active', effective_at }`.

---

#### TC-U08 — processCheckerDecision (approve): self-approval blocked

**Scenario:** `configuration_versions.maker_id === userId` (same user trying to approve their own submission).

**Assert:** Throws `FORBIDDEN` (403). No DB writes occur.

---

#### TC-U09 — processCheckerDecision (approve): blocked when CV not in pending state

**Scenario:** `configuration_versions.status='rejected'`. Checker tries to approve.

**Assert:** Throws `CONFLICT` (409).

---

#### TC-U10 — processCheckerDecision (approve): eligibility_mapping change blocked for BM scope

**Scenario:** `configuration_versions.diff` contains key `eligibility_mapping`. Current checker user has role BM (scope=B, not A).

**Assert:** Throws `FORBIDDEN` (403) — eligibility-mapping changes require scope A (ADMIN/HEAD). No DB writes occur.

---

#### TC-U11 — processCheckerDecision (reject): happy path

**Scenario:** `configuration_versions.status='pending'`. `action='rejected'`, `remarks='Field X invalid.'`.

**Assert:**
- `configuration_versions` updated to `status='rejected'`, `checker_id` set.
- Draft `product_configs` row (the linked `config_ref`) set to `status='retired'` (was draft; no leads reference it).
- `AuditAppender.emit` called. `OutboxService.emit` called with `status='rejected'`.
- Returns `{ configuration_version_id, status:'rejected' }`.

---

#### TC-U12 — retireConfig: happy path

**Scenario:** Target `product_configs` row has `status='active'`. No `leads` rows reference a different concern (retire is status-only; in-flight leads keep their pinned row).

**Assert:**
- `UPDATE product_configs SET status='retired'` issued for the target `product_config_id`.
- `AuditAppender.emit` and `OutboxService.emit` called.
- Returns `{ product_config_id, status:'retired' }`.

---

#### TC-U13 — retireConfig: blocked when config is not active

**Scenario:** Target row has `status='draft'`.

**Assert:** Throws `CONFLICT` (409). No UPDATE issued.

---

#### TC-U14 — version pinning invariant: in-flight lead config unchanged after activation of new version

**Scenario:** Lead row pinned to `product_config_id='pc-old'` (version=2). A new version (version=3) is activated for the same product_code.

**Assert:** `leads` table query for the lead still returns `product_config_id='pc-old'`. The activation path does NOT issue any `UPDATE leads ...` statement.

---

#### TC-U15 — transaction rollback: if outbox INSERT fails, all writes roll back

**Scenario:** `OutboxService.emit` throws inside the UnitOfWork transaction after `product_configs` INSERT has succeeded.

**Assert:**
- `product_configs` row does NOT persist (transaction rolled back).
- `configuration_versions` row does NOT persist.
- `AuditAppender.emit` intent is not committed.
- Service re-throws; exception filter returns `INTERNAL_ERROR` (500).

---

### API Integration Tests (`product-config.e2e-spec.ts`)

All integration tests use **Testcontainers-Postgres** (isolated DB per run), Flyway seed, and a real NestJS app instance via supertest. JWT tokens are generated for seeded test users with specified roles.

#### TC-A01 — GET /admin/products: happy path returns paginated list

**Setup:** Seed 3 `product_configs` rows (2 active, 1 draft) for orgId.

**Request:** `GET /api/v1/admin/products` with ADMIN JWT.

**Assert:**
- 200 OK.
- `data` array length ≤ 25 (default limit).
- `meta.pagination` present with `total=3`.
- Each item contains `product_config_id`, `product_code`, `version`, `status` but NOT `field_schema` or `document_checklist` (list response omits large JSONB fields).

---

#### TC-A02 — GET /admin/products: status filter works correctly

**Setup:** Seed 2 active + 1 draft config.

**Request:** `GET /api/v1/admin/products?filter[status]=draft` with ADMIN JWT.

**Assert:** `data` length = 1; all returned items have `status='draft'`.

---

#### TC-A03 — GET /admin/products: unauthenticated → AUTH_REQUIRED

**Request:** No Authorization header / cookie.

**Assert:** 401. `error.code='AUTH_REQUIRED'`.

---

#### TC-A04 — GET /admin/products: RM (no configuration capability) → FORBIDDEN

**Request:** JWT for RM user.

**Assert:** 403. `error.code='FORBIDDEN'`.

---

#### TC-A05 — POST /admin/products: full happy path creates draft + pending CV

**Request:** `POST /api/v1/admin/products` with ADMIN JWT. Valid body: `product_code='SBL'`, well-formed `field_schema` (1 group, 3 fields), `document_checklist` (2 items), `sla_config`, `eligibility_mapping` (mapped to declared fields), `pan_required_at='before_kyc'`.

**Assert:**
- 201 Created.
- `data.status='draft'`, `data.config_version_status='pending'`.
- DB: `product_configs` row exists with `status='draft'`, `version=1`, correct `org_id`.
- DB: `configuration_versions` row with `status='pending'`, `maker_id=<adminUserId>`, `config_type='product_config'`.
- DB: `audit_logs` has a row with `action='config_change'` (via AuditAppender — queued; check intent emitted).
- DB: `event_outbox` has a `CONFIG_CHANGED` row.

---

#### TC-A06 — POST /admin/products: invalid field_schema (missing groups) → VALIDATION_ERROR

**Request:** `POST /api/v1/admin/products`, body has `field_schema={}` (no `groups` key).

**Assert:** 400. `error.code='VALIDATION_ERROR'`. `error.fields` contains an entry for `field_schema`.

---

#### TC-A07 — POST /admin/products: invalid product_code → VALIDATION_ERROR

**Request:** `product_code='TRUCK'` (not in enum).

**Assert:** 400. `error.code='VALIDATION_ERROR'`. `error.fields[0].field='product_code'`.

---

#### TC-A08 — POST /admin/products: eligibility_mapping references undeclared lms_field → VALIDATION_ERROR

**Request:** `field_schema.groups[0].fields` declares only `['vehicle_type']`. `eligibility_mapping.fields[0].lms_field='invoice_value'`.

**Assert:** 400. `error.code='VALIDATION_ERROR'`. `error.fields` contains entry with `field` referencing the bad mapping field.

---

#### TC-A09 — POST /admin/products: invalid document_checklist doc_type → VALIDATION_ERROR

**Request:** `document_checklist.items[0].doc_type='passport'` (not in `doc_type` enum).

**Assert:** 400. `error.code='VALIDATION_ERROR'`. `error.fields[0].field` references the checklist item.

---

#### TC-A10 — PATCH /admin/products/{id}: edit active config creates new draft, leaves original untouched

**Setup:** Seed 1 active `product_configs` row (`version=2`, `status='active'`).

**Request:** `PATCH /api/v1/admin/products/{id}` with ADMIN JWT. Body: `{ "name": "Updated Name" }`.

**Assert:**
- 200 OK. `data.version=3`, `data.status='draft'`.
- DB: original row still has `version=2`, `status='active'`, `name` unchanged.
- DB: new row exists with `version=3`, `status='draft'`, `name='Updated Name'`.
- DB: `configuration_versions` row with `status='pending'`, `maker_id` set.

---

#### TC-A11 — PATCH /admin/products/{id}: edit a draft config → CONFLICT

**Setup:** Seed 1 draft config.

**Request:** `PATCH` with `{ "name": "any" }`.

**Assert:** 409. `error.code='CONFLICT'`. No new rows created.

---

#### TC-A12 — PATCH /admin/products/{id}: not found or wrong org → NOT_FOUND

**Request:** `PATCH /api/v1/admin/products/00000000-0000-0000-0000-000000000099` (non-existent UUID).

**Assert:** 404. `error.code='NOT_FOUND'`.

---

#### TC-A13 — POST /admin/config/{id}/approve: full maker-checker approval cycle activates config

**Setup:**
1. Seed a `product_configs` row (status=`active`, version=2, product_code=`CV`).
2. As user-A (ADMIN), `POST /admin/products` to create draft version 3 → get `configuration_version_id`.

**Request:** As user-B (different ADMIN): `POST /api/v1/admin/config/{cvId}/approve` with `{ "action": "approved", "remarks": "OK" }`.

**Assert:**
- 200 OK. `data.status='active'`, `data.product_config_status='active'`.
- DB: new `product_configs` row (v3) has `status='active'`.
- DB: old `product_configs` row (v2) now has `status='retired'`.
- DB: `configuration_versions` row has `status='active'`, `checker_id=<user-B-id>`, `effective_at` not null.
- DB: `event_outbox` has `CONFIG_CHANGED` with `status='active'`.

---

#### TC-A14 — POST /admin/config/{id}/approve: self-approval blocked → FORBIDDEN

**Setup:** User-A creates a draft config (maker). User-A is the currently authenticated user.

**Request:** User-A tries to approve their own pending CV.

**Assert:** 403. `error.code='FORBIDDEN'`. `configuration_versions.status` remains `pending`.

---

#### TC-A15 — POST /admin/config/{id}/approve: approve a non-pending CV → CONFLICT

**Setup:** Seed a `configuration_versions` row with `status='rejected'`.

**Request:** ADMIN tries to approve it.

**Assert:** 409. `error.code='CONFLICT'`.

---

#### TC-A16 — POST /admin/config/{id}/approve: eligibility_mapping change blocked for BM checker → FORBIDDEN

**Setup:** User-A (ADMIN) creates a draft that modifies `eligibility_mapping` → `diff` includes key `eligibility_mapping`.

**Request:** User-B (BM, scope=B) tries to approve.

**Assert:** 403. `error.code='FORBIDDEN'`. `configuration_versions.status` remains `pending`.

---

#### TC-A17 — POST /admin/config/{id}/approve: rejection path

**Request:** As user-B (ADMIN): `{ "action": "rejected", "remarks": "Bad field refs." }`.

**Assert:**
- 200 OK. `data.status='rejected'`.
- DB: `configuration_versions.status='rejected'`, `checker_id` set.
- DB: draft `product_configs` row set to `status='retired'`.
- DB: original active config still has `status='active'` (previous active not changed on rejection).

---

#### TC-A18 — POST /admin/config/{id}/approve: rejection without remarks → VALIDATION_ERROR

**Request:** `{ "action": "rejected" }` — missing `remarks`.

**Assert:** 400. `error.code='VALIDATION_ERROR'`. `error.fields[0].field='remarks'`.

---

#### TC-A19 — PATCH /admin/products/{id} with status=retired: retires active config

**Setup:** Seed 1 active config.

**Request:** `PATCH /api/v1/admin/products/{id}` with `{ "status": "retired" }`.

**Assert:**
- 200 OK. `data.status='retired'`.
- DB: `product_configs` row has `status='retired'`.
- In-flight leads pinned to this `product_config_id` still reference it (join check passes with their `product_config_id` FK still valid).

---

#### TC-A20 — Version pinning: in-flight lead keeps old config after activation of new version

**Setup:**
1. Seed active config v2 (`product_config_id='pc-v2'`).
2. Seed a `leads` row with `product_config_id='pc-v2'`.
3. Complete full maker-checker cycle to activate v3 (`product_config_id='pc-v3'`).

**Assert:**
- DB: `leads` row still has `product_config_id='pc-v2'`.
- DB: `product_configs` row `pc-v2` now has `status='retired'` but still exists.
- DB: `product_configs` row `pc-v3` has `status='active'`.
- No `UPDATE leads` statement was executed during v3 activation.

---

#### TC-A21 — Rate limiting: mutations are rate-limited at 60/min per user

**Setup:** Issue 61 `POST /admin/products` requests in quick succession from the same JWT user.

**Assert:** The 61st request returns 429. `error.code='RATE_LIMITED'`. `Retry-After` header is present.

---

#### TC-A22 — Append-only invariant: audit_logs rows cannot be updated or deleted

**Setup:** After TC-A05, an `audit_logs` row has been inserted for the config_change action.

**Assert (SQL invariant query):**
```sql
UPDATE audit_logs SET action = 'login' WHERE entity_type = 'product_config' RETURNING audit_id;
-- Must return 0 rows (DB REVOKE UPDATE on app role)
DELETE FROM audit_logs WHERE entity_type = 'product_config' RETURNING audit_id;
-- Must return 0 rows (DB REVOKE DELETE on app role)
```
Both should raise a permission error or return 0 affected rows.

---

#### TC-A23 — Transaction rollback: mid-write failure rolls back all changes atomically

**Setup:** Inject a failure in `OutboxService.emit` after `product_configs` INSERT completes.

**Assert:**
- 500 returned. `error.code='INTERNAL_ERROR'`.
- DB: no `product_configs` row exists for the attempted insert.
- DB: no `configuration_versions` row exists.
- DB: no `event_outbox` row with the new `aggregate_id`.

---

### UI Component Tests

#### TC-C01 — FieldSchemaEditor: adds a field group with a mandatory select field

**Test:** Render `<FieldSchemaEditor>` with empty initial state. User adds a group "Asset Details", then adds a field with `type=select`, marks it mandatory, and adds options `["LCV","HCV"]`.

**Assert:**
- Group renders with heading.
- Field row shows type dropdown, mandatory toggle (checked), options input.
- Zod schema output from form state includes `{ groups: [{ id, label, fields: [{ type:'select', mandatory:true, options:['LCV','HCV'] }] }] }`.

---

#### TC-C02 — EntityForm: server VALIDATION_ERROR.fields[] maps to inline errors

**Test:** Simulate `apiClient` returning `{ error: { code:'VALIDATION_ERROR', fields:[{ field:'eligibility_mapping.fields[0].lms_field', issue:'not declared' }] } }`.

**Assert:** The `EligibilityMappingEditor` row 0 shows an inline error message with the issue text. No toast shown for field-level errors (only inline display).

---

#### TC-C03 — ApproveConfigDrawer: remarks required when reject action selected

**Test:** Render `<ApproveConfigDrawer>`. Select `action=rejected`. Click submit without filling `remarks`.

**Assert:** Form does not submit. Inline validation error shown on `remarks` field: "remarks are required when rejecting".

---

#### TC-C04 — VersionHistoryTable: approve button disabled when user is the maker

**Test:** Render `<VersionHistoryTable>` with a pending CV row where `maker_id === currentUserId`.

**Assert:** The "Approve" action button in that row is disabled. Tooltip text explains why (e.g., "You submitted this change; a different user must approve.").

---

#### TC-C05 — StatusChip: config_status renders correct variant

**Test:** Render `<StatusChip status='draft'>`, `<StatusChip status='active'>`, `<StatusChip status='retired'>`.

**Assert:** Draft renders with muted/warning styling; active with success/green; retired with destructive/grey.

---

### E2E Tests (`apps/web/e2e/product-config.spec.ts`)

#### TC-E01 — Full maker-checker workflow: create → approve → verify activation

**Steps:**
1. Log in as user-A (ADMIN). Navigate to `/admin/products`. Click "New Configuration".
2. Fill form: `product_code=HRM`, `name=Home Renovation v1`, add a field group with 2 fields, add a checklist item, set `pan_required_at=before_kyc`. Submit.
3. Assert: Redirected to list or detail page. Toast shows "Configuration submitted for checker approval". DB has draft row.
4. Log in as user-B (different ADMIN). Navigate to version history for the new config.
5. Click "Approve". Fill `remarks`. Submit.
6. Assert: Config status chip changes to "active". Version history row shows "active".

**Assert:** End-to-end: a new `product_configs` row is live with `status='active'` after checker approval.

---

#### TC-E02 — Retire flow shows ConfirmDialog

**Steps:**
1. Log in as ADMIN. Navigate to an active config.
2. Click "Retire" action.
3. Assert: `ConfirmDialog` appears. Cancel → dialog closes, status unchanged.
4. Confirm → 200 returned. StatusChip updates to "retired".

---

#### TC-E03 — RM cannot access /admin/products

**Steps:** Log in as RM. Navigate directly to `/admin/products`.

**Assert:** 403 page or redirect to 403 `ErrorState` component. RM is not shown the product config list.

---

## SQL Invariant Queries

Run these after test setup to verify data integrity rules. Each must return **0 rows**.

```sql
-- INV-01: No product_configs row with status=active where a newer version for the same product_code is also active (only one active per product_code per org)
SELECT org_id, product_code, COUNT(*) AS active_count
FROM product_configs
WHERE status = 'active'
GROUP BY org_id, product_code
HAVING COUNT(*) > 1;
-- Expect: 0 rows

-- INV-02: No leads row whose product_config_id no longer exists (FK integrity)
SELECT l.lead_id
FROM leads l
LEFT JOIN product_configs pc ON l.product_config_id = pc.product_config_id
WHERE pc.product_config_id IS NULL;
-- Expect: 0 rows

-- INV-03: No configuration_versions row with status=active whose linked config_ref is not also active in product_configs
SELECT cv.configuration_version_id
FROM configuration_versions cv
LEFT JOIN product_configs pc ON cv.config_ref = pc.product_config_id
WHERE cv.config_type = 'product_config'
  AND cv.status = 'active'
  AND (pc.product_config_id IS NULL OR pc.status != 'active');
-- Expect: 0 rows

-- INV-04: No self-approved configuration_versions (checker == maker)
SELECT configuration_version_id
FROM configuration_versions
WHERE checker_id IS NOT NULL
  AND checker_id = maker_id;
-- Expect: 0 rows

-- INV-05: No product_configs row with status=active that was created by a maker and never went through configuration_versions approval (every active row must have a corresponding active or approved configuration_versions entry)
SELECT pc.product_config_id
FROM product_configs pc
LEFT JOIN configuration_versions cv ON cv.config_ref = pc.product_config_id
  AND cv.config_type = 'product_config'
  AND cv.status IN ('active', 'approved')
WHERE pc.status = 'active'
  AND cv.configuration_version_id IS NULL;
-- Expect: 0 rows (exception: seeded FR-041 rows may be bootstrapped directly; document if so)

-- INV-06: No leads row that was updated to point to a different product_config_id after capture (version pinning invariant)
-- (Assert by verifying no UPDATE statement touching leads.product_config_id is present in the code path — structural check, not a SQL invariant query)
-- SQL proxy: check that product_config_id on leads matches the config version at the leads.created_at time
-- This is enforced by owner-writes rule; no SQL query validates it directly here.
-- Placeholder to document the intent.
SELECT 1 WHERE FALSE;
-- Expect: trivially 0 rows (placeholder)

-- INV-07: No event_outbox row for CONFIG_CHANGED without a corresponding product_configs change in the same transaction window
-- (Hard to test via SQL; covered by TC-A23 rollback test above)
SELECT 1 WHERE FALSE;
```

---

## UI Test Scenarios

| Scenario | Tool | Steps | Assert |
|---|---|---|---|
| List page renders with correct columns | Vitest + Testing-Library | Mount `ProductConfigListPage` with mocked `useProductConfigs` returning 3 items | DataTable has columns: Product, Name, Version, Status, PAN Required At, Last Updated, Actions; 3 rows visible |
| Empty state shown when no configs | Vitest + Testing-Library | Mock returns `data=[]` | `EmptyState` component renders; no table rows |
| Loading skeleton shown while fetching | Vitest + Testing-Library | Mock in loading state | `LoadingSkeleton` renders; no DataTable |
| Form submission disabled during isSubmitting | Vitest + Testing-Library | Submit button clicked once; mock delays response | Submit button shows spinner + `disabled` attribute |
| Keyboard accessibility: all form fields reachable by Tab | Playwright | Tab through CreateProductConfig form | Every input, select, toggle, and submit button receives focus in order |
| Dark mode: StatusChip renders correct colours | Vitest + Testing-Library | Render with `dark` class on body | Draft=muted; active=green; retired=grey in dark theme |

---

## Coverage Checklist

| Requirement | Test(s) covering it |
|---|---|
| Happy path — create draft | TC-U01, TC-A05 |
| Happy path — edit active creates new draft (immutability) | TC-U04, TC-A10 |
| Happy path — approve activates config, retires old | TC-U07, TC-A13 |
| Happy path — reject → draft retired | TC-U11, TC-A17 |
| Happy path — retire active config | TC-U12, TC-A19 |
| First-version assignment (version=1) | TC-U02 |
| AUTH_REQUIRED (401) | TC-A03 |
| FORBIDDEN — no configuration capability (RM) | TC-A04, TC-E03 |
| FORBIDDEN — self-approval | TC-U08, TC-A14 |
| FORBIDDEN — eligibility-mapping change, BM checker | TC-U10, TC-A16 |
| VALIDATION_ERROR — invalid product_code | TC-A07 |
| VALIDATION_ERROR — malformed field_schema | TC-U03 (service), TC-A06 |
| VALIDATION_ERROR — invalid doc_type in checklist | TC-A09 |
| VALIDATION_ERROR — eligibility_mapping undeclared lms_field | TC-U03, TC-A08 |
| VALIDATION_ERROR — rejection missing remarks | TC-A18 |
| VALIDATION_ERROR — status=other via PATCH | Covered by DTO Zod constraint (TC-A11 exercises related path) |
| CONFLICT — edit draft (not active) | TC-U05, TC-U06, TC-A11 |
| CONFLICT — approve non-pending CV | TC-U09, TC-A15 |
| NOT_FOUND — non-existent product_config_id | TC-A12 |
| RATE_LIMITED (429) | TC-A21 |
| INTERNAL_ERROR (500) on unhandled exception | TC-A23 (via forced rollback) |
| Transaction rollback — partial failure rolls back all writes | TC-U15, TC-A23 |
| Version pinning — in-flight leads unaffected by activation | TC-U14, TC-A20 |
| Append-only audit_logs (no UPDATE/DELETE) | TC-A22 |
| SQL invariant — only one active config per product_code | INV-01 |
| SQL invariant — no orphaned leads FK | INV-02 |
| SQL invariant — no self-approved CV | INV-04 |
| Maker-checker UI: approve button disabled for maker | TC-C04 |
| Retire ConfirmDialog | TC-E02 |
| Full E2E maker-checker workflow | TC-E01 |
| UI field validation inline errors from VALIDATION_ERROR | TC-C02 |
| UI remarks required on reject | TC-C03 |
| No external service calls on primary path | All API tests pass without IntegrationGateway mock needed (FR-040 has no external calls) |
