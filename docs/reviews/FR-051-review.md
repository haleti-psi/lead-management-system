# FR-051 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-051 (Lead 360 View) is well-implemented overall: auth/ABAC wiring is correct, owner-writes are respected, all 10 repository queries are parameterised and LIMIT-bounded, PII tokens are never selected, masking is applied in-service before serialisation, error codes match the taxonomy, and test coverage addresses all 12 required test cases plus UI tests. Two findings prevent approval: one MAJOR (DPO audit blocks the response contrary to the fire-and-forget spec) and one MINOR (api-contract.yaml documents a 403 for this endpoint that is never emitted).

## Findings

### MAJOR — `apps/api/src/modules/workspace/lead360.service.ts:212`

The LLD §Auth Check 4 specifies the DPO audit as 'fire-and-forget; does not block response', but the implementation uses `await this.auditDpoView(...)` on line 212. This serialises every DPO Lead-360 response behind the audit write, adding latency proportional to the audit sink on every DPO request. If the sink is slow, DPO reads degrade. The auditDpoView method correctly catches and logs errors, so correctness is not broken — only the non-blocking contract is violated.

**Fix:** Remove the `await` on line 212 and use void to suppress the floating-promise lint: `if (isDpo) { void this.auditDpoView(user, leadId); }`. The inner try/catch in `auditDpoView` already handles sink failures without propagating them, so the response is unaffected whether the audit succeeds or fails.

### MINOR — `docs/contracts/api-contract.yaml:142`

The OpenAPI contract documents a `"403"` response for `GET /leads/{id}` (FR-051). The LLD §Error Cases explicitly states: 'FORBIDDEN (403) is not returned for this endpoint — existence is hidden via 404 (BRD §8.4 policy: out-of-scope lead → hide existence).' The implementation is correct (never emits 403), but the contract creates a false expectation for downstream consumers and generated SDK clients that may handle 403 as a distinct case.

**Fix:** Remove the `"403": { $ref: '#/components/responses/Forbidden' }` entry from the `GET /leads/{id}` response map in api-contract.yaml. The `404` entry already covers the out-of-scope case as specified by the LLD.


## Test coverage

All 12 named test cases from FR-051-tests.md are implemented. TC-051-01 through TC-051-11 are covered in lead360.service.spec.ts as service-level analogues (with the Testcontainers integration tier deferred project-wide per manifest). TC-051-12 (consent de-duplication) is a pure unit test implemented verbatim. The repository compile-level tests (lead360.repository.spec.ts) assert the SQL for scope-in-SQL, soft-delete filter, LIMIT bounds, and PII column exclusions for all 10 LLD queries. Controller metadata tests (lead360.controller.spec.ts) assert @Requires(VIEW_LEAD) with explicit resource resolver and absence of @Public(). DTO schema tests (lead360.dto.spec.ts) cover TC-051-05 validation. UI tests (Lead360View.test.tsx) cover UI-051-01 through UI-051-06. E2E tests (apps/web/e2e/lead360.spec.ts) exist per the file location list but were not reviewed (deferred project-wide). Coverage is adequate for Tier 2.
