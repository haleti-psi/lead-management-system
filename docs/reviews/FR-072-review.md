# FR-072 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-072 (KYC Exception Handling) is functionally sound in its core backend path: auth/ABAC chaining is correct (JwtAuthGuard global + @Requires(kyc_signoff) + service-layer KYC/BM role gate), owner-writes discipline is observed (only KycVerificationRepository writes kyc_verifications; leads written only via LeadService.setKycStatus), all Kysely queries are parameterised with LIMIT guards, no any/console.*/swallowed errors, PII masking in audit detail is correct, and the UnitOfWork transaction wraps all five writes atomically. The unit test file covers 12 of the 18 specified cases at the service/DTO layer. Three issues block approval: the API integration test file is entirely absent (11 API-layer tests missing per spec), the TanStack Query cache is never invalidated after a successful mutation (stale exception queue and lead status chip in the UI), and the state-machines.md contract lists `resolved` as the target status while the schema has no such enum value and the implementation maps to `success`/`waived` — an unreconciled contract discrepancy that will mislead future reviewers.

## Findings

### BLOCKER — `apps/api/test/kyc-exception.e2e-spec.ts (file does not exist)`

The entire API integration test file is absent. FR-072-tests.md specifies T-01 through T-17 as API-layer tests using Jest + Supertest + Testcontainers-Postgres. The testing-contract.md mandates 'all endpoints: happy + each error path' for Tier 3 FRs. No API-level test exists for T-03 (AUTH_REQUIRED 401), T-05 (out-of-scope branch FORBIDDEN), T-07 (provider_down_manual with flag), T-10 (CONFLICT from DB state), T-17 (RATE_LIMITED 429), or any DB-state-based assertions (outbox row, leads.kyc_status update).

**Fix:** Create apps/api/test/kyc-exception.e2e-spec.ts implementing T-01 through T-17 as specified in FR-072-tests.md using the kyc.factory.ts test factories and Testcontainers-Postgres. Include factories.kycException, factories.kycResolved, factories.twoKycExceptions, and the SQL invariant assertions INV-01 through INV-04.

### MAJOR — `apps/web/src/hooks/use-resolve-kyc-exception.ts:15-22`

The TanStack Query mutation hook does not invalidate any query caches on success. The LLD (§UI) explicitly requires invalidateQueries(['kyc-verifications', leadId]) and invalidateQueries(['leads', leadId]) after a successful resolve. Without this, the exception queue DataTable and the lead kyc_status chip display stale data after the modal closes, requiring a full page reload to reflect the resolution.

**Fix:** Add an onSuccess callback to useMutation that calls queryClient.invalidateQueries({ queryKey: ['kyc-verifications', leadId] }) and queryClient.invalidateQueries({ queryKey: ['leads', leadId] }). Use useQueryClient() from @tanstack/react-query. Pattern matches other mutation hooks in the codebase (e.g. apps/web/src/components/compliance/use-data-rights.ts).

### MAJOR — `docs/contracts/state-machines.md (KYCVerification section) vs docs/data-model/schema.sql:64`

The state-machines.md contract lists 'exception → resolved' as the target transition state for FR-072. The DB schema (kyc_check_status enum) has no 'resolved' value — only initiated/success/failed/exception/waived. The LLD response example also shows "status": "resolved" (FR-072.md line 89). The implementation correctly maps to 'success' or 'waived' (per Ambiguity A-5), but the authoritative contract document is wrong and will mislead future reviewers, FR-081 handoff guard implementation, and any consumer of the event_outbox KYC_EXCEPTION payload that inspects the resulting status.

**Fix:** Update docs/contracts/state-machines.md to replace 'exception → resolved' with 'exception → success (re-verified/manual) | exception → waived (authorised waiver)'. Update the LLD response example at FR-072.md line 89 to show 'status': 'success' (or 'waived'). Record this as resolved for Ambiguity A-5.

### MAJOR — `apps/web/e2e/ (directory does not exist)`

T-18 (E2E full workflow: login as KYC user, navigate to KYC Workbench, open exception queue, resolve exception via modal) is specified in FR-072-tests.md and the testing-contract.md mandates a full workflow E2E for Tier 3 FRs. The apps/web/e2e/ directory does not exist at all.

**Fix:** Create apps/web/e2e/kyc-exception.spec.ts with the Playwright test for T-18 as described in FR-072-tests.md: log in as KYC user, navigate to KYC Workbench, open an exception row, resolve with re_verified code, assert modal closes, Toast shows 'KYC exception resolved', and the exception row is removed from the queue.

### MINOR — `apps/api/src/modules/kyc/kyc-exception.service.ts:40-43`

OPEN_EXCEPTION_STATUSES includes KycCheckStatus.FAILED in addition to KycCheckStatus.EXCEPTION. The state-machines.md defines the resolvable state as 'exception' only; 'failed' should transition to 'exception' via a system consumer before FR-072 can act on it. The service accepts 'failed' rows as directly resolvable, which bypasses the 'failed → exception' queuing step. This is documented as Ambiguity FR-072-A4, but it creates a behavioural divergence from the state machine contract without a formal record in the LLD ambiguity list.

**Fix:** Ensure the A4 ambiguity decision is formally recorded in FR-072.md's Assumptions section and added to the AMBIGUITY.md or state-machines.md as a known deviation. If the intent is to treat 'failed' as implicitly 'exception' (skipping the consumer), this must be a signed-off design decision, not an implicit code behaviour.

### MINOR — `apps/web/src/components/kyc/ExceptionResolutionModal.test.tsx (missing UT-03 server-side variant)`

UT-03 in FR-072-tests.md tests that the modal renders a server-returned VALIDATION_ERROR fields[] inline (MSW mock returns 400 with fields: [{field: 'evidenceRef', issue: '...'}]). The actual test file covers only the client-side validation blocking (Zod-level, no mutateAsync call). The server-side field error rendering path via EntityForm's VALIDATION_ERROR handling is not tested.

**Fix:** Add a test case that uses vi.fn() on mutateAsync to reject with a mock VALIDATION_ERROR response containing fields: [{field: 'evidenceRef', issue: 'evidenceRef is required for waiver.'}] and asserts the error text appears inline in the form (EntityForm maps VALIDATION_ERROR.fields to field errors per shared-utilities.md).


## Test coverage

Unit tests (kyc-exception.service.spec.ts) cover 12 of 18 specified test cases: T-01, T-02, T-04, T-05, T-06, T-07, T-08, T-09, T-10, T-11, T-15, T-16 at the service layer, plus T-12, T-13, T-14 via DTO parse. API integration test file (apps/api/test/kyc-exception.e2e-spec.ts) is entirely absent — T-01 through T-17 are specified as API-layer tests using Testcontainers. T-03 (AUTH_REQUIRED), T-05 (out-of-scope branch), T-10 (already resolved DB state), T-17 (RATE_LIMITED) have no API-level coverage. UI component tests (ExceptionResolutionModal.test.tsx) cover UT-01, UT-02, UT-04; UT-03 is covered as a client-validation variant. T-18 Playwright E2E is absent (apps/web/e2e/ directory does not exist). SQL invariant tests INV-01 through INV-04 have no backing implementation. The testing-contract.md mandates full API integration coverage for Tier 3 FRs.
