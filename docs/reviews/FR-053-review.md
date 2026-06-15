# FR-053 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-053 (Role-Based Dashboard & Home) implementation is structurally sound — auth/ABAC wiring, scope filtering, org_id isolation, rate-limit, no owner-writes violations, parameterised Kysely queries with LIMIT, Redis cache pattern, widget degradation via Promise.allSettled, and frontend PII field usage are all correct. Two blockers prevent approval: (1) the integration_logs query uses an invalid enum literal 'los' against a typed PostgreSQL enum, which will throw at runtime and silently break the handoff_failures widget; (2) the required API integration test file (dashboard.e2e-spec.ts, mandated by Tier 2 testing-contract) is entirely absent — 13 of 14 test cases in the test spec have no implementation. Two additional minor issues: a vitest environment directive misplaced in a production component, and a non-strict full_name mask returning unmasked names for RM/BM/SM contrary to the LLD example output.

## Findings

### BLOCKER — `apps/api/src/modules/workspace/dashboard.repository.ts:277`

getHandoffFailures uses sql`il.integration = 'los'` but the integration_logs.integration column is typed as the PostgreSQL enum integration_kind whose valid values are ('los_eligibility','los_handoff','los_status','pan','ckyc',...). The literal 'los' is not a valid enum member. PostgreSQL will throw a cast error at runtime (or in some client configurations return 0 rows), making the handoff_failures widget always fail or always be empty.

**Fix:** Replace the raw SQL fragment with a parameterised Kysely expression covering the relevant LOS integration kinds, e.g. `.where('il.integration', 'in', ['los_handoff', 'los_eligibility', 'los_status'])`. If only failed hand-offs are intended, `'los_handoff'` alone is sufficient — confirm with the LLD owner which integration_kind values represent hand-off attempts.

### BLOCKER — `apps/api/test/dashboard.e2e-spec.ts (file missing)`

FR-053 is Tier 2 (Moderate). The testing-contract requires API integration tests covering all endpoint happy paths and every named error code the FR can raise. The LLD file-locations table lists apps/api/test/dashboard.e2e-spec.ts and the test spec defines 13 API integration test cases (TC-01 through TC-12, TC-14). The file does not exist at any path under apps/api/test/. The merge gate in testing-contract.md explicitly prohibits merging without these tests.

**Fix:** Create apps/api/test/dashboard.e2e-spec.ts using Jest + Supertest + Testcontainers-Postgres (already used by harness.e2e-spec.ts and retention.e2e-spec.ts). Implement at minimum: TC-01 (BM full widget set), TC-02 (RM scope isolation), TC-03/TC-04 (PARTNER/ADMIN 403), TC-05 (expired JWT 401), TC-06/TC-07 (validation errors), TC-08 (scope override 403), TC-09 (widget degradation still 200), TC-12 (cache hit flag), TC-14 (empty state). The 14th case TC-13 (Redis unavailable) is a unit test already covered.

### MAJOR — `apps/api/src/modules/workspace/dashboard.service.ts:85`

Masking strictness is derived from user.scope (JWT claim) — `user.scope === DataScope.M` — rather than from the entitlement object already loaded by resolveScope (line 140). The JWT scope claim can be stale if a DPO's entitlement changes between JWT issuance and the dashboard request, causing incorrect masking decisions. The correct source of truth is the entitlement loaded from the cache.

**Fix:** Resolve scope from the entitlement inside resolveScope and propagate it via DashboardScopeContext (add a `strict: boolean` or `dataScope: DataScope` field). In getWidgets, derive `const strict = ctx.dataScope === DataScope.M` rather than reading user.scope directly.

### MAJOR — `apps/api/src/modules/workspace/dashboard.service.spec.ts:288`

The test asserts hl[0].name_masked === 'Ramesh Kumar' (fully unmasked) for BM scope with comment 'partial: full_name not strict'. MaskingService.mask('full_name', value, { strict: false }) returns the raw unmasked name. The LLD response example at line 99 shows name_masked: 'Am***** P****' for a BM user, implying partial masking should occur. This discrepancy means RM/BM/SM users receive the full unmasked name of other people's leads in the hot_leads widget, contrary to PII masking intent described in the LLD.

**Fix:** Decide and document whether partial name masking (e.g. first name only, or initial masking) should apply to non-DPO scopes. If it should, update MaskingService.mask('full_name', ...) non-strict branch to apply a partial mask (e.g. show first name + masked surname), and update the test assertion to match. If not, update the LLD example to show the unmasked name, and add a comment in the service explaining the deliberate non-masking.

### MINOR — `apps/web/src/components/dashboard/WidgetErrorState.tsx:1`

The production component file begins with `// @vitest-environment jsdom`. This directive is only meaningful in Vitest test files; in a production .tsx component it has no effect but misleads readers into thinking this is a test file and may cause confusion when the file is processed by the build tool.

**Fix:** Remove the `// @vitest-environment jsdom` line from WidgetErrorState.tsx (and from any other production component files that incorrectly contain this directive).

### MINOR — `apps/api/src/modules/workspace/dashboard.service.spec.ts:362,379,395,411,428`

Five occurrences of `const qb: any` in the applyScopeToLeads mock query builder tests, each suppressed with eslint-disable-next-line. The project guidelines state no `any` as non-negotiable. While test-file mock builders are the most pragmatic place to use them, the Kysely SelectQueryBuilder type is available and could be used with appropriate generics to avoid the any.

**Fix:** Type the mock query builder more precisely using Kysely's SelectQueryBuilder generic type or a local interface `interface MockQb { where(...args: unknown[]): MockQb }` and return that type, eliminating the need for `any` and the suppression comments.


## Test coverage

Unit tests (dashboard.service.spec.ts): present and cover resolveScope (O/B/T/A/FORBIDDEN overrides), getWidgets (allSettled degradation, cache hit/miss, Redis fallback, masking, strict/non-strict), DTO schema validation, and applyScopeToLeads predicate helper — meets the unit test requirements of the test spec. Frontend unit tests (DashboardPage.test.tsx): present and cover all 8 required UI scenarios (loading, empty, widget error, PII masking, role visibility, drill-through links, low-bandwidth table, error state). API integration tests (dashboard.e2e-spec.ts): MISSING — file does not exist at apps/api/test/dashboard.e2e-spec.ts or apps/api/test/integration/. TC-01 through TC-12 and TC-14 (13 tests) are unimplemented. Playwright e2e absent project-wide (deferred). Overall: unit coverage is good; mandatory API integration layer is absent.
