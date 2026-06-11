# FR-122 Test Specification — Report Export Governance

**Tier: 3**
**Source LLD:** `docs/lld/FR-122.md`

---

## Test Cases

Minimum Tier-3 requirement: ≥ 10 test cases. This spec defines 22.

| # | Layer | Type | Description | Expected outcome |
|---|---|---|---|---|
| TC-01 | API | Happy path — create queued export | Authenticated HEAD user POSTs a valid export request for `funnel` report, `partial` masking, scope `A`, estimated rows below threshold | HTTP 202; `export_jobs.status = 'queued'`; `audit_logs` row with `action = 'export_generate'`; Cloud Tasks job enqueued |
| TC-02 | API | Happy path — export completion | Async worker processes TC-01 job: fetches data, applies masking, uploads to GCS, updates job | `export_jobs.status = 'completed'`; `artefact_ref` set; `row_count` set; `audit_logs` completion entry; `event_outbox` row `EXPORT_COMPLETED` |
| TC-03 | API | Happy path — download URL | GET /exports/{id} after completion | HTTP 200; `download_url` is a signed GCS URL; `artefact_ref` is NOT present in response; `audit_logs` row with `action = 'export_download'` |
| TC-04 | API | Happy path — list own exports | RM user calls GET /exports | HTTP 200; only rows where `requested_by = actor.user_id`; pagination applied (default limit 25) |
| TC-05 | API | Approval threshold gate | DPO requests `consent_ops` export with `masking_level = unmasked` | HTTP 409; `error.code = 'CONFLICT'`; `error.detail.reason = 'EXPORT_APPROVAL_REQUIRED'`; `error.detail.export_job_id` present; `export_jobs.status = 'awaiting_approval'`; job row persisted |
| TC-06 | API | Approval threshold gate — row count | HEAD user requests large export with valid masking but estimated rows ≥ EXPORT_APPROVAL_ROW_THRESHOLD | HTTP 409; `EXPORT_APPROVAL_REQUIRED`; `status = awaiting_approval`; job row created |
| TC-07 | API | Approval flow — happy path | Approver (SM, scope T ≥ requester's T) calls POST /exports/{id}/approve on awaiting_approval job | HTTP 200; `status = 'queued'`; `approver_id` set to approver user_id; audit entry written; Cloud Tasks job enqueued |
| TC-08 | API | Self-approval blocked | Requester calls POST /exports/{id}/approve on their own job | HTTP 403; `error.code = 'FORBIDDEN'`; `approver_id` remains null; job status unchanged |
| TC-09 | API | Approving already-queued job | Approver calls POST /exports/{id}/approve on a `queued` (not `awaiting_approval`) job | HTTP 409; `error.code = 'CONFLICT'` |
| TC-10 | API | Authz negative — RM cannot read BM export | RM calls GET /exports/{id} for a job `requested_by` a different user (BM) | HTTP 403; `FORBIDDEN` |
| TC-11 | API | Authz negative — no export capability | CUSTOMER-role token calls POST /exports (customer has no `export` capability over reports) | HTTP 403; `FORBIDDEN` |
| TC-12 | API | Masking level below role minimum | RM requests `masking_level = partial` (minimum for RM is `full`) | HTTP 400; `VALIDATION_ERROR`; `fields[0].field = 'masking_level'`; no `export_jobs` row created |
| TC-13 | API | Scope exceeds entitlement | RM (scope O) requests `scope = B` | HTTP 403; `FORBIDDEN`; no `export_jobs` row created |
| TC-14 | API | Validation — invalid report_code | POST /exports with `report_code = 'nonexistent_report'` | HTTP 400; `VALIDATION_ERROR`; `fields[0].field = 'report_code'` |
| TC-15 | API | Validation — missing purpose | POST /exports without `purpose` field | HTTP 400; `VALIDATION_ERROR`; `fields[0].field = 'purpose'` |
| TC-16 | Unit | Masking — partial masking in generated file | Async worker processes job with `masking_level = partial`; inspect output rows | PAN columns match pattern `ABCxxxx1F`; mobile matches `98xxxxxx10`; other PII columns replaced; non-PII columns intact |
| TC-17 | Unit | Masking — full masking | Async worker with `masking_level = full` | All PII columns are `***`; no PAN, mobile, Aadhaar-ref values in output |
| TC-18 | Unit | Watermark in file | Async worker generates file | First row of CSV contains user display name, user_id, ISO timestamp, report_code, masking_level |
| TC-19 | Unit | GCS upload failure — job marked failed | Mock GCS upload to throw `StorageException`; async worker runs | `export_jobs.status = 'failed'`; no partial artefact_ref stored; error logged with correlation_id and export_job_id; no EXPORT_COMPLETED outbox event |
| TC-20 | API | Transaction rollback — audit write failure | Force `AuditAppender.emit` to throw mid-UnitOfWork during POST /exports | `export_jobs` INSERT rolled back (no orphan row); HTTP 500; `INTERNAL_ERROR` |
| TC-21 | API | Rate limit enforcement | Submit 61 consecutive export POST requests from the same user within one minute | 61st request returns HTTP 429; `RATE_LIMITED` |
| TC-22 | E2E | Full export governance workflow | HEAD user requests large export → 409 awaiting_approval → SM approves → worker runs → HEAD downloads | File downloaded; watermark visible; audit log shows generate + approve + download entries |

---

## Test Case Detail

### TC-01 — Happy path: create queued export

```typescript
// apps/api/test/reporting/export.e2e-spec.ts
it('creates a queued export job for a below-threshold request', async () => {
  const actor = await factory.createUser({ role: 'HEAD' });
  const token = await signToken(actor);

  // Seed report data so COUNT query returns < threshold
  // (or mock ExportService.estimateRowCount to return 100)

  const res = await request(app.getHttpServer())
    .post('/api/v1/exports')
    .set('Authorization', `Bearer ${token}`)
    .send({
      report_code:   'funnel',
      filters:       { date_from: '2026-05-01', date_to: '2026-05-31' },
      scope:         'A',
      masking_level: 'partial',
      purpose:       'monthly_review',
    })
    .expect(202);

  expect(res.body.data.status).toBe('queued');
  expect(res.body.error).toBeNull();

  // Verify DB row
  const job = await db.selectFrom('export_jobs')
    .selectAll()
    .where('export_job_id', '=', res.body.data.export_job_id)
    .executeTakeFirstOrThrow();
  expect(job.status).toBe('queued');
  expect(job.requested_by).toBe(actor.user_id);

  // Verify audit log written
  const audit = await db.selectFrom('audit_logs')
    .selectAll()
    .where('entity_id', '=', job.export_job_id)
    .where('action', '=', 'export_generate')
    .executeTakeFirst();
  expect(audit).toBeDefined();
  expect(audit!.detail).not.toHaveProperty('pan');    // no PII in audit detail
});
```

### TC-05 — Approval gate: unmasked PII

```typescript
it('returns CONFLICT with EXPORT_APPROVAL_REQUIRED when masking_level is unmasked', async () => {
  const dpo = await factory.createUser({ role: 'DPO' });
  const token = await signToken(dpo);

  const res = await request(app.getHttpServer())
    .post('/api/v1/exports')
    .set('Authorization', `Bearer ${token}`)
    .send({
      report_code:   'consent_ops',
      filters:       { date_from: '2026-01-01', date_to: '2026-05-31' },
      scope:         'A',
      masking_level: 'unmasked',
      purpose:       'regulatory_audit',
    })
    .expect(409);

  expect(res.body.error.code).toBe('CONFLICT');
  expect(res.body.error.detail.reason).toBe('EXPORT_APPROVAL_REQUIRED');
  expect(res.body.error.detail.export_job_id).toBeDefined();

  // Job row must exist in awaiting_approval state
  const job = await db.selectFrom('export_jobs')
    .selectAll()
    .where('export_job_id', '=', res.body.error.detail.export_job_id)
    .executeTakeFirstOrThrow();
  expect(job.status).toBe('awaiting_approval');
  expect(job.approver_id).toBeNull();
});
```

### TC-10 — Authz negative: cross-scope read

```typescript
it('returns FORBIDDEN when RM reads an export job they did not create', async () => {
  const bm   = await factory.createUser({ role: 'BM' });
  const rm   = await factory.createUser({ role: 'RM', branch_id: bm.branch_id });
  const job  = await factory.createExportJob({ requested_by: bm.user_id });
  const rmToken = await signToken(rm);

  await request(app.getHttpServer())
    .get(`/api/v1/exports/${job.export_job_id}`)
    .set('Authorization', `Bearer ${rmToken}`)
    .expect(403);
});
```

### TC-16 — Unit: partial masking

```typescript
// apps/api/src/modules/reporting/export.service.spec.ts
describe('MaskingService applied in export worker', () => {
  it('masks PAN and mobile columns for partial masking level', () => {
    const row = { pan_masked: 'ABCDE1234F', mobile: '9812345678', name: 'Test User', branch: 'Mumbai' };
    const masked = maskingService.maskExportRow(row, 'partial');
    expect(masked.pan_masked).toMatch(/^[A-Z]{3}xxxx[0-9][A-Z]$/);
    expect(masked.mobile).toMatch(/^[6-9][0-9]xxxxxx[0-9]{2}$/);
    expect(masked.name).toBe('Test User');     // non-PII preserved
    expect(masked.branch).toBe('Mumbai');
  });
});
```

### TC-19 — GCS upload failure

```typescript
it('marks job as failed when GCS upload throws', async () => {
  const job = await factory.createExportJob({ status: 'queued' });
  jest.spyOn(gcsStorage, 'upload').mockRejectedValueOnce(new Error('GCS unavailable'));

  await exportGenerationTask.run(job.export_job_id);

  const updated = await db.selectFrom('export_jobs')
    .selectAll()
    .where('export_job_id', '=', job.export_job_id)
    .executeTakeFirstOrThrow();
  expect(updated.status).toBe('failed');
  expect(updated.artefact_ref).toBeNull();

  // EXPORT_COMPLETED must NOT be in outbox
  const outboxEvent = await db.selectFrom('event_outbox')
    .selectAll()
    .where('event_code', '=', 'EXPORT_COMPLETED')
    .where('aggregate_id', '=', job.export_job_id)
    .executeTakeFirst();
  expect(outboxEvent).toBeUndefined();
});
```

### TC-20 — Transaction rollback

```typescript
it('rolls back export_jobs insert when audit write fails', async () => {
  jest.spyOn(auditAppender, 'emit').mockRejectedValueOnce(new Error('audit failure'));
  const actor = await factory.createUser({ role: 'HEAD' });
  const token = await signToken(actor);

  await request(app.getHttpServer())
    .post('/api/v1/exports')
    .set('Authorization', `Bearer ${token}`)
    .send(validExportPayload)
    .expect(500);

  const jobs = await db.selectFrom('export_jobs')
    .selectAll()
    .where('requested_by', '=', actor.user_id)
    .execute();
  // No orphan row
  expect(jobs).toHaveLength(0);
});
```

---

## SQL Invariant Queries
*Each query must return 0 rows to pass. Run after integration tests on the test DB.*

```sql
-- INV-01: No export_jobs row without a corresponding audit_log(export_generate)
SELECT ej.export_job_id
FROM export_jobs ej
LEFT JOIN audit_logs al
  ON al.entity_id = ej.export_job_id
  AND al.action = 'export_generate'
WHERE al.audit_id IS NULL;
-- expect 0 rows

-- INV-02: No export_jobs row with status='completed' and artefact_ref IS NULL
SELECT export_job_id
FROM export_jobs
WHERE status = 'completed'
  AND artefact_ref IS NULL;
-- expect 0 rows

-- INV-03: No export_jobs row with status='completed' and row_count IS NULL
SELECT export_job_id
FROM export_jobs
WHERE status = 'completed'
  AND row_count IS NULL;
-- expect 0 rows

-- INV-04: No export_jobs row with approver_id = requested_by (self-approval never persisted)
SELECT export_job_id
FROM export_jobs
WHERE approver_id IS NOT NULL
  AND approver_id = requested_by;
-- expect 0 rows

-- INV-05: No audit_logs rows have been updated or deleted (append-only)
-- (This invariant is enforced at the DB trigger/REVOKE level; verify via DDL inspection)
-- Proxy check: no audit_log row has updated_at > created_at (no updated_at column on audit_logs)
-- Confirmed: audit_logs has no updated_at column in schema.sql — append-only enforced by design.
-- Invariant verified by schema structure.

-- INV-06: No EXPORT_COMPLETED outbox event for a failed export job
SELECT eo.event_id
FROM event_outbox eo
JOIN export_jobs ej ON ej.export_job_id::text = eo.aggregate_id::text
WHERE eo.event_code = 'EXPORT_COMPLETED'
  AND ej.status = 'failed';
-- expect 0 rows

-- INV-07: No export_jobs row with masking_level='unmasked' and status NOT IN ('awaiting_approval','completed')
-- (unmasked exports that bypassed approval gate)
SELECT export_job_id
FROM export_jobs
WHERE masking_level = 'unmasked'
  AND status NOT IN ('awaiting_approval', 'completed', 'failed', 'running');
-- expect 0 rows (queued unmasked means approval was bypassed — should never happen)

-- INV-08: No export_jobs row with status='awaiting_approval' that has approver_id set
-- (approval transitions job to queued; awaiting_approval rows should have null approver)
SELECT export_job_id
FROM export_jobs
WHERE status = 'awaiting_approval'
  AND approver_id IS NOT NULL;
-- expect 0 rows
```

---

## UI Test Scenarios

### Playwright E2E

**Scenario 1: Export button visible and creates queued job (TC-01 UI layer)**
```typescript
// apps/web/e2e/export-governance.spec.ts
test('HEAD user can request a below-threshold export from report viewer', async ({ page }) => {
  await loginAs(page, 'HEAD');
  await page.goto('/reports/funnel');
  await page.click('[data-testid="export-button"]');
  await page.selectOption('[data-testid="masking-level-select"]', 'partial');
  await page.fill('[data-testid="export-purpose-input"]', 'monthly review');
  await page.click('[data-testid="request-export-submit"]');
  await expect(page.locator('[data-testid="toast"]')).toContainText('Export queued');
});
```

**Scenario 2: Masking level select filtered by role minimum**
```typescript
test('RM export form only shows "full" masking option', async ({ page }) => {
  await loginAs(page, 'RM');
  await page.goto('/reports/funnel');
  await page.click('[data-testid="export-button"]');
  const options = await page.$$eval(
    '[data-testid="masking-level-select"] option',
    opts => opts.map(o => o.value)
  );
  expect(options).toEqual(['full']);
  expect(options).not.toContain('partial');
  expect(options).not.toContain('unmasked');
});
```

**Scenario 3: Approval required toast on large export**
```typescript
test('shows "requires approval" toast when threshold exceeded', async ({ page }) => {
  // Mock API returns 409 EXPORT_APPROVAL_REQUIRED
  await page.route('**/api/v1/exports', route =>
    route.fulfill({ status: 409, body: JSON.stringify(approvalRequiredFixture) })
  );
  await loginAs(page, 'HEAD');
  await page.goto('/reports/consent_ops');
  await page.click('[data-testid="export-button"]');
  await page.selectOption('[data-testid="masking-level-select"]', 'unmasked');
  await page.fill('[data-testid="export-purpose-input"]', 'audit');
  await page.click('[data-testid="request-export-submit"]');
  await expect(page.locator('[data-testid="toast"]')).toContainText('requires approval');
});
```

**Scenario 4: Download button only visible on completed jobs**
```typescript
test('download button is disabled for non-completed jobs', async ({ page }) => {
  await loginAs(page, 'HEAD');
  await page.goto('/exports');
  // queued job row
  const queuedRow = page.locator('[data-testid="export-row-queued"]').first();
  await expect(queuedRow.locator('[data-testid="download-btn"]')).toBeDisabled();
  // completed job row
  const completedRow = page.locator('[data-testid="export-row-completed"]').first();
  await expect(completedRow.locator('[data-testid="download-btn"]')).toBeEnabled();
});
```

**Scenario 5: Full governance workflow (TC-22)**
```typescript
test('full export governance: request → approve → download', async ({ page, context }) => {
  // HEAD requests large export → awaiting_approval
  const headPage = await context.newPage();
  await loginAs(headPage, 'HEAD');
  await headPage.goto('/reports/first_contact_sla');
  await headPage.click('[data-testid="export-button"]');
  await headPage.fill('[data-testid="export-purpose-input"]', 'compliance_audit');
  await headPage.click('[data-testid="request-export-submit"]');
  await expect(headPage.locator('[data-testid="toast"]')).toContainText('requires approval');

  // SM approves
  const smPage = await context.newPage();
  await loginAs(smPage, 'SM');
  await smPage.goto('/exports/approvals');
  await smPage.locator('[data-testid="approve-btn"]').first().click();
  await smPage.locator('[data-testid="confirm-dialog-confirm"]').click();
  await expect(smPage.locator('[data-testid="toast"]')).toContainText('approved');

  // Wait for async worker (mock in E2E) then HEAD downloads
  await headPage.goto('/exports');
  await headPage.waitForSelector('[data-testid="export-row-completed"]');
  const [download] = await Promise.all([
    headPage.waitForEvent('download'),
    headPage.locator('[data-testid="download-btn"]').first().click(),
  ]);
  expect(download.suggestedFilename()).toContain('first_contact_sla');
});
```

---

## Coverage Checklist

| Area | Tests covering it | Status |
|---|---|---|
| Happy path — create queued export | TC-01 | Required |
| Happy path — async job completion | TC-02 | Required |
| Happy path — download signed URL | TC-03 | Required |
| Happy path — list exports (own scope) | TC-04 | Required |
| Error: EXPORT_APPROVAL_REQUIRED (unmasked) | TC-05 | Required |
| Error: EXPORT_APPROVAL_REQUIRED (row threshold) | TC-06 | Required |
| Approval flow — happy path | TC-07 | Required |
| Error: self-approval blocked (FORBIDDEN) | TC-08 | Required |
| Error: approving non-awaiting job (CONFLICT) | TC-09 | Required |
| Authz negative — cross-scope read (FORBIDDEN) | TC-10 | Required |
| Authz negative — no export capability (FORBIDDEN) | TC-11 | Required |
| Validation: masking_level below role minimum (VALIDATION_ERROR) | TC-12 | Required |
| Validation: scope exceeds entitlement (FORBIDDEN) | TC-13 | Required |
| Validation: invalid report_code (VALIDATION_ERROR) | TC-14 | Required |
| Validation: missing purpose (VALIDATION_ERROR) | TC-15 | Required |
| Masking: partial masking correctness | TC-16 | Required |
| Masking: full masking correctness | TC-17 | Required |
| Watermark injection in generated file | TC-18 | Required |
| External service failure: GCS upload → job failed | TC-19 | Required |
| Transaction rollback on mid-write failure | TC-20 | Required |
| Rate limit enforcement (RATE_LIMITED 429) | TC-21 | Required |
| E2E full governance workflow | TC-22, UI scenarios | Required |
| SQL invariants (append-only, no orphans, no self-approval) | INV-01..08 | Required |
| artefact_ref NOT exposed in API response | TC-03 (assert absence) | Required |
| Audit log written for export_download | TC-03 | Required |
| No PII values in audit_logs.detail | TC-01 (assert) | Required |
| EXPORT_COMPLETED outbox emitted only on completion | TC-02 / TC-19 | Required |
| UI: masking select filtered by role | UI Scenario 2 | Required |
| UI: download button gated on status=completed | UI Scenario 4 | Required |
