# FR-071 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-071 KYC Verification Orchestration is largely well-implemented: auth/ABAC guards are correctly applied (JwtAuthGuard global + AbacGuard @Requires('verify_doc') + role gate KYC/BM only), owner-writes discipline is respected (LeadService.setKycStatus is the sole leads writer, LeadIdentityRepository.enrich is used for lead_identities), all error codes are from the taxonomy, PAN/Aadhaar are masked/tokenised (never raw), all list queries are LIMIT-bounded, no `any` types or console.* calls. Three real issues block approval: (1) setKycStatus lacks optimistic locking despite the LLD specifying CONFLICT on stale version, (2) the idempotent-replay response never sets detail.reason='IDEMPOTENT_REPLAY' as specified, and (3) multiple required unit test cases are absent.

## Findings

### BLOCKER — `apps/api/src/modules/capture/lead.service.ts:831`

LeadService.setKycStatus does not implement optimistic locking. The LLD error table explicitly lists 'Stale optimistic lock on leads.version → CONFLICT (409)' and TC-071-025 is a required unit test. The implementation at line 831-841 performs an unconditional UPDATE with no expectedVersion check and no version bump, making the CONFLICT path unreachable. shared-utilities.md lists only setScore, setConsentStatus, and recomputeDuplicateStatus as no-version derived-field mutators — setKycStatus is not in that list.

**Fix:** Add an expectedVersion parameter to setKycStatus and its callers. The UPDATE should add .where('version', '=', expectedVersion) and .set({ version: eb => eb('version', '+', 1) }). On numUpdatedRows === 0n throw DomainException(ERROR_CODES.CONFLICT). Pass lead.version from kyc.service.ts (already fetched in getLeadForKyc). Add TC-071-025 asserting CONFLICT when the mock returns 0n updated rows.

### MAJOR — `apps/api/src/modules/kyc/kyc.service.ts:129`

Idempotent replay returns the original KycVerificationData DTO (this.toData(prior)) without setting detail.reason='IDEMPOTENT_REPLAY'. The LLD error cases table states '200 with original data + detail.reason=IDEMPOTENT_REPLAY'; TC-071-013 description expects this field. The test also does not assert for it, so the gap is doubly invisible.

**Fix:** Wrap the replay response in a carrier that signals the meta detail, or return an object that the ResponseEnvelopeInterceptor can decorate. Simplest: throw a purpose-built idempotent-replay sentinel that the exception filter maps to a 200 with {data: prior, meta: {detail: {reason: 'IDEMPOTENT_REPLAY'}}, error: null}, or annotate the request context. Also update TC-071-013 to assert result.meta?.detail?.reason === 'IDEMPOTENT_REPLAY' (or equivalent interceptor output).

### MAJOR — `apps/api/src/modules/kyc/kyc.service.spec.ts`

Multiple required test cases from FR-071-tests.md are absent: TC-071-005 (withdrawn consent state → FORBIDDEN CONSENT_MISSING — distinct from TC-071-004 which only tests absent consent), TC-071-014 (DB failure mid-write → full rollback, no partial state in kyc_verifications/data_sharing_logs/event_outbox), and TC-071-025 (optimistic lock CONFLICT — dependent on Blocker 1 fix). No kyc.controller.spec.ts exists, so controller-layer tests TC-071-010 (invalid PAN format), TC-071-011 (invalid type param), TC-071-012 (missing JWT), TC-071-015 (rate limit 429), and TC-071-016 (masked PAN in response, not raw) are all missing. Testing contract requires unit + component coverage for Tier 3.

**Fix:** Add TC-071-005 by mocking getActiveKycConsentId to return undefined when the consent row is in 'withdrawn' state (same repo mock, documents the intent). Add TC-071-014 by making insertDataSharingLog throw and asserting insertVerification rows are absent (UoW rollback). Add TC-071-025 after fixing the optimistic lock. Create apps/api/src/modules/kyc/kyc.controller.spec.ts covering TC-071-010, TC-071-011, TC-071-012, TC-071-015, and TC-071-016 using NestJS testing module.

### MINOR — `apps/api/src/modules/kyc/kyc.service.ts:174`

'provider_down' as KycException is a string cast to an enum type. KycException.PROVIDER_DOWN = 'provider_down' exists in @lms/shared (confirmed in packages/shared/src/enums/index.ts:349). The cast suppresses the type system and will silently pass if the enum value is ever renamed.

**Fix:** Replace 'provider_down' as KycException with KycException.PROVIDER_DOWN (already imported at line 13). Same applies to the maskedResponse object at line 177: change exceptionType: 'provider_down' to exceptionType: KycException.PROVIDER_DOWN.

### MINOR — `apps/api/src/modules/kyc/dto/run-kyc.dto.ts:20`

consentId is marked .optional() in all body schemas, deviating from the LLD which marks it required for all types. The code resolves consent server-side (AMBIGUITY FR-071-9 referenced inline), but no AMBIGUITY.md was written back per pipeline §9 and global CLAUDE.md §9 — the decision is undocumented in the canonical location.

**Fix:** Create docs/lld/AMBIGUITY-FR-071-9.md (or add to a project AMBIGUITY.md) recording the decision: 'consentId in request body is optional; the server authoritatively resolves the active granted kyc consent via getActiveKycConsentId and uses that consent_id for data_sharing_logs, decoupling the UI from a consent-id lookup.' Write-back to FR-071.md §Validation Logic to note this deviation.


## Test coverage

15 of 25 required TCs are implemented in kyc.service.spec.ts (TC-001 through 004, 006 through 009, 013, 018 through 020, 022 through 024). Missing: TC-005, TC-010, TC-011, TC-012, TC-014, TC-015, TC-016, TC-021, TC-025. TC-017 and TC-021 are partially covered inline within TC-001 and TC-002 respectively but lack dedicated tests. No e2e spec exists under apps/api/test/kyc.e2e-spec.ts (project-wide deferral is noted in the CLAUDE.md). No controller spec file exists. Coverage is approximately 60% of required Tier-3 unit/component cases.
