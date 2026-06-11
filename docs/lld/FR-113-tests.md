# FR-113: DLA/LSP Registry Support — Test Specification

**Tier: 2**
**Source LLD:** `docs/lld/FR-113.md`

---

## Test Cases

| # | Layer | Scenario | Expected outcome | Error code / detail |
|---|-------|----------|-----------------|---------------------|
| T01 | API integration | **Happy path — create draft entry** POST `/compliance/dla` with valid minimal payload (`name`, `type`) and `status: 'draft'`; caller is DPO | 201; returned `dla_registry_id` non-null; `status = 'draft'`; `owner`, `url`, `grievance_officer`, `storage_location` are null | — |
| T02 | API integration | **Happy path — create active entry** POST `/compliance/dla` with all mandatory disclosure fields populated and `status: 'active'`; caller is ADMIN | 201; `status = 'active'`; all disclosure fields present in response | — |
| T03 | API integration | **Happy path — list entries** GET `/compliance/dla` (DPO); seed 3 entries (1 draft, 1 active, 1 retired) | 200; all 3 returned; `meta.pagination.total = 3` | — |
| T04 | API integration | **Happy path — list with type filter** GET `/compliance/dla?type=lsp` with mixed types | 200; only `type = 'lsp'` entries returned | — |
| T05 | API integration | **Happy path — list with status filter** GET `/compliance/dla?status=active` | 200; only `status = 'active'` entries returned | — |
| T06 | API integration | **Happy path — update fields (no status change)** PATCH `/compliance/dla` with `dla_registry_id` + `owner` update; caller is DPO | 200; `owner` updated; `status` unchanged; `updated_at` advanced | — |
| T07 | API integration | **Happy path — transition draft → active** PATCH `/compliance/dla` with `status: 'active'` on a fully populated draft entry | 200; `status = 'active'` | — |
| T08 | API integration | **Happy path — transition active → retired** PATCH `/compliance/dla` with `status: 'retired'` on an active entry | 200; `status = 'retired'` | — |
| T09 | API integration | **Authz negative — non-DPO/ADMIN caller** POST `/compliance/dla`; caller is RM | 403 | `FORBIDDEN` |
| T10 | API integration | **Authz negative — unauthenticated** GET `/compliance/dla`; no JWT | 401 | `AUTH_REQUIRED` |
| T11 | API integration | **Validation — create active entry missing `owner`** POST with `status: 'active'` but `owner` omitted | 400; `fields` contains `{ field: 'owner', message: 'owner is required for active entries' }` | `VALIDATION_ERROR` |
| T12 | API integration | **Validation — create active entry missing `grievance_officer`** POST with `status: 'active'` but `grievance_officer` null | 400; `fields` contains `grievance_officer` | `VALIDATION_ERROR` |
| T13 | API integration | **Validation — create active entry missing multiple fields** POST with `status: 'active'`, `owner` and `url` both missing | 400; `fields` lists both `owner` and `url` | `VALIDATION_ERROR` |
| T14 | API integration | **Validation — invalid `type`** POST with `type: 'bank'` | 400; `fields` contains `type` | `VALIDATION_ERROR` |
| T15 | API integration | **Validation — invalid `url`** POST with `url: 'not-a-url'` | 400; `fields` contains `url` | `VALIDATION_ERROR` |
| T16 | API integration | **Conflict — duplicate name** POST two entries with the same `name` for the same org | Second call: 409 | `CONFLICT` |
| T17 | API integration | **Not found — update non-existent entry** PATCH with an unknown `dla_registry_id` | 404 | `NOT_FOUND` |
| T18 | API integration | **Invalid transition — retired → active** PATCH `status: 'active'` on a retired entry | 409 | `CONFLICT` |
| T19 | API integration | **Invalid transition — draft → retired** PATCH `status: 'retired'` on a draft entry | 409 | `CONFLICT` |
| T20 | API integration | **Activate draft with missing disclosure fields** PATCH `status: 'active'` on a draft entry where `url` is null | 400; `fields` contains `url` | `VALIDATION_ERROR` |
| T21 | Unit | **validateMandatoryDisclosureFields — all fields present** Pass an entry with owner/url/grievance_officer/storage_location all populated | Returns without throwing | — |
| T22 | Unit | **validateMandatoryDisclosureFields — missing storage_location** | Throws VALIDATION_ERROR with `fields: [storage_location]` | `VALIDATION_ERROR` |
| T23 | Unit | **validateStatusTransition — valid transitions** `draft→active`, `active→retired` | Does not throw | — |
| T24 | Unit | **validateStatusTransition — invalid transitions** `retired→active`, `retired→draft`, `draft→retired` | Throws CONFLICT (409) | `CONFLICT` |
| T25 | Unit | **validateStatusTransition — no-op (same status)** `active→active` | Does not throw (no change) | — |
| T26 | Unit | **Pagination LIMIT enforced** Call `DlaRegistryRepository.list` with `limit=200` | Repository clamps to 100 before executing query; SQL LIMIT is 100 | — |
| T27 | API integration | **Transaction rollback on audit failure** Mock `AuditAppender.emit` to throw after `DlaRegistryRepository.create` succeeds within the UnitOfWork | No `dla_registry` row persisted; DB row count unchanged | `INTERNAL_ERROR` (500) |
| T28 | E2E (Playwright) | **Full registry workflow** DPO logs in → navigates to `/compliance/dla` → creates a draft entry → edits to add disclosure fields → activates → verifies `StatusChip` shows "Active" → retires → verifies entry is listed as "Retired" | Status transitions reflected in UI after each save | — |

---

## SQL Invariant Queries

Run against the integration test database after each test. Every query must return 0 rows.

```sql
-- INV-01: No dla_registry row with status='active' is missing any mandatory disclosure field
SELECT dla_registry_id, name
FROM dla_registry
WHERE status = 'active'
  AND (
    owner IS NULL OR trim(owner) = ''
    OR url IS NULL OR trim(url) = ''
    OR grievance_officer IS NULL
    OR storage_location IS NULL OR trim(storage_location) = ''
  );
-- Expected: 0 rows

-- INV-02: No dla_registry row belongs to an org that does not exist
SELECT d.dla_registry_id
FROM dla_registry d
LEFT JOIN orgs o ON o.id = d.org_id
WHERE o.id IS NULL;
-- Expected: 0 rows

-- INV-03: created_by and updated_by always reference a real user
SELECT d.dla_registry_id
FROM dla_registry d
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = d.created_by)
   OR NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = d.updated_by);
-- Expected: 0 rows

-- INV-04: status is always a valid config_status value
SELECT dla_registry_id, status
FROM dla_registry
WHERE status NOT IN ('draft', 'active', 'retired');
-- Expected: 0 rows

-- INV-05: type is always a valid dla_type value
SELECT dla_registry_id, type
FROM dla_registry
WHERE type NOT IN ('dla', 'lsp', 'partner');
-- Expected: 0 rows

-- INV-06: Every create and update action has a corresponding audit_log entry for 'config_change' on 'dla_registry'
-- (Spot check: after creating 3 entries, at least 3 audit rows should exist for entity_type='dla_registry')
SELECT COUNT(*) FROM audit_logs WHERE entity_type = 'dla_registry' AND action = 'config_change';
-- Expected: >= number of creates + updates performed in the test run
```

---

## UI Test Scenarios

### Component: DlaRegistryPage / DlaRegistryDrawer

| # | Scenario | Tool | Assertion |
|---|----------|------|-----------|
| U01 | Create form — required field `name` left blank, submit attempted | Vitest / Testing Library | Inline error "name is required" appears under the name input; form not submitted |
| U02 | Create form — `status` switched to "Active", submit with `grievance_officer.email` invalid | Vitest / Testing Library | Inline error on email field; `VALIDATION_ERROR.fields[]` from server mapped to field |
| U03 | Status chip rendering | Vitest / Testing Library | Draft entry renders `StatusChip` with "Draft" label and muted colour; Active → green; Retired → muted |
| U04 | Retire confirm dialog | Vitest / Testing Library | Clicking "Retire" on an active entry opens `ConfirmDialog`; confirming calls PATCH; cancelling does not |
| U05 | Empty state | Vitest / Testing Library | When API returns 0 entries, `EmptyState` component is rendered (not an empty `<tbody>`) |
| U06 | Loading skeleton | Vitest / Testing Library | While query is in-flight, `LoadingSkeleton` is rendered |
| U07 | Filter by type | Vitest / Testing Library | Selecting "LSP" in the type filter triggers a new API call with `?type=lsp`; table reflects filtered results |
| U08 | Add Entry button hidden for non-DPO/ADMIN | Vitest / Testing Library | When session role is RM, "Add Entry" button is not rendered |

---

## Coverage Checklist

- [x] **Happy paths** — list (T03–T05), create draft (T01), create active (T02), update fields (T06), activate (T07), retire (T08)
- [x] **Every error code FR-113 raises:**
  - `VALIDATION_ERROR` 400 — missing fields on create (T11–T15), missing fields on activate (T20), no update fields (implicit in Zod refinement)
  - `AUTH_REQUIRED` 401 (T10)
  - `FORBIDDEN` 403 (T09)
  - `NOT_FOUND` 404 (T17)
  - `CONFLICT` 409 — duplicate name (T16), invalid transitions (T18–T19)
  - `INTERNAL_ERROR` 500 — transaction rollback (T27)
- [x] **Authorisation negatives** — unauthenticated (T10), wrong role (T09)
- [x] **State machine** — valid transitions (T07, T08), invalid transitions (T18–T19, T24), unit transition rules (T23–T25)
- [x] **Boundary — pagination limit** clamped to 100 (T26)
- [x] **Transaction rollback** — partial write rolled back on audit failure (T27)
- [x] **SQL invariants** — mandatory-field integrity, FK integrity, enum integrity, audit completeness (INV-01 to INV-06)
- [x] **UI component states** — loading, empty, error, form validation, status chips, role-filtered actions (U01–U08)
- [x] **End-to-end workflow** — full lifecycle in browser (T28)
- [ ] **Masking** — `dla_registry` contains no PII fields; `MaskedField` is not applicable to this FR
- [ ] **Idempotency / `Idempotency-Key`** — not applicable; POST creates a non-idempotent registry entry (name uniqueness is the deduplication mechanism; no `Idempotency-Key` header is specified in the contract for this endpoint)
- [ ] **Rate limiting** — mutations rate limit (60/min) is enforced by the global `ThrottlerGuard`; a dedicated rate-limit test is not required at the FR level per `testing-contract.md` (not an auth/OTP/public endpoint)
- [ ] **Consent gates** — not applicable; `dla_registry` is administrative configuration, not a lead-stage gate
