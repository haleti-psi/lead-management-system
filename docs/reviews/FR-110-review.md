# FR-110 — Stage 8 Per-FR Review

**Verdict:** APPROVE

> FR-110 (Purpose-wise Consent Ledger) implementation is correct and complete. Auth guards, ABAC, owner-writes, append-only enforcement, transaction boundaries, error codes, PII masking, LIMIT clauses, and test coverage all conform to spec. Three minor issues found: a TOCTOU race in the withdrawal pre-check (pre-transaction check matches the LLD flow diagram but INV-05 can theoretically be violated under concurrency), the api-contract FR-110 coverage map omits the customer consent endpoint (a contract artefact gap, not a code issue), and the ADMIN role receiving unmasked ip_device is explicitly sanctioned by the LLD but conflicts with the auth-matrix capability_conditions — the code correctly follows the LLD, and the ambiguity is already flagged in AMBIGUITY.md. No blockers found.

## Findings

### MINOR — `apps/api/src/modules/compliance/consent.service.ts:155`

hasPriorGrant withdrawal pre-check is called outside the UnitOfWork transaction. Between this check passing and the INSERT in appendConsent completing, a concurrent request could remove all prior grants (e.g. a supersede chain clearing the open grant), theoretically violating INV-05 (every withdrawn row must have a prior granted row for the same (lead_id, purpose)).

**Fix:** Move hasPriorGrant into appendConsent's UnitOfWork.run callback (pass tx to it), immediately before the INSERT. ConsentRepository.hasPriorGrant already accepts an optional executor parameter. Update the corresponding test T09 to assert the call uses the transaction object.

### MINOR — `docs/contracts/api-contract.yaml:53`

The x-fr-coverage entry for FR-110 lists only 'GET/POST /leads/{id}/consents', omitting 'POST /c/{token}/consent' which tags FR-110 in its own x-frs field (line 196). The coverage map is therefore incomplete for FR-110.

**Fix:** Update the FR-110 line in x-fr-coverage to: "GET/POST /leads/{id}/consents, POST /c/{token}/consent (co-owned with FR-060)". This is a contract artefact correction, not a code change.

### MINOR — `apps/api/src/modules/compliance/consent.service.ts:262`

ADMIN role is granted unmasked ip_device visibility (same as DPO). The LLD §Backend Flow step 4 and §Auth Check explicitly sanction this, but auth-matrix capability_conditions states 'ADMIN.*: NO standing lead-content access'. ip_device is classified as PII (LLD §Ambiguities 3). The code faithfully follows the LLD, but the spec is internally contradictory. The ambiguity is noted in code comments referencing AMBIGUITY.md §FR-110-1 but never formally recorded there.

**Fix:** Add an entry to AMBIGUITY.md §FR-110 documenting the ADMIN ip_device visibility decision and get product/compliance sign-off. If the decision is that ADMIN should NOT see unmasked ip_device (consistent with auth-matrix capability_conditions), change line 262 to: const ipDeviceVisible = ctx.role === RoleCode.DPO; and update T18 accordingly.


## Test coverage

All 34 named test cases from FR-110-tests.md are implemented. T01–T03 (happy paths), T04–T09 (validation errors), T10–T13 (auth/forbidden/not-found), T14–T18 (list/pagination/masking), T19 (customer path), T20–T24 (token expiry/revocation/rate-limit — guard-tier, covered by metadata assertions), T25–T28 (derivation matrix), T29 (append-only enforcement), T30–T31 (transaction rollback propagation), T32–T34 (audit/outbox effects). DTO-layer tests (T04–T06, T22–T23) in consent.dto.spec.ts. Controller metadata tests (T13, T20–T21, T24 analogues) in consent.controller.spec.ts. SQL invariants (INV-01 to INV-08) and UI tests (UI-01 to UI-07) are deferred per project-wide test strategy (Testcontainers/Playwright wave). Unit coverage is thorough for all service-layer and DTO-layer paths.
