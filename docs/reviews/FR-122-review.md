# FR-122 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-122 implementation is structurally sound: auth/ABAC guards are correctly applied (JwtAuthGuard global + @Requires('export') on controller), owner-writes discipline is followed (only ExportRepository/ExportService write export_jobs), all error codes are from the taxonomy, PII is not logged (filter_keys only in audit detail), all list queries have LIMIT <= 100 via Kysely, no `any` types, no console.*, no swallowed errors. The async worker, GCS adapter, Cloud Tasks adapter, and approval state machine are correctly implemented. However, two MAJOR issues require resolution before approve: a UI bug that breaks export creation for all non-scope-A roles, and a missing required test case (TC-02).

## Findings

### BLOCKER — `apps/web/src/components/reporting/ExportRequestForm.tsx:52`

scope is hardcoded to 'A' in every export submission payload. Any user without scope-A entitlement (RM with scope O, BM with scope B, SM with scope T, KYC with scope B, PARTNER with scope P) will receive a 403 FORBIDDEN from ExportService.enforceScopeEntitlement because the requested scope A exceeds their entitlement. These roles cannot successfully create any export from the UI.

**Fix:** Derive the scope from the authenticated user's entitlement and pass it as a prop to ExportRequestForm (e.g. userScope: DataScope). Use that value in the submission payload instead of the hardcoded 'A'. Add a read-only scope display or allow the user to select within their maximum scope.

### MAJOR — `apps/web/src/components/reporting/ExportJobsPage.tsx:132-134`

window.open() and toast.success() are called directly in the render body of DownloadButton when data?.download_url && enabled. Side effects during render violate React's rendering model, will double-fire in StrictMode (dev), and will re-trigger on every re-render while the condition remains true — opening multiple browser tabs and showing duplicate toasts.

**Fix:** Move the window.open and toast.success calls into a useEffect: useEffect(() => { if (data?.download_url && enabled) { window.open(data.download_url, '_blank', 'noopener,noreferrer'); toast.success('Download started.'); setEnabled(false); } }, [data?.download_url, enabled]);

### MAJOR — `apps/api/src/modules/reporting/export.service.spec.ts (missing TC-02)`

TC-02 (happy path async job completion) is listed as Required in the FR-122-tests.md coverage checklist but is absent from export.service.spec.ts. No test asserts that OutboxService.emit is called with EventCode.EXPORT_COMPLETED when ExportService.generate() succeeds. The TC-19 negative path asserts the outbox event is NOT emitted on failure, but the positive emission on success is never verified — meaning the EXPORT_COMPLETED event could be silently removed without any test failing.

**Fix:** Add a test in export.service.spec.ts under the 'ExportService.generate — worker state transitions' describe block: mock outbox.emit, call service.generate(JOB_ID) on a QUEUED job with a working storagePort, then assert outbox.emit was called with { event_code: EventCode.EXPORT_COMPLETED, aggregate_type: 'ExportJob', aggregate_id: JOB_ID }.

### MINOR — `apps/web/src/components/reporting/ExportRequestForm.tsx:51`

filters is hardcoded to {} (empty object) in every export submission. The LLD specifies that date_from / date_to inside filters should be ISO-8601 validated with range <= 366 days. The form provides no date range inputs, so all exports will run against unbounded data. This means the backend row-count estimate will count all records, likely triggering the approval gate for most reports even for small-scope users who should be able to export immediately.

**Fix:** Add optional date_from / date_to inputs to ExportRequestForm (with client-side ISO-8601 and range <= 366 days validation). Include the filter values in the submitted filters object when the user provides them.

### MINOR — `apps/api/src/modules/reporting/export.service.ts:319-320`

After approve() commits the UnitOfWork, the service makes a second repo.findById() call purely to build the response object. This adds an unnecessary database round-trip on the hot approve path when all required field values (status: QUEUED, approver_id: actor.userId, and original job fields) are already available in memory.

**Fix:** Construct the ExportJobResponse directly from the in-memory awaitingJob and the known updated fields rather than issuing a second SELECT. Remove the second findById call and build: { ...awaitingJob, status: JobStatus.QUEUED, approver_id: actor.userId, updated_at: new Date() }.


## Test coverage

Backend unit tests (export.service.spec.ts): Good coverage of TC-01, TC-05, TC-06 (approval threshold), TC-07 (approval happy path), TC-08 (self-approval blocked), TC-09 (non-awaiting conflict), TC-10 (authz cross-scope), TC-12 (masking level enforcement), TC-13 (scope cross-check), TC-16/TC-17 (masking in worker), TC-18 (watermark), TC-19 (GCS failure), and PII-in-audit check. Missing: TC-02 (EXPORT_COMPLETED outbox event on completion), TC-11 (CUSTOMER role blocked — handled by AbacGuard at controller level, no unit-level test), TC-20 (transaction rollback on audit failure — would require integration context). Frontend component tests (ExportButton.test.tsx): covers maskingOptionsForRole, isMaskingAllowed, ExportRequestForm rendering + validation, ExportButton open/close, ExportJobsPage states, and ExportApprovalQueue confirm dialog. E2E tests are deferred project-wide. SQL invariants (INV-01..08) are well-specified. Overall coverage meets Tier-3 minimum for implemented cases, but TC-02 (Required) is absent.
