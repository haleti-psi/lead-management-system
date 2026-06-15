# FR-100 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-100 Task Management is largely well-implemented: auth/ABAC decorators are correct on all endpoints, the sweep controller correctly uses @Public() + InternalTaskGuard per auth-matrix.json, error codes match the taxonomy, all Kysely queries are parameterised and LIMIT-capped at 100, no `any` types or console.* usage, PII is excluded from audit detail and logs, and the state machine correctly blocks user-settable `overdue`. Two blocking gaps exist: (1) the ownership check in `update()` allows any BM/KYC/SM to mutate tasks in any branch/team without verifying ABAC scope over the task's lead; (2) the required T20 test (AuditAppender throws during task INSERT → UnitOfWork rolls back) is absent from task.service.spec.ts.

## Findings

### MAJOR — `apps/api/src/modules/engagement/task.service.ts:420-424`

The ownership check in `update()` uses `this.hasBranchOrTeamScope(caller)` as a blanket pass for BM, KYC, and SM roles without verifying the caller is actually scoped over the task's lead. A BM from Branch-A can PATCH tasks whose lead belongs to Branch-B — the ABAC scope over the lead is never checked. The LLD explicitly requires 'BM/SM scope over the lead', not just possession of BM/SM role. The `logDisposition()` path also has this gap (line 268 only checks role, not whether the lead is in the caller's branch/team).

**Fix:** Load the task via `findByIdWithLead()` (which joins the lead's `branch_id` and `lead_owner_id`) and enforce scope: for BM/KYC, assert `task.branch_id === caller.branchId`; for SM, assert `task.lead_owner_id in caller.teamMemberIds`. Apply the same check in `logDisposition()` after the existing role check. The `findByIdWithLead()` method already exists in `task.repository.ts` for exactly this purpose.

### MAJOR — `apps/api/src/modules/engagement/task.service.spec.ts (missing test)`

Test case T20 from FR-100-tests.md — 'UnitOfWork rolls back task insert when AuditAppender throws' — is not implemented in `task.service.spec.ts`. The T20 in `task-overdue-sweep.job.spec.ts` covers only the sweep-job `markOverdue` throw, which is a different code path. The LLD requires verifying that a task row is absent when `AuditAppender.append` throws during `create()`.

**Fix:** Add a test in `task.service.spec.ts` under the `create` describe block: mock `audit.append` to throw, assert the `repo.insert` call occurred but the error propagates (simulating UnitOfWork rollback), and verify `service.create(...)` rejects. Use the existing `fakeUow` pattern with a mock that propagates the audit throw out of `uow.run`.

### MINOR — `apps/api/src/modules/engagement/task.controller.ts:116-134`

The `PATCH /tasks/:id` controller routes any body containing `disposition != null` to `TaskService.logDisposition()`, which enforces RM/BM-only access (FR-102 restriction). This means SM, HEAD, and KYC users — all of whom have `edit_lead` capability per auth-matrix.json — receive FORBIDDEN when they send a PATCH body with `disposition`. The FR-100 LLD says SM and KYC can update tasks; this undocumented routing restriction is not surfaced in the FR-100 LLD and will surprise callers who expect 200 based on the auth matrix.

**Fix:** Document this routing restriction in the controller's JSDoc and in the api-contract.yaml entry for `PATCH /tasks/{id}` (note that disposition field triggers FR-102 role restriction). Alternatively, only call `logDisposition()` for the call/visit task types, letting SM/HEAD/KYC go through the general `update()` path even when `disposition` is provided.


## Test coverage

T01, T02, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, T15, T16, T17, T18, T19 are covered across task.service.spec.ts and task-overdue-sweep.job.spec.ts. T03 (invalid enum type) is substituted in the spec with a FORBIDDEN test (valid given Zod catches invalid enums at the controller boundary before the service). T20 (UnitOfWork rollback when AuditAppender throws on task INSERT) is NOT covered — the sweep job's T20 is a different code path. The controller spec covers delegation to the service but does not cover ABAC boundary cases. E2E tests (fr-100-tasks.e2e-spec.ts) are deferred project-wide per the LLD note.
