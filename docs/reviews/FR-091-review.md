# FR-091 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-091 (Partner Lead Submission) is well-structured overall: auth/ABAC decorators are correct, owner-writes are honoured (CaptureService is the sole leads writer), the partner-active gate is properly implemented, partner-scope isolation is enforced in every query via `sa.partner_id = partnerId`, PII masking is applied server-side (raw name/mobile never sent to client), error codes are all from the taxonomy, no `any`/`console.*`/swallowed errors. Two MAJOR gaps require rejection: (1) `created_at` is absent from the `POST 201` response shape despite being explicit in the LLD contract, and (2) the e2e spec file listed in the LLD File Locations does not exist, leaving the majority of Tier-3 test cases unexecuted.

## Findings

### MAJOR — `apps/api/src/modules/partner/partner-lead.service.ts:19-29`

`PartnerLeadCreateView` omits `created_at`. The LLD §Endpoint 1 `POST /partners/leads` response example explicitly includes `"created_at": "2026-06-09T10:00:00.000Z"` (LLD line 126), making it a contractual field in the `201` body. Neither `PartnerLeadCreateView` nor the upstream `LeadCaptureData` (apps/api/src/modules/capture/capture.service.ts:76-90) carries this field, so it is silently absent from all create responses.

**Fix:** Add `created_at: Date` to `LeadCaptureData` in `capture.service.ts` (populate from the inserted `leads.created_at` row returned by `LeadService.create`), propagate it through `CreateLeadResult.data`, then add `created_at: Date` to `PartnerLeadCreateView` and include it in the return mapping in `partner-lead.service.ts` `submit()`.

### MAJOR — `apps/api/test/partner-lead.e2e-spec.ts (file does not exist)`

The LLD File Locations section lists `apps/api/test/partner-lead.e2e-spec.ts` as a required test file. The file is absent. FR-091-tests.md classifies T01–T09, T12–T18, T20, and T21 as `e2e API` or `unit/e2e` — covering happy path, all 6 error-taxonomy paths the FR raises, idempotency replay, transaction rollback, rate-limit, partner-scope isolation, PAN-timing, and pagination boundary. None of these are executed. Tier-3 testing contract requires ≥80% new-code coverage and 100% error-taxonomy path coverage.

**Fix:** Create `apps/api/test/partner-lead.e2e-spec.ts` implementing T01–T21 using Jest + Supertest + Testcontainers-Postgres as specified in FR-091-tests.md. Seed partners, product configs, and users in `beforeAll`; assert DB invariants Q1–Q7 after relevant tests. Use fault-injection (mock `OutboxService.emit` inside the tx) for T13 rollback verification.

### MINOR — `apps/web/src/components/partner/SubmitLeadForm.tsx:7-10`

Product code values are hardcoded locally as `['CV','CAR','TRACTOR','CE','TW','SBL','HRM']` and repeated in the Zod schema `z.enum([...])`. The shared-utilities contract states '`@shared/enums` — the **only** source of enum values for both apps; never redefine an enum locally.' If a product code is added to `ProductCode` in `packages/shared`, the form silently excludes it.

**Fix:** Replace the local array with `Object.values(ProductCode)` imported from `@lms/shared`, and replace `z.enum([...])` with `z.nativeEnum(ProductCode, ...)` to match the backend DTO pattern.

### MINOR — `apps/web/src/components/partner/SubmitLeadForm.tsx (no test file exists)`

FR-091-tests.md T22 requires a Vitest component test for `SubmitLeadDrawer`/`SubmitLeadForm` that verifies: invalid mobile shows inline field error via `EntityForm`, submit button is blocked until corrected, and no raw PII is rendered. No `.test.tsx` file exists for this component.

**Fix:** Create `apps/web/src/components/partner/SubmitLeadForm.test.tsx` with Vitest + @testing-library/react covering T22: render the form, submit with invalid mobile `'12345'`, assert inline error message appears, assert raw mobile never shown in DOM, assert submit is disabled.

### MINOR — `apps/web/src/components/partner/SubmitLeadForm.tsx:32-46`

LLD §UI Component Tree specifies a `ConfirmDialog (on submit)` within `SubmitLeadDrawer`. The `onSubmit` handler calls `submit.mutateAsync(...)` directly without showing a confirmation step. While not a security issue, this deviates from the specified UX flow and the `ConfirmDialog` usage pattern established elsewhere (e.g., `DlaRegistryDrawer`, `GrievanceResolutionForm`).

**Fix:** Add a confirmation step before calling `mutateAsync`: show a `ConfirmDialog` (following the pattern in `apps/web/src/components/compliance/DlaRegistryDrawer.tsx`) and only proceed on confirm. Update `PartnerLeadsPage.test.tsx` to cover the confirm step.


## Test coverage

Unit spec (`partner-lead.service.spec.ts`) covers 8 of the 23 specified test cases (T05/T06/T03 via undefined partner, T10 duplicate-stripping, T11 weak-dup/non-blocking, T19 DTO stripping, T21 source mapping, T16 list masking). The required e2e spec file is absent — T01, T02, T04, T07, T08, T09, T12, T13, T14, T15, T17, T18, T20 are entirely without test execution. The Vitest component test for `PartnerLeadsPage` exists and covers the list/empty-state/dialog-open scenarios. No test file exists for `SubmitLeadForm` (T22 uncovered). E2E Playwright specs (T23, UI scenarios) are deferred project-wide and acceptable per the testing contract note.
