# FR-041 — Stage 8 Per-FR Review

**Verdict:** APPROVE

> FR-041 implementation is functionally correct and safe. The Flyway seed migration (`V2__seed_product_configs.sql`) inserts all seven launch products idempotently with correct `pan_required_at` values, matching the LLD's Seed Data Reference table. Auth is properly enforced via `@Requires(Capability.CONFIGURATION)` on every controller method plus the global `JwtAuthGuard`. All Kysely queries are parameterised and LIMIT-bounded. No `any` types, no console.* calls, no swallowed errors, no PII in logs. Owner-writes rule is respected — only `ProductConfigRepository` in M5 and the `ProductConfigActivator` (same module) write to `product_configs`. Cross-module references in M4/M8/M12 are reads only. Two MINOR issues and one MAJOR documentation discrepancy were found; none are runtime security or data-integrity blockers. The MAJOR finding is a filename mismatch between the LLD spec (`V003__`) and the actual migration file (`V2__`) — this is a spec documentation error, not a code bug, since the test file correctly references the real path. Test coverage meets Tier-1 minimums: seed structural tests (T12/INV-01..08), repository unit tests (T11), and service unit tests (T04-scope-B FORBIDDEN, T10 NOT_FOUND, T08/T09 validation) are all present in unit form; API integration tests T01–T07 are deferred Testcontainers per project-wide policy.

## Findings

### MAJOR — `docs/lld/FR-041.md (File Locations, Backend Flow, Transaction Boundaries sections)`

The LLD consistently names the migration file `V003__seed_product_configs.sql` (four occurrences: File Locations, Backend Flow step 1, Transaction Boundaries, and Seed Data Reference note). The actual file is `V2__seed_product_configs.sql` and the test at `apps/api/src/modules/product-config/seed-product-configs.spec.ts:23` correctly hardcodes the real `V2__` path. Flyway orders migrations by version prefix, so `V2` and `V003` would produce different results in a clean install — Flyway would try to apply a non-existent `V003__` file if the LLD-specified name were ever used as a script reference. The LLD is the artefact future agents will consume, so this discrepancy is a traceability risk.

**Fix:** Update all references in `docs/lld/FR-041.md` from `V003__seed_product_configs.sql` to `V2__seed_product_configs.sql` to match the actual file on disk and the test path. Alternatively, if the project intends `V003__` as the canonical name, rename the file and update the test path accordingly.

### MINOR — `apps/api/src/modules/product-config/product-config.controller.ts:48,53,62,71,81`

The controller class is decorated with `@Requires(Capability.CONFIGURATION)` at line 48 (no resource resolver), and every handler method is also individually decorated with `@Requires(Capability.CONFIGURATION, productConfigResource)` at lines 53, 62, 71, 81. The class-level `@Requires` without a resource resolver is a duplicate that is shadowed by the per-method decorator. This creates ambiguity about which annotation is authoritative and could mislead a future developer into thinking the class-level check is a meaningful gate.

**Fix:** Remove the class-level `@Requires(Capability.CONFIGURATION)` at line 48. The per-method `@Requires(Capability.CONFIGURATION, productConfigResource)` decorators are sufficient and correctly include the resource resolver used by `EntitlementService`.

### MINOR — `docs/lld/FR-041.md (Data Operations § Runtime read queries) vs apps/api/src/modules/product-config/product-config.repository.ts:107,123`

The LLD pseudocode shows `findAllActive(orgId: string)` and `findActiveByProductCode(orgId: string, productCode: ProductCode)` with an explicit `orgId` parameter. The actual implementation uses `ORG_ID_DEFAULT` constant internally, with no `orgId` parameter. This is a spec-vs-implementation divergence in the method signatures. The implementation choice is defensible (single-tenant, constant default org) but the LLD spec is incorrect, which will mislead the FR-010 coding agent when it wires up calls to these methods.

**Fix:** Update the LLD pseudocode for `findAllActive` and `findActiveByProductCode` to reflect the actual zero-`orgId`-parameter signatures. No code change needed — the implementation is correct for a single-org deployment using `ORG_ID_DEFAULT`.


## Test coverage

Unit coverage is adequate for Tier 1. `seed-product-configs.spec.ts` structurally verifies all 7 product codes, idempotency (T12/INV-05), `pan_required_at` per product (INV-06/INV-07), JSONB field presence (INV-02/03/04), CV field_schema/checklist spot check (T02), and org/user UUID counts. `product-config.read.repository.spec.ts` covers `findActiveByProductCode` (T11) and `findAllActive` with predicate and LIMIT assertions. `product-config.service.spec.ts` covers scope-B FORBIDDEN on create/update (test for T04/T05 class equivalent), NOT_FOUND on get/update (T10), CONFLICT on draft/retired update, VALIDATION_ERROR on eligibility cross-reference, and outbox-propagation rollback (T15). `product-config-dto.spec.ts` covers limit>100 rejection (T08), unknown filter value rejection (T09), bracketed-filter mapping, and signed-sort parsing. Auth negative tests T04 (RM-FORBIDDEN), T05 (PARTNER-FORBIDDEN), T06 (HEAD-200), T07 (no-JWT-401) and the full API integration tests T01–T03 are deferred to Testcontainers tier per project-wide dispatch brief — this is acceptable and expected.
