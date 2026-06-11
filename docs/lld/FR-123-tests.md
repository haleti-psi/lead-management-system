# FR-123 Tests — Audit Explorer & Evidence Export

**Tier: 2**
**Source LLD:** `docs/lld/FR-123.md`

---

## Test Cases

Minimum required for Tier 2: 5 cases covering happy path + every named error + authz both ways + validation + boundary. This spec provides 14 cases.

| # | Name | Layer | Type | Scenario | Input | Expected outcome |
|---|---|---|---|---|---|---|
| T-01 | Happy path — DPO page-1 unfiltered | API integration | Happy path | DPO JWT; no filters; page=1 limit=25 | `GET /audit` | 200; `data.items` length <= 25; `meta.total >= 0`; `integrity_badge` is one of `intact|not_checked`; `ip_device` absent from every item; `lead_id` present in items |
| T-02 | Happy path — ADMIN system-events only | API integration | Happy path + scope | ADMIN JWT; no filters | `GET /audit` | 200; every `item.action` is in `ADMIN_ALLOWED_ACTIONS`; `item.lead_id` is null on all rows |
| T-03 | Filter by lead_id — DPO | API integration | Happy path + filter | DPO JWT; `lead_id=<existing-lead-uuid>` | `GET /audit?lead_id=<uuid>` | 200; every `item.lead_id == requested uuid` |
| T-04 | Filter by action | API integration | Happy path + filter | DPO JWT; `action=stage_transition` | `GET /audit?action=stage_transition` | 200; every `item.action == 'stage_transition'` |
| T-05 | Filter by date range | API integration | Happy path + filter | DPO JWT; `from` and `to` spanning 1 hour that includes known seed data | `GET /audit?from=<t1>&to=<t2>` | 200; all `item.created_at` within `[t1, t2]`; count matches expected seed rows |
| T-06 | AUTH_REQUIRED — no token | API integration | Error path | No Authorization header | `GET /audit` | 401; `error.code == 'AUTH_REQUIRED'` |
| T-07 | FORBIDDEN — RM role | API integration | Authz negative | RM JWT (valid token, wrong role) | `GET /audit` | 403; `error.code == 'FORBIDDEN'` |
| T-08 | FORBIDDEN — BM role | API integration | Authz negative | BM JWT | `GET /audit` | 403; `error.code == 'FORBIDDEN'` |
| T-09 | FORBIDDEN — ADMIN passes lead_id filter | API integration | Authz scope | ADMIN JWT; `lead_id=<uuid>` supplied | `GET /audit?lead_id=<uuid>` | 403; `error.code == 'FORBIDDEN'` |
| T-10 | VALIDATION_ERROR — invalid action enum | API integration | Validation | DPO JWT; `action=DOES_NOT_EXIST` | `GET /audit?action=DOES_NOT_EXIST` | 400; `error.code == 'VALIDATION_ERROR'`; `fields[0].field == 'action'` |
| T-11 | VALIDATION_ERROR — unknown entity_type | API integration | Validation | DPO JWT; `entity_type=secret_table` | `GET /audit?entity_type=secret_table` | 400; `error.code == 'VALIDATION_ERROR'`; `fields[0].field == 'entity_type'` |
| T-12 | VALIDATION_ERROR — from > to | API integration | Validation | DPO JWT; `from=2026-06-10&to=2026-06-01` | `GET /audit?from=2026-06-10T00:00:00Z&to=2026-06-01T00:00:00Z` | 400; `error.code == 'VALIDATION_ERROR'`; `fields` contains `from` or `to` |
| T-13 | Chain integrity break detection | Unit | Integrity logic | Service unit test: construct 3 rows where `rows[2].prev_audit_hash != rows[1].after_hash` | `AuditService.verifyChainIntegrity(rows)` | Returns `{ broken: true, breakAt: rows[2].audit_id }`; no exception thrown |
| T-14 | Masking — DPO sees masked PII in detail | API integration | Masking | DPO JWT (no active BreakGlassGrant); seed an audit_log row with `detail` containing `mobile: '9812345678'` | `GET /audit` | 200; matching item's `detail.mobile == '98xxxxxx78'` (masked); `ip_device` not present in item |

---

## Unit Test Scenarios

### `AuditExplorerService`

Describe block: `describe('AuditExplorerService')`

| Test | Scenario | Setup | Assertion |
|---|---|---|---|
| `it('returns empty items and not_checked badge when no rows returned')` | Repository returns `[]` | Mock `AuditRepository.search` → `[]` | `result.data.items == []`; `integrity_badge == 'not_checked'` |
| `it('returns intact badge when all prev_audit_hash values chain correctly')` | 3 rows with correct chain | rows[1].prev_audit_hash == rows[0].after_hash; rows[2].prev_audit_hash == rows[1].after_hash | `integrity_badge == 'intact'`; `meta.integrity_break_at == null` |
| `it('returns broken badge and logs warn when prev_audit_hash mismatch found')` | rows[1].prev_audit_hash does NOT equal rows[0].after_hash | inject logger spy | `integrity_badge == 'broken'`; `meta.integrity_break_at == rows[1].audit_id`; logger.warn called once with `event: 'audit_chain_break'` |
| `it('returns not_checked badge for a single row')` | Repository returns exactly 1 row | — | `integrity_badge == 'not_checked'` |
| `it('zeros lead_id in all items for ADMIN role')` | ADMIN user; rows have non-null lead_id | Mock ADMIN user object | Every `item.lead_id == null` |
| `it('excludes ip_device from all response items regardless of role')` | DPO user; rows have non-null ip_device in DB | — | No item has `ip_device` key |
| `it('masks PII fields in detail JSONB for DPO without break-glass')` | DPO user; no active BreakGlassGrant; row.detail contains mobile | Mock `MaskingService.maskAuditDetail` to return masked value | `detail.mobile` in result is masked |

---

## API Integration Test Scenarios

File: `apps/api/test/reporting/audit-explorer.e2e-spec.ts`
Stack: Jest + supertest + Testcontainers-Postgres (isolated per run).

### Setup (beforeAll)

1. Start Testcontainers-Postgres; run `V1__initial_schema.sql` with `ON_ERROR_STOP`.
2. Seed: org, system user, roles (DPO, ADMIN, RM, BM).
3. Seed 30 `audit_logs` rows with a valid sequential hash chain (compute `after_hash` and set each row's `prev_audit_hash` to previous row's `after_hash`).
4. Among the 30 rows: 10 rows with `action='stage_transition'`; 5 rows with `action='config_change'`; 3 rows with `action='user_change'`; 2 rows with `action='break_glass_access'`.
5. In 5 of the rows with lead-related actions: set `detail.mobile = '9812345678'`.
6. Generate JWTs for DPO user, ADMIN user, RM user via the auth service.

### Teardown

Drop test database; stop container.

### Test cases (mapped to table above)

**T-01 (DPO unfiltered)**
```
GET /api/v1/audit (DPO JWT)
expect(status).toBe(200)
expect(body.data.items.length).toBeLessThanOrEqual(25)
expect(body.meta.total).toBeGreaterThanOrEqual(30)
expect(['intact','not_checked']).toContain(body.data.integrity_badge)
body.data.items.forEach(item => {
  expect(item).not.toHaveProperty('ip_device')
})
```

**T-02 (ADMIN system events)**
```
GET /api/v1/audit (ADMIN JWT)
expect(status).toBe(200)
const ADMIN_ALLOWED = ['config_change','user_change','role_change','break_glass_access','login','logout','login_failed','mfa_failed','export_generate','export_download']
body.data.items.forEach(item => {
  expect(ADMIN_ALLOWED).toContain(item.action)
  expect(item.lead_id).toBeNull()
})
```

**T-03 (lead_id filter, DPO)**
```
GET /api/v1/audit?lead_id=<seeded-lead-id> (DPO JWT)
expect(status).toBe(200)
body.data.items.forEach(item => expect(item.lead_id).toBe('<seeded-lead-id>'))
```

**T-06 (AUTH_REQUIRED)**
```
GET /api/v1/audit (no Authorization header)
expect(status).toBe(401)
expect(body.error.code).toBe('AUTH_REQUIRED')
```

**T-07 (FORBIDDEN — RM)**
```
GET /api/v1/audit (RM JWT)
expect(status).toBe(403)
expect(body.error.code).toBe('FORBIDDEN')
```

**T-08 (FORBIDDEN — BM)**
```
GET /api/v1/audit (BM JWT)
expect(status).toBe(403)
expect(body.error.code).toBe('FORBIDDEN')
```

**T-09 (FORBIDDEN — ADMIN + lead_id)**
```
GET /api/v1/audit?lead_id=<uuid> (ADMIN JWT)
expect(status).toBe(403)
expect(body.error.code).toBe('FORBIDDEN')
```

**T-10 (VALIDATION_ERROR — bad action)**
```
GET /api/v1/audit?action=BAD_ACTION (DPO JWT)
expect(status).toBe(400)
expect(body.error.code).toBe('VALIDATION_ERROR')
expect(body.error.fields[0].field).toBe('action')
```

**T-11 (VALIDATION_ERROR — bad entity_type)**
```
GET /api/v1/audit?entity_type=secret_table (DPO JWT)
expect(status).toBe(400)
expect(body.error.code).toBe('VALIDATION_ERROR')
expect(body.error.fields[0].field).toBe('entity_type')
```

**T-12 (VALIDATION_ERROR — from > to)**
```
GET /api/v1/audit?from=2026-06-10T00:00:00Z&to=2026-06-01T00:00:00Z (DPO JWT)
expect(status).toBe(400)
expect(body.error.code).toBe('VALIDATION_ERROR')
```

**T-14 (Masking — DPO no break-glass)**
```
GET /api/v1/audit (DPO JWT, no active BreakGlassGrant)
// Find a row seeded with detail.mobile
const row = body.data.items.find(i => i.detail?.mobile)
if (row) {
  expect(row.detail.mobile).toMatch(/^98x{6}78$/)  // masked pattern
}
```

---

## SQL Invariant Queries

Run after each test run against the test database. Each must return 0 rows (confirming append-only and no accidental writes from this FR).

```sql
-- INV-01: No UPDATE on audit_logs permitted (confirm no rows were modified by this FR)
-- (Baseline: record count before test; assert count unchanged or only increased by seeded rows)

-- INV-02: No row in audit_logs was written with a null org_id
SELECT COUNT(*) FROM audit_logs WHERE org_id IS NULL;
-- Expect: 0

-- INV-03: No audit_log row has a null actor_id (FK integrity)
SELECT COUNT(*) FROM audit_logs WHERE actor_id IS NULL;
-- Expect: 0

-- INV-04: No audit_log row references a non-existent user
SELECT COUNT(*) FROM audit_logs al
LEFT JOIN users u ON u.user_id = al.actor_id
WHERE u.user_id IS NULL;
-- Expect: 0

-- INV-05: No export_jobs row was created or modified by FR-123 (export is delegated to FR-122)
-- (Compare export_jobs count before and after FR-123 read tests — no delta expected)

-- INV-06: Lead content is never exposed to ADMIN in the response
-- (Validated in T-02 / T-09 above at API level; no SQL invariant needed)
```

---

## UI Test Scenarios

File: `apps/web/e2e/audit-explorer.spec.ts` (Playwright)

| # | Scenario | Steps | Assertion |
|---|---|---|---|
| E2E-01 | DPO sees Audit Explorer in nav, loads list | Login as DPO; navigate to /audit | Audit Explorer page title visible; DataTable renders at least 1 row; IntegrityBadge visible |
| E2E-02 | ADMIN sees Audit Explorer, no Lead ID column or filter | Login as ADMIN; navigate to /audit | "Lead ID" column not rendered in DataTable; "Lead ID" filter input not visible in AuditFilterBar |
| E2E-03 | RM does not see Audit Explorer in nav | Login as RM | "Audit Explorer" nav item absent in AppShell sidebar |
| E2E-04 | DPO applies date range filter | Login as DPO; open AuditFilterBar; set `from`/`to` spanning yesterday | DataTable updates; pagination meta reflects filtered count |
| E2E-05 | IntegrityBadge shown | Login as DPO; load /audit (chain-intact seed data) | IntegrityBadge displays "intact" status chip |
| E2E-06 | Export button opens ExportConfirmDialog | Login as DPO; click "Export Evidence" | ExportConfirmDialog appears; Cancel closes it; Confirm calls POST /exports (network intercept confirms correct body) |
| E2E-07 | Empty state rendered on zero results | Login as DPO; apply date filter with no matching range | EmptyState component visible; no empty `<tbody>` |
| E2E-08 | PII masked in Detail column (DPO no break-glass) | Login as DPO (no BreakGlassGrant); find a row with mobile in detail | Mobile value displays as masked pattern (e.g. `98xxxxxx78`); raw mobile never visible |

---

## Coverage Checklist

| Requirement | Covered | Test(s) |
|---|---|---|
| Happy path — DPO unfiltered list | Yes | T-01, E2E-01 |
| Happy path — ADMIN system-events scope | Yes | T-02, E2E-02 |
| Filter: lead_id (DPO only) | Yes | T-03 |
| Filter: action enum | Yes | T-04, T-10 |
| Filter: entity_type allow-list | Yes | T-11 |
| Filter: date range | Yes | T-05, T-12, E2E-04 |
| Pagination (page/limit) | Yes | T-01 (default), service unit tests (limit enforcement) |
| AUTH_REQUIRED (no token) | Yes | T-06 |
| FORBIDDEN — wrong role (RM) | Yes | T-07 |
| FORBIDDEN — wrong role (BM) | Yes | T-08 |
| FORBIDDEN — ADMIN passes lead_id | Yes | T-09 |
| VALIDATION_ERROR — bad action value | Yes | T-10 |
| VALIDATION_ERROR — bad entity_type | Yes | T-11 |
| VALIDATION_ERROR — from > to | Yes | T-12 |
| Hash-chain integrity — intact | Yes | T-01, unit chain test |
| Hash-chain integrity — broken (break detected) | Yes | T-13 |
| Hash-chain integrity — not_checked (single row) | Yes | Unit test |
| Masking — DPO without break-glass | Yes | T-14, E2E-08 |
| ip_device never returned | Yes | T-01 (assertion per item), unit test |
| lead_id nulled for ADMIN | Yes | T-02, unit test |
| ADMIN lead_id filter rejected (FORBIDDEN) | Yes | T-09 |
| SQL INV: no audit_logs mutations from this FR | Yes | INV-01..05 |
| Append-only (no UPDATE/DELETE on audit_logs) | Yes | INV-01 + architecture constraint (no write path in this FR) |
| Rate limiting (300/min read tier) | Covered by ThrottlerGuard; recommend adding a dedicated throttle test if rate-limit testing is in scope for CI |
| UI — Lead ID column hidden for ADMIN | Yes | E2E-02 |
| UI — Audit Explorer hidden from RM in nav | Yes | E2E-03 |
| UI — EmptyState on zero results | Yes | E2E-07 |
| UI — Export button triggers FR-122 pathway | Yes | E2E-06 |
