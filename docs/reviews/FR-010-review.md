# FR-010 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-010 omnichannel lead capture is structurally sound: all three endpoints carry correct auth decorators, the UnitOfWork transaction wraps all required inserts atomically, owner-writes is respected (LeadService is the sole writer of `leads`), only permitted error codes are used, all list/lookup queries have LIMIT, no `console.*` or `any` in production paths, and the async post-commit scoring/duplicate hooks are guarded correctly. One MAJOR defect is confirmed: `name_masked` in the 201 response returns the full unmasked name for all non-strict callers because `MaskingService.mask('full_name', value)` without `{strict: true}` returns the value unchanged — no format-preserving first-name masking is applied. The LLD spec example shows `"name_masked": "Raxxxx Kumar"` but the code produces `"name_masked": "Ramesh Kumar"`. The unit test (line 460) confirms this by asserting the raw name while incorrectly labelling the check as an M-02 masking assertion. A MINOR issue: the `name_masked` guard in the JSON.stringify check (line 462) validates mobile absence but does not assert name is masked, so the masking gap is not caught by CI. Test coverage is otherwise comprehensive (13 unit + all service orchestration paths + bulk import + controller metadata + public-captcha). E2E/Testcontainers tests are deferred project-wide.

## Findings

### MAJOR — `apps/api/src/modules/capture/capture.service.ts:357`

`name_masked` is populated via `this.masking.mask('full_name', dto.identity.name)` without `{strict: true}`. `MaskingService.mask('full_name', value)` in non-strict mode returns the value unchanged (masking.service.ts:78 — `return options.strict ? this.firstNameOnly(value) : value`). The 201 response therefore exposes the raw full name in `name_masked` for every caller role except DPO/export. The LLD §Summary specifies `"name_masked": "Raxxxx Kumar"` and M-02 requires masking, but neither the service call nor MaskingService produce any partial-name mask at this level.

**Fix:** Either (a) apply a partial-mask algorithm for `full_name` at the non-strict level in `MaskingService` (e.g. mask all characters after the first two of each word component as `Raxxxx Kumar`) so `mask('full_name', 'Ramesh Kumar')` produces the LLD example, or (b) if the design intent is that `name_masked` holds the first-name-only for RM callers, pass `{strict: true}` here and update the LLD example accordingly. Also fix the M-02 assertion in `capture.service.spec.ts:460` to assert the masked form and add `expect(JSON.stringify(result.data)).not.toContain('Ramesh Kumar')` alongside the mobile check.

### MINOR — `apps/api/src/modules/capture/capture.service.spec.ts:460-462`

The unit test comment `// M-01/M-02: masked response, raw PII absent` asserts `name_masked: 'Ramesh Kumar'` (the raw full name) while M-02 in the test spec requires the raw name to be absent. The `JSON.stringify` guard at line 462 only checks for the mobile `'9876543210'` — it does not assert that the raw name `'Ramesh Kumar'` is absent. As a result the MAJOR masking defect above passes CI silently.

**Fix:** Add `expect(JSON.stringify(result.data)).not.toContain('Ramesh Kumar')` to the M-02 check (mirroring the M-01 mobile check). Update the `name_masked` assertion to match whatever masked form `MaskingService.mask('full_name', 'Ramesh Kumar')` should return once the MAJOR defect above is fixed.

### MINOR — `apps/api/src/modules/capture/capture.service.ts:344-359 and docs/contracts/api-contract.yaml:401-413`

`LeadCaptureData` (the 201 payload) includes `score_reasons`, `channel_created_by`, `duplicate_status`, and `kyc_status` fields beyond what the `Lead` schema in `api-contract.yaml` defines. The contract schema lists only `lead_id`, `lead_code`, `stage`, `product_code`, `is_hot`, `score`, `consent_status`, `kyc_status`, `name_masked`, `mobile_masked`. While extra fields are additive and not a breaking change, `score_reasons` and `channel_created_by` are not in the contract and are not validated by any schema-conformance test.

**Fix:** Either add `score_reasons` and `channel_created_by` to the `Lead` schema in `api-contract.yaml` (since the LLD §Response explicitly lists them in the 201 body), or document in the LLD that the contract schema is intentionally a subset. No code change needed; this is a contract-documentation gap.


## Test coverage

Unit tests U-01..U-13 are all present and pass. Service-level analogues of A-01..A-31, I-01..I-03, M-01, B-01..B-04 are implemented in capture.service.spec.ts and import-processor.job.spec.ts. Controller metadata and behaviour tests (CaptureController, PublicCaptureController) cover A-21..A-26 analogues and idempotency replay (I-01). Testcontainers integration tests and Playwright E2E tests are deferred project-wide. The only gap is that M-02 (name masking assertion) silently passes with an incorrect expected value, masking the MAJOR defect identified above.
