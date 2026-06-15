# FR-054 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-054 (Global Search) is structurally sound: auth/ABAC decorators are correct and tested, all queries are Kysely-parameterised with LIMIT 5, PII masking (mobile always, name strict for DPO) is correctly delegated to MaskingService, no writes or audit side-effects exist, and no `any` casts or console.* calls appear in production code. Three defects prevent approval: a code-spec divergence on PAN token lookup (raw string compared against a tokenised column without the required log warning), a missing logger.error assertion in the T17 degradation test, and under-specified responses in api-contract.yaml for the /search endpoint.

## Findings

### MAJOR — `apps/api/src/modules/workspace/repositories/lead-search.repository.ts:71`

PAN token lookup compares the raw PAN string `q` directly against `li.pan_token`, which stores a tokenised (not raw) value. This means PAN searches always silently return zero matches — a functional failure. The LLD (Ambiguity 3) explicitly states the service must tokenise the input before lookup, or skip the PAN lookup with a warning log when no PanTokenService is available. Neither is done: the comparison is made (futilely) and no warning is logged, leaving the divergence invisible.

**Fix:** Resolve LLD Ambiguity 3 before shipping. If a PanTokenService exists (M2/M8), inject it and call `panTokenService.tokenise(q)` before the `pan_token =` predicate. If no such utility is yet registered in shared-utilities.md, remove the `pan_token` predicate branch and add `this.logger.warn({ userId }, 'PAN search skipped: PanTokenService not registered')` when `isPan` is true. Update shared-utilities.md once the utility is added.

### MINOR — `apps/api/src/modules/workspace/search.service.spec.ts:152-160`

Test T17 (graceful degradation) only asserts that `result.leads` is empty when the lead repo rejects. It does not assert that `logger.error` was called (the LLD flow step 6e says 'log at error level with correlation_id'), and it does not cover the partner or task sub-query failure paths independently. The logger mock exists in `makeMockLogger()` but is never captured or referenced in the T17 describe block.

**Fix:** Capture the logger from `makeService` (return it alongside the service or expose it), then add `expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), 'lead search sub-query failed')` in the T17 test. Add two analogous tests for partner and task repo failures.

### MINOR — `docs/contracts/api-contract.yaml:184`

The /search GET entry only declares `200` and `429` responses. The LLD specifies that `400 VALIDATION_ERROR`, `401 AUTH_REQUIRED`, and `403 FORBIDDEN` are also valid outcomes. Any consumer generating a client from this contract will not know to handle those status codes.

**Fix:** Add `"400": { $ref: '#/components/responses/ValidationError' }`, `"401": { $ref: '#/components/responses/Unauthenticated' }`, and `"403": { $ref: '#/components/responses/Forbidden' }` to the /search responses block, consistent with how other protected endpoints are documented.

### MINOR — `apps/api/src/modules/workspace/repositories/task-search.repository.ts:53`

The task query filters only on `t.org_id = orgId` but does NOT add `l.org_id = orgId` on the joined `leads` table. In a correctly partitioned schema this is safe because `INNER JOIN leads ON l.lead_id = t.lead_id` and tasks already carry `org_id`, but if a data-integrity bug ever created a cross-org task reference, deleted leads from another org could leak. The lead-search repo and LLD conceptual SQL both apply `l.org_id = :orgId` explicitly.

**Fix:** Add `.where('l.org_id', '=', orgId)` after the `innerJoin` on leads, matching the pattern in `lead-search.repository.ts` and the LLD SQL shape.


## Test coverage

Unit tests cover masking (T14/T15/T21), empty results (T16), all-buckets populated, topN value, and partial sub-query failure for the lead bucket only (T17). DTO schema tests cover T10/T11/T12/T20/T22. UI component tests cover E01-E03/E06-E08 plus loading and generic error states. Gaps: T17 does not assert logger.error is called; T17 does not exercise partner or task sub-query failure paths independently; no API integration (supertest) tests for T01-T23 (search.e2e-spec.ts listed in LLD is absent). E2E Playwright tests (E01-E10) are absent (consistent with project-wide deferral noted in SearchPalette.test.tsx).
