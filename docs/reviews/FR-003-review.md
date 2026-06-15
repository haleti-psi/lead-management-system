# FR-003 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-003 backend logic (controller, service, repository, expiry job) is well-structured with correct ABAC decoration, parameterised Kysely queries, UnitOfWork atomicity, defence-in-depth four-eyes enforcement, and no `any`/`console.*`/swallowed-error violations. Unit and DTO-schema tests cover all Tier-3 unit scenarios (T03, T08–T17, T22–T23, T26). However, the expiry job writes audit rows with a hardcoded sentinel `DEFAULT_ORG_ID` for grants belonging to any tenant (multi-tenant correctness bug), all 16 API integration test scenarios are missing, and the entire UI component subtree is absent.

## Findings

### BLOCKER — `apps/api/src/modules/identity/break-glass-expiry.job.ts:99`

Expiry sweep emits audit rows with hardcoded `DEFAULT_ORG_ID` ('00000000-0000-0000-0000-000000000001') for every expired grant regardless of the grant's actual org. `expireDue` sweeps all tenants but returns only `grant_id[]`, discarding `org_id`. In any multi-tenant deployment, audit_logs rows for grants in other orgs will have the wrong `org_id`, breaking the audit-trail invariant INV-7 / INV-4.

**Fix:** Change `expireDue` to return `{ grant_id: string; org_id: string }[]` (add `org_id` to the SELECT and include it in the return type). In `runOnce`, pass `row.org_id` instead of `DEFAULT_ORG_ID` to `this.audit.append`. Remove the `DEFAULT_ORG_ID` import from the job file.

### MAJOR — `apps/api/test/ (file missing: break-glass.e2e-spec.ts)`

The LLD File Locations section and FR-003-tests.md list 16 test scenarios at the API integration layer (T01 full HTTP, T02, T04, T06, T07, T13, T14, T18–T21, T24, T25, T28). None exist — apps/api/test/break-glass.e2e-spec.ts is absent entirely. Critical paths not tested at the HTTP boundary include: AUTH_REQUIRED (T07), FORBIDDEN for RM role (T06), EntitlementService integration with active/expired/revoked grants (T18–T21), DPO positive path (T24), and audit append-only DB enforcement (T28).

**Fix:** Create apps/api/test/integration/break-glass.e2e-spec.ts using the project's Testcontainers harness (see harness.e2e-spec.ts). Implement all 16 API integration scenarios listed in FR-003-tests.md. At minimum T07, T18–T21, and T28 must exist as these cover security and data-integrity invariants that unit tests cannot reach.

### MAJOR — `apps/web/src/components/break-glass/ (directory missing)`

All five UI files specified in the LLD File Locations section are absent: BreakGlassGrantsTable.tsx, RequestGrantModal.tsx, ApprovalQueueTable.tsx, BreakGlassGrantStatusChip.tsx, and use-break-glass.ts. The frontend has no way to request, approve, or view break-glass grants. Playwright E2E tests (UI-01–UI-05) are also absent.

**Fix:** Implement the five UI components and the TanStack Query hook file as specified in the LLD UI Component Tree section, using existing shared primitives (DataTable, EntityForm, Modal, ConfirmDialog, Toast, StatusChip, apiClient). Add apps/web/e2e/break-glass.spec.ts covering UI-01 through UI-05.

### MINOR — `docs/data-model/schema.sql:303`

The `break_glass_grants.status` column default is `'active'`, but grants are now always inserted as `'pending'` by the two-step flow. The default is never exercised (the INSERT always provides an explicit `status`), but it is misleading and could cause silent incorrectness if a future INSERT omits the field.

**Fix:** Change the column default to `DEFAULT 'pending'` in the next Flyway migration to match the implementation's invariant.

### MINOR — `apps/api/src/modules/identity/break-glass.dto.ts:92`

BreakGlassGrantResponse.approverId is typed as non-nullable `string`, but the LLD endpoint spec (§Endpoints, POST /admin/break-glass 201 response) shows `"approverId": null`. Although the current two-call design always sets approver_id at creation so non-null is correct, the LLD example JSON is inconsistent with both the type and the implementation. If a future reviewer trusts the LLD JSON, they may expect null.

**Fix:** Update the LLD §Endpoints 201 response example to show the nominated approver UUID (not null), confirming that approverId is always set at creation under the two-call design. No code change needed.


## Test coverage

Unit tests (break-glass.service.spec.ts, break-glass.dto.spec.ts, break-glass-expiry.job.spec.ts) cover T01 (service slice), T02, T03, T05, T08–T17, T22–T23, T26 and additional edge cases. API integration tests (T01 full, T02 full, T04, T06, T07, T13, T14, T18–T21, T24–T25, T28) are entirely absent — apps/api/test/break-glass.e2e-spec.ts does not exist. Playwright E2E tests (UI-01–UI-05) are absent — apps/web/e2e/break-glass.spec.ts does not exist. The testing-contract requires integration-layer coverage for all Tier-3 FRs; the gap is substantial.
