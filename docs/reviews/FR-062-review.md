# FR-062 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-062 is substantially correct in structure, auth guard wiring, DTO validation, Kysely usage (parameterised, no `any`, no raw SQL), and error-taxonomy compliance. Three material gaps warrant rejection: (1) the hot-flag side effect is silently skipped with no test coverage for that path (LLD §2.4 is a behavioral requirement, not an optional nice-to-have, and the AMBIGUITY.md note acknowledges but does not justify omitting the test); (2) the IDEMPOTENT_REPLAY meta signal is absent from the 200 replay response, contradicting the LLD spec and the error-taxonomy sub-reason table; (3) the audit entry for the status-view path logs entity_type='lead' and entity_id=lead_id rather than entity_type='customer_link' and entity_id=customerLinkId as specified, meaning audit trail cannot be used to find all status-views for a given link. The `FOR UPDATE` row-lock omission in getLeadForCallback is a lower-severity gap. Test coverage also misses the rejected-stage guard (U-07 from the test spec is absent), and the integration e2e spec file does not exist.

## Findings

### BLOCKER — `apps/api/src/modules/self-service/status.service.ts:146-148`

Hot-flag side effect silently skipped with no documentation of a test path. LLD §Data Operations 2 step 4 and §State Machine §leads.is_hot are behavioral requirements: if `!lead.is_hot`, call `LeadService.setHotFlag(leadId, true, ['callback_requested'], tx)`. The code comment says 'deferred' and the call is entirely absent. AMBIGUITY FR-062-A2 correctly identifies this but the resolution ('wire when FR-031 implements setHotFlag') does not satisfy the LLD requirement that exists NOW — this is not a dependency on a non-existent service, it is a skipped write that changes business behavior. Test cases U-08 and U-09 from FR-062-tests.md (setHotFlag called/not-called) cannot pass because the call does not exist. A-10 (leads.is_hot=true after callback) will always fail.

**Fix:** Check whether `LeadService.setHotFlag` is now implemented (FR-031 has been merged per git log). If it is, wire the call: `if (!lead.is_hot) { await leadService.setHotFlag(ctx.leadId, true, ['callback_requested'], tx); }` inside the UnitOfWork. Add `LeadService` to `StatusService` constructor injection and `SelfServiceModule` providers. If FR-031 is not yet complete, keep the stub path but add a test that explicitly asserts the hot-flag is NOT set and the warn log is emitted (U-08/U-09 must pass in some form).

### MAJOR — `apps/api/src/modules/self-service/status.service.ts:105-111`

IDEMPOTENT_REPLAY sub-reason is not surfaced in the replay response. The LLD §Idempotency states: 'Response has detail.reason = IDEMPOTENT_REPLAY in the meta when replayed (HTTP 200 with original body, per IDEMPOTENT_REPLAY sub-reason)'. The error-taxonomy.md sub-reasons table lists IDEMPOTENT_REPLAY as a contractual behavior. The replay path on line 109 returns `{ task_id, message }` with no meta injection — the ResponseEnvelopeInterceptor wraps this as a 201 (not 200), losing the sub-reason entirely. AMBIGUITY FR-062-A5 notes this but frames it as a ratification request, not a confirmed deviation — the LLD is unambiguous on this point.

**Fix:** In the controller or service, detect replay and return HTTP 200 with the cached data plus the meta signal. Pattern: in the controller, when `StatusService.requestCallback` signals a replay (e.g. return a discriminated union `{ replay: true, task_id }`) set `@HttpCode(200)` and inject `meta.detail.reason = 'IDEMPOTENT_REPLAY'` into the envelope before returning. Alternatively, follow the pattern in `apps/api/src/modules/integration/integration.controller.ts:104` which sets `meta: { ..., reason: 'IDEMPOTENT_REPLAY' }` and returns HTTP 200 using `res.status(200).json(...)`. Unit test U-05 must also assert the reason field.

### MAJOR — `apps/api/src/modules/self-service/status.service.ts:79-87`

Audit entry for the status-view (GET /c/{token}/status) uses `entity_type: 'lead'` and `entity_id: lead.lead_id` instead of `entity_type: 'customer_link'` and `entity_id: ctx.customerLinkId` as specified in the LLD §Data Operations 1. The LLD states: `AuditAppender.emit({ action: 'link_open', entityType: 'customer_link', entityId: ctx.customerLinkId, ... })`. The code comment ('entity_id is the lead id... entity_type is lead to keep the audit row consistent') is a self-justifying deviation, not a spec change. This breaks the audit trail — an auditor querying `audit_logs WHERE entity_type='customer_link'` to find all link opens will miss these rows. The `customerLinkId` is not on `ResolvedCustomerLink`, which is the root cause.

**Fix:** Either (a) add `customerLinkId: string` to the `ResolvedCustomerLink` interface in `apps/api/src/modules/compliance/ports/customer-link.port.ts` and populate it in `CustomerLinkAdapter.resolve()`, then pass it through to `StatusService.getStatus()` and use `entity_type: 'customer_link', entity_id: link.customerLinkId` in the audit entry; or (b) document in AMBIGUITY.md that the port does not expose the link ID and the audit uses the lead as the entity (with Dev-1 approval to amend the LLD). The current situation silently deviates from the spec without a recorded decision.

### MAJOR — `apps/api/src/modules/self-service/status.repository.ts:82-94`

The `getLeadForCallback` query does not apply a `FOR UPDATE` row-lock. The LLD §Data Operations 2 step 1 explicitly requires `.forUpdate()` to 'prevent concurrent double-insert' of callback tasks for the same lead. Without this lock, two concurrent POST /c/{token}/callback requests without an Idempotency-Key (or with different keys) can race past the stage check and both insert tasks. The LLD treats this as a correctness requirement, not an optimization.

**Fix:** Add `.forUpdate()` to the Kysely query in `getLeadForCallback` after `.where('deleted_at', 'is', null)`: `.forUpdate().executeTakeFirst()`. This requires the query to run inside a transaction (which it already does — `tx` is passed in). Kysely supports `.forUpdate()` on SELECT queries inside transactions.

### MAJOR — `apps/api/test/self-service.e2e-spec.ts (file does not exist)`

The entire API integration test suite (A-01 through A-23, 23 test cases) is absent. The test spec (FR-062-tests.md) mandates Testcontainers-Postgres integration tests for all critical paths including: auth negative cases (A-03..A-06), rate limiting (A-07, A-21), data-leak prevention (A-08), transaction rollback (A-22), and idempotency (A-12). The testing-contract.md for Tier-2 FRs requires component-level API tests. This is not a deferred e2e (Playwright) gap — these are supertest API integration tests on the same node as the unit tests.

**Fix:** Create `apps/api/test/self-service.e2e-spec.ts` with Testcontainers-Postgres harness (following the pattern in `apps/api/test/integration/harness.e2e-spec.ts`). At minimum implement A-01, A-03, A-06, A-08, A-09, A-12, A-22 which cover the auth boundary, data-leak, idempotency, and transaction rollback paths. The existing harness in the integration/ directory provides the setup pattern.

### MINOR — `apps/api/src/modules/self-service/status.service.spec.ts (missing test U-07)`

Unit test U-07 ('throws VALIDATION_ERROR when lead stage is rejected') from FR-062-tests.md is absent from the spec file. The `rejected` stage is listed in `CALLBACK_BLOCKED_STAGES` so the code is correct, but the test does not cover it — only `handed_off` is tested (line 131-137). If the set is ever edited, the rejected-stage regression path has no coverage.

**Fix:** Add a test case in the `requestCallback` describe block: `d.repo.getLeadForCallback.mockResolvedValue(callbackLead({ stage: LeadStage.REJECTED }))`, then assert that `requestCallback` rejects with `{ code: ERROR_CODES.VALIDATION_ERROR }` and that `insertCallbackTask` is not called.

### MINOR — `apps/api/src/modules/self-service/status.service.spec.ts:84-92`

Test U-01 requires looping through all 13 `lead_stage` values to verify each maps to the correct `stage_label`. The existing test only asserts `documents_pending` → 'Documents Required' for one stage. The other 12 stages are untested at the unit level, meaning a typo or missing entry in `CUSTOMER_STAGE_MAP` (e.g. adding a new stage) would not be caught.

**Fix:** Add a parameterised test (using `it.each` or a loop over `Object.entries(CUSTOMER_STAGE_MAP)`) that stubs `getLeadStatus` to return each stage value and asserts the corresponding `stage_label` and `stage_description` in the response. This directly fulfills U-01 from the test spec.

### MINOR — `apps/api/src/modules/self-service/status.service.spec.ts:91`

Test U-04 asserts `audit.append` was called with `action: 'link_open'` but does not assert `entityType: 'customer_link'` (the full LLD audit spec). Given finding #3 above (the code actually emits entity_type='lead'), this test passes even though the audit entry is wrong — the test is incomplete and masks the defect.

**Fix:** Extend the assertion in the existing test: `expect(d.audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'link_open', entity_type: 'customer_link' }))`. This will fail until finding #3 is resolved, making the test a proper regression guard.


## Test coverage

Unit spec (status.service.spec.ts) covers 6 of 10 required unit cases: stages mapped correctly, handed_off flag, NOT_FOUND on missing lead, idempotency replay, VALIDATION_ERROR for handed_off stage, and unassigned-owner fallback. Missing: U-01 (loop over ALL 13 stages — only documents_pending and handed_off are tested), U-03 (pending_actions absent for non-documents_pending stage — implicit but not explicit), U-04 (audit emit with the correct entity_type — the spec asserts entity_type='customer_link' but code emits entity_type='lead'), U-07 (VALIDATION_ERROR for rejected stage — only handed_off is covered in the spec), U-08/U-09 (setHotFlag called/not-called — cannot be tested because the hot-flag code is missing). Frontend component tests (StatusPage.test.tsx) cover F-01 through F-05 and submit/success paths adequately; F-07/F-10 (inline field-error ARIA) are not present. API integration spec (apps/api/test/self-service.e2e-spec.ts) does not exist — A-01 through A-23 are entirely untested. E2E Playwright suite absent. SQL invariants not set up.
