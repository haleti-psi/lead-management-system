# FR-140 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-140 implementation is largely correct — auth guards, owner-writes, PII masking, query LIMIT enforcement, Kysely parameterisation, and circuit-breaker/retry logic all match the spec. However, three concrete defects require rejection: (1) the idempotent-replay response for POST /admin/webhooks omits the required `error` object entirely, contradicting the LLD and error-taxonomy `IDEMPOTENT_REPLAY` contract; (2) the `@Requires` decorator is applied redundantly at class level (without a scope resolver) AND at each method level (with a resolver), meaning the AbacGuard sees the class-level metadata first via `getAllAndOverride` when the Reflector iterates handler before class — the method-level annotation wins, but the class-level orphan annotation is misleading and could cause guard misfires in future edits; (3) the e2e spec file listed in the LLD File Locations (`apps/api/test/integration-monitor.e2e-spec.ts`) does not exist, leaving API-tier test cases T16–T32 (happy paths, auth negatives, pagination, sort, rate-limit) uncovered at any tier.

## Findings

### BLOCKER — `apps/api/src/modules/integration/integration.controller.ts:97-106`

Idempotent replay response shape violates the LLD contract and error-taxonomy. LLD §Endpoints 3 states: HTTP 200 replay must set `error: { code: 'CONFLICT', message: 'Idempotent replay.', retryable: false, detail: { reason: 'IDEMPOTENT_REPLAY' } }`. The implementation returns `error: null` instead, placing `reason: 'IDEMPOTENT_REPLAY'` in `meta`. This diverges from the canonical envelope spec and the test expectation in T25 (`error.detail.reason='IDEMPOTENT_REPLAY'`).

**Fix:** Change the replay branch to: `return { data: outcome.webhook, meta: { correlation_id: '' }, error: { code: 'CONFLICT', message: 'Idempotent replay.', retryable: false, detail: { reason: 'IDEMPOTENT_REPLAY' } } };`. The `correlation_id` is back-filled by `ResponseEnvelopeInterceptor` as already noted; the `error` object must be non-null with the CONFLICT code and IDEMPOTENT_REPLAY sub-reason.

### MAJOR — `apps/api/src/modules/integration/integration.controller.ts:51`

`@Requires(Capability.CONFIGURATION)` is declared on the controller class (line 51) without a scope resolver, and then repeated with the correct resolver `configurationResource` on every method (lines 56, 72, 81). The AbacGuard uses `reflector.getAllAndOverride` which picks the handler decorator first — so the class-level decorator never executes in practice. However its presence creates a confusing mismatch: the class-level annotation resolves the resource as `{ resourceType: 'leads' }` (the default when no resolver is provided), which is semantically wrong for a `configuration_versions` resource. A future copy-paste edit that removes the method-level annotation would silently produce a wrong resource type in audit/deny events.

**Fix:** Remove the class-level `@Requires(Capability.CONFIGURATION)` decorator at line 51. Auth is fully covered by the per-method decorators. The class-level annotation adds no protection and carries a misleading default resource type.

### MAJOR — `apps/api/test/integration-monitor.e2e-spec.ts (absent)`

The LLD File Locations section explicitly declares `apps/api/test/integration-monitor.e2e-spec.ts` as a required artefact containing API integration tests for all three FR-140 endpoints. The file does not exist. This leaves T16–T32 (HTTP 200 list/create happy paths, filter/sort, auth negatives 401/403, pagination defaults and cap, idempotent-replay HTTP shape, rate-limit 429, DB rollback/invariant, LIMIT=100 enforcement) without any test coverage at the API tier. The testing-contract mandates happy paths and every named error code be tested.

**Fix:** Create `apps/api/test/integration-monitor.e2e-spec.ts` using the Testcontainers harness pattern established in `apps/api/test/integration/harness.e2e-spec.ts`. Cover at minimum T16 (list 200), T17 (filter by status), T18 (401), T19 (RM 403), T20 (BM 403), T21 (secret_ref absent), T22 (pagination default 25), T23 (create 201), T24 (http:// 400), T25 (replay 200 + CONFLICT error shape), T26 (401 unauthenticated), T27 (PARTNER 403), T31 (limit=100 cap).

### MINOR — `apps/api/src/modules/integration/integration.repository.ts:83-84`

The `orderBy` call uses a template-literal string interpolation: `.orderBy(\`il.${column}\`, dir)`. While `column` is typed as `'created_at' | 'retry_count'` and derived from the `resolveSort` allow-list switch (preventing injection in the current code), Kysely's typed `.orderBy` accepts a column reference directly without interpolation. Using the template literal bypasses Kysely's type-checker for column names and could silently become unsafe if the `resolveSort` return type is ever widened.

**Fix:** Separate the table alias from the column: `.orderBy(\`il.${column}\` as never, dir)` is already constrained, but ideally use Kysely's typed form. At minimum, assert the column is in the allow-list with `const SORT_COLS: ReadonlySet<string> = new Set(['created_at','retry_count'])` and throw `VALIDATION_ERROR` if it is not, then call `.orderBy(\`il.${column}\`, dir)` after the guard. The allow-list is currently in the type system only, not enforced at runtime.


## Test coverage

Unit tests (T01–T15) are fully present and cover the gateway resilience pipeline, circuit breaker, HMAC guard, DTO validation, and service scope-A enforcement. The e2e spec referenced by the LLD at `apps/api/test/integration-monitor.e2e-spec.ts` does not exist: API-tier cases T16–T32 (HTTP 200 list responses, filter/sort, 401/403 negatives, pagination defaults, idempotent replay HTTP shape, rate-limit, rollback invariant, LIMIT hard cap) have no test file. Testcontainers DB invariants (INV-01..INV-07) are also absent but this is noted as a project-wide e2e deferral. The missing e2e file is the gap that matters here because the LLD explicitly calls for it.
