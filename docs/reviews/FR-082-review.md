# FR-082 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-082 implementation is structurally sound: HMAC guard, Zod validation, UnitOfWork transaction, upsert out-of-order guard, LIMIT clauses, no `any`, no `console.*`, PII excluded from logs, and correct error codes all conform to spec. Three issues warrant rejection: (1) `api-contract.yaml` omits the `400 VALIDATION_ERROR` response for the webhook endpoint despite it being a specified and tested path; (2) T01, T02, and T12 from the test spec are claimed as covered in the controller spec but are absent — the controller spec only mocks the service layer and does not verify any DB state, leaving the full happy-path and concurrent-duplicate integration paths untested; (3) the inner `catch (logErr)` in the reconcile failure path silently discards the error object, making the root cause of a failed `writeFailedIntegrationLog` invisible.

## Findings

### MAJOR — `docs/contracts/api-contract.yaml:232`

The `POST /los/webhooks/status` entry declares only `200` and `403` responses. It omits `400 VALIDATION_ERROR`, which the LLD §Validation Logic specifies is returned when the Zod parse fails (T08–T10 confirm this path is live in code). The contract is the machine-readable source of truth consumed by downstream reviewers and client generators.

**Fix:** Add `"400": { $ref: '#/components/responses/ValidationError' }` to the `/los/webhooks/status` post response map in api-contract.yaml.

### MAJOR — `apps/api/src/modules/los/los-status.service.spec.ts:8 / apps/api/src/modules/los/los-status.controller.spec.ts:4`

The service spec comment states T01, T02, T12 are covered in the controller spec. The controller spec only mocks `LosStatusService` and never writes to a database — it cannot verify that T01 (HTTP 200 + `los_application_mirrors` row created), T02 (mirror `status` and `status_date` updated for a newer event), or T12 (concurrent duplicate resolved to exactly one `integration_logs` row) actually work end-to-end. The FR-082-tests.md coverage checklist marks all three as covered. They are not.

**Fix:** Add a supertest + Testcontainers integration test (alongside los-mirror.e2e-spec.ts) that starts the full NestJS app, sends a correctly HMAC-signed POST to `/api/v1/los/webhooks/status`, and asserts the DB state: (T01) one `los_application_mirrors` row and one `integration_logs` row with `status='success'`; (T02) same lead, newer `status_date` event updates `status`; (T12) two concurrent identical `event_id` requests both return 200, exactly one `integration_logs` row persists.

### MINOR — `apps/api/src/modules/los/los-status.service.ts:250`

In the inner `catch (logErr)` block inside `reconcile()`, `logErr` is completely discarded. The log call at line 251 emits only `{ lead_id }` with no error message or stack. If `writeFailedIntegrationLog` itself fails (e.g., DB connection lost), the actual cause is unobservable in production logs.

**Fix:** Change line 251 to `this.logger.warn({ lead_id, err: logErr }, 'FR-082 reconcile: failed to write error integration_log');` to surface the underlying error. This follows the project's pino structured logging pattern used elsewhere in the service.

### MINOR — `apps/api/src/modules/los/los-application-mirror.repository.ts:123-157`

`findStaleHandedOffLeads` issues two separate SQL queries (inner-join for stale mirrors, left-join for missing mirrors), each with `LIMIT 100`, then deduplicates and slices in memory. Up to 200 rows are materialized from the database to produce at most 100 results. A single query with `WHERE (m.los_mirror_id IS NULL OR m.status_date < $threshold) LIMIT 100` would be correct and efficient, and avoids the edge case where the two query result sets overlap and return fewer than 100 unique leads.

**Fix:** Merge the two queries into a single LEFT JOIN query: `SELECT l.lead_id, l.los_application_id, l.org_id FROM leads l LEFT JOIN los_application_mirrors m ON m.lead_id = l.lead_id WHERE l.stage = 'handed_off' AND l.los_application_id IS NOT NULL AND l.deleted_at IS NULL AND (m.los_mirror_id IS NULL OR m.status_date < $staleThreshold) LIMIT 100`. Remove the in-memory dedup and slice.


## Test coverage

Unit tests (service spec) cover T03, T04, T07, T11, T13, T14, T15, T18, T19, plus reconcile resilience and multi-lead batch. Guard spec covers T05/T06 cryptographic paths. Schema spec covers T08–T10. UI component tests cover T16, T17, U01–U05. Testcontainer integration tests cover the upsert ON CONFLICT WHERE clause and the idempotency partial unique index. Missing: T01 (happy path, new mirror created with DB verification), T02 (mirror updated with newer status_date, DB state asserted), T12 (concurrent duplicate delivery race — claimed but only a sequential unit mock exists). E2E (T20, U06) is project-wide deferred per manifest.
