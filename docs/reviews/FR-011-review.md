# FR-011 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-011 scoring implementation is partially correct but has three significant conformance gaps: (1) score/score_reasons are not stripped for PARTNER/CUSTOMER on the Lead-360 read path; (2) the PATCH /leads/{id} trigger path is entirely absent (Wave 5 deferral not acknowledged in the LLD); (3) LeadService.setScore silently swallows a missing-lead condition instead of throwing NOT_FOUND; (4) the post-commit transaction split contradicts the LLD's stated rollback invariant.

## Findings

### BLOCKER — `apps/api/src/modules/workspace/lead360.service.ts:88-89`

score and scoreReasons are unconditionally included in the Lead360Dto for all roles, including PARTNER and CUSTOMER. MaskingInterceptor (masking.interceptor.ts FIELD_MAP) does not mask score or score_reasons. The LLD §Score visibility and auth-matrix scoring_visibility=internal_roles_only mandate these fields be stripped for PARTNER and CUSTOMER roles.

**Fix:** In Lead360Service.getAggregate, after building the dto, null-out dto.score and dto.scoreReasons when user.role is RoleCode.PARTNER or RoleCode.CUSTOMER. Example: if (user.role === RoleCode.PARTNER || user.role === RoleCode.CUSTOMER) { dto.score = null; dto.scoreReasons = null; }. Also add test T18 (PARTNER sees no score) and T19 (BM sees score) from FR-011-tests.md.

### BLOCKER — `apps/api/src/modules/capture/capture.service.ts:361-371`

Scoring runs post-commit in its own separate UnitOfWork transaction (ScoringAdapter.evaluateAsync opens a new tx after the capture tx commits). The LLD §Transaction Boundaries explicitly states that if LeadService.setScore fails, the entire UnitOfWork rolls back — the lead must not be persisted with a partial score. With the current design, a setScore failure leaves a persisted lead with score=null and no rollback occurs, violating FR-011-tests.md T20 invariant ('NO lead row in DB' on setScore failure).

**Fix:** Move ScoringService.evaluate and LeadService.setScore calls inside the capture UnitOfWork, before it commits (step E11 or after E10), matching the LLD §Backend Flow steps 7b–7d. The catch-and-null pattern for scoring errors still applies but is inside the same tx so that a setScore DB failure causes full rollback.

### MAJOR — `apps/api/src/modules/capture/lead.service.ts:456-488`

LeadService.setScore does not guard against a missing or soft-deleted lead. When the pre-read SELECT returns null, the code falls through: the UPDATE silently matches 0 rows (no error), and the audit row is written with org_id='' which is an invalid UUID. Every other volatile-field mutator (setHotFlag, setConsentStatus, setKycStatus) throws NOT_FOUND on zero rows.

**Fix:** After the SELECT at line 457, add: if (!lead) { throw new DomainException(ERROR_CODES.NOT_FOUND); }. This is consistent with setHotFlag (lead.service.ts:764-766) and setConsentStatus (line 578-580).

### MAJOR — `apps/api/src/modules/capture/capture.controller.ts (absent — no PATCH /leads/:id endpoint)`

The PATCH /api/v1/leads/{id} (operationId: updateLead, x-frs: FR-050, FR-011, FR-031) endpoint is entirely absent from the codebase. FR-011 specifies re-scoring on scoring-relevant field changes via this endpoint. FR-011-tests.md T10, T13, T14, T15, T16, T17 all target this path and have no implementation. The LLD does not indicate this as a deferred dependency on FR-050.

**Fix:** Add a note in the LLD that the PATCH /leads/{id} trigger path for FR-011 is deferred pending FR-050 implementation (Wave 5). Add T10, T13–T17 to the deferred test registry in manifest.json. No code fix needed until FR-050 lands, but the reviewer verdict must be REJECT until the LLD and test coverage checklist accurately reflect the deferral.

### MAJOR — `apps/api/src/modules/allocation/scoring.service.spec.ts:3 (comment line)`

The spec file claims coverage of T01–T10 but T10 ('ScoringService.evaluate is NOT called when no scoring-relevant field is in the PATCH diff') is not present. T10 tests UpdateLeadUseCase which does not exist. The coverage checklist in FR-011-tests.md marks T10 as covered by this file but it is not.

**Fix:** Remove 'T10' from the scoring.service.spec.ts comment header, and register T10 as deferred (alongside the PATCH /leads/{id} endpoint) in manifest.json or the deferred test list.

### MINOR — `apps/api/src/core/masking/masking.interceptor.ts:21-28 (FIELD_MAP)`

score and score_reasons are not present in the MaskingInterceptor FIELD_MAP. The LLD §Score visibility states MaskingService / ResponseEnvelopeInterceptor strips these for PARTNER/CUSTOMER. Even if field-level stripping were added to the service layer, the interceptor provides no safety net.

**Fix:** Role-based nulling of score/scoreReasons is better handled in-service (see BLOCKER finding above) rather than via FIELD_MAP (which masks by format, not by role). Document in a comment that score/scoreReasons are role-gated in-service and not in the interceptor FIELD_MAP.

### MINOR — `apps/api/src/modules/allocation/scoring.service.ts:216-222`

When the score accumulator is non-finite (NaN/Infinity), the guard logs with lead_id: 'unknown' (hardcoded string) instead of the actual leadId parameter, making the log entry non-traceable.

**Fix:** Replace the hardcoded 'unknown' with the leadId parameter: this.logger.error({ raw, lead_id: leadId, module: 'scoring' }, 'Score accumulator is not finite — returning null');


## Test coverage

Unit tests (T01–T09, T11, T12) are well-covered in scoring.service.spec.ts and capture.service.spec.ts with deterministic fixtures. The AllocationModule seam wiring test is present. Missing or deferred: T10 (PATCH scoring-skip — UpdateLeadUseCase absent), T13–T17 (PATCH path — endpoint absent), T18 (PARTNER score masking — not implemented), T19 (BM score visible — not tested), T20 (setScore rollback — contradicts post-commit design), T21 (rate-limit 429). UI component tests U01–U07 (ScoreChip) are absent — ScoreChip.tsx and ScoreChip.test.tsx listed in LLD file locations do not exist in apps/web/src/components/capture/. E2E scenarios E01–E03 are project-wide deferred.
