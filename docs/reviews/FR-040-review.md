# FR-040 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-040 backend logic (service, repository, DTOs, activator, unit tests) is well-structured and correct in its core: ABAC guards are wired properly, owner-writes rule is respected, all Kysely queries are parameterised and LIMIT-bounded, error codes match the taxonomy, no `any` types or console.* calls exist, and the immutability invariant (never mutating a pinned config row on PATCH) is correctly enforced. However there are three real defects: (1) the `list` and `get` controller handlers are missing the `@CurrentUser()` user argument needed to pass the actor's orgId through to data-scoping (the service and repo fall back to a hardcoded `ORG_ID_DEFAULT` constant instead — this is acceptable for the current single-tenant MVP but the controller signature omission means org-scope is never asserted dynamically); (2) the LLD-mandated API integration test file `apps/api/test/product-config.e2e-spec.ts` is entirely absent (TC-A01 through TC-A23 have zero implementation); and (3) all frontend files listed in the LLD File Locations section are absent (pages, components, hooks, and Playwright E2E spec — none exist in the repository). The missing e2e spec is particularly serious for a Tier-3 FR with a complex maker-checker flow.

## Findings

### BLOCKER — `apps/api/test/product-config.e2e-spec.ts`

The LLD-mandated API integration test file does not exist in the repository. Test cases TC-A01 through TC-A23 (covering the full maker-checker cycle, rate limiting, rollback atomicity, version pinning, and all FORBIDDEN/CONFLICT/NOT_FOUND paths against a real DB via Testcontainers) are entirely unimplemented. For a Tier-3 FR with a four-state config_status machine and four-step checker flow, the absence of an integration test suite is a blocker.

**Fix:** Create `apps/api/test/product-config.e2e-spec.ts` implementing TC-A01 through TC-A23 as described in FR-040-tests.md, using the Testcontainers-Postgres pattern already established in the project (see §14.7 in commit e0010f4). Priority cases: TC-A13 (full approve cycle), TC-A14 (self-approval blocked), TC-A16 (eligibility-mapping scope gate), TC-A20 (version pinning invariant), TC-A23 (rollback atomicity).

### MAJOR — `apps/api/src/modules/product-config/product-config.controller.ts:52-58 and :61-67`

The `list` and `get` handlers do not inject `@CurrentUser()` or `@Req()` and therefore never pass the authenticated user's `orgId` to the service. The repository uses the hardcoded `ORG_ID_DEFAULT` constant for org-scoping on every query path. This means a multi-tenant deployment would silently expose one org's product configs to any authenticated user of a different org who possesses the `configuration` capability — a data-isolation violation. The ABAC guard enforces the capability check but not the org boundary for data reads.

**Fix:** Inject `@CurrentUser() user: AuthUser` in both `list` and `get` handlers (mirroring the `create` and `update` handlers already present). Thread `user.orgId` through to `service.list(query, user.orgId)` and `service.get(id, user.orgId)`, then update the service methods and repository queries to replace `ORG_ID_DEFAULT` with the caller-supplied `orgId`. Also update the unit test to assert the correct `org_id` is forwarded.

### MAJOR — `apps/web/src/app/admin/products/ and apps/web/src/components/product-config/ and apps/web/src/hooks/use-product-configs.ts`

All frontend files listed in the LLD File Locations section are absent from the repository: the list page, create page, detail page, FieldSchemaEditor, ChecklistEditor, SlaConfigEditor, EligibilityMappingEditor, VersionHistoryTable, ApproveConfigDrawer, and the TanStack Query hooks. The FR-040 feature is therefore entirely non-functional from the user's perspective — the admin UI for product configuration does not exist.

**Fix:** Implement all frontend files listed in FR-040.md §File Locations (Frontend), following the UI Component Tree spec in the same document. Use the shared components (EntityForm, DataTable, ConfirmDialog, StatusChip, Toast, Tabs) as specified. Implement the TanStack Query hooks in use-product-configs.ts. Add frontend component tests TC-C01–TC-C05 and Playwright E2E tests TC-E01–TC-E03.

### MINOR — `apps/api/src/modules/product-config/product-config.service.ts:310`

AuditAppender.append is called with `org_id: ORG_ID_DEFAULT` (a hardcoded sentinel) rather than the actor's actual `orgId` from `AuthUser`. While this is a single-tenant MVP where `ORG_ID_DEFAULT` equals the one real org, it creates a latent bug for multi-tenant expansion and produces misleading audit records if `actor.orgId` ever differs from `ORG_ID_DEFAULT`.

**Fix:** Replace `org_id: ORG_ID_DEFAULT` in the `appendAudit` private method with `org_id: actor.orgId` (the `actorId` parameter already carries the userId; add `orgId` to the signature or pass the full `AuthUser`). Apply the same fix to `OutboxService.emit` if it also takes an `org_id` parameter.

### MINOR — `apps/api/src/modules/product-config/product-config.service.spec.ts:298-304`

TC-U15 (transaction rollback: outbox failure rolls back all writes) tests that the error propagates, but the mock UnitOfWork (`fakeUow`) simply runs the callback synchronously without wrapping it in a real transaction — so the test verifies that the exception is re-thrown but cannot verify that no `product_configs` row was persisted. The test comment acknowledges 'asserted without a DB' but the spec says 'product_configs row does NOT persist'.

**Fix:** The unit-level assertion is acceptable for the service layer (re-throw is sufficient); document in the test comment that the DB-level rollback guarantee is covered by TC-A23 in the integration suite. Ensure TC-A23 is implemented in the (currently absent) e2e spec.


## Test coverage

Unit tests (product-config.service.spec.ts and product-config.activator.spec.ts and product-config-dto.spec.ts) cover TC-U01–U06, TC-U08–U09, TC-U12–U13, TC-U15, plus DTO cases TC-A06/A07/A08/A09 — good breadth. TC-U07 (activation happy path) and TC-U10 (eligibility-mapping scope gate) are delegated to product-config.activator.spec.ts and FR-132 respectively, which is acceptable. TC-U03 for the service-layer eligibility cross-validation is present as an unlabelled test ("rejects eligibility_mapping referencing an undeclared field on a partial edit"). Missing entirely: the full API integration test suite (TC-A01–TC-A23, apps/api/test/product-config.e2e-spec.ts — file does not exist), all frontend component tests (TC-C01–TC-C05 — no component files to test), all E2E tests (TC-E01–TC-E03), and the SQL invariant verification suite (INV-01 through INV-07).
