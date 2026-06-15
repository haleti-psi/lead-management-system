# FR-102 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-102 has two BLOCKER security/correctness defects in `logDisposition`: (1) no per-task scope enforcement for RM or BM — an RM can disposition any task regardless of ownership, violating TC-05/TC-06 and the LLD §Auth Check; (2) the `WHERE status != 'done'` UPDATE guard allows cancelled tasks to transition to done, contradicting the Error Cases table and state machine contract. Both bugs are untested. A Tier-2 MAJOR gap is the absence of the required API integration test file (fr-102.e2e-spec.ts). All other checks (error taxonomy, owner-writes, PII/masking, LIMIT on list queries, Kysely parameterisation, no `any` types, OutboxService/AuditAppender call shapes, UI components, DTOs) are compliant.

## Findings

### BLOCKER — `apps/api/src/modules/engagement/task.service.ts:268-271`

logDisposition() enforces only a role check (RM or BM allowed) but never verifies per-task ownership or branch scope. The AbacGuard is called with `{ resourceType: 'tasks' }` — no ownerId/branchId in the resource — so EntitlementService.can() grants access without per-task verification (evaluateScope skips the check when resource.ownerId/branchId is null). An RM can therefore disposition any task, not only their own assigned task (TC-05 FORBIDDEN case is never enforced). Similarly, a BM can disposition tasks whose lead belongs to a different branch (TC-06 case). The LLD §Auth Check explicitly requires: RM scope O passes only if `task.owner_id === user.user_id`; BM scope B passes only if `task.lead.branch_id === user.branch_id`.

**Fix:** After the role check at line 270, add ownership/branch enforcement: `if (callerIsRm && task.owner_id !== caller.userId) throw new DomainException(ERROR_CODES.FORBIDDEN);` and `if (callerIsBm && caller.branchId != null && task.branch_id !== caller.branchId) throw new DomainException(ERROR_CODES.FORBIDDEN);`. Alternatively pass `{ resourceType: 'tasks', ownerId: task.owner_id, branchId: task.branch_id }` to the AbacGuard scope resolver so the guard itself enforces scope before the service is reached. Add unit tests for TC-05 and TC-06 in the logDisposition describe block.

### BLOCKER — `apps/api/src/modules/engagement/task.service.ts:274-276 and 322-325`

The pre-state guard at line 274 only checks `task.status === TaskStatus.DONE`. A task with status `cancelled` passes this check, enters the UnitOfWork, and the UPDATE clause `WHERE status != 'done'` matches the cancelled row (`'cancelled' != 'done'` is true), writing disposition and transitioning the task to `done`. This directly violates the Error Cases table ('Task status is already done or cancelled → CONFLICT 409') and the task state machine (CANCELLED has no allowed outbound transitions). The LLD comment claiming 'a cancelled task returning zero rows triggers CONFLICT' is factually wrong given the actual WHERE clause.

**Fix:** Change the pre-check at line 274 to: `if (task.status === TaskStatus.DONE || task.status === TaskStatus.CANCELLED) throw new DomainException(ERROR_CODES.CONFLICT, 'Task already completed or cancelled.');`. As defence-in-depth, also change the UPDATE WHERE clause at line 325 to `.where('status', 'not in', [TaskStatus.DONE, TaskStatus.CANCELLED])`. Add a unit test: `it('TC-08c: returns CONFLICT when task status is cancelled', ...)` in the logDisposition describe block.

### MAJOR — `apps/api/test/engagement/fr-102.e2e-spec.ts (missing file)`

The LLD §File Locations specifies `apps/api/test/engagement/fr-102.e2e-spec.ts` as the required API integration test file. It does not exist. The testing-contract requires Tier-2 FRs to have API integration tests (Jest + supertest + Testcontainers) covering all endpoints, happy paths, and each error path. Several scenarios from FR-102-tests.md cannot be verified at unit level: TC-04 (AUTH_REQUIRED — requires HTTP 401 from JwtAuthGuard), TC-05/TC-06 (FORBIDDEN scope — requires the full guard stack), TC-09 (VALIDATION_ERROR from the Zod ValidationPipe), and TC-12 (RATE_LIMITED — requires ThrottlerGuard). The project-wide deferral applies to Playwright E2E (TC-17/18), not to the Testcontainers API integration tier.

**Fix:** Create `apps/api/test/engagement/fr-102.e2e-spec.ts` using the Testcontainers harness (see `apps/api/test/integration/harness.e2e-spec.ts` for the pattern). Implement at minimum TC-04, TC-05, TC-06, TC-09, TC-12 as HTTP-level tests against the running Nest app, using the existing task factory and JWT helper.

### MINOR — `apps/api/src/modules/engagement/task.controller.ts:126`

The geo mapping contains a redundant type assertion: `(dto.geo as { lat: number; lng: number; accuracy_m: number }).accuracy_m`. The Zod-inferred type of `dto.geo` already includes `accuracy_m` (it is declared in `UpdateTaskDto` at `geo.accuracy_m: z.number().positive()`), so the `as { ... }` cast is unnecessary and suggests a type-narrowing confusion.

**Fix:** Replace the spread at line 124-127 with a direct property access without the cast: `geo: dto.geo != null ? { lat: dto.geo.lat, lng: dto.geo.lng, accuracy_m: dto.geo.accuracy_m } : null`. No cast is needed because the Zod type already carries accuracy_m.


## Test coverage

Unit tests (task.service.spec.ts) cover TC-01 through TC-03, TC-07, TC-08, TC-08b, TC-10, TC-10b, TC-10c, TC-11, TC-13, TC-14, TC-15, TC-16, plus state-machine transitions. UI component tests (DispositionForm.test.tsx) cover UI-01 through UI-07. Missing: (a) unit test for cancelled-task CONFLICT in logDisposition (TC-08c); (b) unit tests for RM cross-scope and BM cross-branch FORBIDDEN in logDisposition (TC-05/TC-06 equivalents); (c) the entire API integration test file (fr-102.e2e-spec.ts) required by the testing-contract for TC-04, TC-05, TC-06, TC-09, TC-12.
