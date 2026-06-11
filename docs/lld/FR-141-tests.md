# FR-141: Event Outbox & Analytics/AI-Readiness Stream — Test Specification

**Tier: 3** | Source LLD: `docs/lld/FR-141.md`

---

## Test Cases

Tier 3 minimum: 10 test cases covering happy path, every error code the FR raises, state
transitions (valid + invalid), external-service failure + retry, idempotency/at-least-once, and
transaction-rollback guarantee.

| # | Name | Layer | Tool | Scenario | Input / Setup | Expected outcome |
|---|---|---|---|---|---|---|
| T01 | emit inserts pending row in same transaction | Unit | Jest | Happy path: `OutboxService.emit` inserts a row with `status='pending'` using the caller's tx | Call `emit(EventCode.LEAD_STAGE_CHANGED, 'Lead', leadId, maskedPayload, tx)` within an active Kysely tx | 1 row inserted in `event_outbox` with `status='pending'`, correct `event_code`, `aggregate_type`, `aggregate_id`, `schema_version=1`, `payload` matches masked input; `published_at` is null |
| T02 | emit + state change commit atomically | Integration (e2e) | Jest + Testcontainers | Transactional atomicity: lead stage transition + outbox row commit together | Call `LeadService.transitionStage` for a valid `captured → assigned` transition inside `uow.run` | After commit: `leads.stage='assigned'`, `stage_history` row present, `event_outbox` row present with `status='pending'` and `event_code='LEAD_STAGE_CHANGED'`; all in single committed tx |
| T03 | tx rollback removes outbox row (no partial state) | Integration (e2e) | Jest + Testcontainers | Mid-transaction failure rolls back all writes atomically | Force DB error (e.g., insert a duplicate `stage_history_id`) after `OutboxService.emit` is called but before commit | Zero rows in `event_outbox` for the test `aggregate_id`; `leads.stage` unchanged; `stage_history` has no new row — entire tx rolled back |
| T04 | publisher polls and publishes pending rows | Unit | Jest | Happy path: `OutboxPublisherService` selects pending rows and calls Pub/Sub | Seed 3 `event_outbox` rows with `status='pending'`; mock `PubSub.topic().publishMessage` to return success | `publishMessage` called 3 times (once per row); `markPublished` updates all 3 rows to `status='published'` with `published_at` set; no rows remain `pending` |
| T05 | publisher marks row published (pending→published transition) | Unit | Jest | State machine: `pending → published` | One pending row in DB; Pub/Sub mock returns ack | Row `status` = `'published'`, `published_at` is not null; `updated_at` advanced |
| T06 | Pub/Sub failure retries up to MAX and marks failed | Unit | Jest | `pending → failed` after exhausted retries; `UPSTREAM_UNAVAILABLE` path | Mock `publishMessage` to always throw; set `MAX_PUBLISH_RETRIES=3` | After 3 failed publish attempts the row is updated to `status='failed'`; Cloud Monitoring counter `outbox_dead_letter_total` incremented; row is NOT re-attempted in the same poll cycle |
| T07 | Pub/Sub transient failure leaves row pending for next poll | Unit | Jest | Transient failure: first attempt fails, row stays pending for retry on next cycle | Mock `publishMessage` to throw once; poll runs again | After first poll: row still `status='pending'` (attempt count below threshold); second poll: `publishMessage` succeeds; row becomes `published` |
| T08 | at-least-once: crash after publish before mark leaves row rescheduled | Unit | Jest | At-least-once guarantee — process crash between publish and markPublished | Mock `publishMessage` success; mock `markPublished` to throw; next poll cycle runs | `publishMessage` is called again on the next poll (row still `pending`); idempotent consumer must handle duplicate `event_id`; row eventually marked `published` |
| T09 | payload PII is masked before insert | Unit | Jest | Masking: `MaskingService.maskEventPayload` is applied; raw PII never in outbox | Call `emit` with a payload containing `mobile: '9876543210'`, `pan_masked: 'ABCDE1234F'` | Inserted `payload` JSONB has mobile and PAN replaced with masked values (e.g. `98xxxxxx10`, `ABCDE****F`); raw values do not appear anywhere in the DB row |
| T10 | invalid event_code throws INTERNAL_ERROR (not 400) | Unit | Jest | Validation: unsupported `event_code` value passed to `emit` | Pass `event_code: 'INVALID_CODE'` (not in `EventCode` enum) to `emit` | `emit` throws `InternalException` (maps to `INTERNAL_ERROR` 500); no row inserted in `event_outbox`; error logged with `correlation_id`; caller may catch and rollback |
| T11 | publisher batch respects PUBLISHER_BATCH_SIZE LIMIT | Unit | Jest | NFR: LIMIT enforced on SELECT | Seed 200 `pending` rows; `PUBLISHER_BATCH_SIZE=100` | Only 100 rows returned from SELECT (LIMIT applied); 100 rows published and marked; 100 still `pending` after first run |
| T12 | publisher skips published and failed rows | Unit | Jest | State machine: only `pending` rows are picked up | Seed 1 `published`, 1 `failed`, 1 `pending` row | `publishMessage` called exactly once (for the `pending` row); other rows untouched |
| T13 | markPublished is guarded by WHERE status='pending' | Unit | Jest | Idempotency guard: concurrent publish of same row | Two concurrent publisher instances both attempt `markPublished` on the same `event_id` | One UPDATE succeeds (1 row affected); the second UPDATE affects 0 rows (WHERE guard); no double-mark; `published_at` reflects the first writer |
| T14 | emit rejects null/empty aggregateId (internal validation) | Unit | Jest | Validation boundary: malformed call | Pass `aggregateId: ''` (empty string) to `emit` | `emit` throws `InternalException`; Zod validation failure logged; no row inserted |
| T15 | CONSENT_WITHDRAWN event is emitted and published | Integration (e2e) | Jest + Testcontainers | End-to-end: consent withdrawal triggers outbox row with correct event_code | Withdraw a consent record via `ConsentService` (FR-110); publisher worker mock | `event_outbox` row with `event_code='CONSENT_WITHDRAWN'`, `aggregate_type='Consent'`, `aggregate_id=consentId`; payload is masked; `schema_version=1` |

---

## SQL Invariant Queries

Run after each integration test; expect 0 rows unless otherwise noted.

```sql
-- INV-01: No event_outbox row should have NULL event_code (enum NOT NULL)
SELECT COUNT(*) FROM event_outbox WHERE event_code IS NULL;
-- Expected: 0

-- INV-02: No event_outbox row should contain raw mobile numbers (10-digit unmasked)
-- (Catches masking bypass — mobile in payload must be masked)
SELECT COUNT(*) FROM event_outbox
WHERE payload::text ~ '"mobile"\s*:\s*"[6-9][0-9]{9}"';
-- Expected: 0

-- INV-03: No event_outbox row should contain raw PAN (10-char alphanumeric unmasked)
SELECT COUNT(*) FROM event_outbox
WHERE payload::text ~ '"pan[^"]*"\s*:\s*"[A-Z]{5}[0-9]{4}[A-Z]"';
-- Expected: 0

-- INV-04: No outbox row that is 'published' should have NULL published_at
SELECT COUNT(*) FROM event_outbox WHERE status = 'published' AND published_at IS NULL;
-- Expected: 0

-- INV-05: No outbox row that is 'pending' should have non-NULL published_at
SELECT COUNT(*) FROM event_outbox WHERE status = 'pending' AND published_at IS NOT NULL;
-- Expected: 0

-- INV-06: Atomicity check — if a lead stage transition is committed, its outbox row must exist
-- (Run after T02 scenario)
SELECT l.lead_id
FROM leads l
INNER JOIN stage_history sh ON sh.lead_id = l.lead_id
LEFT JOIN event_outbox eo ON eo.aggregate_id = l.lead_id
  AND eo.event_code = 'LEAD_STAGE_CHANGED'
WHERE sh.occurred_at >= NOW() - INTERVAL '1 minute'
  AND eo.event_id IS NULL;
-- Expected: 0 rows (every committed stage_history row must have a matching outbox row)

-- INV-07: No outbox row should have schema_version < 1
SELECT COUNT(*) FROM event_outbox WHERE schema_version < 1;
-- Expected: 0

-- INV-08: event_outbox.org_id must always equal the default org (single-tenant MVP)
SELECT COUNT(*) FROM event_outbox
WHERE org_id != '00000000-0000-0000-0000-000000000001';
-- Expected: 0

-- INV-09: No event_outbox row has aggregate_type exceeding 40 chars (column constraint)
SELECT COUNT(*) FROM event_outbox WHERE length(aggregate_type) > 40;
-- Expected: 0

-- INV-10: After T03 (rollback scenario), no orphaned outbox row exists for test aggregate
-- (parameterised with :test_aggregate_id)
SELECT COUNT(*) FROM event_outbox WHERE aggregate_id = :test_aggregate_id;
-- Expected: 0
```

---

## UI Test Scenarios

FR-141 has no user-facing UI.  No Playwright or Vitest/Testing-Library UI tests are required.

Operational visibility is covered by FR-140 integration monitor tests (separate LLD).

---

## Coverage Checklist

| Requirement | Test(s) | Status |
|---|---|---|
| Happy path: outbox row written on state change | T01, T02, T15 | covered |
| Transactional atomicity: outbox commits with state change | T02 | covered |
| Rollback: outbox row absent when tx fails | T03 | covered |
| Publisher: polls pending rows and publishes | T04 | covered |
| State: `pending → published` | T04, T05 | covered |
| State: `pending → failed` after exhausted retries | T06 | covered |
| State: retry on transient failure (still pending) | T07 | covered |
| At-least-once: duplicate publish on crash/retry | T08 | covered |
| Masking: PII never in outbox payload | T09, INV-02, INV-03 | covered |
| `INTERNAL_ERROR` on invalid event_code | T10 | covered |
| `UPSTREAM_UNAVAILABLE` path (Pub/Sub failure) | T06, T07 | covered (unit) |
| NFR LIMIT enforced on SELECT | T11 | covered |
| Only `pending` rows processed (not published/failed) | T12 | covered |
| Idempotent markPublished (concurrent guard) | T13 | covered |
| Validation boundary (malformed args) | T10, T14 | covered |
| CONSENT_WITHDRAWN event end-to-end | T15 | covered |
| INV: no NULL event_code | INV-01 | covered |
| INV: no raw PII in payload | INV-02, INV-03 | covered |
| INV: published_at invariants | INV-04, INV-05 | covered |
| INV: stage_history ↔ outbox atomicity | INV-06 | covered |
| INV: rollback leaves no orphan | INV-10 | covered |
| No human-facing auth test required | n/a — FR-141 has no HTTP endpoint | n/a |
| Append-only check (audit/stage_history) | Covered by FR-123/FR-052 tests respectively | out of scope here |
| `schema_version` field always ≥ 1 | INV-07 | covered |
| org_id residency | INV-08 | covered |
| aggregate_type length guard | INV-09 | covered |

### Testing-contract tier compliance (Tier 3)

| Tier 3 requirement | Fulfilled by |
|---|---|
| All logic unit tests | T01, T04–T14 |
| All endpoints (no public endpoint) | n/a |
| All transitions + invalid | T04, T05, T06, T12, T13 |
| External service mock + timeout + retry + dedupe | T06, T07, T08 |
| Idempotency/concurrency | T08, T13 |
| Full workflow (integration e2e) | T02, T03, T15 |
