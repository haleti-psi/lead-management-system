# FR-080: Eligibility Request & Read-Only Snapshot — Test Specification

**Tier: 3** | **Source LLD:** `docs/lld/FR-080.md`

---

## Test Cases

| # | Name | Layer | Type | Input / Setup | Expected Outcome |
|---|---|---|---|---|---|
| T01 | Happy path — eligibility received | API integration | Happy path | RM user, lead in `kyc_in_progress`, active `product_eligibility` consent, complete `eligibility_mapping`, `LosMockAdapter` returns success | HTTP 200; `data.status = 'received'`; `eligibility_snapshots` row with `status='received'`; `leads.stage = 'eligibility_requested'`; `stage_history` row inserted; `data_sharing_logs` row inserted; `ELIGIBILITY_RECEIVED` outbox event; `LEAD_STAGE_CHANGED` outbox event |
| T02 | Pending snapshot on LOS timeout | API integration | External-service failure | Same setup; `LosMockAdapter` configured to timeout | HTTP 200; `data.status = 'pending'`; `eligibility_snapshots.status = 'pending'`; `leads.stage = 'eligibility_requested'` (transition committed before call); `integration_logs.status` in `('pending','retrying')`; no `UPSTREAM_UNAVAILABLE` error in response |
| T03 | UPSTREAM_UNAVAILABLE on LOS 5xx | API integration | External-service failure | Same setup; `LosMockAdapter` returns HTTP 503 | HTTP 503; `error.code = 'UPSTREAM_UNAVAILABLE'`; `error.retryable = true`; `eligibility_snapshots.status = 'failed'`; `integration_logs.status = 'failed'` |
| T04 | FORBIDDEN — no product_eligibility consent | API integration | Consent gate | RM user, lead in `kyc_in_progress`, consent_records has no row with `purpose='product_eligibility'` and `state='granted'` | HTTP 403; `error.code = 'FORBIDDEN'`; `error.detail.reason = 'CONSENT_MISSING'`; no snapshot inserted; lead stage unchanged |
| T05 | FORBIDDEN — consent withdrawn | API integration | Consent gate | Active consent exists but has `state='withdrawn'` | HTTP 403; `error.code = 'FORBIDDEN'`; `error.detail.reason = 'CONSENT_MISSING'`; no snapshot inserted |
| T06 | FORBIDDEN — consent expired | API integration | Consent gate | Consent has `state='granted'` but `expires_at` is in the past | HTTP 403; `error.code = 'FORBIDDEN'`; `error.detail.reason = 'CONSENT_MISSING'`; no snapshot inserted |
| T07 | VALIDATION_ERROR — eligibility_mapping null | API integration | Validation | Lead in correct stage; ProductConfig has `eligibility_mapping = null` | HTTP 400; `error.code = 'VALIDATION_ERROR'`; message contains "no eligibility mapping"; no snapshot inserted; no LOS call made |
| T08 | VALIDATION_ERROR — stage guard fails (wrong stage) | API integration | State machine | Lead in `captured` stage (not `kyc_in_progress`) | HTTP 400; `error.code = 'VALIDATION_ERROR'`; `error.detail.reason = 'STAGE_GUARD_FAILED'`; no snapshot inserted; lead stage unchanged |
| T09 | VALIDATION_ERROR — stage guard fails (handed_off terminal) | API integration | State machine | Lead in `handed_off` stage | HTTP 400; `error.code = 'VALIDATION_ERROR'`; `error.detail.reason = 'STAGE_GUARD_FAILED'`; no snapshot inserted |
| T10 | CONFLICT — optimistic lock stale version | API integration | Concurrency | Two concurrent requests for same lead; second arrives with stale `leads.version` | HTTP 409; `error.code = 'CONFLICT'`; exactly one snapshot row in DB; exactly one `eligibility_requested` stage_history row |
| T11 | Idempotent replay — pending snapshot | API integration | Idempotency | POST with `Idempotency-Key: KEY1`; repeat POST with same `Idempotency-Key: KEY1` while snapshot is `pending` | Second call HTTP 200; `error.detail.reason = 'IDEMPOTENT_REPLAY'`; still exactly one `eligibility_snapshots` row; exactly one `integration_logs` row for `KEY1`; LOS called only once |
| T12 | Idempotent replay — received snapshot | API integration | Idempotency | POST with `Idempotency-Key: KEY2`; `LosMockAdapter` returns success; repeat POST with same key | Second call HTTP 200; `data.status = 'received'`; `error.detail.reason = 'IDEMPOTENT_REPLAY'`; single snapshot row; LOS not called again |
| T13 | FORBIDDEN — RM cannot trigger on another RM's lead | API integration | Authz negative | RM user A calls POST for a lead assigned to RM user B (different `owner_id`) | HTTP 403; `error.code = 'FORBIDDEN'`; no snapshot inserted |
| T14 | FORBIDDEN — PARTNER role denied | API integration | Authz negative | PARTNER user calls POST /leads/{id}/eligibility | HTTP 403; `error.code = 'FORBIDDEN'`; no snapshot inserted |
| T15 | AUTH_REQUIRED — unauthenticated | API integration | Auth | No JWT header | HTTP 401; `error.code = 'AUTH_REQUIRED'` |
| T16 | NOT_FOUND — unknown lead ID | API integration | Boundary | Valid UUID format but no matching lead in DB | HTTP 404; `error.code = 'NOT_FOUND'` |
| T17 | VALIDATION_ERROR — invalid UUID path param | API integration | Validation | `id = 'not-a-uuid'` | HTTP 400; `error.code = 'VALIDATION_ERROR'`; `error.fields[0].field = 'id'` |
| T18 | Transaction rollback on DB failure mid-write | Unit / API integration | Transaction | Simulate DB error during `INSERT data_sharing_logs` (after `UPDATE leads`) | All writes (leads, stage_history, eligibility_snapshots, integration_logs, data_sharing_logs) rolled back; `leads.stage` unchanged; no orphaned rows |
| T19 | EligibilityPayloadBuilder maps attributes correctly | Unit | Payload mapping | ProductConfig with known `eligibility_mapping`; LeadProductDetail with matching attributes | Built LOS payload contains exactly the mapped fields; no PII fields (name, mobile, pan_token) in payload |
| T20 | EligibilityMappingValidator rejects missing mapping field | Unit | Validation | `eligibility_mapping` references a field not present in `lead_product_details.attributes` | `VALIDATION_ERROR` raised; message names the missing attribute field |
| T21 | BM can trigger eligibility for own-branch lead | API integration | Authz positive | BM user; lead `branch_id` matches BM's branch | HTTP 200 (same as T01) |
| T22 | Snapshot read-only — UI shows indicative label unless final | Frontend unit | UI | `EligibilityCard` rendered with snapshot `responseBasis='indicative'` | "Indicative" badge visible; no edit controls present |
| T23 | Snapshot read-only — UI shows "final" label when LOS returns final | Frontend unit | UI | Snapshot `responseBasis='final'` | "Final" badge shown; "Indicative" badge absent |
| T24 | UI polls while pending | Frontend unit | UI | Snapshot `status='pending'` | `LoadingSkeleton` shown; TanStack Query refetch interval active (15 s); retry button absent while pending |
| T25 | UI EmptyState with request button when no snapshot | Frontend unit | UI | Lead in `kyc_in_progress`, no snapshot yet, consent present | `EmptyState` shown; "Request Eligibility" button enabled |
| T26 | UI DisabledOverlay for terminal stage | Frontend unit | UI | Lead `stage='handed_off'` | Request button absent; disabled overlay rendered |
| T27 | Masking — indicative_amount masked for DPO (masked scope M) | API integration | Masking | DPO user requests GET on lead 360 eligibility data | Numeric fields not masked (financial amounts are not PII fields); test validates masking interceptor does not suppress them — document that amount is NOT a PII-masked field |
| T28 | data_sharing_logs append-only — no UPDATE/DELETE | SQL invariant | Invariant | Any test that updates/deletes data_sharing_logs | DB rejects the operation (REVOKE UPDATE/DELETE from app role) |
| T29 | consent_records append-only — no UPDATE/DELETE | SQL invariant | Invariant | Any test that updates/deletes consent_records | DB rejects the operation |
| T30 | audit_logs append-only — no UPDATE/DELETE | SQL invariant | Invariant | Any test that updates/deletes audit_logs | DB rejects the operation |

---

## SQL Invariant Queries

Run after each relevant test. All must return **0 rows** to pass.

```sql
-- INV-01: No eligibility_snapshot without a corresponding lead
SELECT es.eligibility_snapshot_id
FROM eligibility_snapshots es
LEFT JOIN leads l ON l.lead_id = es.lead_id
WHERE l.lead_id IS NULL;

-- INV-02: No eligibility_snapshot without a corresponding integration_log
-- (a request_ref appears in both)
SELECT es.eligibility_snapshot_id
FROM eligibility_snapshots es
WHERE es.request_ref NOT IN (
  SELECT il.request_ref
  FROM integration_logs il
  WHERE il.integration = 'los_eligibility'
)
AND es.request_ref IS NOT NULL;

-- INV-03: No received snapshot without a LEAD_STAGE_CHANGED outbox event
-- for the same lead at or after the snapshot creation time
SELECT es.eligibility_snapshot_id
FROM eligibility_snapshots es
WHERE es.status = 'received'
AND NOT EXISTS (
  SELECT 1
  FROM event_outbox eo
  WHERE eo.aggregate_id = es.lead_id
    AND eo.event_code = 'LEAD_STAGE_CHANGED'
    AND eo.created_at >= es.created_at
);

-- INV-04: No lead in eligibility_requested stage without at least one
-- stage_history row recording that transition
SELECT l.lead_id
FROM leads l
WHERE l.stage = 'eligibility_requested'
AND NOT EXISTS (
  SELECT 1
  FROM stage_history sh
  WHERE sh.lead_id = l.lead_id
    AND sh.to_stage = 'eligibility_requested'
);

-- INV-05: No data_sharing_log for los_eligibility without a
-- corresponding granted product_eligibility consent
SELECT dsl.data_sharing_log_id
FROM data_sharing_logs dsl
WHERE dsl.purpose = 'product_eligibility'
  AND dsl.recipient = 'LOS'
  AND dsl.consent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM consent_records cr
    WHERE cr.consent_id = dsl.consent_id
      AND cr.state = 'granted'
  );

-- INV-06: No duplicate integration_log rows for the same idempotency_key
-- (partial unique index enforced by schema; this query detects violations)
SELECT idempotency_key, COUNT(*) AS cnt
FROM integration_logs
WHERE idempotency_key IS NOT NULL
  AND integration = 'los_eligibility'
GROUP BY idempotency_key
HAVING COUNT(*) > 1;

-- INV-07: No eligibility_snapshot with status='received' and null indicative_amount
-- when LOS mock always returns an amount (smoke test of happy path data integrity)
-- Note: allow null indicative_amount if LOS legitimately returns null (e.g. declined).
-- This invariant is conditional on the mock scenario only.

-- INV-08: No orphaned data_sharing_log without a lead
SELECT dsl.data_sharing_log_id
FROM data_sharing_logs dsl
LEFT JOIN leads l ON l.lead_id = dsl.lead_id
WHERE l.lead_id IS NULL;
```

---

## UI Test Scenarios

### Playwright E2E — `apps/web/e2e/los-eligibility.spec.ts`

| Scenario | Steps | Assertion |
|---|---|---|
| E2E-01: RM requests eligibility successfully | Login as RM; open Lead 360 for a lead in `kyc_in_progress` with consent; click "Request Eligibility" | Loading skeleton appears; after mock LOS responds, card shows `received` status with amount and "Indicative" badge; no edit controls visible |
| E2E-02: Consent missing blocks request | Login as RM; open Lead 360 for lead without `product_eligibility` consent; observe button state | "Request Eligibility" button is disabled; tooltip or inline message cites missing consent |
| E2E-03: Pending state shows skeleton | Login as RM; mock LOS configured to delay; click "Request Eligibility" | `LoadingSkeleton` shown; status chip shows `pending`; polling active |
| E2E-04: Failed state shows retry button | Login as RM; mock LOS returns 503; click "Request Eligibility" | `ErrorState` rendered with "Retry" button; snapshot `status='failed'` |
| E2E-05: Terminal stage disables card | Login as BM; open Lead 360 for `handed_off` lead | Eligibility card shows disabled overlay; no request button |

---

## Coverage Checklist

| Requirement | Test IDs | Covered |
|---|---|---|
| Happy path — LOS success, snapshot received | T01 | Yes |
| LOS timeout → pending + retry (never blocks workflow) | T02 | Yes |
| LOS 5xx → UPSTREAM_UNAVAILABLE (503) | T03 | Yes |
| Consent gate — no consent | T04 | Yes |
| Consent gate — withdrawn consent | T05 | Yes |
| Consent gate — expired consent | T06 | Yes |
| eligibility_mapping null → VALIDATION_ERROR | T07 | Yes |
| Stage guard — wrong stage → STAGE_GUARD_FAILED | T08 | Yes |
| Stage guard — terminal stage | T09 | Yes |
| Optimistic lock stale → CONFLICT (409) | T10 | Yes |
| Idempotency — pending replay | T11 | Yes |
| Idempotency — received replay | T12 | Yes |
| Authz negative — cross-owner RM | T13 | Yes |
| Authz negative — PARTNER role | T14 | Yes |
| AUTH_REQUIRED (unauthenticated) | T15 | Yes |
| NOT_FOUND (unknown lead) | T16 | Yes |
| Invalid UUID path param | T17 | Yes |
| Transaction rollback on mid-write failure | T18 | Yes |
| Payload builder maps correctly (unit) | T19 | Yes |
| Mapping validator rejects missing attribute | T20 | Yes |
| Authz positive — BM own branch | T21 | Yes |
| UI — indicative label | T22 | Yes |
| UI — final label | T23 | Yes |
| UI — polls while pending | T24 | Yes |
| UI — EmptyState with request button | T25 | Yes |
| UI — disabled overlay for terminal stage | T26 | Yes |
| Masking behaviour on response | T27 | Yes |
| data_sharing_logs append-only | T28, INV-05, INV-08 | Yes |
| consent_records append-only | T29 | Yes |
| audit_logs append-only | T30 | Yes |
| No orphaned snapshot (SQL invariant) | INV-01 | Yes |
| No snapshot without integration_log (SQL invariant) | INV-02 | Yes |
| No received snapshot without outbox event (SQL invariant) | INV-03 | Yes |
| No eligibility_requested lead without stage_history (SQL invariant) | INV-04 | Yes |
| No duplicate idempotency_key (SQL invariant) | INV-06 | Yes |
| E2E happy flow | E2E-01 | Yes |
| E2E consent missing blocks UI | E2E-02 | Yes |
| E2E pending skeleton | E2E-03 | Yes |
| E2E failed → retry button | E2E-04 | Yes |
| E2E terminal stage disabled | E2E-05 | Yes |

---

## Test Data Factories Required

- `eligibilitySnapshotFactory` — `apps/api/test/factories/eligibility-snapshot.factory.ts`
  - Defaults: `status='pending'`; valid `lead_id`, `org_id`, `request_ref`, `created_by`, `updated_by`
  - Override: `status`, `indicative_amount`, `response_basis`, `validity_until`

- `consentRecordFactory` — extend existing factory to support `purpose='product_eligibility'`, `state='granted'`

- `productConfigFactory` — extend to support `eligibility_mapping` (populated vs null) and `eligibility_mapping_incomplete` fixture

- `leadProductDetailFactory` — extend to support `attributes` with all required mapped fields (matching the eligibility_mapping fixture) and a fixture with missing required attribute

- `integrationLogFactory` — extend to support `integration='los_eligibility'`, `idempotency_key`, `status`

**LosMockAdapter fixtures required:**
- `success` — returns full eligibility response (`responseBasis='indicative'`)
- `success_final` — returns response with `responseBasis='final'`
- `timeout` — simulates timeout (Promise never resolves within `LOS_TIMEOUT_MS`)
- `server_error` — returns HTTP 503

---

## Naming Convention

Tests follow `describe('<unit>') + it('<does X> when <scenario>')` per testing-contract.md:

```
describe('EligibilityService')
  it('returns received snapshot when LOS responds successfully')
  it('returns pending snapshot and enqueues retry when LOS times out')
  it('throws UPSTREAM_UNAVAILABLE when LOS returns 5xx')
  it('throws FORBIDDEN with CONSENT_MISSING when no product_eligibility consent')
  it('throws VALIDATION_ERROR when eligibility_mapping is null')
  it('throws VALIDATION_ERROR with STAGE_GUARD_FAILED when lead is not in kyc_in_progress')
  it('throws CONFLICT when leads.version is stale')
  it('returns original snapshot and IDEMPOTENT_REPLAY on replayed Idempotency-Key')
  it('rolls back all writes when data_sharing_logs insert fails mid-transaction')
  it('does not include PII fields in the LOS payload')

describe('EligibilityPayloadBuilder')
  it('maps all eligibility_mapping fields from lead_product_details.attributes to LOS payload')
  it('throws VALIDATION_ERROR when a required mapped attribute is absent')

describe('POST /api/v1/leads/:id/eligibility (e2e)')
  it('returns 200 with received snapshot for valid RM request')
  it('returns 403 CONSENT_MISSING when product_eligibility consent is absent')
  it('returns 403 CONSENT_MISSING when consent is withdrawn')
  it('returns 403 FORBIDDEN when RM requests another RM lead')
  it('returns 403 FORBIDDEN for PARTNER role')
  it('returns 401 AUTH_REQUIRED without JWT')
  it('returns 404 NOT_FOUND for unknown lead ID')
  it('returns 400 VALIDATION_ERROR for non-UUID lead ID')
  it('returns 400 VALIDATION_ERROR with STAGE_GUARD_FAILED when stage is captured')
  it('returns 409 CONFLICT on stale optimistic lock')
  it('returns 503 UPSTREAM_UNAVAILABLE when LOS returns 5xx')
  it('returns 200 pending when LOS times out')
  it('returns 200 IDEMPOTENT_REPLAY on duplicate Idempotency-Key (pending)')
  it('returns 200 IDEMPOTENT_REPLAY on duplicate Idempotency-Key (received)')
  it('returns 200 for BM on own-branch lead')
```
