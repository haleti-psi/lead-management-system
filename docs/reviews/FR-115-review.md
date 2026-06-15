# FR-115 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-115 (Data Retention, Purge & Anonymisation Engine) is well-structured with correct ABAC wiring, owner-writes discipline for `leads` via `LeadService.softDeleteForRetention`, Kysely-only queries with LIMIT guards, no `any` casts, no PII logging of values, and consent/audit_logs immutability enforced. Three findings require rejection: the dry-run preview never reports a non-zero `blocked_by_open_request` count (contradicting the LLD spec example and T03), the Cloud Tasks enqueue step is not implemented (apply-mode runs inline via `void` promise), and API-layer controller tests for happy-path and rate-limit scenarios are absent.

## Findings

### MAJOR — `apps/api/src/modules/compliance/retention.engine.ts:124`

`dryRun` always returns `blocked_by_open_request: 0`. The LLD §Endpoints dry-run response example shows `blocked_by_open_request: 7`, and test-spec T03 expects this count to be non-zero. By pushing the exclusion into a NOT EXISTS subquery in `fetchCandidates`, excluded leads never appear in the candidate set and cannot be counted separately. A DPO running a dry-run sees 0 blocked-by-open-request even when many leads are actually blocked, misleading compliance review.

**Fix:** Introduce a separate counting query for `dryRun` that counts leads matching the eligibility criteria (cutoff, outcome stages, no legal hold) but having an open DRR or Grievance. Assign that count to `blocked_by_open_request` in the returned preview. `fetchCandidates` (apply-mode path) correctly keeps the NOT EXISTS exclusion; only the dry-run counting path needs the additional query.

### MAJOR — `apps/api/src/modules/compliance/retention-policy.controller.ts:198-215`

LLD §Backend Flow step 4b specifies: 'Enqueue a Cloud Tasks job (`RETENTION_RUN_TASK`) carrying `{ runId, dataCategory, orgId }`; return 202 immediately.' The implementation instead runs `void this.engine.applyRun(...)` inline (commented 'Cloud Tasks enqueue is out of scope'). This means: (a) apply-mode blocks the HTTP response until the engine finishes (contradicting 202 semantics); (b) if the engine throws at the top level, the error is silently swallowed by the outer `.catch` without surfacing `run_id` failure status reliably; (c) under load, a long-running purge batch ties up the Cloud Run instance. The approved library `@google-cloud/tasks` is listed in the dependency register for exactly this purpose.

**Fix:** Implement Cloud Tasks enqueue using `@google-cloud/tasks` `CloudTasksClient`. After writing the run-start audit record, enqueue a task to the `RETENTION_RUN_TASK` queue carrying `{ runId, dataCategory, orgId }` and return 202 immediately. Move `engine.applyRun` into a separate `@Controller` HTTP handler (or existing pattern like `GrievanceEscalationJob`) decorated with `@Public()` and protected by `InternalTaskGuard`, accepting the task payload from the Cloud Tasks header.

### MAJOR — `apps/api/src/modules/compliance/retention.engine.spec.ts (file-level)`

API-layer controller tests T11 (GET DPO paginated list), T14 (POST ADMIN create policy), T19 (POST DPO dry-run succeeds, 202), T21 (POST ADMIN apply enqueues job, run_id returned), T23 (scoped dry-run by category), and T29 (rate-limit 429) are all absent from the spec file. The spec file comment says API tests are 'DEFERRED to the integration-test wave', but T29 (rate-limit) has no coverage in `retention.e2e-spec.ts` either, and T11/T14/T19/T21/T23 are not present there. The testing-contract requires component-level HTTP tests for every Tier-3 FR. Role assertion tests (T12/T15/T20) are present only as inline logic replication, not as HTTP-level controller tests.

**Fix:** Add a `retention-policy.controller.spec.ts` (or extend the existing spec) using NestJS `Test.createTestingModule` with mocked `RetentionPolicyRepository` and `RetentionEngine`. Cover: T11 (GET 200 DPO), T14 (POST 201 ADMIN), T15 (POST 403 DPO — HTTP), T19 (POST dry-run 202 DPO), T20 (POST apply 403 DPO — HTTP), T21 (POST apply 202 ADMIN with run_id), T22 (400 invalid mode — HTTP), T23 (scoped dry-run), T29 (throttler guard returning 429).

### MINOR — `apps/api/src/modules/compliance/retention.engine.ts:234-235`

The LLD §Data Operations anonymisation example (and test T05 as specified in FR-115-tests.md) states `mobile: '0000000000'`. The implementation uses `'9000000000'` to satisfy the DB check constraint `ck_lead_identities_mobile (^[6-9][0-9]{9}$)`. The deviation is technically correct (constraint compliance), but (a) the LLD is not updated to reflect this change, (b) test T05 in the test spec says `mobile = '0000000000'` while the unit test asserts `'9000000000'` — the test spec and unit test are inconsistent.

**Fix:** Update `docs/lld/FR-115.md` §Data Operations anonymisation snippet to show `mobile: '9000000000'` (with a comment referencing the check constraint). Update `docs/lld/FR-115-tests.md` T05 expected outcome accordingly. The code itself is correct.

### MINOR — `apps/api/src/modules/compliance/retention.engine.ts:168-171`

The per-lead error log at line 168 passes `{ leadId, policyId, err }` directly to `this.logger.error`. The `err` object is the raw caught exception, which for a Postgres constraint violation or Kysely serialisation error may include field values from the failing row (e.g. column values in the error message). The guidelines prohibit logging PII field values even at debug/error level.

**Fix:** Sanitise the logged error: replace `err` with `err instanceof Error ? err.message : String(err)`. Do not spread the raw error object. E.g.: `this.logger.error({ leadId, policyId, errorMessage: err instanceof Error ? err.message : String(err) }, 'Retention apply failed for lead; skipping to next')`.


## Test coverage

Unit tests (retention.engine.spec.ts) cover T01-T10, T13, C1, T12/T15/T16/T17/T18/T20/T22 via inline logic. Integration tests (retention.e2e-spec.ts) cover T24/T25 analogues with Testcontainers Postgres. Missing: T11/T14/T19/T21/T23 (API controller happy-path), T29 (rate-limit 429). T03/T04 unit tests pass but misrepresent the spec: they assert `blocked_by_open_request = 0` whereas the spec requires a non-zero count when DRR/Grievance leads exist. E2E tests (T30, UI-01 through UI-06) are deferred project-wide.
