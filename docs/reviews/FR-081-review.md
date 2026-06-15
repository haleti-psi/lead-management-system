# FR-081 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-081 LOS Hand-off is partially implemented with a solid core: auth/ABAC (@Requires on the controller), UoW atomicity, idempotency, owner-writes (LeadService.markHandedOff), no raw SQL, no any types, no console.*, no PII in logs or payload. However, three BLOCKER/MAJOR backend defects and absent frontend deliverables prevent approval: (1) guard-failure error codes for KYC_EXCEPTION_OPEN and DUPLICATE_BLOCKED are 400 instead of the spec-mandated 409; (2) the POST handler returns 201 instead of the spec-mandated 200 due to a missing @HttpCode decorator; (3) the api-contract omits the 404 response for this endpoint; and (4) all frontend components (HandoffActionPanel, GuardChecklist, HandoffStatusPanel, use-handoff hook, Playwright E2E) are absent with no evidence of deferral in the manifest.

## Findings

### BLOCKER — `apps/api/src/modules/los/los-handoff.service.ts:205-208`

All StageGuardService guard failures are mapped to VALIDATION_ERROR (400) / STAGE_GUARD_FAILED regardless of guard type. The LLD error table and error-taxonomy.md specify that kyc_signoff failure → KYC_EXCEPTION_OPEN → CONFLICT (409) and duplicate_clear failure → DUPLICATE_BLOCKED → CONFLICT (409). The current blanket mapping swallows the 409 branch entirely, breaking T06 and T07 contract assertions.

**Fix:** After collecting guardResult.failed, inspect the guard names before throwing. If 'kyc_signoff' is in failed[], throw DomainException(ERROR_CODES.CONFLICT, ..., { detail: { reason: 'KYC_EXCEPTION_OPEN' } }). If 'duplicate_clear' is in failed[], throw DomainException(ERROR_CODES.CONFLICT, ..., { detail: { reason: 'DUPLICATE_BLOCKED' } }). Remaining guard failures (stage_valid, mandatory_docs_verified, valid_payload, consent_present) throw VALIDATION_ERROR / STAGE_GUARD_FAILED with failed_guards[]. Add unit tests T06 and T07 asserting 409 CONFLICT with the correct sub-reason.

### MAJOR — `apps/api/src/modules/los/los-handoff.controller.ts:36-37`

The @Post(':id/handoff') handler has no @HttpCode decorator. NestJS defaults POST to 201 Created. The LLD success response is 200 OK, and api-contract.yaml line 226 declares '200': Ok. Both the normal path and the idempotent replay path will return 201 instead of 200.

**Fix:** Add @HttpCode(HttpStatus.OK) (import HttpStatus from '@nestjs/common') above the @Post decorator, matching the pattern used by other action endpoints in the codebase (e.g. allocation.controller.ts:54).

### MAJOR — `docs/contracts/api-contract.yaml:218-230`

The /leads/{id}/handoff endpoint definition omits the '404' NOT_FOUND response. The LLD error table explicitly lists NOT_FOUND (404) when the lead does not exist or is soft-deleted, and the service correctly throws it (los-handoff.service.ts:118). The contract must declare all possible HTTP responses.

**Fix:** Add '"404": { $ref: "#/components/responses/NotFound" }' to the responses block of the /leads/{id}/handoff POST operation, alongside the existing 200/400/403/409/503 entries.

### MAJOR — `apps/web/src/components/los/ and apps/web/src/hooks/ and apps/web/e2e/los/`

All frontend deliverables specified in the FR-081 LLD File Locations section are absent: HandoffActionPanel.tsx, GuardChecklist.tsx, HandoffStatusPanel.tsx, use-handoff.ts, and the Playwright E2E spec (fr-081-handoff.spec.ts). No FR-081 tag appears in any web file. LosStatusTimeline.tsx exists but belongs to FR-082. UI test cases UI-01 through UI-08 cannot be verified.

**Fix:** Implement the missing frontend files per the LLD UI Component Tree: HandoffActionPanel (with GuardChecklist, ConfirmDialog, mutation hook), HandoffStatusPanel (LOS App ID display with MaskedField for DPO scope), use-handoff.ts (useMutation wrapping apiClient.post with Idempotency-Key generation), and the Playwright E2E spec for UI-01 through UI-08. Tag all files with FR-081.

### MAJOR — `apps/api/src/modules/los/los-handoff.service.spec.ts`

Test cases T06 (KYC_EXCEPTION_OPEN → CONFLICT 409) and T07 (DUPLICATE_BLOCKED → CONFLICT 409) are absent. The spec header only defers T01/T03/T04/T18/T19/T20, so T06 and T07 are required unit tests. These are also the cases that expose the BLOCKER error-code mismatch in finding #1.

**Fix:** Add two unit tests in the LosHandoffService describe block: one with guardResult: { failed: ['kyc_signoff'] } asserting DomainException with code ERROR_CODES.CONFLICT and detail.reason='KYC_EXCEPTION_OPEN'; one with guardResult: { failed: ['duplicate_clear'] } asserting code=CONFLICT and detail.reason='DUPLICATE_BLOCKED'. These tests will fail until finding #1 is fixed.

### MINOR — `apps/api/src/modules/los/los-handoff.service.spec.ts:516-533`

The 'emits LEAD_HANDED_OFF outbox event with aggregate_type=Lead per CORRECTIONS' test does not assert anything meaningful — expect(capturedEmitCalls).toBeDefined() is trivially true. The comment acknowledges that LEAD_HANDED_OFF is actually emitted from LeadService.markHandedOff (mocked), so the service-level outbox.emit call is never invoked on the success path, and the test body captures no real HANDOFF_FAILED events in the happy-path scenario either.

**Fix:** Either remove the test (the assertion is already covered in the LeadService.markHandedOff sub-suite at line 589) or refactor it to spy on the mocked leadService.markHandedOff call and assert it was called with expect.objectContaining({ event_code: EventCode.LEAD_HANDED_OFF }) as an indirect proxy — making the intent explicit.


## Test coverage

Unit tests (los-handoff.service.spec.ts): 14 tests across LosHandoffService and LeadService.markHandedOff describe blocks. The following spec cases from FR-081-tests.md are covered at unit level: T02 (idempotent replay), T05 (CONSENT_MISSING), T08/T09/T10 (STAGE_GUARD_FAILED), T11 (UPSTREAM_UNAVAILABLE), T13 (pending-key replay), T14 (UoW rollback), T15 (optimistic lock), T16 (kyc_status=waived), T17 (duplicate_status=linked), plus LeadService.markHandedOff happy path and 0-rows CONFLICT. Missing: T06 (KYC_EXCEPTION_OPEN → 409) and T07 (DUPLICATE_BLOCKED → 409) — both required. Deferred per manifest comment: T01/T03/T04/T18/T19 (API integration) and T20 (E2E). Integration tests: apps/api/test/integration/los-idempotency.e2e-spec.ts covers the DB-level idempotency_key unique index (§14.7) but is tagged FR-082, not a full FR-081 handoff flow. Frontend: all 8 Playwright E2E scenarios (UI-01 through UI-08) are absent — the spec file does not exist. SQL invariant queries INV-01 through INV-10 are defined in FR-081-tests.md but no test harness executes them as part of the FR-081 suite.
