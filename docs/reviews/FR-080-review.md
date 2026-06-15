# FR-080 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-080 (Eligibility Request & Read-Only Snapshot) is substantially correct in auth/ABAC, error codes, owner-writes, PII/masking, Kysely-only queries, and UI read-only invariants. However, three issues warrant rejection: (1) the service-layer defensive scope re-check (LLD step 6 — verify owner_id/branch_id against the authenticated user's scope) is entirely absent from EligibilityService, leaving a gap between AbacGuard resolution (which fires before the lead is loaded) and the actual lead row; (2) the repository contains an unsafe `as unknown as never` cast on the `conditions` field that circumvents the type system instead of using the correct Kysely JSONB typing; (3) the unit test suite is missing the T02 (LOS timeout → pending snapshot returned) scenario, which is the critical non-error path specified in the test contract. The api-contract.yaml entry for POST /leads/{id}/eligibility also omits the 401 and 404 response codes that the LLD specifies, though this is a spec-artefact gap, not a code defect.

## Findings

### MAJOR — `apps/api/src/modules/los/eligibility.service.ts:93-116`

The service-layer defensive scope re-check (LLD §Backend Flow step 6) is absent. The LLD requires verifying that the loaded lead's owner_id (RM path) or branch_id (BM/KYC path) matches the authenticated user after the lead is fetched from the DB. AbacGuard fires before the lead row is loaded (it receives only the path id), so there is a window where a stale or misconfigured ABAC decision could be followed by processing a lead outside the caller's scope. The lead's owner_id and branch_id are selected (lines 104–105) but never compared against user.userId or user.branchId.

**Fix:** After the NOT_FOUND check (line 116), add an explicit scope assertion: for RM (scope O) verify lead.owner_id === user.userId; for BM/KYC (scope B) verify lead.branch_id === user.branchId. Throw DomainException(ERROR_CODES.FORBIDDEN) on mismatch. This mirrors the pattern used in other scoped services in this codebase.

### MAJOR — `apps/api/src/modules/los/eligibility.repository.ts:104`

`setValues.conditions = (update.conditions as unknown as never) ?? null;` is an unsound cast that bypasses TypeScript's type checker entirely. `as unknown as never` makes the value unerasably typed as `never`, which compiles only because `never` assignable to any position but provides zero type safety. This violates the no-`as any`/unsound-cast rule and hides the real issue: the Kysely Updateable type for a JSONB column accepts `unknown` or `JsonValue`, not `Record<string, unknown>`.

**Fix:** Remove the unsafe cast. Cast directly to the correct Kysely JSONB column type: `setValues.conditions = update.conditions as import('kysely').JSONColumnType<Record<string, unknown>> ?? null;` or widen the `EligibilitySnapshotUpdate.conditions` type to `unknown` to match the generated Kysely DB type for JSONB columns.

### MAJOR — `apps/api/src/modules/los/eligibility.service.spec.ts`

T02 (LOS timeout path: IntegrationGateway resolves with no throw but gateway returns a non-2xx or the gateway returns undefined/timeout sentinel, snapshot stays pending, pending snapshot is returned to caller with HTTP 200) has no unit test. The test contract (FR-080-tests.md) explicitly lists T02 as required and the coverage checklist marks it 'Yes'. The spec file covers T01 (success), T03 (5xx), T04/T07/T08/T11/T18/T19/T20 but nothing exercises the timeout branch at lines 370–371 of the service where `gatewayResult` is truthy but the status code is outside 2xx.

**Fix:** Add a unit test that mocks `integrationGateway.call` to resolve with `{ httpStatus: 408, body: {}, idempotent: false }` (or the sentinel value used by IntegrationGateway for timeout). Assert: result.status === 'pending'; eligibilityRepo.updateSnapshotStatus not called; outbox.emit not called; no exception thrown.

### MINOR — `docs/contracts/api-contract.yaml:217`

The api-contract.yaml entry for POST /leads/{id}/eligibility omits the 401 (AUTH_REQUIRED) and 404 (NOT_FOUND) response codes that the LLD §Error Cases table specifies. The contract entry has only: 200, 400, 403, 503. This diverges from the spec and will cause contract-validation tooling to flag legitimate 401/404 responses as undocumented.

**Fix:** Add `"401": { $ref: '#/components/responses/Unauthenticated' }` and `"404": { $ref: '#/components/responses/NotFound' }` to the responses map for POST /leads/{id}/eligibility, matching the LLD error table.

### MINOR — `apps/api/src/modules/los/eligibility.service.ts:273`

LeadService.recordEligibility(leadId, snap.eligibility_snapshot_id, tx) is called inside the UoW but the shared-utilities.md lists `recordEligibility` as a volatile derived-field mutator that takes NO `expectedVersion` and does NOT bump version. The call itself is correct in placement and signature. However, the function currently writes only an audit entry (no column update, because schema.sql has no eligibility_snapshot_ref column) — the AMBIGUITY.md note acknowledges this, but the recorded audit uses `actor_id: SYSTEM_ACTOR_ID` (line 908 of lead.service.ts) instead of the actual actorId, losing the per-user audit trail for this operation.

**Fix:** Pass the actual actorId (available as the `actorId` parameter that `recordEligibility` receives as `snapshotRef`'s caller context — or add an `actorId` parameter) instead of SYSTEM_ACTOR_ID so the audit entry is attributed to the triggering user. Update the AMBIGUITY.md note to reflect this attribution decision.


## Test coverage

Unit tests (eligibility.service.spec.ts): 12 cases covering T01, T03, T04, T07, T08, T11, T18, T19, T20 plus two extra regression cases (MAJOR-1 recordEligibility in UoW, MAJOR-2 null data_category consent). T02 (LOS timeout → pending snapshot) is absent — this is the only non-error happy path the spec calls out separately. Frontend unit tests (EligibilityCard.test.tsx): T22–T26 fully covered plus failed-state retry. API integration e2e (apps/api/test/los/eligibility.e2e-spec.ts) and the eligibility-snapshot factory (apps/api/test/factories/eligibility-snapshot.factory.ts) referenced in FR-080-tests.md do not exist; no full API integration test covers T01–T21 against a real DB. E2E Playwright suite (apps/web/e2e/los-eligibility.spec.ts) also does not exist (project-wide e2e deferral is noted, so not a finding).
