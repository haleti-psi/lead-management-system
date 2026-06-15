# FR-114 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-114 is well-structured: auth/ABAC decorators are correct on all three staff endpoints, the state machine implementation is faithful to the LLD and contracts, UnitOfWork usage is correct, Kysely queries are parameterised and LIMIT-bounded, no `any` types or console.* calls exist in production paths, and test coverage is strong for service and controller tiers. Three issues prevent approval: the escalation job hard-codes a single org ID making it silently inactive for every other tenant; the T26 test does not assert the logger.warn call required by the spec (the null-return path does not trigger the catch that logs); and the Idempotency-Key replay path returns the raw cached data without injecting the `IDEMPOTENT_REPLAY` sub-reason that the LLD, error taxonomy, and T02 all require in the response.

## Findings

### MAJOR — `apps/api/src/modules/compliance/grievance-escalation.job.ts:45`

The escalation sweep is called with the hard-coded `ORG_ID_DEFAULT` constant (UUID `00000000-0000-0000-0000-000000000001`). In a multi-tenant deployment every org except the seed org is silently skipped. The LLD §Escalation Sweep says the sweep should process grievances scoped to each org; there is no mechanism here to iterate all orgs.

**Fix:** Inject a repository (or re-use GrievanceRepository) to fetch all distinct `org_id` values that have open/in_progress breached grievances, then call `runEscalationSweep(orgId, now)` per org. Alternatively, accept the org_id from the Cloud Tasks payload body (set by the Cloud Scheduler job definition per tenant) and validate it with InternalTaskGuard, making the single-tenant deployment explicit rather than implicit.

### MAJOR — `apps/api/src/modules/compliance/grievance.service.spec.ts:322-331`

Test T26 specifies 'logger.warn called with structured message' when no active SLA policy is returned. The test only verifies `sla_due_at` is null but never asserts `h.logger.warn` was called. Furthermore, when `computeDueAt` returns `null` (no policy, no exception), the code at service.ts:153 sets `slaDueAt = null` silently — the `logger.warn` is only inside the `catch` block (line 155-158) which fires on an exception, not on a null return. The warning is therefore never emitted on the null-policy path, and the test does not catch this gap.

**Fix:** After the try/catch, add an explicit `if (slaDueAt === null) this.logger.warn({ grievanceId }, 'No active grievance SLA policy; sla_due_at set to null');` in the happy non-exception path. Update T26 to add `expect(h.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ grievanceId: expect.any(String) }), expect.any(String));`.

### MAJOR — `apps/api/src/modules/compliance/grievance.controller.ts:88-92`

On an idempotency-key replay the controller returns the raw cached `GrievanceData` object directly (line 91). The LLD (step 12), error-taxonomy.md sub-reasons table, and test T02 all require `error.detail.reason = 'IDEMPOTENT_REPLAY'` in the response envelope. The `ResponseEnvelopeInterceptor` wraps `data` but has no mechanism to inject `error.detail` on a 200 path from a plain return value. The sub-reason is mentioned only in a comment and is never set in the actual response.

**Fix:** Return a discriminated object that the interceptor can recognise, or set a response header (e.g. `res.header('X-Idempotent-Replay', 'true')`) and adjust the interceptor to inject `error: { code: null, detail: { reason: 'IDEMPOTENT_REPLAY' } }` when the header is present. Align the T02 test to assert `error.detail.reason === 'IDEMPOTENT_REPLAY'` in the HTTP response body.

### MINOR — `apps/api/src/modules/compliance/grievance.service.ts:309`

`validateTransition` silently accepts no-op same-status transitions (`if (current === target) return;`). This means `PATCH { status: 'open' }` against an already-open grievance succeeds with a 200, writes an audit entry with `transition: { from: 'open', to: undefined }` (because dto.status is defined but transition is a no-op), and persists no meaningful change. The LLD does not explicitly allow no-op transitions and the 'at least one field' refine in UpdateGrievanceDto is already satisfied by `status` being present.

**Fix:** Either throw `VALIDATION_ERROR` when `current === target && dto.status !== undefined` (treat it as a caller error), or explicitly document and test this as an allowed no-op. If allowed, the audit.append call in `update()` should guard against emitting a transition detail when `dto.status === current`.

### MINOR — `apps/api/src/modules/self-service/grievance.service.ts:50`

The self-service module computes `sla_due_at` using wall-clock arithmetic (`Date.now() + thresholdMinutes * MINUTE_MS`) rather than delegating to `BusinessCalendarService.addBusinessMinutes`. This produces calendar-minutes instead of business-hours minutes, violating the SLA calculation contract specified in the LLD (§External Service Calls) and producing different SLA deadlines for customer-link grievances vs. internally-created ones on the same policy.

**Fix:** The self-service `GrievanceService` should call `SlaEngine.computeDue` (or inject `BusinessCalendarService` directly) instead of plain wall-clock arithmetic. This is a secondary motivation for the XFR-H3 consolidation: route FR-061 customer intake through `ComplianceModule.GrievanceService.create()` which already uses `SlaEngine`.


## Test coverage

Unit/component coverage is strong: T27-T30 (state machine), T25-T26 (SLA), T31-T32 (rollback), T33 (code-gen), T34-T35 (escalation sweep), T02 (idempotency controller), T09-T11 (DTO validation), T14-T23 (update lifecycle), T40 (UI status select), and ConfirmDialog are all covered in grievance.service.spec.ts, grievance.controller.spec.ts, grievance.dto.spec.ts, and GrievanceResolutionForm.test.tsx. E2E/integration tests (T01, T03-T08, T12-T13, T24, T34-T36) are project-wide deferred to the Testcontainers wave per manifest. Gap: T26 test body does not assert logger.warn; T02 does not assert the IDEMPOTENT_REPLAY sub-reason in the response envelope.
