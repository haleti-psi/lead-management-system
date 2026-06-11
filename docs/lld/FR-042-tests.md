# FR-042: Scheme & Offer Capture — Test Specification

**Tier: 2**
**Source LLD:** `docs/lld/FR-042.md`

---

## Test Cases

### Category: Scheme Administration — Happy Paths

| # | ID | Description | Type | Inputs | Expected Result |
|---|-----|-------------|------|--------|-----------------|
| 1 | TC-042-01 | ADMIN creates a valid scheme | API | `POST /admin/schemes` with valid body; JWT for ADMIN user | 201, `data.scheme_id` present, `data.code` matches, `data.is_active = true`; `audit_logs` row with `action='config_change'` and `entity_type='scheme'` |
| 2 | TC-042-02 | ADMIN lists schemes — paginated | API | `GET /admin/schemes?page=1&limit=10` with ADMIN JWT | 200, `data` is array, `meta.pagination.limit = 10`; rows ≤ 10 |
| 3 | TC-042-03 | List schemes filtered by product_code | API | `GET /admin/schemes?product_code=TW` with RM JWT | 200, every returned scheme has `product_code='TW'` or `product_code=null` (global schemes must not be filtered out if null is all-product — see ambiguities) |
| 4 | TC-042-04 | RM attaches a valid, active, product-matched scheme to a lead | API | `PATCH /leads/{id}` body `{ product_detail: { scheme_code: 'DEALER-TW-Q3' } }`; lead product_code = TW; scheme TW active, valid | 200, `data.lead_product_detail.attributes.scheme_code = 'DEALER-TW-Q3'`; `audit_logs` row with `action='lead_update'` and `lead_id` set |
| 5 | TC-042-05 | RM detaches scheme (null) | API | `PATCH /leads/{id}` body `{ product_detail: { scheme_code: null } }` | 200, `data.lead_product_detail.attributes.scheme_code` absent or null |

### Category: Scheme Validation — Error Paths

| # | ID | Description | Type | Inputs | Expected Result |
|---|-----|-------------|------|--------|-----------------|
| 6 | TC-042-06 | Attach expired scheme | API | Scheme `valid_to` = yesterday; `PATCH /leads/{id}` with that code | 400 `VALIDATION_ERROR`, `error.fields[0].field = 'scheme_code'`, message contains 'expired' |
| 7 | TC-042-07 | Attach inactive scheme (`is_active=false`) | API | Scheme exists but `is_active=false`; attach attempt | 400 `VALIDATION_ERROR`, `error.fields[0].field = 'scheme_code'`, message contains 'inactive' |
| 8 | TC-042-08 | Attach scheme for wrong product | API | Lead `product_code=CV`; scheme `product_code=TW`; attach attempt | 400 `VALIDATION_ERROR`, `error.fields[0].field = 'scheme_code'`, message contains 'not available for this product' |
| 9 | TC-042-09 | Attach non-existent scheme code | API | `scheme_code='DOES-NOT-EXIST'` | 400 `VALIDATION_ERROR`, `error.fields[0].field = 'scheme_code'`, message contains 'not found' |
| 10 | TC-042-10 | Create scheme with `valid_to` before `valid_from` | API | `valid_from='2026-10-01'`, `valid_to='2026-09-01'` | 400 `VALIDATION_ERROR`, `error.fields[0].field = 'valid_to'` |
| 11 | TC-042-11 | Create scheme with duplicate code | API | Create the same `code` twice for the same org | First: 201. Second: 409 `CONFLICT`, no duplicate row in `schemes` |
| 12 | TC-042-12 | Create scheme with missing required fields | API | Body omits `code`, `valid_from` | 400 `VALIDATION_ERROR`, `error.fields` lists both missing fields |

### Category: Authorisation — Positive

| # | ID | Description | Type | Inputs | Expected Result |
|---|-----|-------------|------|--------|-----------------|
| 13 | TC-042-13 | BM lists schemes (has `configuration` B-scope) | API | JWT for BM role | 200 |
| 14 | TC-042-14 | RM lists schemes (has `view_lead` O-scope; read-only) | API | JWT for RM role | 200 |
| 15 | TC-042-15 | BM attaches scheme to a branch-scoped lead | API | Lead in BM's branch; BM JWT | 200 |

### Category: Authorisation — Negative (mandatory per testing-contract.md)

| # | ID | Description | Type | Inputs | Expected Result |
|---|-----|-------------|------|--------|-----------------|
| 16 | TC-042-16 | Unauthenticated request to create scheme | API | No JWT header | 401 `AUTH_REQUIRED` |
| 17 | TC-042-17 | RM attempts to create scheme (lacks `configuration` capability) | API | RM JWT; `POST /admin/schemes` | 403 `FORBIDDEN` |
| 18 | TC-042-18 | PARTNER attempts to attach scheme | API | PARTNER JWT; `PATCH /leads/{id}` with `product_detail.scheme_code` | 403 `FORBIDDEN` |
| 19 | TC-042-19 | RM attempts to attach scheme to another RM's lead (out-of-scope O) | API | RM-A JWT; lead owned by RM-B | 403 `FORBIDDEN` (or 404 per §8.4 existence hiding rule) |
| 20 | TC-042-20 | ADMIN (no standing lead-content access) attempts `PATCH /leads/{id}` | API | ADMIN JWT (no break-glass) | 403 `FORBIDDEN` |

### Category: Boundary & Invariant

| # | ID | Description | Type | Inputs | Expected Result |
|---|-----|-------------|------|--------|-----------------|
| 21 | TC-042-21 | Scheme with `valid_from = valid_to` (one-day scheme) | Unit | `valid_from = valid_to = today`; attach attempt | Scheme is not expired (boundary); attach succeeds |
| 22 | TC-042-22 | Scheme with `product_code = null` attaches to any lead product | Unit | Scheme `product_code=null`; lead `product_code=CV` | Product match check passes; attach succeeds |
| 23 | TC-042-23 | List limit enforced at 100 | API | `GET /admin/schemes?limit=999` | `meta.pagination.limit ≤ 100`; no 4xx |
| 24 | TC-042-24 | Attach scheme preserves existing `attributes` fields | Unit/API | LPD has `{ "vehicle_reg": "MH01AB1234" }`; attach scheme_code | After update: `attributes.vehicle_reg` still present; `attributes.scheme_code` added |

### Category: Concurrent write safety

| # | ID | Description | Type | Inputs | Expected Result |
|---|-----|-------------|------|--------|-----------------|
| 25 | TC-042-25 | Concurrent `PATCH /leads/{id}` from two sessions (optimistic lock) | API | Two simultaneous patches to the same lead; second uses stale `version` if the broader lead patch bumps it | 409 `CONFLICT` on the stale write; first write committed; no partial state |

---

## Unit Tests

**File:** `apps/api/src/modules/product-config/scheme.service.spec.ts`

### TC-042-U1: Validity window boundary — scheme valid today is not expired

```typescript
it('returns the scheme when valid_to equals today (UTC date)', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const scheme = makeScheme({ valid_from: today, valid_to: today, is_active: true });
  mockRepo.findActiveByCode.mockResolvedValue(scheme);

  const result = await service.validateAndResolveScheme('CODE', 'CV', orgId, today);

  expect(result).toEqual(scheme);
});
```

### TC-042-U2: Scheme expired yesterday throws VALIDATION_ERROR

```typescript
it('throws VALIDATION_ERROR when scheme valid_to is before today', async () => {
  const yesterday = subtractDays(new Date(), 1).toISOString().slice(0, 10);
  const scheme = makeScheme({ valid_to: yesterday, is_active: true });
  mockRepo.findActiveByCode.mockResolvedValue(scheme);

  await expect(
    service.validateAndResolveScheme('CODE', 'CV', orgId, new Date().toISOString().slice(0, 10))
  ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', fields: [{ field: 'scheme_code' }] });
});
```

### TC-042-U3: Null product_code scheme matches any product

```typescript
it('passes product match when scheme.product_code is null', async () => {
  const scheme = makeScheme({ product_code: null, valid_to: '2099-12-31', is_active: true });
  mockRepo.findActiveByCode.mockResolvedValue(scheme);

  await expect(
    service.validateAndResolveScheme('CODE', 'CV', orgId, '2026-06-09')
  ).resolves.toEqual(scheme);
});
```

### TC-042-U4: Product mismatch throws VALIDATION_ERROR

```typescript
it('throws VALIDATION_ERROR when scheme product does not match lead product', async () => {
  const scheme = makeScheme({ product_code: 'TW', valid_to: '2099-12-31', is_active: true });
  mockRepo.findActiveByCode.mockResolvedValue(scheme);

  await expect(
    service.validateAndResolveScheme('CODE', 'CV', orgId, '2026-06-09')
  ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', fields: [{ field: 'scheme_code' }] });
});
```

### TC-042-U5: Inactive scheme throws VALIDATION_ERROR

```typescript
it('throws VALIDATION_ERROR when scheme is_active is false', async () => {
  const scheme = makeScheme({ is_active: false, valid_to: '2099-12-31' });
  mockRepo.findActiveByCode.mockResolvedValue(scheme);

  await expect(
    service.validateAndResolveScheme('CODE', 'CV', orgId, '2026-06-09')
  ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', fields: [{ field: 'scheme_code' }] });
});
```

---

## SQL Invariant Queries

These run after relevant test scenarios and must return 0 rows.

```sql
-- INV-1: No scheme row should have valid_to < valid_from (DB constraint ck_schemes_validity, but assert in tests too)
SELECT scheme_id FROM schemes WHERE valid_to < valid_from;

-- INV-2: No two schemes share the same (org_id, code)
SELECT org_id, code, COUNT(*) AS cnt
FROM schemes
GROUP BY org_id, code
HAVING COUNT(*) > 1;

-- INV-3: After scheme attach, lead_product_details must still have exactly one row per lead
SELECT lead_id, COUNT(*) AS cnt
FROM lead_product_details
GROUP BY lead_id
HAVING COUNT(*) > 1;

-- INV-4: audit_logs rows emitted for scheme creation must not be UPDATE-able or DELETE-able
-- (verified by REVOKE grant — tested via direct SQL attempt returning permission-denied)

-- INV-5: No lead_product_details row should reference a scheme code that does not exist in schemes
-- (no FK on attributes.scheme_code — this is a logical invariant test)
SELECT lpd.lead_id, lpd.attributes->>'scheme_code' AS bad_code
FROM lead_product_details lpd
WHERE lpd.attributes->>'scheme_code' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM schemes s WHERE s.code = lpd.attributes->>'scheme_code' AND s.org_id = lpd.org_id
  );
```

---

## UI Test Scenarios

**File:** `apps/web/src/components/scheme/SchemeSelect.test.tsx`

| # | Scenario | Tool | Assertion |
|---|----------|------|-----------|
| UI-1 | Scheme picker displays active schemes filtered by lead's product_code | Vitest + Testing Library | Combobox renders options; expired scheme (from today's date) shows disabled chip |
| UI-2 | Selecting a scheme calls PATCH and shows Toast on success | Vitest + Testing Library | `onSubmit` mock called with correct `scheme_code`; Toast "Scheme attached" appears |
| UI-3 | Expired scheme option is visually flagged and cannot be selected | Vitest + Testing Library | `StatusChip "Expired"` rendered; option is `aria-disabled="true"` |
| UI-4 | API VALIDATION_ERROR maps `fields[scheme_code]` to inline error | Vitest + Testing Library | Error message appears below the Combobox |

**File:** `apps/web/e2e/scheme.spec.ts`

| # | Scenario | Tool | Assertion |
|---|----------|------|-----------|
| E2E-1 | ADMIN creates a new scheme via admin UI and it appears in the list | Playwright | Form submit → success toast → scheme row visible in DataTable |
| E2E-2 | RM attaches scheme on lead 360; scheme persists after page reload | Playwright | Scheme Combobox value visible in lead 360 after reload |

---

## Coverage Checklist

| Requirement | Covered by | Status |
|-------------|-----------|--------|
| Happy path — create scheme | TC-042-01 | Yes |
| Happy path — list schemes (paginated) | TC-042-02, TC-042-03 | Yes |
| Happy path — attach scheme | TC-042-04 | Yes |
| Happy path — detach scheme | TC-042-05 | Yes |
| `VALIDATION_ERROR` — expired scheme | TC-042-06, TC-042-U2 | Yes |
| `VALIDATION_ERROR` — inactive scheme | TC-042-07, TC-042-U5 | Yes |
| `VALIDATION_ERROR` — product mismatch | TC-042-08, TC-042-U4 | Yes |
| `VALIDATION_ERROR` — scheme not found | TC-042-09 | Yes |
| `VALIDATION_ERROR` — date range invalid | TC-042-10 | Yes |
| `VALIDATION_ERROR` — missing required fields | TC-042-12 | Yes |
| `CONFLICT` — duplicate scheme code | TC-042-11 | Yes |
| `CONFLICT` — optimistic lock | TC-042-25 | Yes |
| `AUTH_REQUIRED` — unauthenticated | TC-042-16 | Yes |
| `FORBIDDEN` — insufficient role (create) | TC-042-17 | Yes |
| `FORBIDDEN` — wrong role (attach) | TC-042-18 | Yes |
| `FORBIDDEN` — out-of-scope (attach) | TC-042-19 | Yes |
| `FORBIDDEN` — ADMIN no lead-content access | TC-042-20 | Yes |
| Null product_code matches any product | TC-042-22, TC-042-U3 | Yes |
| Pagination limit enforced at 100 | TC-042-23 | Yes |
| JSONB merge preserves existing attributes | TC-042-24 | Yes |
| Boundary: valid_to = today is not expired | TC-042-21, TC-042-U1 | Yes |
| Audit log written on scheme create | TC-042-01 (assert audit row) | Yes |
| Audit log written on scheme attach | TC-042-04 (assert audit row) | Yes |
| Append-only audit invariant | INV-4 (SQL invariant) | Yes |
| No duplicate schemes invariant | INV-2 (SQL invariant) | Yes |
| Orphan scheme_code invariant | INV-5 (SQL invariant) | Yes |
| UI: scheme picker renders per product | UI-1 | Yes |
| UI: expired scheme flagged | UI-3 | Yes |
| UI: validation error mapped to field | UI-4 | Yes |
| E2E: admin creates scheme end-to-end | E2E-1 | Yes |
| E2E: RM attaches scheme on lead 360 | E2E-2 | Yes |

---

## Ambiguities

1. **`product_code = null` on scheme and picker filtering** — the BRD says schemes are "product-matched" but does not state whether a `null` product_code scheme is available across all products. This LLD treats `null` as "all products." If the business requires all schemes to have an explicit product, adjust the Zod DTO to make `product_code` required and non-nullable, and remove TC-042-22 / TC-042-U3.

2. **Scheme `code` case sensitivity** — the schema has `VARCHAR(40)` with a unique constraint on `(org_id, code)`. The Zod regex enforces uppercase, but if the DB collation is case-sensitive, `DEALER-TW-Q3` and `dealer-tw-q3` would be distinct. The LLD enforces uppercase at input. Confirm that the target PostgreSQL collation is `C` or `en-US-x-icu` (case-sensitive) so the constraint behaves as expected.

3. **List `GET /admin/schemes` for scheme picker (RM access)** — the API contract maps `GET /admin/{masterResource}` to `x-frs: [FR-131]` only (not FR-042). The RM role does not have `configuration` capability. This LLD allows `view_lead` as sufficient for the list endpoint used as a picker. If admin list routes are to be strictly `configuration`-gated, a separate non-admin route (e.g., `GET /products/schemes`) should be added to the API contract.

4. **Scheme deactivation / edit** — FR-042 specifies creation and attachment but not scheme editing or deactivation. The `PATCH /admin/{masterResource}` route exists in the contract (FR-131). Deactivation (setting `is_active = false`) is treated as out of scope for FR-042 and delegated to FR-131.
