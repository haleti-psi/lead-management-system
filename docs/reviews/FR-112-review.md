# FR-112 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-112 (Data-Principal Rights & Retention Workflow) is structurally sound — auth guards, state machine, UnitOfWork transactions, error taxonomy, and Kysely parameterised queries are all correctly implemented. Two MAJOR issues block approval: (1) `MaskingService` is not injected into `DataRightsService`, so the DPO list response returns raw `customerProfileId` and related PII fields without masking, violating the LLD spec and the project masking non-negotiable; (2) the customer-link intake body schema (`CustomerRaiseDataRightsDto`) does not accept `lead_id` from the client at all, so the LLD-mandated scope-check (T34: validate supplied `lead_id` against the token's bound lead, 400 on mismatch) is completely absent. Additionally, T33 (masking test) and T34/T09 (customer-link scope tests) are missing from the unit test suite.

## Findings

### MAJOR — `apps/api/src/modules/compliance/data-rights.service.ts:87-100 (list) and :302-316 (toDataRightsData)`

MaskingService is never injected into DataRightsService. The DPO list response (GET /data-rights) returns raw customerProfileId and any PII-bearing fields without masking, violating LLD §Shared Utilities ('MaskingService — Mask customer_profile_id related PII in DPO list response') and the project masking non-negotiable. T33 is untested for the same reason.

**Fix:** Inject MaskingService into DataRightsService constructor. Apply masking in the list() method before returning: rows.map(r => toDataRightsData(r, this.masking, callerRole)). Add T33 unit test asserting masked fields are redacted for DPO callers.

### MAJOR — `apps/api/src/modules/compliance/customer-data-rights.controller.ts:18-26 (CustomerRaiseDataRightsDto) and :54-79 (customerRaiseDataRights handler)`

The customer-link DTO only accepts request_type; lead_id is stripped from the body. The LLD (§Validation §Customer-link path) mandates: 'if lead_id is supplied in the body it must match the token's bound lead_id — 400 VALIDATION_ERROR if mismatch'. DataRightsRaisePage.tsx (line 67) sends lead_id in the body. The scope-check is missing entirely. T34 ('lead_id does not match customer link scope') has no implementation and no test.

**Fix:** Extend CustomerRaiseDataRightsDto to accept optional lead_id (UUID). In the handler, after resolving the token link, check: if (dto.lead_id && dto.lead_id !== link.leadId) throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'lead_id does not match the customer link scope.'). Add T34 unit test for the controller.

### MINOR — `apps/api/src/modules/compliance/customer-data-rights.controller.ts:66`

callerId is set to link.leadId (a lead UUID) instead of a user or customer principal. The LLD notes this is a temporary proxy 'until FR-060 provides a customer user ID', but this value is written into audit_logs.actor_id. When FR-060 lands, the audit trail will contain lead UUIDs as actor references for pre-FR-060 records, making them ambiguous. This should be documented as a known limitation or a TODO.

**Fix:** Add an inline comment: // TODO(FR-060): replace link.leadId with link.customerUserId once FR-060 populates that field; pre-FR-060 audit entries will carry the lead UUID as actor_id proxy. No code change required now unless FR-060 is available.

### MINOR — `apps/web/src/components/compliance/DataRightsPage.test.tsx:152-158 (UI-05 test)`

The UI-05 test only asserts container is defined when rows are present. It does not render DataRightsDetailDrawer or exercise the disposition validation. No unit test file exists for DataRightsDetailDrawer. LLD-tests.md UI-05 requires: 'render DataRightsDetailDrawer, set status to fulfilled, leave disposition empty, assert inline validation error shown, form not submitted'.

**Fix:** Create apps/web/src/components/compliance/DataRightsDetailDrawer.test.tsx. Add a test that renders the drawer with a non-terminal in_review request, sets targetStatus to 'fulfilled', leaves disposition empty, submits the form, and asserts the disposition error message is displayed and mutateAsync is not called.


## Test coverage

Unit tests (data-rights.service.spec.ts) cover T01-T08, T10, T12-T13, T18-T21, T23-T32, T35-T39. UI component tests (DataRightsPage.test.tsx) cover UI-04, UI-07, UI-08, UI-09 with a stub for UI-05. Missing: T09 (customer link happy path — controller not tested), T11 (AUTH_REQUIRED — global guard, acceptable at unit level), T22 (rate limit — infra-level, acceptable), T33 (masking — no test because MaskingService is not wired), T34 (customer-link lead_id scope mismatch — no check implemented). E2E files (apps/api/test/compliance/data-rights.e2e-spec.ts, apps/web/e2e/compliance/data-rights.spec.ts) are absent — project-wide deferral is acceptable per manifest.
