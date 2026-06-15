# FR-070 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-070 implementation is functionally correct in its core business logic (upload phases, MIME inspection, scan callback, waiver, owner-writes via LeadService, LIMIT on list queries, parameterised Kysely, no `any`, no console.*, error codes match taxonomy). However, three significant issues prevent approval: the waiver endpoint is registered as POST where the LLD specifies PATCH; the internal scan-result webhook is absent from the auth-matrix service_to_service_only contract; and the entire API integration test suite (TC-008 through TC-021, 14 test cases) is missing — only unit tests exist. Additionally, TC-005's mock premise is wrong, meaning the role-code gate that actually blocks RM in production is not exercised by any test.

## Findings

### BLOCKER — `apps/api/src/modules/kyc/document.controller.ts:84`

Waiver endpoint is decorated @Post(':did/waive') but the LLD §Endpoint 3 and §Backend Flow unambiguously specifies PATCH /api/v1/leads/{id}/documents/{did}/waive. The frontend hook (apps/web/src/hooks/use-waive-document.ts:22) also calls apiClient.post(), consistent with the wrong HTTP verb. POST and PATCH have different idempotency semantics and REST conventions; the LLD's deliberate choice of PATCH (by analogy with PATCH /leads/{id}/kyc/{kid}/resolve) must be honoured.

**Fix:** Change @Post(':did/waive') to @Patch(':did/waive') in document.controller.ts and import Patch from @nestjs/common. Change apiClient.post to apiClient.patch in use-waive-document.ts line 22. Update the comment on line 13 of use-waive-document.ts from 'POST' to 'PATCH'.

### MAJOR — `docs/contracts/auth-matrix.json:81-88 (service_to_service_only array)`

POST /api/v1/internal/documents/{did}/scan-result is not listed in auth-matrix.json service_to_service_only and is absent from api-contract.yaml. Every other Cloud Tasks internal endpoint (sla/sweep, tasks/overdue-sweep, communications/dispatch, etc.) appears in service_to_service_only. The scan-result callback relies solely on ScanCallbackGuard HMAC verification at the application layer, but the contract is silent on its protection model, leaving future reviewers and security tooling without a declared security posture for this endpoint.

**Fix:** Add 'POST /api/v1/internal/documents/{did}/scan-result' to auth-matrix.json service_to_service_only. Add a corresponding entry to api-contract.yaml paths section (internal tag, @Public + ScanCallbackGuard noted in x-auth). Add an endpoint_auth_notes entry: 'HMAC-SHA256 of raw body verified by ScanCallbackGuard using VIRUS_SCAN_API_KEY; @Public — no user JWT'.

### MAJOR — `apps/api/test/ (file does not exist: apps/api/test/document.e2e-spec.ts)`

The FR-070-tests.md test specification defines 14 mandatory API integration tests (TC-008 through TC-021) targeting apps/api/test/document.e2e-spec.ts. That file does not exist. The testing-contract.md for Tier 3 requires all endpoints be covered at the integration layer (happy path + each error path). Missing tests include: authz scope rejection (TC-009), UNSUPPORTED_MEDIA (TC-011), PAYLOAD_TOO_LARGE (TC-012), VALIDATION_ERROR from checklist (TC-013), UPSTREAM_UNAVAILABLE on GCS failure (TC-014), transaction rollback (TC-015), waiver happy path and audit (TC-016), RM cannot waive (TC-017), customer upload path (TC-018), re-upload version increment (TC-019), infected scan callback (TC-020), rate limit (TC-021).

**Fix:** Create apps/api/test/document.e2e-spec.ts implementing TC-008 through TC-021 using Testcontainers-Postgres + Flyway migrations + GcsMockAdapter + VirusScanMockAdapter as specified in FR-070-tests.md. Each test case's setup, action, and assert clauses are fully specified in the test specification.

### MAJOR — `apps/api/src/modules/kyc/document.service.spec.ts:353-359 (TC-005)`

TC-005 tests that RM cannot waive by using build(false) which makes fakeEntitlements return granted:false for can(). In production, RM holds verify_doc:O in the capability matrix (auth-matrix.json line 25), so EntitlementService.can() returns granted:true for RM — the FORBIDDEN is correctly thrown by the subsequent !WAIVER_ROLE_CODES.has(ctx.role) check, not by can() returning false. The test exercises the !decision.granted branch but the production code takes the !WAIVER_ROLE_CODES.has(ctx.role) branch. If the role-code gate were removed and only the can() check remained, TC-005 would still pass (mock is hardcoded false) while RMs could waive in production.

**Fix:** Change the TC-005 setup to build(true) so that can() returns granted:true (matching production RM behavior). The test should then pass only because WAIVER_ROLE_CODES blocks RM, not because can() returns false. Add a complementary assertion that repo.waiveDocument was not called, confirming the correct gate was exercised.

### MINOR — `apps/api/src/modules/kyc/document.service.ts:329`

In confirmUpload the MIME mismatch check reads: if (doc.file_type && metadata.contentType && metadata.contentType !== doc.file_type). If GCS returns null for contentType (a valid GCS response for objects uploaded without a content-type), the condition short-circuits and no mismatch is detected, allowing any content through. The LLD §Validation states content-inspection must reject mismatches; a null GCS contentType is not a clean bill of health.

**Fix:** Treat a null or missing GCS contentType as a mismatch against any non-null declared type: replace the condition with if (doc.file_type && metadata.contentType !== doc.file_type) — removing the metadata.contentType truthy guard so that null contentType from GCS triggers rejection when the declared type is set.


## Test coverage

Unit tests (document.service.spec.ts, customer-document.controller.spec.ts) cover TC-001 through TC-007 and TC-020 analogue adequately. The required API integration test file apps/api/test/document.e2e-spec.ts does not exist — TC-008 through TC-021 are entirely absent. No Playwright E2E tests exist (apps/web/e2e/document-upload.spec.ts missing, but E2E is deferred project-wide). TC-005 passes for the wrong reason: it mocks EntitlementService.can as returning false for RM, but in production RM holds verify_doc:O so can() returns true — it is the WAIVER_ROLE_CODES role-code gate that blocks RM, not the can() result. The branch `!WAIVER_ROLE_CODES.has(ctx.role)` is never exercised by any test.
