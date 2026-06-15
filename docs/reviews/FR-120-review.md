# FR-120 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-120 core report pack: auth/ABAC wiring, SQL parameterisation, LIMIT guards, zero-denominator rule, scope enforcement, and test coverage are all solid. Two real defects found: (1) a BLOCKER that incorrectly applies an FR-121 DPO restriction to FR-120 core reports, making all four core reports inaccessible to the DPO role despite the LLD explicitly granting it; (2) a MAJOR UI bug where the branch_id/team_id/owner_id filter inputs are rendered but their values are never captured in state and are silently dropped on Apply. One MINOR deviation from the LLD pseudocode (rejection_summary omits the stage_history join, using the simpler leads.stage column instead — functionally equivalent).

## Findings

### BLOCKER — `apps/api/src/modules/reporting/report.service.ts:71-73`

DPO role is blocked from all four FR-120 core reports (funnel_conversion, source_performance, rm_performance, rejection_summary) by the check `if (user.role === RoleCode.DPO && !DPO_ALLOWED_REPORT_CODES.has(code))`. DPO_ALLOWED_REPORT_CODES contains only 'consent_privacy_ops'. The FR-120 LLD explicitly states: 'DPO (M): scope is A for aggregates (DPO may see org-wide counts)' and auth-matrix grants DPO reports:M. This restriction belongs only to FR-121 differentiator codes — it must not block FR-120's four core report codes.

**Fix:** Add the four FR-120 core codes to DPO_ALLOWED_REPORT_CODES in reporting.constants.ts ('funnel_conversion', 'source_performance', 'rm_performance', 'rejection_summary'), or restructure the gate so it only applies to FR-121 differentiator codes: `if (user.role === RoleCode.DPO && DIFFERENTIATOR_REPORT_CODES.includes(code) && !DPO_ALLOWED_REPORT_CODES.has(code)) throw FORBIDDEN`. The DPO masking of owner_name in rm_performance (line 104-111) should remain.

### MAJOR — `apps/web/src/pages/reports/ReportFilterBar.tsx:6-11,39-45`

FilterState only tracks {from, to, product_code, source}. The branch_id, team_id, and owner_id input elements are rendered in the DOM (correctly for scope-visibility tests U-01/U-02) but they have no onChange handlers binding them to state, and handleApply() never reads or includes them in the params object passed to onApply. HEAD, BM, and SM users can type a branch_id or team_id filter but it is silently dropped on Apply — the API call is made without those params.

**Fix:** Add branch_id, team_id, and owner_id to FilterState (initialised to ''). Wire each input's onChange to update the corresponding state field. In handleApply(), include each value in params when non-empty, gated by the same visibility condition used for rendering (e.g. if (!isRm && isHeadOrBmOrSm && filters.branch_id) params.branch_id = filters.branch_id).

### MINOR — `apps/api/src/modules/reporting/report.repository.ts:317-358`

The rejection_summary query omits the stage_history join specified in the LLD pseudocode (which joined stage_history to filter `sh.to_stage = 'rejected'`). Instead the implementation uses `where('l.stage', '=', 'rejected')` on the leads table. Functionally equivalent and simpler, but it diverges from the spec pseudocode. The omission is correct, not a bug, but warrants noting so the LLD can be updated to reflect the simpler approach.

**Fix:** Update FR-120.md rejection_summary pseudocode to reflect that the stage_history join is unnecessary: the leads.stage = 'rejected' filter is sufficient to identify rejected leads. No code change required.


## Test coverage

Unit tests cover T-01 through T-10 (zero-denominator, scope enforcement for RM/BM/SM/PARTNER, dispatch routing, timeout path). Controller component tests cover T-07/T-20 (invalid code), T-11 (happy path envelope), T-24 (pagination meta), T-14 (rejection_summary dispatch). UI tests cover U-01 through U-06 (scope-aware filter visibility, zero-denominator cell rendering, loading/empty/error states). Missing: no unit test for the DPO FORBIDDEN gate (T-16 analogue specifically for the DPO-blocked-from-core-reports case), no test verifying that DPO can access funnel_conversion (this gap caused the BLOCKER to go undetected). T-12 (BM scope in source_performance) and T-13 (SM scope in rm_performance) are not covered in service spec tests, though the scope enforcement logic is exercised indirectly. API-layer tests T-15 through T-19, T-22, T-23, T-25 are deferred per project-wide e2e deferral.
