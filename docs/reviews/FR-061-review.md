# FR-061 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-061 (Customer Grievance Intake) has two BLOCKERs: a confirmed owner-writes violation (self-service M7 ships its own `grievances` writer in parallel with M12's canonical GrievanceService — tracked as XFR-H3 but not resolved) and an HTTP status code contract breach (LLD specifies 409 CONFLICT for token-expired/revoked/OTP-absent but the adapter collapses all three cases to `null` and the controller maps every null to 404 NOT_FOUND, so TC-03/04/05 would fail). Two MAJORs: the SLA threshold lookup occurs outside the UnitOfWork transaction (read/write window is not atomic), and the self-service service uses wall-clock arithmetic instead of the required SlaEngine/BusinessCalendarService (business-day aware). The mandatory API integration test file (FR-061.e2e-spec.ts) is entirely absent. A MINOR: `attachmentNote` is validated and then silently dropped (not written to any column, not logged).

## Findings

### BLOCKER — `apps/api/src/modules/self-service/grievance.service.ts:1, apps/api/src/modules/self-service/grievance.repository.ts:1`

Owner-writes violation (XFR-H3): the SelfServiceModule (M7) ships its own GrievanceService + GrievanceRepository that INSERT directly into `grievances`. auth-matrix.json resource_governance designates `grievances.writer = M12`. ComplianceModule already provides a GrievanceService.create(dto, ctx) seam explicitly intended for FR-061 reuse (compliance.module.ts:68–76, AMBIGUITY.md §XFR-H3). Two independent modules writing the same table violates the non-negotiable owner-writes rule.

**Fix:** Delete apps/api/src/modules/self-service/grievance.service.ts, grievance.repository.ts, and grievance.controller.ts. Import ComplianceModule's GrievanceService into SelfServiceModule. In the GrievanceController (now in self-service), call grievanceService.create({ source: 'customer_link', leadId: link.leadId, category: dto.category, description: dto.description }, { callerId: SYSTEM_ACTOR_ID_GRIEVANCE, orgId: link.orgId, predicate: undefined }) and map the GrievanceData response to the FR-061 envelope shape (grievanceId, grievanceNo, status, sla_due_at, message).

### BLOCKER — `apps/api/src/modules/self-service/customer-link.adapter.ts:55-58, apps/api/src/modules/self-service/grievance.controller.ts:35-38`

HTTP 409 CONFLICT required by LLD §Error Cases and test-spec TC-03/04/05 for token-expired, token-revoked (status != 'active'), and OTP-not-verified — but CustomerLinkAdapter.resolve() returns null for ALL three conditions, and the controller maps every null to NOT_FOUND (404). Callers that rely on distinguishing 409 (can retry with OTP) from 404 (link does not exist) will receive the wrong status code, and TC-03/04/05 assertions would fail.

**Fix:** Replace the single null return with a discriminated result type (e.g. { ok: ResolvedCustomerLink } | { error: 'NOT_FOUND' | 'CONFLICT' }). In CustomerLinkAdapter.resolve(): return { error: 'NOT_FOUND' } when the DB row is absent; return { error: 'CONFLICT' } when status != 'active', expires_at <= now(), purpose mismatch, or OTP session absent. In the controller, throw DomainException(ERROR_CODES.NOT_FOUND) for NOT_FOUND and DomainException(ERROR_CODES.CONFLICT) for CONFLICT.

### MAJOR — `apps/api/src/modules/self-service/grievance.service.ts:49-50`

SLA threshold lookup (`findGrievanceSlaThresholdMinutes`) is executed BEFORE the UnitOfWork transaction opens. If the SLA policy changes or is deactivated between the read (line 49) and the grievance INSERT (inside uow.run), the written sla_due_at will be inconsistent with the policy that was active at commit time. The LLD §3 places the SLA lookup inside the UnitOfWork block.

**Fix:** Move the call to repo.findGrievanceSlaThresholdMinutes inside the uow.run callback (before the grievance INSERT). Pass the transaction executor to the repo method (the method already accepts an optional `executor` parameter) so the read participates in the same snapshot.

### MAJOR — `apps/api/src/modules/self-service/grievance.service.ts:50`

SLA due-at is computed as wall-clock `Date.now() + thresholdMinutes * MINUTE_MS` instead of using the shared `SlaEngine` / `BusinessCalendarService` (shared-utilities.md: 'BusinessCalendarService.resolve + SlaEngine — one business-time clock; SLA due/breach'). The M12 GrievanceService.create correctly calls SlaEngine.computeDueAt(SlaTarget.GRIEVANCE, ...) which accounts for non-business hours and holidays. The self-service path would produce incorrect sla_due_at values for grievances submitted outside business hours.

**Fix:** Inject SlaEngine (from core/sla) and call slaEngine.computeDueAt(SlaTarget.GRIEVANCE, { branchId: null, regionId: undefined }) to obtain the business-calendar-aware due date; fall back to null on error with a warn log, matching the M12 pattern. This issue is also resolved automatically if the BLOCKER owner-writes fix is applied (the M12 GrievanceService already does this correctly).

### MAJOR — `apps/api/test/self-service/FR-061.e2e-spec.ts (absent)`

The LLD's File Locations table and FR-061-tests.md §TC-01 through TC-11 require an API integration test file at apps/api/test/self-service/FR-061.e2e-spec.ts. The file does not exist — the test directory contains only harness/los/retention specs. TC-01 (happy path DB assertions), TC-03/04/05 (CONFLICT guard), TC-09 (rate limit), TC-10 (rollback), and TC-11 (missing SLA) are all specified at the integration layer and are entirely unexercised. Only unit tests (grievance.service.spec.ts) exist.

**Fix:** Create apps/api/test/self-service/FR-061.e2e-spec.ts covering TC-01 through TC-11 as detailed in FR-061-tests.md. At minimum: TC-01 (201 + DB row + outbox row), TC-02 (404), TC-03 (409 expired), TC-04 (409 revoked), TC-05 (409 OTP absent), TC-06/07/08 (400 validation), TC-10 (rollback), TC-11 (null sla_due_at). TC-09 rate-limit can be skipped if Redis is unavailable in CI, but must be noted.

### MINOR — `apps/api/src/modules/self-service/grievance.controller.ts:22, apps/api/src/modules/self-service/grievance.service.ts:44`

The LLD §Auth Check specifies CustomerLinkGuard applied at the controller/route level ('sets req.customerLink'). The implementation skips the guard entirely and instead calls CustomerLinkAdapter.resolveForGrievance() inline in the handler. This is architecturally inconsistent with all other /c/{token}/* endpoints (which use the guard) and means the guard's canActivate path is not exercised for this route, making it harder to centrally audit or modify the auth boundary.

**Fix:** Apply @UseGuards(CustomerLinkGuard) at the controller or method level as documented. Remove the inline adapter call from the handler. Read link context from req[CUSTOMER_LINK_KEY] (set by the guard), or keep the adapter call and document the deliberate deviation from the guard pattern — but fix the CONFLICT/NOT_FOUND status code issue first regardless.

### MINOR — `apps/api/src/modules/self-service/grievance.service.ts:56-68, apps/api/src/modules/self-service/grievance.repository.ts:49-66`

`attachmentNote` from the validated DTO is accepted and validated (max 500 chars) but is never passed to the repository insert and never stored anywhere. The field is silently discarded with no log, comment, or explanation in the service code. While LLD AMB-3 notes there is no attachment column in Phase 1, the service should explicitly acknowledge the discard rather than silently ignoring a validated input field.

**Fix:** Add a comment in GrievanceService.createFromCustomerLink (at the point where dto is deconstructed) noting that dto.attachmentNote is intentionally not persisted in Phase 1 per LLD AMB-3. No behaviour change required, but the silence is a maintenance hazard.


## Test coverage

Unit tests (grievance.service.spec.ts): 3 service tests covering happy path, rollback propagation, and null-SLA case; 4 DTO validation tests (invalid category, empty description, description>2000, valid with attachmentNote). TC-01/TC-11 are effectively covered at unit level. TC-02 through TC-05 (guard rejections) and TC-06/07/08 (validation errors) are covered by DTO unit tests but NOT at integration/HTTP level. TC-09 (rate limit) and TC-10 (DB rollback with real tx) have no coverage at all — the mandatory API integration test file (apps/api/test/self-service/FR-061.e2e-spec.ts) is entirely absent. UI tests (GrievancePage.tsx): no test files found for UI-01 through UI-06 (GrievanceForm.test.tsx absent). E2E tests (apps/web/e2e/grievance.spec.ts): absent. Coverage falls well below the Tier 2 minimum for integration-layer tests.
