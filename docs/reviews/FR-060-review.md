# FR-060 — Stage 8 Per-FR Review

**Verdict:** APPROVE

> FR-060 (Secure Customer Action Link) is well-implemented and closely follows the LLD. Auth/ABAC is correct on all five endpoints. Owner-writes are respected: customer_links are only written by M7, documents by M8 (DocumentService), consent_records by M12 (ConsentService). Token security is sound (crypto.randomBytes(32), SHA-256 hash stored, raw token never persisted or logged). Error codes match error-taxonomy.md exactly. All Kysely queries are parameterised with LIMIT where applicable. No `any` types, no console.* calls, no silent error swallowing (the catch on line 165 logs a structured warn). Test coverage addresses the primary happy paths and negative cases, with the unit tests for CustomerLinkService, CustomerLinkGuard, OtpService, and CustomerLinkAdapter all exercising the required scenarios. Two minor findings are noted below.

## Findings

### MINOR — `apps/api/src/modules/self-service/customer-link.service.ts:156-168`

The post-commit try/catch wraps both otp.generateAndStore and notifier.send in a single block. If generateAndStore throws (e.g. Redis unavailable), the notifier is never called and no Cloud Tasks retry is enqueued — the link is created but completely inert (no OTP stored, no URL dispatched). The LLD retry path covers the notifier failure only; OTP generation failure is not separately handled.

**Fix:** Split into two try/catch blocks: first generate and store the OTP; if that fails log and return 201 (acceptable — the resend path will regenerate). Only if OTP generation succeeds, proceed to notifier.send with its own catch. This ensures the failure point is identifiable and the correct retry path is applied.

### MINOR — `apps/api/src/modules/self-service/customer-link.service.spec.ts (missing) and apps/api/src/modules/self-service/dto/create-customer-link.dto.ts`

No unit tests exist for CreateCustomerLinkDto validation (T-06: empty purpose array → VALIDATION_ERROR, T-07: invalid channel → VALIDATION_ERROR) or for the staff-endpoint JWT guard path (T-32: no JWT → 401, T-33: CUSTOMER role → 403). These are called out in the FR-060-tests.md coverage checklist.

**Fix:** Add a dto/create-customer-link.dto.spec.ts that parses invalid payloads through the Zod schema and asserts the correct field errors. Add a customer-link.controller.spec.ts that mounts the controller with a mock guard to assert 401/403 on missing/wrong role JWT.


## Test coverage

Service layer (customer-link.service.spec.ts): covers T-01 (create/revoke/audit/emit), T-02 (dispatch failure), T-03 (NOT_FOUND), T-05 (FORBIDDEN scope), T-08 (open+audit+display). Guard (customer-link.guard.spec.ts): covers T-09, T-10 (expire), T-11. OTP (otp.service.spec.ts): covers T-12 (happy), T-13 (wrong OTP), T-14 (rate limit), T-15 (null OTP). Adapter (customer-link.adapter.spec.ts): covers T-17/T-23 (no session), T-18/T-24 (wrong purpose), expired link. CustomerDocumentController.spec.ts covers T-16 and T-20 seam. Missing explicit controller-level tests for T-06/T-07 (DTO validation), T-32/T-33 (JWT guard on staff endpoint), and T-31 (idempotent open). E2E tests are deferred project-wide. SQL invariants are defined but not yet backed by integration-test harness runs. Coverage is adequate for a Tier-3 FR at this pipeline stage.
