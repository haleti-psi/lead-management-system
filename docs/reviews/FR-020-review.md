# FR-020 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-020 (Duplicate & Near-Duplicate Detection) is generally well-implemented: owner-writes respected (DuplicateService writes duplicate_matches, LeadService sole-writes leads), all Kysely queries are parameterised and LIMIT-capped (PER_KEY_CANDIDATE_LIMIT=10), no `any` types, no console.*, correct error taxonomy codes, PII-safe audit details (key names only, no raw values), masking delegated to the global interceptor, and all 30 test cases from FR-020-tests.md are covered (with guard/HTTP-layer tests marked deferred). One MAJOR spec conflict is found: the shared-utilities.md contract explicitly states recomputeDuplicateStatus takes NO expectedVersion, but both the LLD and the implementation add it as an optimistic lock — this gap was not flagged in AMBIGUITY.md and the two artefacts disagree. One MINOR issue: the api-contract.yaml entry for the endpoint omits 400/401/403/404 responses. The DUPLICATE_FLAGGED event code discrepancy noted in the LLD assumptions was resolved in code (the enum does exist as EventCode.DUPLICATE_FLAGGED in the shared enums), which is a positive deviation from the LLD's stated assumption.

## Findings

### MAJOR — `apps/api/src/modules/capture/lead.service.ts:502-549 and apps/api/src/modules/dedupe/dedupe.service.ts:537-543`

recomputeDuplicateStatus accepts an expectedVersion parameter and enforces an optimistic lock (WHERE version = :v) on the leads table. The authoritative shared-utilities.md contract explicitly states this mutator 'takes NO expectedVersion and does NOT bump version — system-managed volatile fields must not raise false 409s against concurrent human edits'. The LLD (FR-020.md §Step 4 and the Shared Utilities table) contradicts the contract by including expectedVersion. This conflict was not recorded in AMBIGUITY.md. The current implementation will emit CONFLICT (409) when a concurrent human edit increments leads.version between the fetch in findLeadContext and the recompute write, even when neither user is doing anything wrong — the exact false-409 scenario the contract prohibits.

**Fix:** Remove the expectedVersion parameter from recomputeDuplicateStatus and its WHERE version = :v clause, making the update unconditional (as setConsentStatus and setScore do). Update the call site in dedupe.service.ts to drop the lead.version argument and remove the merge-lead.service.ts call's expectedVersion argument. Update T21 in the test suite: it should no longer produce CONFLICT from a stale version on this path. Record this decision in AMBIGUITY.md and back-propagate to FR-020.md §Shared Utilities.

### MINOR — `docs/contracts/api-contract.yaml:169`

The POST /leads/{id}/duplicate-check contract entry lists only responses 200 and 409. The implementation correctly returns 400 (VALIDATION_ERROR), 401 (AUTH_REQUIRED), 403 (FORBIDDEN), and 404 (NOT_FOUND), all of which are specified in the LLD §Error Cases but absent from the api-contract entry. Downstream consumers (client codegen, integration tests) relying solely on the contract are unaware of these response codes.

**Fix:** Add the missing response codes to the api-contract.yaml entry: 400 ($ref ValidationError), 401 ($ref Unauthenticated), 403 ($ref Forbidden), 404 ($ref NotFound).

### MINOR — `apps/api/src/modules/dedupe/dedupe.service.ts:495-498 (comment) and docs/lld/FR-020.md §Assumptions (1)`

The LLD's Assumption 1 states that no dedicated DUPLICATE_FLAGGED event code exists and that the closest available code is LEAD_STAGE_CHANGED. The code actually uses EventCode.DUPLICATE_FLAGGED (which exists in the shared enums and the DB-generated types). The code is correct, but the LLD assumption is stale/incorrect and was not updated, leaving a misleading comment in the service that references a resolved ambiguity as if it were still open.

**Fix:** Remove the 'DUPLICATE_FLAGGED' comment reference to LEAD_STAGE_CHANGED from dedupe.service.ts:495 and update FR-020.md Assumption 1 to reflect that DUPLICATE_FLAGGED is a valid EventCode. This is a documentation fix only; the implementation is already correct.


## Test coverage

All 30 API/unit test cases (T01–T30) from FR-020-tests.md are implemented in dedupe.service.spec.ts and dedupe.controller.spec.ts. T18 (JwtAuthGuard 401) and T24 (full-HTTP masking) are addressed at the metadata/shape level with a documented deferral to the Testcontainers wave, consistent with the project-wide test strategy in manifest.json. SQL invariants INV-01 through INV-08 and UI test scenarios UI-T01 through UI-T05 are documented and deferred to the integration/E2E wave. Unit coverage for the scoring engine (T01–T10), scope predicates, service orchestration (T11–T29), port adapter (T30), Zod boundary (T16), post-commit scan, and module wiring is complete. No required test cases are missing for the unit/component tier.
