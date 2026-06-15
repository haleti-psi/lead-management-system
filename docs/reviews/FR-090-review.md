# FR-090 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-090 Partner Master CRUD is largely correct in auth/ABAC, owner-writes, query safety, masking format, error taxonomy, and state machine enforcement. Three issues prevent approval: (1) the `OutboxService.emit` call mandated by the LLD for `PARTNER_CREATED` is entirely missing from `PartnerService.create`; (2) `MaskingService` is bypassed in favour of a locally duplicated function, violating the shared-utilities contract; (3) both the API-level test file (`partner.e2e-spec.ts`) and the UI unit test file (`PartnerForm.test.tsx`) are absent, leaving 14 API test cases and 5 UI test scenarios unimplemented.

## Findings

### BLOCKER — `apps/api/src/modules/partner/partner.service.ts:108-143`

OutboxService.emit is never called in PartnerService.create. The LLD backend flow step 6c and transaction boundary both mandate `OutboxService.emit({ event: 'PARTNER_CREATED', payload: { partnerId } }, tx)` inside the UnitOfWork run, making the insert + audit + outbox atomic. The service imports only AuditAppender and UnitOfWork — OutboxService is absent from the imports and the constructor. The PARTNER_CREATED event is never emitted.

**Fix:** Inject OutboxService into PartnerService constructor. Inside the UnitOfWork.run callback in create(), after AuditAppender.append, add: `await this.outbox.emit({ event_code: 'PARTNER_CREATED', aggregate_type: 'partner', aggregate_id: created.partner_id, payload: { partnerId: created.partner_id } }, tx);`. Add OutboxService to the module providers/imports as needed.

### MAJOR — `apps/api/src/modules/partner/partner.service.ts:271-274`

The service defines a local private `maskMobile()` function instead of injecting and using the shared `MaskingService` (core/masking/). `shared-utilities.md` states: 'Agents MUST reuse these — never recreate.' This creates a duplicated masking implementation that can diverge from the canonical masker (e.g., if the masking format is updated centrally). The same local function is also used in sanitize() for the audit chain.

**Fix:** Remove the local `maskMobile()` and `sanitize()` helpers. Inject `MaskingService` into `PartnerService`. Call `this.masking.maskField(mobile, 'mobile')` (or equivalent public API on MaskingService) where maskMobile() is currently used in toView() and sanitize().

### MAJOR — `apps/api/test/partner/partner.e2e-spec.ts`

File does not exist. The LLD specifies 14 API-layer test cases (TC-01 through TC-14) including happy paths for all three endpoints, all auth/authz paths (AUTH_REQUIRED, FORBIDDEN, BM branch scope), all error codes (CONFLICT, VALIDATION_ERROR, NOT_FOUND), masking verification, and the state machine transitions. These are Testcontainers/supertest integration tests — they are not covered by the project-wide e2e deferral.

**Fix:** Create `apps/api/test/partner/partner.e2e-spec.ts` implementing TC-01 through TC-14 as specified in `docs/lld/FR-090-tests.md`. Minimum 14 cases covering all paths listed in the coverage checklist.

### MAJOR — `apps/web/src/components/partner/PartnerForm.test.tsx`

File does not exist. The LLD specifies 5 UI unit test scenarios (UI-01 through UI-05) covering: create form render, edit form with immutable fields disabled, inline validation error display, ConfirmDialog for status change, and masked mobile display in the DataTable row. These are Vitest + Testing Library tests and are required per the test spec.

**Fix:** Create `apps/web/src/components/partner/PartnerForm.test.tsx` implementing UI-01 through UI-05 as specified in `docs/lld/FR-090-tests.md`.

### MINOR — `apps/api/src/modules/partner/partner.service.spec.ts:178-182`

Test U-05 ('rejects suspension without statusReason') is placed in the `Partner DTOs` suite and only exercises Zod DTO.safeParse, not PartnerService.update. The spec requires U-05 in the `PartnerService.update` suite. More importantly, the service itself does not independently validate that statusReason is present when suspending/expiring — it relies entirely on the DTO guard. If the service is called programmatically (e.g., from a future internal migration path), a suspend without statusReason would silently produce an audit record without a reason field.

**Fix:** Add an explicit guard inside PartnerService.update after the status transition check: `if (statusChanging && STATUS_REASON_REQUIRED.has(dto.status as PartnerStatus) && !dto.statusReason) { throw new DomainException(ERROR_CODES.VALIDATION_ERROR, ..., { fields: [{ field: 'statusReason', issue: '...' }] }); }`. Add a corresponding service-level unit test in the `PartnerService.update` describe block.

### MINOR — `apps/web/src/components/partner/PartnerForm.tsx:114-115`

The edit form's `editSchema` does not validate that `statusReason` is required when `status` is changed to `suspended` or `expired`. The server enforces this, but the client-side Zod schema has no `superRefine` equivalent, so users see no inline field error until the server rejects the request. The LLD specifies that ConfirmDialog captures statusReason before submitting (UI-04), but the form schema does not enforce it.

**Fix:** Add a `.superRefine` to `editSchema` checking: if `status` is `suspended` or `expired` and `statusReason` is empty/blank, add a Zod issue on path `['statusReason']`. This matches the existing server-side DTO behaviour and prevents a round-trip rejection.


## Test coverage

Unit service spec (partner.service.spec.ts) exists and covers U-01 through U-06 and the masking audit check (U-07 inlined in U-01). However, `apps/api/test/partner/partner.e2e-spec.ts` (TC-01–TC-14, all 14 API-layer test cases) does not exist. `apps/web/src/components/partner/PartnerForm.test.tsx` (UI-01–UI-05) does not exist. Playwright e2e spec (`apps/web/e2e/partner-management.spec.ts`) also absent, though e2e is project-wide deferred. The API-level tests (TC-01–TC-14) are Testcontainers/supertest tier and are not covered by the e2e deferral.
