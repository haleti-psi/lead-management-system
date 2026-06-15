# FR-001 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-001 implementation is structurally sound: all four endpoints are correctly decorated @Public(), parameterised Kysely queries throughout, no `any` types, no console.* in production code, no PII in logs or audit detail, argon2 password verify, rotating opaque refresh tokens, MFA challenge single-use Redis invalidation, and idle-timeout on refresh are all implemented correctly and match the LLD flow. However, four confirmed defects block approval: a contract-violating AUTH_REQUIRED toast message in the UI, a missing 403 response declaration in api-contract.yaml for POST /auth/login, and two mandatory test categories (rate-limit T-012/T-013/T-014 and internal-error T-025) that are entirely absent from the suite.

## Findings

### MAJOR — `apps/web/src/app/login/LoginPage.tsx:33`

AUTH_REQUIRED toast message is 'Invalid username or password.' — this deviates from the authoritative message in error-taxonomy.md ('Please sign in to continue.') and the LLD UI spec (line 422). The spec is explicit: the message must be generic and non-enumerating. While 'Invalid username or password.' is also non-enumerating, the pipeline requires the exact taxonomy-defined message to be used consistently across all surfaces.

**Fix:** Change `toast.error('Invalid username or password.')` to `toast.error('Please sign in to continue.')` to match error-taxonomy.md and the LLD UI component tree spec.

### MAJOR — `docs/contracts/api-contract.yaml:71-83 (POST /auth/login responses block)`

The api-contract.yaml POST /auth/login entry lists only 200, 400, 401, 429 responses. It omits the 403 (FORBIDDEN/ACCOUNT_LOCKED) response that the LLD specifies and the implementation actively produces when users.status='locked'. Any client or generator consuming this contract will not know a 403 is possible from this endpoint.

**Fix:** Add `"403": { $ref: '#/components/responses/Forbidden' }` to the responses block of POST /auth/login in api-contract.yaml.

### MAJOR — `apps/api/src/modules/identity/auth.service.spec.ts (missing T-012, T-013, T-014)`

FR-001-tests.md requires T-012 (login rate-limit 429 on 11th request), T-013 (MFA rate-limit 429), and T-014 (reset rate-limit 429) as API-layer test cases. None exist in the service spec or controller spec. ThrottlerGuard is wired at the controller level but is never exercised by any test in this FR's suite.

**Fix:** Add controller-level integration tests (using NestJS testing module with a mock ThrottlerGuard configured to reject) that verify the 429 RATE_LIMITED response for POST /auth/login, POST /auth/mfa, and POST /auth/reset. Alternatively, use the existing NestJS testing harness to assert that the global throttler is applied (e.g. confirm SkipThrottle is NOT present on login/mfa/reset handlers and that ThrottlerGuard is registered).

### MAJOR — `apps/api/src/modules/identity/auth.service.spec.ts (missing T-025)`

FR-001-tests.md T-025 requires that an injected DB failure (unhandled internal error) returns HTTP 500 INTERNAL_ERROR with no stack trace, SQL, or file path in the response body. No such test exists anywhere in the identity module suite.

**Fix:** Add a test that forces the repository to throw an unexpected error (e.g. mock findUserByUsername to throw new Error('DB conn lost')), sends a login request through the full Nest stack, and asserts: (1) response status 500, (2) body code is INTERNAL_ERROR, (3) body contains no 'stack', 'SQL', or file-path strings.

### MINOR — `apps/api/src/modules/identity/auth.service.spec.ts:163-179 (T-006)`

FR-001-tests.md T-006 specifies two observable outcomes: '401 on 5th attempt THEN 403 FORBIDDEN + ACCOUNT_LOCKED on next attempt'. The test covers only the 5th-attempt 401 and verifies the DB status write + Redis lockout key, but never makes a follow-up 6th call to confirm the next attempt returns 403. T-007 separately verifies a pre-seeded locked user but does not chain from a live failure sequence.

**Fix:** Extend T-006 to make a second login call (with 4 seeded + 1 new = 5 total, then a 6th call) and assert the 6th call throws DomainException with code FORBIDDEN and detail.reason='ACCOUNT_LOCKED'. This confirms the full two-step sequence the test spec describes.

### MINOR — `apps/web/src/app/login/LoginPage.test.tsx (missing UI-004)`

FR-001-tests.md UI-004 requires that a mocked 403 FORBIDDEN response with reason=ACCOUNT_LOCKED shows the toast 'Your account is locked. Contact your admin.' This scenario is handled in LoginPage.tsx notifyAuthError (line 29-31) but is not exercised by any test case in LoginPage.test.tsx.

**Fix:** Add a test that mocks useAuth().login to reject with ApiClientError({ code: 'FORBIDDEN', status: 403 }) and asserts that toast.error is called with 'Your account is locked. Contact your admin.'


## Test coverage

Happy-path (T-001 to T-004), lockout sequence (T-005 to T-007), MFA wrong OTP and replay (T-008, T-009), refresh expiry (T-010, T-011), password-reset happy/negative (T-015, T-016), unit logic (T-017 to T-019), validation pipe (T-020 to T-022), user-enumeration guard (T-023), no-PII-in-audit (T-024) are all present and well-structured. Missing: T-012/T-013/T-014 (rate-limit 429 RATE_LIMITED — ThrottlerGuard is wired but no test), T-025 (unhandled DB error → INTERNAL_ERROR 500 with no stack trace in body), UI-004 (FORBIDDEN/ACCOUNT_LOCKED toast in LoginPage.test.tsx). E2E tests T-026 to T-029 are correctly deferred project-wide. T-006 covers only the 5th-attempt path; the required follow-up 6th-attempt FORBIDDEN assertion from the test spec is not present (T-007 partially compensates with a pre-seeded locked user but is not the same scenario).
