# FR-101 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-101 has two blockers that break the API response shape and cause a runtime crash in the UI. The list handlers return a custom envelope that the global ResponseEnvelopeInterceptor double-wraps, and the API nulls out the recipient field while the UI component still tries to string-slice it. Additionally, an empty catch swallows errors in the async dispatch path, and the entire API integration test layer (T01-T14, T16, T18-T20) is absent — only unit specs exist.

## Findings

### BLOCKER — `apps/api/src/modules/engagement/communication.controller.ts:61-64 and apps/api/src/modules/engagement/template.service.ts:37-40 (via template.controller.ts)`

Both list handlers return { data, meta: { page, limit, total } } without an 'error' key. ResponseEnvelopeInterceptor.isEnvelope() requires 'data' AND 'meta' AND 'error' to be present; without 'error', isEnvelope returns false and isPaginated also returns false (no 'pagination' key), so the interceptor wraps the object as a plain payload, producing double-wrapped data: { data: { data: [...], meta: {...} }, meta: { correlation_id }, error: null }. Every other list controller in the codebase uses the paginated() helper from core/http.

**Fix:** Import paginated from '../../core/http' and return paginated(rows, { page, limit, total }) in both list handlers, matching the pattern used by every other list endpoint (e.g., admin-roles.controller.ts:44, consent.controller.ts:55).

### BLOCKER — `apps/api/src/modules/engagement/communication.controller.ts:56-59 and apps/web/src/features/leads/detail/CommunicationHistory.tsx:90`

The API list handler strips recipient to null (lines 56-59), but CommLogDto in use-communications.ts types recipient as string (not string | null). CommunicationHistory.tsx then calls maskRecipient(r.channel, r.recipient) where r.recipient is null at runtime, causing maskMobile(null) / null.slice(0,2) to throw a TypeError. The LLD specifies the API returns the masked value (via MaskedField), not null. The API should return the masked string; the UI should not re-mask.

**Fix:** Apply masking in the API using MaskingService (from core/masking/) before returning — return rows with recipient replaced by maskingService.maskRecipient(channel, recipient). Update CommLogDto.recipient to string (always pre-masked from API). Remove the client-side maskRecipient call from CommunicationHistory.tsx and render r.recipient directly. Alternatively, keep null and update CommLogDto to recipient: string | null with a null-guard in CommunicationHistory.

### MAJOR — `apps/api/src/modules/engagement/notification-dispatch.service.ts:227-229`

Bare empty catch: .catch(() => { }) silently swallows errors from the commRepo.updateStatus() call in the dispatchAsync error handler. If the status update itself fails, the failure is discarded with no log, violating the no-swallowed-errors rule (global CLAUDE.md §7). The worker implementation (dispatch-communication.worker.ts:90-96) correctly logs on failure.

**Fix:** Replace .catch(() => { }) with .catch((updateErr: unknown) => { this.logger.error({ communication_log_id: logId, updateErr }, 'FR-101 dispatchAsync: failed to update log to failed status'); }) to match the worker's pattern.

### MAJOR — `apps/api/test/integration/ (no template.e2e-spec.ts or communication.e2e-spec.ts)`

The FR-101-tests.md test spec designates T01-T14, T16, T18-T20 as 'API (e2e-spec)' layer tests using Testcontainers-Postgres. None of these files exist. Only unit specs (template.service.spec.ts, notification-dispatch.service.spec.ts, dispatch-communication.worker.spec.ts) are present. The missing API integration tests include all auth/ABAC tests (T04-T07), consent gate tests (T08-T09) at API level, pagination enforcement (T18-T19), rate limiting (T20), and masking in the real HTTP response (T16).

**Fix:** Create apps/api/test/integration/template.e2e-spec.ts and communication.e2e-spec.ts implementing T01-T14, T16, T18-T20 with Testcontainers-Postgres following the harness pattern in harness.e2e-spec.ts.

### MINOR — `apps/web/src/features/leads/detail/CommunicationHistory.test.tsx:45 (UI-04 test)`

T16/UI-04 test fixture sets recipient: '9876543210' as a string in CommLogDto, but the real API will return null (stripped by the controller). The test passes because it mocks useCommunicationLogs with a raw string, never exercising the actual API contract. This means T16 validates the masking logic in isolation but not the end-to-end masking behavior.

**Fix:** Once the API masking fix (finding #2) is applied, update the test fixture to use the pre-masked value returned by the API, or if the API returns null, update CommLogDto and the test to use null with appropriate null-guard rendering.

### MINOR — `apps/api/src/modules/engagement/template.controller.ts:22 and docs/lld/FR-101.md:185`

The LLD states 'Only ADMIN (scope A) has configuration capability' for template management. However, auth-matrix.json explicitly grants BM: configuration=B, KYC: configuration=B, DPO: configuration=B, HEAD: configuration=A. The @Requires(Capability.CONFIGURATION) decorator per the authoritative auth-matrix allows BM/KYC/HEAD users to reach POST /admin/templates. The resource_governance also marks communication_templates writer as M14 (maker-checker), not M11. The implementation follows the auth-matrix correctly, but the LLD text misstates the intended restriction.

**Fix:** Clarify the LLD: if BM/KYC/HEAD should be blocked, add a role-level guard in TemplateController requiring ADMIN specifically (e.g., check caller.role === RoleCode.ADMIN and throw FORBIDDEN). If the auth-matrix intent is correct (BM/KYC can create draft templates), update the LLD §Auth Check to reflect this.


## Test coverage

Unit coverage is adequate for the service layer (TemplateService, NotificationDispatchService, DispatchCommunicationWorker, UI Vitest components). API integration tests (Testcontainers layer) covering T01-T14, T16, T18-T20 are entirely absent — this is the tier the test spec explicitly requires for all happy-path and error-path scenarios. The worker T15 test passes. UI-01 through UI-04 tests are present and correct modulo the recipient masking contract issue noted in finding #5. E2E Playwright tests are marked deferred project-wide and not evaluated.
