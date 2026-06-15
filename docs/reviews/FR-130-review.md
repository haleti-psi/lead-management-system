# FR-130 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-130 (User, Role, Team & Branch Administration) is generally well-implemented: auth/ABAC guards are correctly applied on all three controllers via @Requires(Capability.USER_MGMT), org-isolation is enforced in every repository query, UnitOfWork transactions are used for all writes, argon2id hashing is correct, password_hash is never selected back, email/mobile masking is delegated to the global interceptor, all list queries have LIMIT <= 100, no `any` types or console.* calls exist, error codes match the taxonomy, and test coverage is solid. Two correctness bugs prevent approval: the permission-list LIMIT bug can silently truncate role permissions in multi-role pages, and the locked-to-inactive state transition is not guarded at the service layer.

## Findings

### MAJOR — `apps/api/src/modules/admin/role.repository.ts:107`

listPermissionsForRoles applies a single LIMIT(100) across permissions for ALL roleIds in the page. With 9 system roles and up to 18 capabilities each (162 rows theoretical max), any permissions past row 100 are silently dropped from list responses, causing AdminRoleService.listRoles to return roles with truncated or missing permission sets.

**Fix:** Raise the limit to a safe ceiling above the maximum possible rows: e.g., `const PERMISSIONS_LIMIT = 300` (or compute dynamically as `Math.max(roleIds.length * capabilities.length, MAX_PAGE_LIMIT)`). Alternatively, fetch permissions per-role or in a per-page subquery that applies a per-role LIMIT. Document the safe ceiling in a constant with an explanatory comment.

### MAJOR — `apps/api/src/modules/admin/admin-user.service.ts:149`

The updateUser method does not validate the state machine transition when status='inactive'. If the existing user is 'locked', an admin can issue PATCH {status:'inactive'} and the service will apply it, bypassing the LLD §State Machine rule that 'locked → inactive' is invalid and must return VALIDATION_ERROR(400). The DTO only blocks status='locked' as input, not the locked→inactive transition.

**Fix:** After loading `existing` (line 146), add a state machine guard before calling handleDeactivation. Example: `if (dto.status !== undefined && existing.status === UserStatus.LOCKED && dto.status !== UserStatus.ACTIVE) { throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, { fields: [{ field: 'status', issue: 'invalid transition from current state' }] }); }` This ensures only locked→active (unlock) is permitted via this endpoint.

### MINOR — `apps/api/src/modules/capture/adapters/lead-reassignment.adapter.ts:37-44`

The SELECT query on `leads` inside bulkReassign uses `where('owner_id', '=', fromUserId)` but has no `org_id` predicate. The LeadReassignPort interface does not accept orgId, so the adapter cannot scope the query. This violates the project invariant that every query against a scoped table includes an org_id clause. Practically safe with UUIDs but violates defense-in-depth.

**Fix:** Add `orgId: string` to the LeadReassignPort.bulkReassign signature. Thread orgId from AdminUserService.handleDeactivation (it already has actor.orgId) through the port call. Add `.where('org_id', '=', orgId)` to the SELECT in LeadReassignmentAdapter and to the LeadService.bulkReassign UPDATE. Update all mocks/specs accordingly.

### MINOR — `apps/api/src/modules/admin/ (user.repository.spec.ts absent)`

The LLD test spec (FR-130-tests.md) lists `apps/api/src/modules/admin/user.repository.spec.ts` as a required file covering T-29 (reassignLeads/countOpenLeads terminal-stage exclusion at the repository level). This file does not exist. The adapter-level test in lead-reassignment.adapter.spec.ts covers the batching behaviour but not the UserRepository.countOpenLeads predicate itself.

**Fix:** Create `user.repository.spec.ts` with a recording-fake transaction (same pattern as role.repository.spec.ts) asserting that countOpenLeads emits a query with `stage NOT IN ('handed_off','rejected')` and `deleted_at IS NULL`. This covers T-29 at the right layer without requiring a real database.

### MINOR — `docs/contracts/api-contract.yaml:63 and lines 324-328`

The api-contract.yaml x-fr-coverage for FR-130 only lists GET/POST /admin/users and PATCH /admin/users/{id}. The /admin/roles (GET, PATCH /{id}) and /admin/teams (GET, POST, PATCH /{id}) endpoints are implemented but absent from the contract, making the contract incomplete for automated conformance checking of these sub-resources.

**Fix:** Add entries for GET /admin/roles, PATCH /admin/roles/{id}, GET /admin/teams, POST /admin/teams, and PATCH /admin/teams/{id} tagged x-frs: [FR-130] to the api-contract.yaml paths section and update the x-fr-coverage entry for FR-130 accordingly.


## Test coverage

Unit tests for AdminUserService, AdminRoleService, AdminTeamService, RoleRepository.replacePermissions, LeadReassignmentAdapter, and all DTOs are present and cover the main spec scenarios (T-01 through T-30 mapped, including T-27 password-not-returned, T-13 rollback propagation, E1 cache invalidation, keyset pagination for listAllUserIdsForRole). Missing: `user.repository.spec.ts` (T-29 - countOpenLeads terminal exclusion at repo level) and `team.repository.spec.ts` are absent from the test file inventory per LLD spec. E2E specs are deferred project-wide. Coverage is acceptable for the unit/component tier but the two missing repository spec files are a gap.
