# FR-070: Document Checklist & Upload — Test Specification

**Tier: 3**
**Source LLD:** `docs/lld/FR-070.md`

---

## Overview

FR-070 is Tier 3 (data + state machine + external service + UI). The required test coverage follows `docs/contracts/testing-contract.md` for Tier 3: all logic units + all endpoints (happy + each error path) + all document state transitions + mock port + timeout/retry + idempotency + full workflow E2E.

Minimum: **10 test cases** (spec calls for ≥ 10 for Tier 3). This specification defines 18.

---

## Test Cases

### Unit Tests (`apps/api/src/modules/kyc/*.spec.ts`)

---

**TC-001** `DocumentService — deriveKycStatus — returns "not_started" when no docs exist`

| | |
|---|---|
| Layer | Unit (Jest) |
| File | `apps/api/src/modules/kyc/document.service.spec.ts` |
| Setup | Checklist: 2 mandatory items (`pan/applicant`, `address/applicant`). DB returns 0 documents. |
| Action | `service['deriveKycStatus'](checklist, [])` |
| Assert | Returns `'not_started'` |
| Error codes covered | — |

---

**TC-002** `DocumentService — deriveKycStatus — returns "in_progress" when a mandatory doc is uploaded but not verified`

| | |
|---|---|
| Layer | Unit (Jest) |
| File | `apps/api/src/modules/kyc/document.service.spec.ts` |
| Setup | Checklist: 2 mandatory items. One doc with `status='uploaded'`, one missing. |
| Action | `service['deriveKycStatus'](checklist, [uploadedDoc])` |
| Assert | Returns `'in_progress'` |
| Error codes covered | — |

---

**TC-003** `DocumentService — deriveKycStatus — returns "verified" when all mandatory docs are verified or waived`

| | |
|---|---|
| Layer | Unit (Jest) |
| File | `apps/api/src/modules/kyc/document.service.spec.ts` |
| Setup | Checklist: 2 mandatory items. Docs: one `status='verified'`, one `status='waived'`. |
| Action | `service['deriveKycStatus'](checklist, docs)` |
| Assert | Returns `'verified'` |
| Error codes covered | — |

---

**TC-004** `DocumentService — initiateUpload — rejects doc_type not in product checklist`

| | |
|---|---|
| Layer | Unit (Jest) |
| File | `apps/api/src/modules/kyc/document.service.spec.ts` |
| Setup | Mock repository returns a lead with `document_checklist = [{ doc_type:'pan', applicant_scope:'applicant', mandatory:true }]`. DTO has `doc_type='photo'`. |
| Action | `service.initiateUpload(leadId, dto, user)` |
| Assert | Throws `VALIDATION_ERROR` (400); message contains "not in the product checklist" |
| Error codes covered | `VALIDATION_ERROR` |

---

**TC-005** `DocumentService — waiveDocument — throws FORBIDDEN when caller is RM (no verify_doc capability)`

| | |
|---|---|
| Layer | Unit (Jest) |
| File | `apps/api/src/modules/kyc/document.service.spec.ts` |
| Setup | Mock `EntitlementService.can` returns `false` for `verify_doc`. User role = `RM`. |
| Action | `service.waiveDocument(leadId, docId, waiverDto, rmUser)` |
| Assert | Throws `FORBIDDEN` (403) |
| Error codes covered | `FORBIDDEN` |

---

**TC-006** `DocumentService — waiveDocument — throws CONFLICT when document already waived`

| | |
|---|---|
| Layer | Unit (Jest) |
| File | `apps/api/src/modules/kyc/document.service.spec.ts` |
| Setup | Mock repository returns document with `status='waived'`. User role = `KYC`. |
| Action | `service.waiveDocument(leadId, docId, waiverDto, kycUser)` |
| Assert | Throws `CONFLICT` (409) |
| Error codes covered | `CONFLICT` |

---

**TC-007** `DocumentService — confirmUpload — MIME mismatch triggers VALIDATION_ERROR and GCS deletion`

| | |
|---|---|
| Layer | Unit (Jest) |
| File | `apps/api/src/modules/kyc/document.service.spec.ts` |
| Setup | Mock `GcsMockAdapter.getObjectMetadata` returns `{ contentType: 'image/jpeg' }`. Document was initiated with `file_type='application/pdf'`. |
| Action | `service.confirmUpload(leadId, docId, confirmDto, user)` |
| Assert | (a) Throws `VALIDATION_ERROR` (400); (b) `GcsMockAdapter.deleteObject` called once; (c) document `status` remains `'pending'` (not changed) |
| Error codes covered | `VALIDATION_ERROR` |

---

### API Integration Tests (`apps/api/test/document.e2e-spec.ts`)

All integration tests use Testcontainers-Postgres with Flyway migrations, seeded with factory data. Mock adapters: `GcsMockAdapter`, `VirusScanMockAdapter`.

---

**TC-008** `GET /leads/{id}/documents — happy path — returns merged checklist`

| | |
|---|---|
| Layer | API integration (supertest) |
| Setup | Seed: lead with product config having 3 checklist items (2 mandatory). 1 existing `documents` row (`status='uploaded'`). JWT for KYC user with branch scope. |
| Action | `GET /api/v1/leads/{id}/documents` with valid JWT |
| Assert | (a) HTTP 200; (b) `data.checklist` has 3 items; (c) one item has `status='uploaded'`, two have `status='pending'`; (d) `data.mandatory_complete = false`; (e) `data.kyc_status = 'in_progress'` |
| Error codes covered | happy path |

---

**TC-009** `GET /leads/{id}/documents — authz negative — RM cannot read another RM's lead`

| | |
|---|---|
| Layer | API integration (supertest) |
| Setup | Seed: lead owned by `rmA`. JWT for `rmB` (different owner, same branch). |
| Action | `GET /api/v1/leads/{id}/documents` with `rmB` JWT |
| Assert | HTTP 403; `error.code = 'FORBIDDEN'` |
| Error codes covered | `FORBIDDEN` |

---

**TC-010** `POST /leads/{id}/documents — Phase A happy path — returns signed URL and document_id`

| | |
|---|---|
| Layer | API integration (supertest) |
| Setup | `GcsMockAdapter.generateSignedPutUrl` returns a fake URL. JWT for RM with O scope (own lead). |
| Action | `POST /api/v1/leads/{id}/documents` with valid `{ doc_type:'pan', applicant_scope:'applicant', file_name:'pan.pdf', file_type:'application/pdf', file_size_kb:200 }` |
| Assert | (a) HTTP 201; (b) `data.document_id` is UUID; (c) `data.upload_url` non-empty; (d) DB: 1 row in `documents` with `status='pending'`; (e) DB: 1 row in `audit_logs` with `action='doc_upload'`; (f) `data.upload_url_expires_at` is in the future |
| Error codes covered | happy path |

---

**TC-011** `POST /leads/{id}/documents — UNSUPPORTED_MEDIA — rejects disallowed file type`

| | |
|---|---|
| Layer | API integration (supertest) |
| Setup | JWT for RM (own lead). |
| Action | `POST /api/v1/leads/{id}/documents` with `file_type='application/zip'` |
| Assert | HTTP 415; `error.code = 'UNSUPPORTED_MEDIA'` |
| Error codes covered | `UNSUPPORTED_MEDIA` |

---

**TC-012** `POST /leads/{id}/documents — PAYLOAD_TOO_LARGE — rejects file > MAX_UPLOAD_MB`

| | |
|---|---|
| Layer | API integration (supertest) |
| Setup | `MAX_UPLOAD_MB=10` in test env. JWT for RM. |
| Action | `POST` with `file_size_kb = 10241` (10 MB + 1 KB) |
| Assert | HTTP 413; `error.code = 'PAYLOAD_TOO_LARGE'` |
| Error codes covered | `PAYLOAD_TOO_LARGE` |

---

**TC-013** `POST /leads/{id}/documents — VALIDATION_ERROR — doc_type not in product checklist`

| | |
|---|---|
| Layer | API integration (supertest) |
| Setup | Lead with product config checklist containing only `['pan','address']`. JWT for RM. |
| Action | `POST` with `doc_type='photo'` |
| Assert | HTTP 400; `error.code = 'VALIDATION_ERROR'`; message includes "not in the product checklist" |
| Error codes covered | `VALIDATION_ERROR` |

---

**TC-014** `POST /leads/{id}/documents (Phase B confirm) — UPSTREAM_UNAVAILABLE on GCS metadata failure`

| | |
|---|---|
| Layer | API integration (supertest) |
| Setup | Existing document in `status='pending'`. `GcsMockAdapter.getObjectMetadata` configured to throw 503. |
| Action | `POST /api/v1/leads/{id}/documents` with `{ action:'confirm', document_id: existingDocId }` |
| Assert | (a) HTTP 503; `error.code = 'UPSTREAM_UNAVAILABLE'`; `error.retryable = true`; (b) DB: document `status` still `'pending'` (transaction rolled back); (c) `IntegrationLog` row exists with `status='failed'` |
| Error codes covered | `UPSTREAM_UNAVAILABLE` |

---

**TC-015** `POST /leads/{id}/documents — transaction rollback — partial failure does not persist`

| | |
|---|---|
| Layer | API integration (supertest) |
| Setup | Force `AuditAppender.emit` to throw mid-transaction after `DocumentRepository.insert` succeeds (via test hook / mock override). |
| Action | Phase A upload initiation |
| Assert | (a) HTTP 500; (b) DB: zero rows in `documents` for this lead+doc_type (insert rolled back); (c) DB: zero rows in `audit_logs` for this lead (whole tx rolled back) |
| Error codes covered | `INTERNAL_ERROR` |

---

**TC-016** `PATCH /leads/{id}/documents/{did}/waive — happy path — status becomes waived, audit written`

| | |
|---|---|
| Layer | API integration (supertest) |
| Setup | Seed: document with `status='uploaded'`. JWT for KYC user (branch scope). |
| Action | `PATCH /api/v1/leads/{id}/documents/{did}/waive` with `{ reason: 'Flood victim, approved by compliance EX-2026-00123', expires_at: '2026-09-01' }` |
| Assert | (a) HTTP 200; `data.status = 'waived'`; (b) DB: `documents.status = 'waived'`, `waiver_reason` non-null; (c) DB: `audit_logs` row with `action='doc_waive'`, `entity_id=did`; (d) DB: `event_outbox` row with `event_code='DOC_UPLOADED'` (status=waived payload); (e) `leads.kyc_status` recomputed |
| Error codes covered | happy path |

---

**TC-017** `PATCH /leads/{id}/documents/{did}/waive — authz negative — RM cannot waive`

| | |
|---|---|
| Layer | API integration (supertest) |
| Setup | JWT for RM (no `verify_doc` capability). |
| Action | `PATCH` waive endpoint |
| Assert | HTTP 403; `error.code = 'FORBIDDEN'` |
| Error codes covered | `FORBIDDEN` |

---

**TC-018** `POST /c/{token}/documents — customer upload — Phase A returns signed URL without JWT`

| | |
|---|---|
| Layer | API integration (supertest) |
| Setup | Seed: active `customer_links` row for the lead. OTP step-up already completed (mock `CustomerLinkGuard` in test mode). `GcsMockAdapter` returns signed URL. |
| Action | `POST /api/v1/c/{token}/documents` (no Authorization header) with valid Phase A body |
| Assert | (a) HTTP 201; (b) `data.upload_url` non-empty; (c) DB: `documents.uploaded_via = 'customer_link'`; (d) DB: document `org_id` matches lead's `org_id` |
| Error codes covered | happy path (customer path) |

---

**TC-019** `Re-upload — version increments, previous verified row is unchanged`

| | |
|---|---|
| Layer | API integration (supertest) |
| Setup | Seed: document with `status='verified'`, `version=1`. JWT for RM. |
| Action | Phase A upload for the same `doc_type + applicant_scope` |
| Assert | (a) HTTP 201 (new document row created); (b) DB: new row with `version=2`, `status='pending'`; (c) DB: original row still has `status='verified'`, `version=1` (not reverted); (d) `leads.kyc_status` recomputed to `'in_progress'` (new pending doc) |
| Error codes covered | state machine: no `verified -> pending` revert |

---

**TC-020** `Virus scan callback — infected file — document rejected, GCS object deleted`

| | |
|---|---|
| Layer | API integration (supertest) |
| Setup | Seed: document with `status='uploaded'`, `virus_scan_status='pending'`, valid `storage_ref`. |
| Action | Internal scan-result webhook: `POST /api/v1/internal/documents/{did}/scan-result` with `{ status:'infected' }` (HMAC-signed) |
| Assert | (a) DB: `documents.virus_scan_status = 'infected'`; (b) DB: `documents.status` back to `'pending'` (rejected); (c) DB: `documents.storage_ref` is null; (d) `GcsMockAdapter.deleteObject` called; (e) DB: `audit_logs` row written; (f) DB: `event_outbox` row with infected status payload |
| Error codes covered | state machine: infected scan path |

---

**TC-021** `GET /leads/{id}/documents — RATE_LIMITED — exceeds read limit`

| | |
|---|---|
| Layer | API integration (supertest) |
| Setup | Redis-backed ThrottlerGuard with `RATE_LIMIT_READ = 5` (override for test). JWT for RM. |
| Action | Send 6 consecutive `GET /api/v1/leads/{id}/documents` requests from same user |
| Assert | First 5: HTTP 200. Sixth: HTTP 429; `error.code = 'RATE_LIMITED'`; `Retry-After` header present |
| Error codes covered | `RATE_LIMITED` |

---

## SQL Invariant Queries

These queries must return **0 rows** at all times. Run after every test suite and as part of CI.

### INV-001: No direct lead writes from M8 (owner-writes rule)

```sql
-- Verify: the M8 module never issues a raw UPDATE on leads (only LeadService is permitted)
-- This is a code-level constraint enforced by review; the SQL invariant checks for impossible
-- states that would only arise from a bypass.
-- Test: after any document write, leads.kyc_status is one of the valid enum values.
SELECT count(*) FROM leads
WHERE kyc_status NOT IN ('not_started','in_progress','verified','exception','waived')
  AND deleted_at IS NULL;
-- Expected: 0
```

### INV-002: Documents without a valid lead reference

```sql
SELECT count(*) FROM documents d
LEFT JOIN leads l ON l.lead_id = d.lead_id
WHERE l.lead_id IS NULL;
-- Expected: 0 (FK enforces this, but explicit check confirms no orphaned rows)
```

### INV-003: No document version duplicate for same (lead, doc_type, applicant_scope, version)

```sql
SELECT lead_id, doc_type, applicant_scope, version, count(*)
FROM documents
WHERE deleted_at IS NULL
GROUP BY lead_id, doc_type, applicant_scope, version
HAVING count(*) > 1;
-- Expected: 0 rows
```

### INV-004: No document with storage_ref set but scan status 'infected'

```sql
SELECT count(*) FROM documents
WHERE virus_scan_status = 'infected'
  AND storage_ref IS NOT NULL;
-- Expected: 0 (infected files must have storage_ref nulled and GCS object deleted)
```

### INV-005: No audit_log rows for doc_upload/doc_waive that are UPDATEd (append-only)

```sql
-- Verify updated_at equals created_at for audit_logs (append-only; rows must never be updated)
SELECT count(*) FROM audit_logs
WHERE action IN ('doc_upload','doc_waive')
  AND updated_at != created_at;
-- Expected: 0
```

### INV-006: Event outbox has no pending DOC_UPLOADED events older than 5 minutes (stale relay check)

```sql
SELECT count(*) FROM event_outbox
WHERE event_code = 'DOC_UPLOADED'
  AND status = 'pending'
  AND created_at < now() - interval '5 minutes';
-- Expected: 0 (used in staging smoke test, not unit test suite)
```

### INV-007: No document with version > 1 where a verified version does not exist at version n-1 or lower

```sql
-- Re-upload version sequence integrity: if version=2 exists, version=1 must also exist.
SELECT d2.document_id, d2.lead_id, d2.doc_type, d2.applicant_scope, d2.version
FROM documents d2
WHERE d2.version > 1
  AND NOT EXISTS (
    SELECT 1 FROM documents d1
    WHERE d1.lead_id = d2.lead_id
      AND d1.doc_type = d2.doc_type
      AND d1.applicant_scope = d2.applicant_scope
      AND d1.version = d2.version - 1
  );
-- Expected: 0 rows
```

---

## UI Test Scenarios

### Playwright E2E (`apps/web/e2e/document-upload.spec.ts`)

**UI-001 — Staff upload full flow (RM)**

1. Log in as RM; navigate to Lead 360 > Documents tab.
2. Checklist renders with `LoadingSkeleton` then actual items.
3. Mandatory items show `StatusChip` variant `pending`.
4. Click "Upload" on PAN item; Drawer/Dialog opens.
5. Select a valid PDF file (< 10 MB).
6. Progress bar appears during GCS PUT (mock).
7. On Phase B confirm: item chip changes to `uploaded`; Toast "Document uploaded" appears.
8. Mandatory_complete remains false (second mandatory doc still pending).

**UI-002 — Customer self-service upload (/c/{token}/upload)**

1. Open customer link URL (no JWT).
2. OTP step-up prompt; enter mock OTP.
3. Simplified checklist visible; camera capture button available on mobile viewport (360px).
4. Upload a JPEG; after confirm, status chip shows `uploaded`.
5. No internal notes, scores, or RM fields are visible on this page.

**UI-003 — Waiver modal — KYC user**

1. Log in as KYC user; open checklist.
2. "Waive" button visible on items (not visible for RM login — verify in UI-004).
3. Click Waive; ConfirmDialog opens with `reason` textarea.
4. Submit without reason → inline validation error: "Waiver reason is required".
5. Fill reason (10+ chars), submit → item chip changes to `waived`; Toast "Document waived".

**UI-004 — Authz UI — RM does not see Waive button**

1. Log in as RM; open checklist.
2. Assert: no "Waive" button rendered in the DOM for any checklist item.

**UI-005 — MIME validation feedback**

1. RM attempts to upload a `.docx` file.
2. FileDropzone rejects the file before form submission (client-side MIME check in accept prop).
3. If bypassed (test with fetch), server returns 415; `Toast` shows "Unsupported file type."

**UI-006 — Re-upload increments version badge**

1. Lead has a `verified` PAN document (version 1).
2. RM uploads a new PAN.
3. After confirm, checklist shows new item with `VersionBadge v2` and `status='uploaded'`.
4. Previous version 1 row is still visible in history (collapsed view or version history drawer).

---

## Coverage Checklist

| Requirement | Test(s) |
|---|---|
| Happy path — GET checklist | TC-008, UI-001 |
| Happy path — POST upload Phase A | TC-010, UI-001 |
| Happy path — POST upload Phase B confirm | TC-010 (Phase B in same test flow) |
| Happy path — waiver | TC-016, UI-003 |
| Happy path — customer upload | TC-018, UI-002 |
| `VALIDATION_ERROR` — bad file type | TC-011 (UNSUPPORTED_MEDIA 415) |
| `VALIDATION_ERROR` — file too large | TC-012 (PAYLOAD_TOO_LARGE 413) |
| `VALIDATION_ERROR` — doc_type not in checklist | TC-013 |
| `VALIDATION_ERROR` — MIME mismatch on confirm | TC-007 (unit), TC-014 (indirectly) |
| `VALIDATION_ERROR` — waiver missing reason | UI-003 (frontend), TC-016 inverse |
| `FORBIDDEN` — out-of-scope read | TC-009 |
| `FORBIDDEN` — RM cannot waive | TC-017, UI-004 |
| `CONFLICT` — already waived | TC-006 (unit) |
| `CONFLICT` — infected scan | TC-020 |
| `NOT_FOUND` — lead absent | Covered by TC-009 scope enforcement (returns 403/404 per §8.4) |
| `PAYLOAD_TOO_LARGE` | TC-012 |
| `UNSUPPORTED_MEDIA` | TC-011 |
| `UPSTREAM_UNAVAILABLE` — GCS failure | TC-014 |
| `RATE_LIMITED` | TC-021 |
| `INTERNAL_ERROR` + transaction rollback | TC-015 |
| State machine: pending -> uploaded | TC-010 |
| State machine: uploaded -> under_review (clean scan) | TC-020 (clean branch) |
| State machine: infected scan -> rejected (status back to pending) | TC-020 |
| State machine: any -> waived | TC-016 |
| State machine: no verified -> pending revert (re-upload creates new version) | TC-019 |
| Authz negative: RM out-of-scope | TC-009 |
| Authz negative: RM no waive | TC-017 |
| Masking: PII not exposed in checklist response | Standard interceptor (verified by security-review) |
| Append-only: audit_logs not updated | INV-005 |
| Transaction integrity: partial failure rolls back | TC-015 |
| Idempotency: virus scan Cloud Tasks retry | VirusScanPort uses `idempotencyKey = "virusScan:{documentId}"` — dedupe tested via mock |
| Re-upload versioning | TC-019 |
| Customer link path | TC-018, UI-002 |
| Owner-writes: only LeadService writes leads | INV-001, TC-001..TC-003 (service unit) |
| SQL invariants | INV-001 through INV-007 |
| Rate limiting | TC-021 |
