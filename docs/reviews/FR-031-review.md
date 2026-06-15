# FR-031 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-031 (Hot-Lead Flag) backend logic is functionally sound: the hot-rule engine (H1–H8), cool-down path, HOT_LEAD outbox idempotency, and owner-writes discipline are all correctly implemented. However there are four concrete issues preventing approval: (1) the `LeadService.setScore` UPDATE omits an `org_id` WHERE predicate, allowing a cross-tenant update if lead_id is globally unique only by assumption — and its audit fallback uses `''` when the pre-read finds no row; (2) the UI components `LeadHotBadge` and `LeadScoreChip` specified in the LLD "File Locations" are entirely absent; (3) the API integration test file (`apps/api/test/allocation/scoring.e2e-spec.ts`) is absent, leaving T-07, T-10 through T-15 — all marked Required — unimplemented; (4) the UI component test files are also absent (U-01 through U-06 all Required). The H7 callback hot-flag side-effect in `StatusService.requestCallback` is correctly documented as a deferred AMBIGUITY (FR-062-A2), not a defect in this FR.

## Findings

### MAJOR — `apps/api/src/modules/capture/lead.service.ts:464-474`

LeadService.setScore UPDATE does not filter by org_id. The WHERE clause is only `lead_id = :leadId AND deleted_at IS NULL`. All other volatile-field mutators in the same file either carry an org_id filter on the UPDATE or on the preceding read used as the authoritative guard. Without the org_id predicate, a caller passing a valid but cross-tenant leadId (if UUID collision ever occurs or if the caller is compromised) writes across tenant boundaries. Additionally, the preceding SELECT uses executeTakeFirst (not executeTakeFirstOrThrow), so if the lead is absent the variable `lead` is undefined and the audit emits `org_id: ''` — a silent inconsistency.

**Fix:** Add `.where('org_id', '=', orgId)` to both the SELECT and the UPDATE in `setScore`. Thread `orgId` as a parameter to `setScore` (matching the signature already defined in shared-utilities.md: `LeadService.setScore(leadId, score, reasons, orgId, tx?)`). In the audit call replace `lead?.org_id ?? ''` with `orgId` after validating it is not empty. Update the caller in `ScoringAdapter` (line 60) to pass `context.org_id`.

### MAJOR — `apps/api/src/modules/allocation/scoring.adapter.ts:60`

ScoringAdapter calls `this.leads.setScore(leadId, result.score, result.reasons, tx)` without passing orgId. The LLD shared-utilities.md contract and the LLD §Shared Utilities table both list the signature as `LeadService.setScore(leadId, score, reasons, orgId, tx?)`. The current call matches an incorrect 4-argument form and will route to the wrong overload or silently omit the org filter when the fix above is applied. This is directly related to finding #1 but is a separate call-site defect.

**Fix:** Change the call to `this.leads.setScore(leadId, result.score, result.reasons, context.org_id, tx)` after the setScore signature is updated to accept orgId.

### MAJOR — `apps/web/src/components/lead/ (directory does not exist)`

The LLD File Locations table specifies `LeadHotBadge.tsx`, `LeadScoreChip.tsx`, `LeadHotBadge.test.tsx`, and `LeadScoreChip.test.tsx` under `apps/web/src/components/lead/`. None of these files exist — the directory itself is absent. The UI component tree in the LLD defines mandatory WCAG 2.1 AA requirements (aria-label on badge, prefers-reduced-motion, PARTNER role exclusion) and the test spec marks U-01 through U-06 as Required. The `HotLeadsWidget.tsx` found at `apps/web/src/components/dashboard/` is a different component and does not fulfil the FR-031 requirement.

**Fix:** Create `apps/web/src/components/lead/LeadHotBadge.tsx` (renders shadcn Badge with aria-label='Hot lead' when isHot=true, null otherwise), `LeadScoreChip.tsx` (shadcn Badge + Radix HoverCard with factor list, disclaimer, colour bands, null-score dash, prefers-reduced-motion, hideScore prop for PARTNER), and their corresponding `.test.tsx` files covering U-01 through U-06.

### MAJOR — `apps/api/test/allocation/ (directory and file do not exist)`

The LLD File Locations table specifies `apps/api/test/allocation/scoring.e2e-spec.ts` for API integration tests. This file and directory are absent. The test spec marks T-07 (scoring error does not block POST /leads — supertest), T-10 (PATCH rescore happy path), T-11 (authz FORBIDDEN out-of-scope RM), T-12 (401 unauthenticated PATCH), T-13 (PARTNER masking), T-14 (CUSTOMER surface masking), and T-15 (TX rollback) all as Required. The unit-tier T-07 in hot-rules.service.spec.ts tests the adapter's non-throw behaviour but does not test the actual HTTP layer or the lead row survival.

**Fix:** Create `apps/api/test/allocation/scoring.e2e-spec.ts` using Jest + supertest (or the project's Testcontainers harness for T-15) covering T-07 and T-10 through T-15 as specified in FR-031-tests.md. At minimum T-11 (FORBIDDEN) and T-12 (AUTH_REQUIRED) are required per the error-taxonomy testing contract.

### MINOR — `apps/api/src/modules/capture/lead.service.ts:483`

In `setScore`, the audit entry uses `org_id: lead?.org_id ?? ''` where `lead` may be undefined if the pre-read finds no row (the UPDATE itself still proceeds). An empty string `org_id` in `audit_logs` breaks the single-writer chain consumer's org scoping and may violate the NOT NULL constraint depending on schema. The `setHotFlag` method (line 763-766) correctly throws NOT_FOUND when `lead` is undefined — `setScore` should do the same.

**Fix:** After the `executeTakeFirst()` in setScore, add: `if (!lead) { throw new DomainException(ERROR_CODES.NOT_FOUND); }` — identical to the guard added in `setHotFlag`. Then use `lead.org_id` (non-nullable) in the audit append.


## Test coverage

Unit tests (hot-rules.service.spec.ts + scoring.service.spec.ts + lead.service.spec.ts): T-01 through T-09 and T-07 (unit variant) are all present and thorough. T-04/T-05/T-06 outbox transition tests in hot-rules.service.spec.ts are well structured. Missing: API integration tests T-07 (supertest), T-10 through T-15 (apps/api/test/allocation/scoring.e2e-spec.ts does not exist). Missing: UI component tests U-01 through U-06 (LeadHotBadge.test.tsx, LeadScoreChip.test.tsx do not exist). Missing: E2E tests E-01 through E-03 (apps/web/e2e/hot-lead.spec.ts does not exist — noted as deferred project-wide but still Required in the test spec). All SQL invariants INV-01 through INV-05 have no integration test runner file present.
