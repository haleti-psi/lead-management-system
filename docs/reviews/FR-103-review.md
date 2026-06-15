# FR-103 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-103 implementation is structurally sound: auth/ABAC decorators are correct, owner-writes are respected, Kysely queries are parameterised with LIMIT, error codes are from the taxonomy, and the UnitOfWork batch-upsert-plus-audit pattern is implemented correctly. However four real issues require rejection: the customer-link controller returns NOT_FOUND (404) where the test spec mandates FORBIDDEN (403) for expired tokens; the CustomerPreferenceCentre frontend reads warnings from the wrong field in the response envelope, silently dropping all transactional opt-out warnings; the mandated API integration e2e test file is absent entirely; and `updated_at` uses `new Date()` (app clock) instead of `sql\`now()\`` (DB clock) on conflict-update, deviating from the LLD spec.

## Findings

### MAJOR — `apps/api/src/modules/engagement/customer-preference.controller.ts:81`

Expired/revoked/used customer-link token returns NOT_FOUND (404) but the LLD error table (FR-103.md §Error Cases) and test spec T07 both require FORBIDDEN (403). The controller comment justifies 404 as 'existence hidden per BRD §8.6', but §8.6 applies to resources whose existence is sensitive; a customer using their own link should receive FORBIDDEN. The controller spec test at line 347 also asserts NOT_FOUND, meaning the test validates the wrong behaviour.

**Fix:** Throw DomainException(ERROR_CODES.FORBIDDEN) when resolveForConsent returns null, consistent with the LLD error table, T07, and the LLD auth-flow step 2 ('Token must exist … Fails → FORBIDDEN (403)'). Update the controller spec assertion at line 347 to expect FORBIDDEN.

### MAJOR — `apps/web/src/components/self-service/CustomerPreferenceCentre.tsx:26,122`

UpsertCustomerPreferencesResponse interface places `warnings` at the top level of the response object (line 26), and the onSuccess handler reads `res.warnings ?? []` (line 122). The actual API envelope places warnings inside `meta.warnings` (per api-contract.yaml and the internal PreferenceCentre.tsx which correctly reads `res.meta?.warnings`). As a result transactional opt-out warnings (e.g. KYC/document_processing opt-outs) are silently dropped in the customer self-service panel — the warning state is always set to [], breaking the spec requirement (LLD §Validation Logic; T14; E2E-03).

**Fix:** Add `meta?: { correlation_id?: string; warnings?: Array<{ field: string; message: string }> }` and `error: null` to UpsertCustomerPreferencesResponse. Change line 122 from `res.warnings ?? []` to `res.meta?.warnings ?? []`.

### MAJOR — `apps/api/test/preference.e2e-spec.ts (absent)`

The LLD file-locations table lists `apps/api/test/preference.e2e-spec.ts` as the API integration test file covering T01–T16 (16 scenarios). This file does not exist. The `apps/api/test/` directory contains only `integration/`, `jest-e2e.json`, and `setup-env.ts`. No integration/component-level tests exist for the HTTP layer (auth, scope enforcement, rate limiting, batch atomicity). The unit tests in preference.service.spec.ts and preference.controller.spec.ts do not substitute for these — they mock all HTTP concerns. The testing-contract requires integration-tier tests per FR Tier 2.

**Fix:** Create `apps/api/test/preference.e2e-spec.ts` covering at minimum T01 (BM happy path), T05 (AUTH_REQUIRED), T06 (FORBIDDEN scope), T09–T13 (VALIDATION_ERROR cases), and T14 (transactional warning in meta). Use the Testcontainers harness already present in `apps/api/test/integration/harness.e2e-spec.ts`.

### MINOR — `apps/api/src/modules/engagement/preference.repository.ts:57`

The conflict-update path sets `updated_at: new Date()` (application server clock). The LLD's upsert pseudocode specifies `updated_at: sql\`now()\`` (database clock). Using the JS Date on the app server can produce skewed timestamps when the app server and DB server clocks differ, and is inconsistent with the pattern used elsewhere in the codebase.

**Fix:** Replace `updated_at: new Date()` with `updated_at: sql\`now()\`` (import `sql` from kysely). This ensures the timestamp is set by the database transaction clock, consistent with the LLD and other upsert patterns in the project.

### MINOR — `apps/api/src/modules/engagement/preference.service.ts:120`

`subject_ref` (which holds a `customer_profile_id` UUID) is logged at INFO level in the structured log object. While it is not human-readable PII (no name/mobile/email), `customer_profile_id` is the direct identifier for a specific customer record in the system and can be used to trace an individual. The security guidelines prohibit logging PII field values even at debug level, and the audit comment in the same file notes 'subject_ref is a UUID — no PII value is logged' — the same reasoning used to justify including it in audit detail but the log line also includes it outside the audit system.

**Fix:** Remove `subject_ref` from the logger.info structured object at line 120. Log only `subject_type` and `count` (non-identifying fields) to keep the operational log compliant with the PII policy.

### MINOR — `apps/api/src/modules/engagement/preference.repository.ts:69,96`

`as PreferenceRow` (line 69) and `as PreferenceRow[]` (line 96) casts bypass TypeScript's type narrowing of Kysely's return type. The guidelines prohibit unsafe casts. These are not `as any` but they suppress any type mismatch between Kysely's generated types and the local PreferenceRow interface if column selection diverges.

**Fix:** Remove the `as PreferenceRow` / `as PreferenceRow[]` casts. Either align the `.select([...])` columns precisely with the PreferenceRow interface fields so Kysely infers the correct type, or use `satisfies PreferenceRow` if an assertion is needed for narrowing. The `returning([...])` and `select([...])` already enumerate exactly the five PreferenceRow fields so the inferred type should match without a cast.


## Test coverage

Unit tests (preference.service.spec.ts): T17, T18, T19, T14, and audit/PII coverage — all present and substantive. Controller tests (preference.controller.spec.ts): envelope shape, scope resolver, null-customerProfileId, subject_ref mismatch, NOT_FOUND token — present. Frontend tests (PreferenceCentre.test.tsx): T20, T21, T22, T14 (pre-save warning), loading/error states — all present. Missing: the entire API integration test file (T01–T16) is absent; T07 is tested in the controller spec but against the wrong error code (NOT_FOUND instead of FORBIDDEN).
