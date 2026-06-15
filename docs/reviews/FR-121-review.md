# FR-121 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-121 implementation is largely correct for auth/ABAC scope enforcement, owner-writes, error codes, LIMIT enforcement, and PII handling. Four concrete defects block approval: (1) the LLD-specified 202 async threshold response path is unimplemented — timeout collapses to INTERNAL_ERROR instead; (2) the `data.summary` block (first_contact_sla top-level KPIs) and `data.reconciliation` block are never surfaced in the controller response envelope, violating the LLD §Response and §12.5; (3) the `meta.async_threshold_hit` flag is absent from every response; (4) `from`/`to` date validation accepts non-ISO formats. Several test spec scenarios (T23, T25/T26) and the AsyncThresholdBanner UI (U05) are untestable against the current implementation. The PARTNER selector hiding (U07) is also missing from ReportFilterBar.

## Findings

### BLOCKER — `apps/api/src/modules/reporting/report.service.ts:81-101`

The LLD §Backend Flow step 6 requires a fast COUNT(*) async-threshold check that returns HTTP 202 with export guidance when rows exceed REPORT_ASYNC_ROW_THRESHOLD. The implementation instead only has a wall-clock timeout (Promise.race) that throws INTERNAL_ERROR on expiry. There is no 202 response path, no estimateComplexity() method, and no REPORT_ASYNC_ROW_THRESHOLD config. Tests T25 and T26 cannot pass.

**Fix:** Add a ReportingService.estimateComplexity(code, filter) method that executes a fast COUNT(*) query. Before dispatching, check against config.get('REPORT_ASYNC_ROW_THRESHOLD') (default 5000). If exceeded, return HTTP 202 with { data: { message, export_endpoint: 'POST /api/v1/exports', suggested_body: { report_code, filters } }, meta: { correlation_id, async_threshold_hit: true }, error: null }. Add REPORT_ASYNC_ROW_THRESHOLD to environment-contract.md.

### BLOCKER — `apps/api/src/modules/reporting/report.service.ts:122-131 + apps/api/src/modules/reporting/dto/report-response.dto.ts`

The LLD §Success Response specifies data.summary (report-specific top-level KPIs, e.g. total_leads_in_scope, sla_compliance_pct for first_contact_sla) and data.reconciliation { numerator, denominator, rate_computed_from }. Neither field exists in ReportData DTO or the controller response. The DifferentiatorRepository.firstContactSla() does compute a summary object but it is dropped — only rows and total are returned from dispatch(). Test T23 (reconciliation block always present) cannot pass.

**Fix:** Extend ReportData to include optional summary and reconciliation fields. Update dispatch() to thread summary through from DifferentiatorRepository.firstContactSla(). For each rate-producing report, populate reconciliation: { numerator, denominator, rate_computed_from: 'numerator / denominator' } before returning. Update report-response.dto.ts and the frontend ReportData interface accordingly.

### MAJOR — `apps/api/src/modules/reporting/report.controller.ts:70-79`

The LLD §Response §meta specifies meta.async_threshold_hit (boolean). Every synchronous 200 response must include async_threshold_hit: false. The controller hardcodes meta as { correlation_id: '', pagination: { page, limit, total } } with no async_threshold_hit field. This breaks the frontend AsyncThresholdBanner check (meta.async_threshold_hit = true/false) and test T26.

**Fix:** Add async_threshold_hit: false to every 200 meta response, and async_threshold_hit: true (with HTTP 202) when the threshold is exceeded. Also note: correlation_id is hardcoded as empty string — it should be read from the CorrelationMiddleware context (e.g. req.correlationId).

### MAJOR — `apps/api/src/modules/reporting/dto/get-report-query.dto.ts:15-18`

The isoDate validator uses Date.parse(s) which is permissive and platform-dependent. It accepts datetime strings ('2026-06-09T12:00:00Z'), invalid dates that parse in some JS engines, and rejects valid YYYY-MM-DD in some edge cases. The LLD mandates YYYY-MM-DD format only. Test T17 ('09-06-2026' in dd-MM-yyyy) may silently pass or fail depending on the engine. VALIDATION_ERROR must reliably fire on non-YYYY-MM-DD input.

**Fix:** Replace the isoDate validator with a strict YYYY-MM-DD regex check: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'must be a valid ISO date.' }).refine(s => !Number.isNaN(Date.parse(s)), ...).transform(s => new Date(s)). This ensures only ISO date strings pass validation.

### MAJOR — `apps/web/src/pages/reports/ReportViewer.tsx (entire file) + apps/web/src/pages/reports/ReportsPage.tsx`

The LLD §UI Component Tree specifies an AsyncThresholdBanner shown when meta.async_threshold_hit = true, with a Button navigating to the Export screen. This component is entirely absent from ReportViewer.tsx. Test U05 (AsyncThresholdBanner visible) will fail. The frontend ReportData type in apps/web/src/lib/api/reports.ts also has no async_threshold_hit in its meta shape.

**Fix:** Add AsyncThresholdBanner component (or inline block) to ReportViewer that conditionally renders when meta.async_threshold_hit === true. Thread meta through from useReport hook (currently discards it). Expose meta.async_threshold_hit in the FetchReportResult type.

### MAJOR — `apps/web/src/pages/reports/ReportFilterBar.tsx:26-161`

LLD §UI Component Tree (test U07) specifies that the PartnerSelector is hidden for the PARTNER role (auto-bound to own partner_id). The ReportFilterBar has no partner_id input at all — it is entirely absent. While hiding it for PARTNER role is implicitly satisfied by its absence, the filter bar also never sends partner_id to the API for any role, meaning HEAD/BM cannot filter by partner even when the backend supports it. U07 passes vacuously but the partner filter functionality is missing.

**Fix:** Add a PartnerSelector input (hidden for PARTNER role; visible for HEAD/BM/SM). When userRole === 'PARTNER', do not render it (U07 requirement). For other roles, render a partner_id UUID input and include it in onApply params.

### MINOR — `apps/api/src/modules/reporting/report.controller.ts:72`

meta.correlation_id is hardcoded as empty string ('') in the controller response. The LLD §Response and architecture §Correlation require the correlation_id from the CorrelationMiddleware to be echoed in every response meta block. An empty correlation_id defeats distributed tracing.

**Fix:** Inject the correlation ID from the request context (e.g. req.headers['x-correlation-id'] or a CorrelationService) and set meta.correlation_id to it.

### MINOR — `apps/api/src/modules/reporting/differentiator.repository.ts:220-226`

avg_age_days in KycDocAgeingRow is typed as string but mapped as r.avg_age_days ?? '0' — if the DB returns null (no documents in window), the fallback is '0' rather than null. The LLD does not explicitly specify the zero-document behavior but returning '0' is misleading (implies 0-day age, not no data). Compare: avg_tat_hrs in productBranchHeatmap correctly returns null.

**Fix:** Return null when avg_age_days is null (no documents): avg_age_days: r.avg_age_days ?? null. Update the KycDocAgeingRow type to avg_age_days: string | null and propagate to frontend.


## Test coverage

Unit tests (differentiator.service.spec.ts) cover DPO gating (T28), dispatch routing to all 10 differentiator repo methods, PARTNER/BM/RM scope-filter rejection (T12/T13), zero-denominator mock pass-through (T20/T21/T22), DSA delegation stub path (T32/T33/T38), and response shape (T23 partial — report_code and generated_at). Missing: T24 (summed-numerator reconciliation math cannot be tested without reconciliation block), T25/T26 (async threshold — path not implemented), T35 (rate limit — integration-level only). Frontend tests (ReportsPage.test.tsx) cover U01-U06 and FR-121 tab presence and column rendering. Missing: U05 (AsyncThresholdBanner — component not implemented), U07 (PARTNER hides partner selector — field never rendered for any role). API-level Testcontainers tests (e2e-spec referenced as apps/api/test/reporting.e2e-spec.ts) were not found in the FR-121 grep output and may not be implemented yet for the differentiator codes.
