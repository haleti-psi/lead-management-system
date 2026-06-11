# FR-081 Test Specification — LOS Hand-off

**Tier: 3**  
**Source LLD:** `docs/lld/FR-081.md`

---

## Test Cases

Minimum required for Tier 3: 10 cases. This specification defines 20.

| # | Layer | Name | Scenario | Expected Outcome |
|---|-------|------|----------|-----------------|
| T01 | API | Happy path — BM hands off | Lead in `ready_for_handoff`, all guards pass, LOS returns `los_application_id`, fresh `Idempotency-Key` | 200; `lead.stage = 'handed_off'`; `los_application_id` populated; `stage_history`, `data_sharing_logs`, `los_application_mirrors`, `event_outbox(LEAD_HANDED_OFF)` rows created; `integration_logs.status = 'success'` |
| T02 | API | Idempotent replay — duplicate key | Same `Idempotency-Key` sent a second time after T01 succeeded | 200; original `losApplicationId` returned; no new LOS call; no new DB rows (idempotency_key unique index blocks second insert); `integration_logs` count unchanged |
| T03 | API | FORBIDDEN — actor out of scope (authz negative) | RM_B attempts hand-off on a lead owned by RM_A (different owner, scope O) | 403 `FORBIDDEN`; no DB mutation; `audit_logs` records `handoff_attempt` denied |
| T04 | API | FORBIDDEN — wrong role | PARTNER role attempts hand-off (no `hand_off` capability) | 403 `FORBIDDEN` |
| T05 | API | FORBIDDEN / CONSENT_MISSING — `los_handoff` consent not granted | Lead has no `consent_records` row with `purpose='los_handoff'` AND `state='granted'` | 403 `FORBIDDEN`, `error.detail.reason = 'CONSENT_MISSING'`; no DB mutation |
| T06 | API | CONFLICT / KYC_EXCEPTION_OPEN — open KYC exception | `kyc_verifications` has a row with `status='exception'` for this lead | 409 `CONFLICT`, `error.detail.reason = 'KYC_EXCEPTION_OPEN'`; `lead.stage` unchanged |
| T07 | API | CONFLICT / DUPLICATE_BLOCKED — unresolved strong duplicate | `leads.duplicate_status = 'flagged'` | 409 `CONFLICT`, `error.detail.reason = 'DUPLICATE_BLOCKED'` |
| T08 | API | VALIDATION_ERROR / STAGE_GUARD_FAILED — wrong stage | Lead is in `kyc_in_progress` (not `ready_for_handoff`) | 400 `VALIDATION_ERROR`, `error.detail.reason = 'STAGE_GUARD_FAILED'`, `failed_guards` contains `'stage_valid'` |
| T09 | API | VALIDATION_ERROR / STAGE_GUARD_FAILED — unverified mandatory doc | One mandatory document in `documents` has `status='pending'` | 400 `VALIDATION_ERROR`, `error.detail.reason = 'STAGE_GUARD_FAILED'`, `failed_guards` contains `'docs_complete'` |
| T10 | API | VALIDATION_ERROR / STAGE_GUARD_FAILED — multiple guards fail | Both `docs_complete` and `product_payload_valid` fail | 400 `VALIDATION_ERROR`, `error.detail.failed_guards` has both entries; no partial fix applied |
| T11 | API | UPSTREAM_UNAVAILABLE — LOS 503 | `LosMockAdapter` configured to return 503 | 503 `UPSTREAM_UNAVAILABLE`, `retryable=true`; `integration_logs.status = 'failed'`; Cloud Tasks retry enqueued; `lead.stage` remains `ready_for_handoff`; `event_outbox(HANDOFF_FAILED)` row created |
| T12 | API | UPSTREAM_UNAVAILABLE — LOS timeout | `LosMockAdapter` configured to delay beyond timeout | Same as T11: 503 returned, `integration_logs.status='failed'`, retry enqueued |
| T13 | Unit | No duplicate LOS application on retry | Two concurrent requests arrive with the same `Idempotency-Key` | Only one `integration_logs` row exists (unique partial index enforces); second call detects the pending row and returns 503 until the first resolves |
| T14 | Unit | Transaction rollback on DB write failure | LOS call succeeds but the `leads` UPDATE inside UoW throws | Entire transaction rolled back; `leads.stage` unchanged; `stage_history`, `data_sharing_logs`, `los_application_mirrors`, `event_outbox` rows absent; `integration_logs` row updated to `failed` by catch handler |
| T15 | Unit | Optimistic lock — stale version | `expectedVersion` passed to `LeadService.markHandedOff` does not match current `leads.version` | `CONFLICT` (409) returned; `leads` unchanged; no partial writes |
| T16 | Unit | Guard evaluation — `kyc_status='waived'` passes KYC guard | Lead has `kyc_status='waived'` and no open KYC exceptions | `kyc_signed_off` guard passes; hand-off proceeds |
| T17 | Unit | Guard evaluation — `duplicate_status='linked'` passes dup guard | Lead has `duplicate_status='linked'` (resolved, not flagged) | `duplicate_clear` guard passes |
| T18 | API | AUTH_REQUIRED — no JWT | Request sent without Authorization header | 401 `AUTH_REQUIRED` |
| T19 | API | NOT_FOUND — non-existent lead | `id` does not exist in `leads` | 404 `NOT_FOUND` |
| T20 | E2E | Full hand-off workflow — BM UI | BM opens Lead 360 for a `ready_for_handoff` lead; guard checklist shows all green; clicks "Initiate LOS Hand-off"; ConfirmDialog appears; confirms; success toast shown; stage chip updates to "Handed Off"; LOS application ID visible | Stage chip = "Handed Off"; no guard rows red; `LEAD_HANDED_OFF` event in outbox |

---

## Detailed Test Descriptions

### T01 — Happy path (API integration)

**Setup:**
- Seed a lead with `stage='ready_for_handoff'`, `duplicate_status='none'`, `kyc_status='verified'`, `consent_status='captured'`.
- Insert `consent_records` row: `purpose='los_handoff'`, `state='granted'`.
- Insert verified/waived `documents` rows (all mandatory types).
- No `kyc_verifications` with `status='exception'`.
- `LosMockAdapter` returns `{ los_application_id: 'LOS-MOCK-001' }`.
- Actor: BM with branch matching the lead.

**Request:**
```
POST /api/v1/leads/{id}/handoff
Authorization: Bearer <bm-jwt>
Idempotency-Key: test-idem-001
```

**Assertions:**
- HTTP 200, `data.stage = 'handed_off'`, `data.losApplicationId = 'LOS-MOCK-001'`.
- `SELECT stage, los_application_id, version FROM leads WHERE lead_id = $1` → `'handed_off'`, `'LOS-MOCK-001'`, original_version + 1.
- `SELECT COUNT(*) FROM stage_history WHERE lead_id=$1 AND from_stage='ready_for_handoff' AND to_stage='handed_off'` → 1.
- `SELECT COUNT(*) FROM data_sharing_logs WHERE lead_id=$1 AND purpose='los_handoff'` → 1.
- `SELECT COUNT(*) FROM los_application_mirrors WHERE lead_id=$1 AND los_application_id='LOS-MOCK-001'` → 1.
- `SELECT COUNT(*) FROM event_outbox WHERE aggregate_id=$1 AND event_code='LEAD_HANDED_OFF'` → 1.
- `SELECT status FROM integration_logs WHERE idempotency_key='test-idem-001'` → `'success'`.

---

### T02 — Idempotent replay (API integration)

**Setup:** T01 completed successfully.

**Request:** identical to T01 (same `Idempotency-Key: test-idem-001`).

**Assertions:**
- HTTP 200, same `losApplicationId` as T01.
- `SELECT COUNT(*) FROM integration_logs WHERE idempotency_key='test-idem-001'` → 1 (unchanged).
- `SELECT COUNT(*) FROM stage_history WHERE lead_id=$1 AND to_stage='handed_off'` → 1 (no second row).
- `SELECT COUNT(*) FROM event_outbox WHERE aggregate_id=$1 AND event_code='LEAD_HANDED_OFF'` → 1 (unchanged).
- No additional `data_sharing_logs` or `los_application_mirrors` rows.

---

### T03 — Authz negative: RM out of scope (API integration)

**Setup:** Lead owned by `user_a` (RM). Actor is `user_b` (RM, different user_id).

**Assertions:**
- HTTP 403 `FORBIDDEN`.
- `SELECT stage FROM leads WHERE lead_id=$1` → `'ready_for_handoff'` (unchanged).
- `SELECT COUNT(*) FROM audit_logs WHERE lead_id=$1 AND action='handoff_attempt'` → 1 (denial recorded).

---

### T11 — UPSTREAM_UNAVAILABLE: LOS 503 (API integration)

**Setup:** `LosMockAdapter` configured to return HTTP 503.

**Assertions:**
- HTTP 503 `UPSTREAM_UNAVAILABLE`, `error.retryable = true`.
- `SELECT status FROM integration_logs WHERE lead_id=$1 AND integration='los_handoff'` → `'failed'`.
- `SELECT stage FROM leads WHERE lead_id=$1` → `'ready_for_handoff'` (no transition).
- `SELECT COUNT(*) FROM event_outbox WHERE aggregate_id=$1 AND event_code='LEAD_HANDED_OFF'` → 0.
- `SELECT COUNT(*) FROM event_outbox WHERE aggregate_id=$1 AND event_code='HANDOFF_FAILED'` → 1.
- Cloud Tasks mock records 1 enqueued retry task.

---

### T14 — Transaction rollback on DB failure (Unit)

**Setup:** `LosMockAdapter` returns success. `LeadService.markHandedOff` is stubbed to throw a DB error after the LOS call.

**Assertions (verified via SQL invariant queries):**
- `SELECT stage FROM leads WHERE lead_id=$1` → `'ready_for_handoff'` (rolled back).
- `SELECT COUNT(*) FROM stage_history WHERE lead_id=$1 AND to_stage='handed_off'` → 0.
- `SELECT COUNT(*) FROM data_sharing_logs WHERE lead_id=$1 AND purpose='los_handoff'` → 0.
- `SELECT COUNT(*) FROM los_application_mirrors WHERE lead_id=$1` → 0.
- `SELECT COUNT(*) FROM event_outbox WHERE aggregate_id=$1 AND event_code='LEAD_HANDED_OFF'` → 0.
- `SELECT status FROM integration_logs WHERE lead_id=$1 AND integration='los_handoff'` → `'failed'` (catch handler updated pre-tx row).

---

### T15 — Optimistic lock stale version (Unit)

**Setup:** Lead `version = 5`. `expectedVersion` passed as `4`.

**Assertions:**
- `CONFLICT` (409) returned.
- `SELECT version FROM leads WHERE lead_id=$1` → 5 (unchanged).
- No `stage_history`, `data_sharing_logs`, `los_application_mirrors`, `event_outbox` rows added.

---

## SQL Invariant Queries

These queries must return **0 rows** at all times (verified by the rollback test and append-only tests).

```sql
-- INV-01: handed_off leads must have a los_application_id
SELECT lead_id
FROM leads
WHERE stage = 'handed_off'
  AND (los_application_id IS NULL OR los_application_id = '')
LIMIT 1;
-- expect: 0 rows

-- INV-02: no stage_history row without a matching leads row (referential integrity)
SELECT sh.stage_history_id
FROM stage_history sh
LEFT JOIN leads l ON l.lead_id = sh.lead_id
WHERE l.lead_id IS NULL
LIMIT 1;
-- expect: 0 rows

-- INV-03: no data_sharing_logs row for los_handoff without a granted consent
SELECT dsl.data_sharing_log_id
FROM data_sharing_logs dsl
WHERE dsl.purpose = 'los_handoff'
  AND NOT EXISTS (
    SELECT 1 FROM consent_records cr
    WHERE cr.lead_id = dsl.lead_id
      AND cr.purpose = 'los_handoff'
      AND cr.state = 'granted'
  )
LIMIT 1;
-- expect: 0 rows

-- INV-04: no duplicate los_application_id in los_application_mirrors
SELECT los_application_id, COUNT(*) AS cnt
FROM los_application_mirrors
GROUP BY los_application_id
HAVING COUNT(*) > 1
LIMIT 1;
-- expect: 0 rows (unique constraint uq_los_mirror_app enforces this)

-- INV-05: no duplicate integration_logs for the same idempotency_key
SELECT idempotency_key, COUNT(*) AS cnt
FROM integration_logs
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1
LIMIT 1;
-- expect: 0 rows (unique partial index uq_integration_idempotency enforces this)

-- INV-06: handed_off leads must have a corresponding los_application_mirrors row
SELECT l.lead_id
FROM leads l
WHERE l.stage = 'handed_off'
  AND NOT EXISTS (
    SELECT 1 FROM los_application_mirrors m WHERE m.lead_id = l.lead_id
  )
LIMIT 1;
-- expect: 0 rows

-- INV-07: no UPDATE or DELETE on audit_logs (verified by attempting in test and expecting DB error)
-- Implementation: test attempts UPDATE audit_logs SET detail='tampered' WHERE lead_id=$1
-- and asserts that 0 rows are affected OR a DB exception is raised (trigger/row-security).
-- expect: 0 rows updated

-- INV-08: no UPDATE or DELETE on stage_history
-- Implementation: same pattern as INV-07.
-- expect: 0 rows updated

-- INV-09: no UPDATE or DELETE on consent_records
-- Implementation: same pattern.
-- expect: 0 rows updated

-- INV-10: handed_off leads must have exactly one successful integration_logs row of kind los_handoff
SELECT lead_id, COUNT(*) AS cnt
FROM integration_logs
WHERE integration = 'los_handoff'
  AND status = 'success'
GROUP BY lead_id
HAVING COUNT(*) > 1
LIMIT 1;
-- expect: 0 rows (one successful hand-off per lead)
```

---

## UI Test Scenarios (Playwright E2E — `apps/web/e2e/los/fr-081-handoff.spec.ts`)

| # | Scenario | Steps | Assertion |
|---|----------|-------|-----------|
| UI-01 | Guard checklist — all green | Navigate to Lead 360 for a `ready_for_handoff` lead; all guards satisfied | All six `GuardItem` rows show green status; "Initiate LOS Hand-off" button is enabled |
| UI-02 | Guard checklist — KYC exception | Navigate to lead with open KYC exception | `kyc_signed_off` guard item shows red/failed; button is disabled; no hand-off can be initiated |
| UI-03 | ConfirmDialog appears before submit | Click enabled "Initiate LOS Hand-off" button | `ConfirmDialog` appears with a confirmation message; cancel returns to Lead 360 with no change |
| UI-04 | Success flow | BM clicks button, confirms; `LosMockAdapter` returns success | Toast "Hand-off successful" appears; stage chip updates to "Handed Off" (terminal); LOS application ID visible; button hidden |
| UI-05 | UPSTREAM_UNAVAILABLE toast | Mock LOS returns 503 | Toast "LOS is temporarily unavailable. Your request has been queued for automatic retry." appears; stage chip remains "Ready for Hand-off"; button re-enabled after toast dismissed |
| UI-06 | CONSENT_MISSING alert | `los_handoff` consent not granted | Guard item `consent_present` shows red; button disabled; alert text links to consent flow |
| UI-07 | Keyboard accessibility | Tab through `HandoffActionPanel` | All interactive elements reachable by keyboard; Escape closes ConfirmDialog; Enter/Space triggers confirm |
| UI-08 | Mobile layout | Viewport 375px | `HandoffActionPanel` renders as bottom-sheet drawer; all content reachable; no overflow |

---

## Coverage Checklist

The following items from `docs/contracts/testing-contract.md` are covered for FR-081:

| Requirement | Covered by |
|-------------|-----------|
| Happy path | T01, T20/UI-04 |
| Every named error code (AUTH_REQUIRED) | T18 |
| Every named error code (FORBIDDEN) | T03, T04, T05 |
| Every named error code (NOT_FOUND) | T19 |
| Every named error code (CONFLICT / KYC_EXCEPTION_OPEN) | T06 |
| Every named error code (CONFLICT / DUPLICATE_BLOCKED) | T07 |
| Every named error code (VALIDATION_ERROR / STAGE_GUARD_FAILED) | T08, T09, T10 |
| Every named error code (UPSTREAM_UNAVAILABLE) | T11, T12, UI-05 |
| Every named error code (INTERNAL_ERROR) | Covered by global exception filter test (framework-level) |
| Authz negative — out-of-scope actor | T03 |
| Authz negative — wrong role | T04 |
| Idempotency — replayed key returns original, no duplicate | T02, T13 |
| Transaction rollback on mid-write failure | T14 |
| Optimistic lock stale version → CONFLICT | T15 |
| Consent gate — hand-off blocked without `los_handoff` grant | T05 |
| Valid/invalid state transitions | T08 (invalid: wrong stage); T01 (valid: ready_for_handoff → handed_off) |
| External service failure + retry | T11, T12 |
| Append-only enforcement (audit_logs / stage_history / consent_records) | INV-07, INV-08, INV-09 |
| SQL invariants (no orphaned data, no duplicates) | INV-01 through INV-10 |
| UI guard checklist display | UI-01, UI-02, UI-06 |
| UI keyboard accessibility | UI-07 |
| UI mobile/PWA layout | UI-08 |
| Masking (DPO M-scope sees masked `los_application_id`) | Covered by masking interceptor test (separate masking spec); noted in T03 context |

---

## Test Factories

All tests use factories from `apps/api/test/factories/`:

```typescript
// Minimum factory shapes for FR-081 tests

createHandoffReadyLead(overrides?): Lead
// → stage='ready_for_handoff', duplicate_status='none', kyc_status='verified',
//   consent_status='captured', version=1, los_application_id=null

createGrantedConsent(leadId, purpose='los_handoff'): ConsentRecord
// → state='granted', purpose='los_handoff'

createVerifiedDocument(leadId, docType): Document
// → status='verified', deleted_at=null

createKycVerification(leadId, overrides?): KycVerification
// → status='success' by default; override status='exception' for T06

createUser(role: 'BM' | 'RM' | 'KYC' | 'PARTNER', branchId?): User
// → active user with given role, scoped to branchId
```

Each test uses an isolated Testcontainers-Postgres instance via the shared `TestDb` helper in `apps/api/test/helpers/test-db.ts`. No shared mutable state between tests.

## Mocking External Services

- `LosMockAdapter` (`LOS_MOCK=true`) is used in all unit and API tests.
- Configure return shapes per test:
  - Success: `{ los_application_id: 'LOS-MOCK-{n}', status: 200 }`
  - Failure: `{ status: 503 }` or timeout simulation via `AbortController`.
- **Never call the real LOS** in unit or integration tests.
- Cloud Tasks enqueue calls are mocked in the `IntegrationGateway` test double; assertions check the mock's call count and arguments.

## Naming Convention

```typescript
describe('LosService — handoffToLos')
  it('transitions lead to handed_off and returns losApplicationId when all guards pass')
  it('returns the original result without re-calling LOS when Idempotency-Key is replayed')
  it('returns FORBIDDEN when actor lacks hand_off capability for the lead scope')
  it('returns FORBIDDEN with CONSENT_MISSING when los_handoff consent is not granted')
  it('returns CONFLICT with KYC_EXCEPTION_OPEN when an open KYC exception exists')
  it('returns CONFLICT with DUPLICATE_BLOCKED when duplicate_status is flagged')
  it('returns VALIDATION_ERROR with STAGE_GUARD_FAILED when lead is not in ready_for_handoff stage')
  it('returns VALIDATION_ERROR with STAGE_GUARD_FAILED when mandatory documents are unverified')
  it('returns UPSTREAM_UNAVAILABLE and enqueues a retry when LOS returns 503')
  it('rolls back all DB writes when the UnitOfWork commit fails after LOS success')
  it('returns CONFLICT when expectedVersion is stale (optimistic lock)')
  it('accepts kyc_status=waived as a passing KYC sign-off guard')
  it('accepts duplicate_status=linked as a passing duplicate-clear guard')
```
