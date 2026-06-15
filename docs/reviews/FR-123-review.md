# FR-123 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-123 backend logic (service, repository, DTO, constants, unit tests) is well-structured and mostly spec-conformant: parameterised Kysely queries throughout, LIMIT enforced, ip_device excluded from SELECT, ADMIN action-filter and lead_id zeroing correct, integrity badge logic correct, masking applied per role, audit.append on unmask path, no `any` types, no console.log, no swallowed application errors. Four findings prevent approval: the service intentionally deviates from the LLD masking spec for DPO+break-glass in the list view; the duplicate @Requires decorator fires the guard twice; all six frontend files required by the LLD are absent; and the API integration (e2e) test file is absent despite being listed in FR-123-tests.md as required.

## Findings

### MAJOR — `apps/api/src/modules/reporting/audit-explorer.service.ts:103-109`

The service comment and implementation explicitly always mask PII in the list view, even when the DPO holds an active break-glass grant. The LLD §Backend Flow step 11 states 'For DPO with hasBreakGlass: PII keys returned unmasked.' The implementation deviates from spec: it never checks break-glass on the list path, so a DPO with an approved grant still receives masked detail — contra the specification.

**Fix:** Either (a) implement the LLD-specified behaviour: after the break-glass check (already called in `search()`), pass `hasBreakGlass` to `toItem()` and skip masking for PII fields when `hasBreakGlass === true`; or (b) formally amend the LLD to record the decision to always mask in the list and confine unmasking exclusively to POST /audit/unmask, then re-run Gate C sign-off. Do not resolve silently — write the decision back to the LLD.

### MAJOR — `apps/api/src/modules/reporting/audit-explorer.controller.ts:42-48`

The @Requires(Capability.AUDIT_TRAIL, ...) decorator is applied at both class level (line 42, wrapping the entire controller) and again at method level on @Get() (line 47). This causes AbacGuard to execute twice for every GET /audit request — once from the class-level binding and once from the method-level binding — doubling the EntitlementService.can() call and any associated DB lookups.

**Fix:** Remove the redundant method-level @Requires on the @Get() handler (line 47). The class-level @Requires on @Controller('audit') already protects all routes. The @Post('unmask') method-level @Requires is also redundant for the same reason — remove it too, or move all @Requires to method level and remove the class-level one.

### MAJOR — `apps/web/src/pages/audit/ (absent), apps/web/src/components/audit/ (absent), apps/web/e2e/audit-explorer.spec.ts (absent)`

All six frontend files specified in the LLD §File Locations (Frontend) are missing: AuditExplorerPage.tsx, AuditFilterBar.tsx, IntegrityBadge.tsx, ExportConfirmDialog.tsx, AuditExplorerPage.test.tsx, and the Playwright E2E spec. The reporting components directory (apps/web/src/components/reporting/) exists for FR-122 but contains no audit-related components. UI test scenarios E2E-01 through E2E-08 and Vitest component test T-14/T-01 UI assertions are entirely unimplemented.

**Fix:** Implement all six frontend files as specified in the LLD §UI Component Tree, using the shared DataTable, MaskedField, StatusChip, EmptyState, LoadingSkeleton, ErrorState, ConfirmDialog, and PageHeader components. Implement the AuditExplorerPage.test.tsx Vitest suite covering at minimum masking display (T-14) and role-based column visibility (T-02). Implement the Playwright E2E spec covering E2E-01 through E2E-08.

### MAJOR — `apps/api/test/reporting/audit-explorer.e2e-spec.ts (absent)`

The API integration test file required by FR-123-tests.md §API Integration Test Scenarios is entirely absent. The apps/api/test/ directory contains only the integration sub-directory (harness, LOS, retention specs) and no audit-explorer e2e spec. Test cases T-01 through T-14 (Testcontainers + supertest) are unimplemented.

**Fix:** Create apps/api/test/reporting/audit-explorer.e2e-spec.ts implementing T-01 through T-14 using Jest + supertest + Testcontainers-Postgres as specified in FR-123-tests.md §API Integration Test Scenarios, including the seed setup (30 hash-chained audit_log rows, role-JWTs for DPO/ADMIN/RM/BM) and the SQL invariant checks INV-01 through INV-05.

### MINOR — `apps/api/src/modules/reporting/audit-explorer.controller.ts:66-76`

POST /audit/unmask is attributed in api-contract.yaml exclusively to x-frs: [FR-002, FR-003], but is implemented inside the FR-123 controller file and service without any FR-002/FR-003 cross-reference comment. The FR-123 LLD §No State Machine states 'No AuditAppender call' then the service JSDoc contradicts this. The contract attribution is inconsistent with the implementation location.

**Fix:** Add a code comment on the unmask controller method and service method referencing FR-002/FR-003 as the governing FRs (e.g. '@see FR-002 / FR-003'). Update the LLD §No State Machine section to acknowledge the AuditAppender.append call on the unmask path, which is a deliberate exception to the read-only constraint. This is a documentation/attribution issue only — no behaviour change needed.


## Test coverage

Unit tests (audit-explorer.service.spec.ts, audit-explorer.controller.spec.ts, dto/audit-explorer-query.dto.spec.ts) cover all seven unit scenarios in the test spec plus controller envelope shape and DTO unmask validation — adequate for the unit tier. The API integration test file (apps/api/test/reporting/audit-explorer.e2e-spec.ts) is entirely absent; T-01 through T-14 integration cases are not implemented. All six frontend files (AuditExplorerPage.tsx, AuditFilterBar.tsx, IntegrityBadge.tsx, ExportConfirmDialog.tsx, AuditExplorerPage.test.tsx, audit-explorer.spec.ts) are absent; UI and E2E scenarios E2E-01 through E2E-08 are unimplemented.
