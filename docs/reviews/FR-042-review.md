# FR-042 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-042 (Scheme & Offer Capture) is well-structured overall: owner-writes discipline is maintained, Kysely parameterised queries are used throughout, LIMIT is applied to all list queries, the UnitOfWork pattern is used correctly for scheme creation, error codes match the taxonomy, no `any` types or swallowed errors are present, and the unit test suite is comprehensive. However, there is one BLOCKER and two MAJOR issues that prevent approval.

## Findings

### BLOCKER — `apps/api/src/modules/product-config/scheme.controller.ts:39-46`

GET /admin/schemes (list) requires `Capability.CONFIGURATION` exclusively. RMs and SMs hold `view_lead` but no `configuration` capability per auth-matrix.json. The LLD §Auth Check and §Backend Flow B explicitly state the list endpoint must accept `view_lead` as sufficient for read-only access (scheme picker). TC-042-14 ('RM lists schemes — 200') will fail with 403 FORBIDDEN.

**Fix:** Change the `@Get()` handler's `@Requires` to accept either capability. The cleanest approach given the single-decorator API is to add a second route handler for the RM case or use an `EntitlementService.canAny` overload. Practically: `@Requires(Capability.VIEW_LEAD, schemeResource)` on a second `@Get()` handler is not idiomatic; instead, expose a non-admin alias route (e.g. `GET /products/schemes`) for the picker path as suggested in LLD §Ambiguities #3, or extend `@Requires` to accept an array of capabilities (OR semantics) and use `@Requires([Capability.CONFIGURATION, Capability.VIEW_LEAD], schemeResource)`.

### MAJOR — `apps/api/src/modules/product-config/scheme.service.ts:128,131`

`validateAndResolveScheme` receives `_orgId` (parameter name with leading underscore signalling intentionally unused) but calls `this.repo.findByCode(schemeCode)` without forwarding it. The repository then falls back to the hardcoded `ORG_ID_DEFAULT`. If a caller passes a different `orgId` (e.g. when the lead-capture FR forwards `user.org_id`), the lookup silently ignores it and queries the wrong org's schemes, breaking the org-isolation contract stated in the LLD §3.3.

**Fix:** Rename `_orgId` to `orgId` and forward it: `this.repo.findByCode(schemeCode, orgId)`. Update `SchemeRepository.findByCode` signature to accept a required `orgId: string` parameter and use it in the `.where('org_id', '=', orgId)` clause (replacing the `ORG_ID_DEFAULT` reference). Update the unit tests to pass the org ID explicitly.

### MAJOR — `apps/api/src/modules/product-config/dto/attach-scheme.dto.ts (absent)`

The LLD 'File Locations' table lists `apps/api/src/modules/product-config/dto/attach-scheme.dto.ts` as a required artefact for this FR. The file does not exist. The lead-capture FR (FR-011/FR-050) that calls `SchemeService.validateAndResolveScheme` for the PATCH /leads/{id} flow has no typed DTO contract to validate or import the `product_detail.scheme_code` field against.

**Fix:** Create the file with the `AttachSchemeDto` Zod schema as specified in the LLD §Validation Logic: `z.object({ scheme_code: z.string().min(1).max(40).nullable() })`. Export both the schema and its inferred type. The consuming FR should import this DTO from this canonical location.

### MINOR — `apps/api/src/modules/product-config/scheme.controller.ts:41-46`

`SchemeController.list` does not inject `@CurrentUser()` and passes no `orgId` to `SchemeService.list`. The repository therefore uses `ORG_ID_DEFAULT` unconditionally. While single-tenant MVP may be the design intent, the LLD §3.1 specifies `SchemeRepository.list(orgId, filters, pagination)` with explicit `orgId` threading.

**Fix:** Add `@CurrentUser() user: AuthUser` to the `list` handler parameters and pass `user.orgId` through to `service.list()` and thence to the repository. This is the same pattern already used by the `create` handler.


## Test coverage

Unit tests cover all five spec-mandated service scenarios (TC-042-U1 through U5) plus boundary cases (TC-042-21/22), the create transaction + audit assertion (TC-042-01), scope-B FORBIDDEN guard (TC-042-17 service layer), unique-violation mapping (TC-042-11), and list pagination/filter forwarding (TC-042-02/03). DTO tests cover TC-042-10, TC-042-12, TC-042-23. Controller metadata tests verify @Requires for both handlers. E2e tests (apps/api/test/scheme.e2e-spec.ts) are listed in the LLD file locations table but that file was not found on disk — it may be deferred project-wide per testing-contract.md, but the LLD references it as an artefact that should exist. Missing: no test for TC-042-14 (RM lists schemes successfully via view_lead) at any level; this gap is structurally caused by the BLOCKER auth issue.
