# FR-071: KYC Verification Orchestration — Test Specification

**Tier: 3**
**Source LLD:** `docs/lld/FR-071.md`

---

## Test Cases

| # | ID | Description | Layer | Type | Input / Setup | Expected Outcome |
|---|---|---|---|---|---|---|
| 1 | TC-071-001 | Happy path: PAN verification succeeds | API integration | Happy path | KYC user; lead in `kyc_in_progress`; active `kyc` consent; `POST /leads/{id}/kyc/pan` with valid PAN + consentId | 200; `kyc_verifications` row with `status='success'`; `lead_identities.pan_masked` set; `leads.kyc_status='in_progress'` (or `verified` if all checks pass); `data_sharing_logs` row created |
| 2 | TC-071-002 | PAN verification fails with mismatch | API integration | Error path | Same setup; `MockKycAdapter` configured to return `name_mismatch` | 200; `kyc_verifications.status='failed'`, `exception_type='name_mismatch'`; `leads.kyc_status='exception'`; `event_outbox` contains `KYC_EXCEPTION`; no UPSTREAM_UNAVAILABLE returned |
| 3 | TC-071-003 | Provider down (5xx/timeout) | API integration | External service failure | Same setup; `MockKycAdapter` configured to throw timeout | 503 `UPSTREAM_UNAVAILABLE` `retryable=true`; `kyc_verifications` row with `status='failed'`, `exception_type='provider_down'`; `event_outbox` contains `KYC_EXCEPTION`; `integration_logs` row with `status='failed'` |
| 4 | TC-071-004 | Missing KYC consent → FORBIDDEN | API integration | Auth/consent gate | Lead with no active `kyc` consent; KYC user | 403 `FORBIDDEN`, `detail.reason='CONSENT_MISSING'`; no `kyc_verifications` row inserted |
| 5 | TC-071-005 | KYC consent exists but withdrawn → FORBIDDEN | API integration | Auth/consent gate | Lead with `consent_records.state='withdrawn'` for `purpose='kyc'`; KYC user | 403 `FORBIDDEN`, `detail.reason='CONSENT_MISSING'` |
| 6 | TC-071-006 | RM cannot run KYC orchestration | API integration | Authz negative | RM user (has `verify_doc` scope O but not KYC orchestrator); valid lead | 403 `FORBIDDEN` |
| 7 | TC-071-007 | KYC user cannot act on a lead from another branch | API integration | Authz scope | KYC user with branch B1; lead belongs to branch B2 | 403 `FORBIDDEN` |
| 8 | TC-071-008 | Lead not in `kyc_in_progress` stage → CONFLICT | API integration | State machine invalid transition | Valid KYC user; lead in `documents_pending` stage | 409 `CONFLICT`; no `kyc_verifications` row inserted |
| 9 | TC-071-009 | Lead not found / soft-deleted | API integration | Not found | Lead ID that does not exist or `deleted_at` is set | 404 `NOT_FOUND` |
| 10 | TC-071-010 | Invalid PAN format → VALIDATION_ERROR | API integration | Validation | `pan = "invalid_pan"` | 400 `VALIDATION_ERROR`, `fields[0].field='pan'` |
| 11 | TC-071-011 | Invalid KYC type path parameter | API integration | Validation | `POST /leads/{id}/kyc/unknown_type` | 400 `VALIDATION_ERROR`, `fields[0].field='type'` |
| 12 | TC-071-012 | Missing JWT → AUTH_REQUIRED | API integration | Auth | No Authorization header | 401 `AUTH_REQUIRED` |
| 13 | TC-071-013 | Idempotency replay — same idempotencyKey returns original success | API integration | Idempotency | First call succeeds with idempotencyKey X; second identical request with same key | 200 with identical `kycVerificationId`; `detail.reason='IDEMPOTENT_REPLAY'`; no second `kyc_verifications` row inserted; no second `data_sharing_logs` row |
| 14 | TC-071-014 | Transaction rollback on DB failure mid-write | Unit | Transaction | Mock DB failure between `INSERT kyc_verifications` and `INSERT data_sharing_logs` | No partial state: `kyc_verifications`, `data_sharing_logs`, `event_outbox` all absent; lead `kyc_status` unchanged |
| 15 | TC-071-015 | Rate limit exceeded (>60/min) | API integration | Rate limit | 61 mutations in under 60 seconds by same user | 429 `RATE_LIMITED` with `Retry-After` header |
| 16 | TC-071-016 | PAN masked in response (KYC user) — not raw | API integration | Masking | Successful PAN verification; KYC role user | Response `maskedResponse.maskedPan` follows format `ABCDE****F`; raw PAN not present in response; `pan_token` not returned |
| 17 | TC-071-017 | `pan_token` never exposed in API response | Unit | Masking | Successful PAN with `pan_token` set in lead_identities | Response DTO contains only `pan_masked`; `pan_token` field absent from serialised output |
| 18 | TC-071-018 | Raw Aadhaar never stored (Aadhaar OTP type) | Unit | Security / masking | Call `runVerification` with `kycType='aadhaar_otp'`; mock provider returns raw Aadhaar number | `lead_identities.aadhaar_ref_token` contains tokenised ref only; raw Aadhaar number not present in `kyc_verifications.masked_response` or `lead_identities` |
| 19 | TC-071-019 | `leads.kyc_status` recomputed to `verified` when all checks pass | Unit | State machine | Lead with two KYC types; both `status='success'` | `leads.kyc_status = 'verified'` via `LeadService.setKycStatus` |
| 20 | TC-071-020 | `leads.kyc_status` recomputed to `exception` when any check fails | Unit | State machine | Lead with one success + one failed KYC check | `leads.kyc_status = 'exception'` |
| 21 | TC-071-021 | `KYC_EXCEPTION` outbox event emitted on failed check | Unit | State/side effect | Mock `OutboxService`; failed provider result | `OutboxService.emit` called once with `event='KYC_EXCEPTION'`; payload contains `leadId` and `kycVerificationId` |
| 22 | TC-071-022 | `data_sharing_logs` inserted with correct consent_id and purpose | Unit | Data ops | Successful PAN verification; known `consentId` | `data_sharing_logs.purpose='kyc'`, `data_sharing_logs.data_category='identity'`, `data_sharing_logs.consent_id = consentId` |
| 23 | TC-071-023 | CKYC ID written to `lead_identities.ckyc_id` on success | Unit | Data ops | `kycType='ckyc'`; mock returns `ckycId='12345'` | `lead_identities.ckyc_id='12345'` after tx commit |
| 24 | TC-071-024 | Manual KYC type skips provider call | Unit | External service | `kycType='manual'`; spy on `IntegrationGateway.call` | `IntegrationGateway.call` not called; `kyc_verifications.status='success'`; audit row created |
| 25 | TC-071-025 | Optimistic lock conflict on leads.version | Unit | Concurrency | `LeadService.setKycStatus` receives stale `expectedVersion` | `CONFLICT` (409); full transaction rolled back |

---

## SQL Invariant Queries

Run after each test case that modifies state. All must return 0 rows for the test to pass.

### INV-1: No raw Aadhaar stored in kyc_verifications

```sql
SELECT kyc_verification_id
FROM kyc_verifications
WHERE masked_response::text ~* '[0-9]{12}'   -- 12-digit pattern indicative of raw Aadhaar
LIMIT 10;
-- expect 0 rows
```

### INV-2: No raw Aadhaar stored in lead_identities

```sql
SELECT lead_identity_id
FROM lead_identities
WHERE aadhaar_ref_token ~ '^[0-9]{12}$'      -- pure 12-digit number = raw Aadhaar
LIMIT 10;
-- expect 0 rows
```

### INV-3: Every kyc_verifications row has a valid lead_id

```sql
SELECT kv.kyc_verification_id
FROM kyc_verifications kv
LEFT JOIN leads l ON kv.lead_id = l.lead_id
WHERE l.lead_id IS NULL
LIMIT 10;
-- expect 0 rows
```

### INV-4: Every kyc_verifications row created by FR-071 has an integration_log_id (unless manual type)

```sql
SELECT kyc_verification_id
FROM kyc_verifications
WHERE kyc_type <> 'manual'
  AND integration_log_id IS NULL
  AND status IN ('success', 'failed')
LIMIT 10;
-- expect 0 rows
```

### INV-5: No data_sharing_logs without a corresponding consent

```sql
SELECT dsl.data_sharing_log_id
FROM data_sharing_logs dsl
WHERE dsl.purpose = 'kyc'
  AND dsl.consent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM consent_records cr
    WHERE cr.consent_id = dsl.consent_id
  )
LIMIT 10;
-- expect 0 rows
```

### INV-6: audit_logs rows are append-only (no UPDATE/DELETE)

```sql
-- Verify no audit_log row has been modified (updated_at != created_at)
-- audit_logs should not have an updated_at column; verify no DELETE succeeded
SELECT audit_log_id
FROM audit_logs
WHERE action = 'kyc_verification_run'
  AND subject_type = 'kyc_verifications'
  AND subject_id NOT IN (
    SELECT kyc_verification_id::text FROM kyc_verifications
  )
LIMIT 10;
-- expect 0 rows (no orphaned audit entries)
```

### INV-7: `leads.kyc_status` is consistent with `kyc_verifications`

```sql
-- Leads where kyc_status='verified' but have an open exception
SELECT l.lead_id
FROM leads l
WHERE l.kyc_status = 'verified'
  AND EXISTS (
    SELECT 1 FROM kyc_verifications kv
    WHERE kv.lead_id = l.lead_id
      AND kv.status = 'failed'
      AND kv.resolution_code IS NULL
  )
LIMIT 10;
-- expect 0 rows
```

### INV-8: Idempotency — no duplicate integration_log for same idempotency_key + integration

```sql
SELECT idempotency_key, integration, COUNT(*) as cnt
FROM integration_logs
WHERE idempotency_key IS NOT NULL
  AND integration IN ('pan','ckyc','digilocker','aadhaar','vcip')
GROUP BY idempotency_key, integration
HAVING COUNT(*) > 1
LIMIT 10;
-- expect 0 rows
```

---

## UI Test Scenarios (Playwright)

### UI-071-001: KYC Workbench renders and PAN verification succeeds

```
Given: Lead is in kyc_in_progress stage
  And: KYC user is logged in
  And: kyc consent is granted
When: User opens Lead 360 → KYC tab
Then: KycWorkbench renders with PAN check row visible
  And: StatusChip shows "Not Started" initially
When: User clicks "Verify PAN" and enters a valid PAN
  And: API returns success
Then: StatusChip changes to "Verified"
  And: Masked PAN (e.g. "ABCDE****F") is displayed in MaskedField
  And: Toast shows success message
```

### UI-071-002: Consent gate blocks verification

```
Given: Lead in kyc_in_progress stage
  And: KYC user logged in
  And: kyc consent NOT granted
When: User opens KYC tab
Then: ConsentGateBanner is visible
  And: "Verify PAN" button is disabled
  And: No API call is made on click attempt
```

### UI-071-003: Provider downtime shows exception banner

```
Given: Lead in kyc_in_progress stage with kyc consent
  And: MockKycAdapter configured to return provider_down
When: User clicks "Verify PAN"
Then: 503 error is handled gracefully
  And: KycExceptionBanner is visible with "Provider down — exception created"
  And: StatusChip shows "Exception" for PAN row
  And: Toast shows "A service is temporarily unavailable" (UPSTREAM_UNAVAILABLE message)
```

### UI-071-004: WCAG 2.1 AA — keyboard navigation and screen reader

```
Given: KycWorkbench rendered
When: User navigates with Tab key only
Then: All interactive elements (Verify buttons, links) are focusable
  And: Each StatusChip has a non-empty aria-label
  And: ConsentGateBanner is announced by screen reader
  And: Error states have role="alert"
```

---

## Coverage Checklist

| Requirement | Covered by |
|---|---|
| Happy path PAN success | TC-071-001 |
| Happy path CKYC (unit) | TC-071-023 |
| Manual KYC type (no provider call) | TC-071-024 |
| Provider down → UPSTREAM_UNAVAILABLE (503) | TC-071-003 |
| Provider mismatch → exception (not 503) | TC-071-002 |
| CONSENT_MISSING (FORBIDDEN 403) | TC-071-004, TC-071-005 |
| AUTH_REQUIRED (401) | TC-071-012 |
| FORBIDDEN authz (403) — wrong role | TC-071-006 |
| FORBIDDEN authz (403) — wrong branch scope | TC-071-007 |
| CONFLICT — wrong stage | TC-071-008 |
| NOT_FOUND — lead absent | TC-071-009 |
| VALIDATION_ERROR — invalid PAN format | TC-071-010 |
| VALIDATION_ERROR — invalid type param | TC-071-011 |
| RATE_LIMITED (429) | TC-071-015 |
| Idempotency replay (200 + IDEMPOTENT_REPLAY) | TC-071-013 |
| Transaction rollback — no partial state | TC-071-014 |
| Optimistic lock CONFLICT | TC-071-025 |
| PAN masking in response | TC-071-016, TC-071-017 |
| Raw Aadhaar never stored | TC-071-018, INV-1, INV-2 |
| kyc_status recompute → verified | TC-071-019 |
| kyc_status recompute → exception | TC-071-020 |
| KYC_EXCEPTION outbox event | TC-071-021 |
| data_sharing_logs integrity | TC-071-022, INV-5 |
| lead_identities.ckyc_id updated | TC-071-023 |
| audit_logs append-only | INV-6 |
| No duplicate integration_logs per idempotency_key | INV-8 |
| UI consent gate | UI-071-002 |
| UI provider downtime handling | UI-071-003 |
| UI happy path | UI-071-001 |
| WCAG 2.1 AA keyboard | UI-071-004 |
