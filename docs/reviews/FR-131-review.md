# FR-131 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-131 backend (API + service + registry + DTOs) is structurally sound: auth/ABAC is correct (JwtAuthGuard global + @Requires(CONFIGURATION) on all handlers; scope-A floor enforced in service for mutations; no public endpoints), owner-writes is respected (only M14 AdminMasterService/descriptors write master tables and configuration_versions), error codes match taxonomy, LIMIT ≤100 is enforced via MAX_PAGE_LIMIT, Kysely parameterised queries only, no console.* or as-any casts, audit uses the correct append() method, and UnitOfWork atomicity is properly implemented. However, three non-trivial blockers prevent approval: the mutation throttle tier is silently wrong (POST/PATCH land on 10/min auth rate instead of 60/min), the configuration_versions lifecycle bypasses the LLD-specified FR-132 delegation and writes ACTIVE directly, and the entire frontend (AdminConfigPage, hooks, components, E2E) is absent. One required unit test (T34) is also missing.

## Findings

### BLOCKER — `apps/api/src/modules/admin/master/admin-master.controller.ts:53`

AdminMasterController has no @Throttle decorator, so its POST and PATCH mutation endpoints inherit the global default throttle (RATE_LIMIT_AUTH = 10/min per IP) instead of the mutation tier (RATE_LIMIT_MUTATION = 60/min). The LLD specifies 60/min for mutations (T38). Every other mutation controller (capture, allocation, consent, dedupe) explicitly decorates @Throttle({ default: { limit: 60, ttl: 60_000 } }).

**Fix:** Add @Throttle({ default: { limit: 60, ttl: 60_000 } }) at the class level on AdminMasterController (or on the POST and PATCH handlers individually). Also add a corresponding unit test asserting the metadata value.

### BLOCKER — `apps/web/src/app/admin/configuration/`

The entire FR-131 frontend is absent. Files listed in the LLD's File Locations section — AdminConfigPage.tsx, use-master-config.ts, components/ (CreateMasterDrawer, EditMasterDrawer, DeactivateConfirmDialog, EntityForm, StatusChip), and apps/web/e2e/admin-master-config.spec.ts — do not exist anywhere in apps/web/. UI test scenarios UI-01 through UI-08 and Playwright tests T41–T43 cannot be executed.

**Fix:** Implement the frontend per the LLD's UI Component Tree: AdminConfigPage.tsx with DataTable + TanStack Query hooks, CreateMasterDrawer / EditMasterDrawer backed by EntityForm (RHF+Zod), DeactivateConfirmDialog, RequireCapability route guard, and the useMasterConfig hook. Add Vitest/RTL tests for UI-01 through UI-06 and Playwright E2E for T41–T43.

### MAJOR — `apps/api/src/modules/admin/master/admin-master.repository.ts:56`

The repository writes configuration_versions with status = ConfigChangeStatus.ACTIVE unconditionally, bypassing the LLD-mandated maker-checker lifecycle. The LLD states (§Summary, §Backend Flow POST step 7a, §Assumption 1): 'FR-131 always delegates to ConfigurationVersionService.submitChange(...) (FR-132 service)' which determines whether status starts as pending or active. Writing ACTIVE directly also conflicts with the state-machines.md ConfigurationVersion machine (pending → approved → active) and would strand the INV-01 invariant check if maker_id is the approval actor.

**Fix:** Inject the FR-132 ConfigurationVersionService (or ConfigGovernanceService) and call its submitChange / createVersion method instead of inserting directly. Let that service determine the initial status (pending for high-impact types, active for low-impact) per the org maker-checker flag. If the org flag always makes these low-impact and always-active for this wave, document this as a confirmed assumption and guard it with a test verifying the service is delegated to.

### MAJOR — `apps/api/src/modules/admin/master/admin-master.service.spec.ts:16`

T34 (unit test: 'inUseCheck for rejection_reason returns true when active lead references it') is listed in the spec comment as implemented ('T31–T34') but the test body does not exist in the file. The RejectionReasonDescriptor.assertNotInUse implementation in descriptors.ts:287 queries leads filtering by stage NOT IN TERMINAL_LEAD_STAGES — this logic has no test coverage at the unit level.

**Fix:** Add T34 as a unit test: create a fake descriptor whose assertNotInUse mocks a DB query returning count=1 (one active lead references the rejection reason), verify the service propagates the CONFLICT. Alternatively, add a descriptors-level unit test that stubs the executor and asserts the Kysely chain (stage not in [...TERMINAL_LEAD_STAGES]) is constructed and the DomainException(CONFLICT) is thrown.

### MINOR — `apps/api/src/modules/admin/master/descriptors.ts:86,187,284,387`

All four descriptors return version: 1 for both create and update operations. The update path will insert a configuration_versions row with version=1 on every PATCH, regardless of how many prior versions exist. If the configuration_versions table has a unique constraint on (config_ref, version) (consistent with the schema and INV-* invariants), the second PATCH on the same resource will produce a DB unique-constraint violation (CONFLICT 409) instead of creating version 2.

**Fix:** In each descriptor's update() method, derive the next version by querying: SELECT MAX(version) FROM configuration_versions WHERE config_ref = existing.id, then return { ..., version: maxVersion + 1, ... }. Or query the existing record's version counter if one exists on the master table itself.

### MINOR — `apps/api/src/modules/admin/master/admin-master.service.ts:234`

The audit entry is emitted with org_id: ORG_ID_DEFAULT (a hardcoded UUID constant '00000000-0000-0000-0000-000000000001') instead of actor.orgId. In the current single-tenant wave this is functionally equivalent, but it introduces a silent multi-tenancy bug: if a second org is onboarded, all admin audit rows would be attributed to the default org regardless of which org the actor belongs to.

**Fix:** Replace ORG_ID_DEFAULT with actor.orgId in the appendAudit call at service.ts:234: org_id: actor.orgId. Verify actor is threaded through or held in scope at appendAudit call site.


## Test coverage

Unit tests (admin-master.service.spec.ts, master-resource.registry.spec.ts, master-dto.spec.ts) cover T25, T26, T27, T30, T31, T32, T33, T36, T18, and several unnamed paths. T34 is missing despite being claimed in the header comment. Integration tests T01–T29 and T38–T40 are explicitly deferred to the Testcontainers wave. All Playwright E2E (T41–T43) and all Vitest/RTL UI tests (UI-01 through UI-08) are unimplemented because the frontend does not exist. SQL invariant queries (INV-01 through INV-11) depend on the deferred integration layer. Coverage checklist items for rate-limit (RATE_LIMITED 429), UI states, and authz-negative for BM on global resources have no runnable tests at this time.
