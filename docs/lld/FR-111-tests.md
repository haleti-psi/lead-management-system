# FR-111: Data Minimisation & Resource-Access Controls — Test Specification

**Tier: 2**
**Source LLD:** `docs/lld/FR-111.md`

---

## Test Cases

| # | Layer | Test name | Scenario | Expected result |
|---|---|---|---|---|
| T-01 | Unit | `DataSharingService` — happy path share | `logShare` called with valid `leadId`, `purpose='los_handoff'`, `dataCategory='financial'`, and a `granted` non-expired `consent_records` row | Inserts `data_sharing_logs` row with `status='shared'`; `AuditAppender.emit` called once; no exception thrown |
| T-02 | Unit | `DataSharingService` — CONSENT_MISSING: no granted record | `logShare` called when no `consent_records` row with `state='granted'` exists for the `purpose`+`dataCategory` | Throws `ForbiddenException` with `code='FORBIDDEN'`, `detail.reason='CONSENT_MISSING'` |
| T-03 | Unit | `DataSharingService` — CONSENT_MISSING: expired consent | `logShare` called when `consent_records` row exists with `state='granted'` but `expires_at < now()` | Throws `ForbiddenException` with `detail.reason='CONSENT_MISSING'` |
| T-04 | Unit | `DataSharingService` — CONSENT_MISSING: withdrawn consent | `logShare` called when the most recent `consent_records` row has `state='withdrawn'` | Throws `ForbiddenException` with `detail.reason='CONSENT_MISSING'` |
| T-05 | Unit | `DataMinimisationService` — allowed fields pass | `assertAllowed` called with only fields listed in `field_schema.allowedFields` | Returns without throwing |
| T-06 | Unit | `DataMinimisationService` — disallowed field blocked | `assertAllowed` called with a field key not in `field_schema.allowedFields` (e.g. `aadhaar_number`) | Throws `BadRequestException` with `code='VALIDATION_ERROR'`; `fields[].field` contains the disallowed key |
| T-07 | Unit | `DataMinimisationService` — multiple disallowed fields | `assertAllowed` called with two disallowed fields | Throws `VALIDATION_ERROR`; `fields[]` lists both disallowed field names |
| T-08 | Unit | `DataMinimisationService` — empty field map passes | `assertAllowed` called with `{}` | Returns without throwing |
| T-09 | API integration | `GET /leads/:id/sharing-logs` — DPO happy path | DPO JWT, valid `leadId` with 3 sharing-log rows | HTTP 200; `data` array length 3; pagination `total=3`; envelope `error=null` |
| T-10 | API integration | `GET /leads/:id/sharing-logs` — authz negative (RM) | RM JWT with valid `leadId` | HTTP 403; `error.code='FORBIDDEN'` |
| T-11 | API integration | `GET /leads/:id/sharing-logs` — authz negative (BM) | BM JWT with lead in their branch | HTTP 403; `error.code='FORBIDDEN'` |
| T-12 | API integration | `GET /leads/:id/sharing-logs` — unauthenticated | No `Authorization` header | HTTP 401; `error.code='AUTH_REQUIRED'` |
| T-13 | API integration | `GET /leads/:id/sharing-logs` — lead not found | DPO JWT, non-existent UUID | HTTP 404; `error.code='NOT_FOUND'` |
| T-14 | API integration | `GET /leads/:id/sharing-logs` — soft-deleted lead | DPO JWT, lead where `deleted_at IS NOT NULL` | HTTP 404; `error.code='NOT_FOUND'` |
| T-15 | API integration | `GET /leads/:id/sharing-logs` — pagination defaults | DPO JWT, lead with 30 sharing-log rows, no query params | HTTP 200; `data` length 25 (default limit); `meta.pagination.total=30` |
| T-16 | API integration | `GET /leads/:id/sharing-logs` — pagination limit=5 | DPO JWT, `?page=1&limit=5`, lead with 12 rows | HTTP 200; `data` length 5 |
| T-17 | API integration | `GET /leads/:id/sharing-logs` — pagination limit over max | DPO JWT, `?limit=200` | HTTP 400; `error.code='VALIDATION_ERROR'`; `fields[].field='limit'` |
| T-18 | API integration | `DataSharingService.logShare` tx rollback | Simulate DB constraint failure mid-`logShare` (mock Kysely throw after consent check, before insert) | `data_sharing_logs` row NOT inserted; `audit_logs` NOT written; outer UoW rolls back; caller operation fails atomically |
| T-19 | API integration | No raw Aadhaar column invariant | Query `information_schema.columns WHERE table_name='lead_identities' AND column_name IN ('aadhaar_number','raw_aadhaar','biometric_data')` | Zero rows returned |
| T-20 | API integration | No raw Aadhaar in KYC table | Query `information_schema.columns WHERE table_name='kyc_verifications' AND column_name IN ('aadhaar_number','raw_aadhaar','biometric_data')` | Zero rows returned |

---

## SQL Invariant Queries

These queries must return **0 rows** at all times. Run after every test that mutates `data_sharing_logs` or `consent_records`.

```sql
-- INV-1: No data-sharing log without a lead reference
SELECT dsl.data_sharing_log_id
FROM data_sharing_logs dsl
LEFT JOIN leads l ON dsl.lead_id = l.lead_id
WHERE l.lead_id IS NULL
LIMIT 1;
-- expect: 0 rows

-- INV-2: No data-sharing log with consent_id pointing to a non-granted record
SELECT dsl.data_sharing_log_id
FROM data_sharing_logs dsl
JOIN consent_records cr ON dsl.consent_id = cr.consent_id
WHERE cr.state NOT IN ('granted')
  AND dsl.consent_id IS NOT NULL
LIMIT 1;
-- expect: 0 rows (all persisted sharing logs reference a granted consent, or consent_id is NULL for system-internal shares that predate consent requirement — but in this system consent_id is always set)

-- INV-3: No raw Aadhaar column in lead_identities
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'lead_identities'
  AND column_name IN ('aadhaar_number', 'raw_aadhaar', 'aadhaar_raw', 'biometric_data', 'biometric_template')
LIMIT 1;
-- expect: 0 rows

-- INV-4: No raw Aadhaar column in kyc_verifications
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'kyc_verifications'
  AND column_name IN ('aadhaar_number', 'raw_aadhaar', 'aadhaar_raw', 'biometric_data', 'biometric_template')
LIMIT 1;
-- expect: 0 rows

-- INV-5: data_sharing_logs rows are not updated (shared_at equals created_at for all rows — log is append-only in intent; updated_at trigger exists but no service ever issues UPDATE)
-- Implementation note: since updated_at trigger fires on UPDATE, verify no UPDATE path exists in DataSharingService.
-- Test assertion: DataSharingService has no method that issues UPDATE on data_sharing_logs.
-- This is a code-review invariant, not a runtime SQL query.

-- INV-6: Every data_sharing_log has a non-null recipient and status
SELECT data_sharing_log_id
FROM data_sharing_logs
WHERE recipient IS NULL
   OR status IS NULL
LIMIT 1;
-- expect: 0 rows
```

---

## UI Test Scenarios

| # | Tool | Scenario | Steps | Expected |
|---|---|---|---|---|
| UI-01 | Vitest + Testing Library | `SharingLogPage` renders log rows | Mount with mocked API returning 2 rows | 2 table rows rendered; each shows `recipient`, `purpose`, `dataCategory`, `sharedAt` |
| UI-02 | Vitest + Testing Library | `SharingLogPage` renders `EmptyState` | Mount with mocked API returning 0 rows | `EmptyState` component visible; no table rows |
| UI-03 | Vitest + Testing Library | `SharingLogPage` renders `LoadingSkeleton` | Mount while API call is in-flight (React Query loading state) | `LoadingSkeleton` visible; table not rendered |
| UI-04 | Vitest + Testing Library | `SharingLogPage` renders `ErrorState` on fetch failure | Mount with mocked API returning 500 | `ErrorState` component visible with message |
| UI-05 | Playwright | DPO views sharing log for a lead | DPO logs in; navigates to lead → Compliance Console → Sharing Log; page loads | Table displays rows with correct columns; no console errors; WCAG focus order correct |

---

## Coverage Checklist

| Requirement | Covered by | Status |
|---|---|---|
| Happy path — `logShare` inserts row with granted consent | T-01 | Covered |
| `CONSENT_MISSING` — no granted consent record | T-02 | Covered |
| `CONSENT_MISSING` — consent expired | T-03 | Covered |
| `CONSENT_MISSING` — consent withdrawn | T-04 | Covered |
| `DataMinimisationService` allows permitted fields | T-05 | Covered |
| `DataMinimisationService` blocks disallowed field (`VALIDATION_ERROR`) | T-06, T-07 | Covered |
| `GET /leads/:id/sharing-logs` DPO happy path | T-09 | Covered |
| `FORBIDDEN` — RM cannot access sharing logs | T-10 | Covered |
| `FORBIDDEN` — BM cannot access sharing logs | T-11 | Covered |
| `AUTH_REQUIRED` — unauthenticated | T-12 | Covered |
| `NOT_FOUND` — lead absent | T-13 | Covered |
| `NOT_FOUND` — soft-deleted lead | T-14 | Covered |
| `VALIDATION_ERROR` — limit > 100 | T-17 | Covered |
| Transaction rollback on `logShare` failure | T-18 | Covered |
| No raw Aadhaar in `lead_identities` (schema invariant) | T-19, INV-3 | Covered |
| No raw Aadhaar in `kyc_verifications` (schema invariant) | T-20, INV-4 | Covered |
| Pagination defaults applied (limit=25) | T-15 | Covered |
| `data_sharing_logs` FK integrity (no orphaned lead) | INV-1 | Covered |
| Consent_id references granted record | INV-2 | Covered |
| UI empty state | UI-02 | Covered |
| UI loading state | UI-03 | Covered |
| UI error state | UI-04 | Covered |
| ABAC: only DPO (`consent_ledger` scope A) can read sharing logs | T-10, T-11, T-12 | Covered |
| Masking: DPO sees masked view (no PII in `data_sharing_logs` columns — `recipient` is provider name, not PII) | MaskingService interceptor; `data_sharing_logs` does not store PII names/mobile directly | Covered by design |
