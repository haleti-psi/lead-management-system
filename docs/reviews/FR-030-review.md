# FR-030 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-030 (Rules-Based Allocation) backend service is well-implemented: auth/ABAC decorators are correct, owner-writes discipline is observed (only LeadService.assignOwner writes leads), all list queries are LIMIT-bounded and fully parameterised via Kysely, no `any` types, no console.* calls, no swallowed errors, error codes are limited to the taxonomy, and the unit test suite covers all Path A/B scenarios specified in FR-030-tests.md (T01–T10 and service-level analogues of T17–T23). Two MAJOR gaps prevent approval: (1) the entire UI component tree (ReassignModal, AllocationRulesPage, CreateRuleDrawer, use-reassign-lead hook) is absent from apps/web — none of the five UI test scenarios can pass; (2) the integration e2e spec file (apps/api/test/allocation.e2e-spec.ts) listed in the LLD is missing, meaning tests T11/T24-T27/T34-T35 — which verify DB invariants (stage_history, audit_logs, event_outbox rows and rollback atomicity) — are entirely unimplemented. Two MINOR api-contract documentation gaps were also found.

## Findings

### MAJOR — `apps/web/src/components/allocation/ (directory does not exist)`

All four UI files declared in the LLD File Locations section are missing: ReassignModal.tsx, AllocationRulesPage.tsx, CreateRuleDrawer.tsx, use-reassign-lead.ts. UI test scenarios UI-01 through UI-05 from FR-030-tests.md cannot pass. The only web file referencing FR-030 is a comment in LeadDetailPage.tsx saying FR-030 UI 'is not rendered here'.

**Fix:** Implement apps/web/src/components/allocation/ReassignModal.tsx (shadcn Sheet + EntityForm + OwnerSelect + OverrideCapacitySwitch), AllocationRulesPage.tsx (DataTable + CreateRuleDrawer), and use-reassign-lead.ts (TanStack Query mutation calling POST /api/v1/leads/{id}/reassign), per LLD §UI Component Tree.

### MAJOR — `apps/api/test/allocation.e2e-spec.ts (file does not exist)`

The LLD File Locations section declares apps/api/test/allocation.e2e-spec.ts. This file is absent. API-layer tests T11, T15, T16, T24-T27, T28-T32, T34, T35 — which verify HTTP status codes, DB-level writes (stage_history, audit_logs, event_outbox rows), and full UnitOfWork rollback atomicity on AuditAppender failure — are unimplemented. The allocation.spec.ts comment at line 25 acknowledges these as 'deferred Testcontainers wave', but the test coverage checklist in FR-030-tests.md marks all of them as required.

**Fix:** Create apps/api/test/integration/allocation.e2e-spec.ts using the project's Testcontainers harness (harness.e2e-spec.ts pattern). At minimum cover: T11 (200 happy path + DB assertions for stage_history/audit_logs/event_outbox), T15 (401), T16 (403 RM), T27 (rollback: mock AuditAppender to throw, verify no stage_history row), T28 (GET /admin/allocation-rules pagination), T31 (POST /admin/allocation-rules 201), T34 (automatic allocation: captured→assigned transition with sla_first_contact_due_at set), T35 (no-match: owner_id=null, LEAD_ASSIGNED in event_outbox).

### MINOR — `docs/contracts/api-contract.yaml (paths section)`

GET /admin/allocation-rules and POST /admin/allocation-rules have no entries in the OpenAPI paths section — only in the x-fr-coverage summary string on line 26. The FR-030 admin-rules endpoints are not formally described with request/response schemas, parameters, or security annotations in the contract document that other agents and reviewers consume.

**Fix:** Add path entries under paths: for /admin/allocation-rules GET (x-frs: [FR-030], responses: 200/401/403) and POST (x-frs: [FR-030], responses: 201/400/401/403/409) with appropriate $ref references, mirroring the endpoint shapes documented in FR-030.md §Endpoints 2 and 3.

### MINOR — `docs/contracts/api-contract.yaml line 175`

The POST /leads/{id}/reassign entry only declares response codes 200, 403, and 409. It omits 400 (VALIDATION_ERROR — missing/invalid fields, verified by T12-T14), 401 (AUTH_REQUIRED — no/expired JWT, T15), and 404 (NOT_FOUND — unknown lead, T19). The implementation correctly returns all these codes but they are absent from the OpenAPI contract.

**Fix:** Add 400: { $ref: '#/components/responses/ValidationError' }, 401: { $ref: '#/components/responses/Unauthenticated' }, and 404: { $ref: '#/components/responses/NotFound' } to the /leads/{id}/reassign POST responses block.


## Test coverage

Unit tests (allocation.spec.ts): all specified T01-T10 scenarios plus additional boundary cases are covered — round_robin tie-break (T01), capacity fall-through (T02), method=capacity (T03), specialist (T04), partner (T05), escalation (T06), no-match unassigned pool (T07), priority ordering (T08), SM override_capacity forbidden (T10), DTO validation (T12-T14, T33). T09 (assignOwner optimistic lock) is covered in lead.service.spec.ts line 572, which is appropriate. API/integration tests (T11, T15-T16, T19-T32, T34-T35): entirely absent — the e2e spec file does not exist. UI tests (UI-01 through UI-05): cannot be written because the UI components do not exist.
