# FR-132 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-132 (Configuration Governance) has a solid backend core — Kysely queries are parameterised, UnitOfWork transactions are correctly used, optimistic status guards are in place, error codes match the taxonomy, and unit-test coverage covers the main happy and error paths. However, two blockers prevent approval: (1) the service's `requireScopeA` guard silently denies BM/KYC/DPO who are explicitly authorised in both the LLD and auth-matrix, and (2) the entire UI layer specified in the LLD is absent. There are also two minor audit-integrity gaps (hardcoded org_id; missing ip_device).

## Findings

### BLOCKER — `apps/api/src/modules/admin/config-governance.service.ts:162-166`

The `requireScopeA` guard in both `approve()` and `rollback()` rejects any caller with `effectiveScope !== DataScope.A`. BM, KYC, and DPO all have `configuration` capability with scope B in auth-matrix.json and are listed as authorised roles in the LLD auth section (FR-132.md lines 164-170). This guard is not specified anywhere in the LLD; it is an unspecified addition that makes scope-B role holders receive FORBIDDEN despite being permitted by the contract.

**Fix:** Remove `this.requireScopeA(effectiveScope)` calls from both `approve()` and `rollback()`, and delete the `requireScopeA` private method. ABAC enforcement via `AbacGuard` + `@Requires(Capability.CONFIGURATION, scopeResolver)` is already sufficient — `EntitlementService.can()` enforces the capability matrix. If an intentional scope-floor decision was made post-LLD, it must be written back to FR-132.md and auth-matrix.json before re-implementing.

### BLOCKER — `apps/web/src/components/admin/ (directory does not exist)`

The four UI components specified in the LLD file locations are entirely missing: `ConfigGovernancePage.tsx`, `ConfigApprovalTable.tsx`, `ApproveDrawer.tsx`, and `RollbackConfirmDialog.tsx`. The approval queue at `/admin/config` is not rendered, making the maker-checker workflow inaccessible from the UI. UI tests UI-01 through UI-08 therefore cannot be executed.

**Fix:** Implement the four UI components as specified in FR-132.md §UI Component Tree: `ConfigGovernancePage`, `ConfigApprovalTable` (server-paginated DataTable with status filter), `ApproveDrawer` (DiffViewer + RHF+Zod EntityForm + ConfirmDialog), and `RollbackConfirmDialog` (ConfirmDialog with required reason Textarea). All must use existing shared UI primitives (DataTable, EntityForm, ConfirmDialog, Toast, StatusChip, LoadingSkeleton, EmptyState, ErrorState) and wire to `apiClient` for the two governance endpoints.

### MAJOR — `apps/api/src/modules/admin/config-governance.service.ts:201`

`appendAudit` passes `org_id: ORG_ID_DEFAULT` (a hardcoded constant `'00000000-0000-0000-0000-000000000001'`) instead of `actor.orgId` from the authenticated user. The LLD audit snippet at FR-132.md line 269 explicitly shows `org_id: user.orgId`. The `actor: AuthUser` is available in the calling methods but is not threaded into the private `appendAudit` helper.

**Fix:** Thread the actor's `orgId` into `appendAudit`: add `orgId: string` as a parameter and replace `org_id: ORG_ID_DEFAULT` with `org_id: orgId`. Update both call sites — in `approve()` pass `actor.orgId`, and in `rollback()` pass `actor.orgId`. Update the service unit tests to assert `auditArg.org_id` matches the actor's orgId.

### MINOR — `apps/api/src/modules/admin/config-governance.service.ts:195-213`

The `appendAudit` helper does not pass `ipDevice` to `AuditAppender.append(...)`. The LLD spec (FR-132.md line 281) includes `ip_device: requestContext.ipDevice` in the audit call. Every audit row for approve/rollback will have `ip_device = null`, reducing the audit trail's forensic value. The `AuditEntry.ipDevice` field exists and is nullable so this does not crash, but it is a deliberate spec omission.

**Fix:** Pass the request IP/user-agent into the service. One approach: accept an optional `ipDevice` parameter on `appendAudit` and on the public `approve()`/`rollback()` methods; populate it from `req[IP_DEVICE_KEY]` in the controller (or from a request-scoped context service). Then pass it to `audit.append({ …, ipDevice })` inside `appendAudit`.

### MINOR — `apps/api/src/modules/admin/config-governance.controller.ts:28`

The controller class carries `@Requires(Capability.CONFIGURATION)` at the class level (no `scopeResolver`), while each handler method applies its own `@Requires(Capability.CONFIGURATION, () => ({ resourceType: CONFIGURATION_RESOURCE_TYPE }))`. `AbacGuard` uses `getAllAndOverride`, so the method-level decorator wins and the class-level one is never evaluated. The redundant decorator is dead metadata that could mislead future developers about which scope resolver actually applies.

**Fix:** Remove the class-level `@Requires(Capability.CONFIGURATION)` from `ConfigGovernanceController`. Authorization is fully covered by the per-handler decorators.

### MINOR — `apps/api/src/modules/admin/activators/sla-policy.activator.ts:52-56`

`SlaPolicyActivator` directly issues `tx.updateTable('sla_policies').set({ is_active: … })` — a write against a table owned by M11 (engagement/SLA module). This violates the owner-writes rule (architecture §11, CLAUDE.md). The LLD comment acknowledges the gap ('when M11 later exposes an owner mutator this class is the one place to delegate it') but the violation exists now.

**Fix:** M11 should expose a `SlaActivatorPort` (or a method on `SlaEngine`/`SlapolicyService`) that the `SlaPolicyActivator` delegates to. The governance transaction is passed via the port so atomicity is preserved. Until M11 exposes this port, log the known debt in the relevant LLD or AMBIGUITY.md rather than writing directly to M11's table from M14.


## Test coverage

Unit tests cover T01/T02/T04/T05/T06/T07/T08/T09/T10/T18/T19/T20/T21/T22/T23/T24 via the service and DTO spec files. Controller @Requires metadata tests cover the ABAC binding shape. DTO validation covers T14/T15/T16/T17. Registry/activator tests cover the cross-module wiring. Integration tests (T03/T11/T12/T13/T25/T26/T27/T28/T29) and E2E tests (T30/T31/T32) are deferred per project-wide policy, but that deferral is consistent with the project norm. UI tests (UI-01 through UI-08) cannot run because the UI components are missing. The misleading test labels T12/T13 in the unit suite actually test scope-B rejection, not the auth-matrix RM/PARTNER negatives named in the spec.
