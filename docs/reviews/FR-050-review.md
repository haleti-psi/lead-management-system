# FR-050 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-050 backend logic (lead list, scope filtering, masking, saved-view CRUD, bulk-action gate) is well-implemented and correctly wired. Auth/ABAC decorators are present on every endpoint, owner-writes discipline is upheld, error codes conform to the taxonomy, all queries are parameterised Kysely with LIMIT ≤ 100, no `any` or `console.*` in production code, and PII masking is enforced in the service layer. However, the `POST /leads/bulk-action` endpoint omits the `Idempotency-Key` header processing required by the api-contract, the entire frontend implementation (4 files listed in LLD §File Locations) is absent, the frontend UI tests UT-1 through UT-5 have no implementation files to test, and TC-27 plus the 5 SQL invariant tests specified in FR-050-tests.md are not implemented.

## Findings

### MAJOR — `apps/api/src/modules/workspace/lead-list.controller.ts:55-66`

POST /leads/bulk-action does not read or process the Idempotency-Key header. The api-contract.yaml line 177 declares `parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }]` for this endpoint, and other state-creating POSTs (capture.controller.ts:57, 84) extract and forward the header. Without this, a network retry will dispatch the bulk mutation a second time, causing duplicate reassignments.

**Fix:** Add `@Headers('idempotency-key') idempotencyKey: string | undefined` to `bulkAction()` and forward it to `BulkActionService.execute()`. Implement replay detection using a Redis/DB idempotency cache keyed on `bulk-action:<orgId>:<idempotencyKey>` and return the cached `BulkActionResult` on replay (returning 200 with the original result, as the contract shows `200` not `201`).

### MAJOR — `apps/web/src/routes/workspace/leads/ (directory does not exist)`

All four frontend files specified in LLD §File Locations are absent: `routes/workspace/leads/lead-list.page.tsx`, `routes/workspace/leads/saved-view-chips.tsx`, `routes/workspace/leads/lead-filter-drawer.tsx`, and `lib/api/leads.ts`. The full UI component tree (WorkspaceLeadListPage, SavedViewChips, LeadFilterDrawer, DataTable wiring with MaskedField columns and BulkActionBar) is unimplemented.

**Fix:** Implement the four frontend files per LLD §UI Component Tree. The `lib/api/leads.ts` file must expose typed `listLeads`, `listSavedViews`, and `createSavedView` functions via the shared `apiClient`. The page must wire `DataTable` with `MaskedField` for name/mobile columns and `BulkActionBar` visible only when the user context has `bulk_action` capability.

### MAJOR — `apps/web/src/ (no spec files for FR-050 UI components)`

UI tests UT-1 through UT-5 required by FR-050-tests.md are completely absent. There are no test files for `DataTable` MaskedField rendering (UT-1), `BulkActionBar` visibility by role (UT-2), `SavedViewChips` filter dispatch (UT-3), empty/error/loading states (UT-4), or the save-view modal validation (UT-5). The testing-contract.md Tier-2 requirement includes frontend component tests.

**Fix:** Once the frontend files are implemented, add corresponding Vitest + Testing-Library spec files: assert that no raw 10-digit mobile appears in the DOM (UT-1), that BulkActionBar renders for BM but not RM (UT-2), that selecting a chip calls `listLeads` with the correct filter parameter (UT-3), that empty/error/skeleton states render on the matching API responses (UT-4), and that an over-wide-share validation error maps to an inline field error on `scope` (UT-5).

### MINOR — `apps/api/src/modules/workspace/ (no TC-27 or INV-1..INV-5 test file)`

TC-27 (bulk audit row is immutable — attempt to UPDATE/DELETE an `audit_logs` row is rejected) and SQL invariants INV-1 through INV-5 specified in FR-050-tests.md are not implemented. These are structural checks (no DB execution required for the service-level variant of TC-27) analogous to the `DataRightsService` append-only guard in `data-rights.service.spec.ts`.

**Fix:** Add a structural test that verifies `BulkActionService` never calls `updateTable('audit_logs')` or `deleteFrom('audit_logs')` (TC-27). The SQL invariants INV-1 through INV-5 are integration-tier checks suitable for the deferred Testcontainers wave, but should be noted in a test file with the queries ready.

### MINOR — `apps/api/src/modules/workspace/bulk-action.service.ts:98`

The bulk-action audit `detail` stores the raw `skipped_out_of_scope` lead ID array. These are UUIDs (not PII), but they expose which leads exist outside the caller's scope in the audit log — a mild information disclosure beyond what the LLD §Backend Flow bulk step 4 describes ('target count, filter/selection'). The LLD says 'No PII in detail' and only specifies 'target count', not the enumerated out-of-scope ID list.

**Fix:** Replace `skipped_out_of_scope: dto.lead_ids.filter(...)` (array of IDs) with `skipped_out_of_scope_count: dto.lead_ids.filter(...).length` in the audit detail to match the LLD description and avoid storing cross-scope ID references in the audit log.


## Test coverage

Backend unit/compile tests are thorough: TC-01/04 (scope compiled into SQL), TC-02/03 (masking projection), TC-05/06 (FORBIDDEN/AUTH_REQUIRED analogues), TC-07/08/09/14/25/26 (DTO validation), TC-10/11 (pagination clamp), TC-12/13 (sla_state/score_band filters), TC-15 (empty queue), TC-16/17/18/19/20 (saved-view CRUD), TC-21/22/23 (bulk-action gate), TC-24 (LeadScopeService per-role predicates). Missing: TC-27 (audit append-only invariant), INV-1 through INV-5 (SQL invariants), and all frontend tests UT-1 through UT-5 (no implementation files exist). E2E tests are project-wide deferred and acceptable.
