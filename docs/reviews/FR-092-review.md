# FR-092 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-092 (Partner Quality Score & Dashboard) is well-structured overall: auth/ABAC is properly applied via JwtAuthGuard + AbacGuard + @Requires, owner-writes are respected (only M10 writes `partners.quality_score`), Kysely queries are all parameterised, no `any`/`console.*` is present, PII fields (`contact_mobile`, `contact_person`) are excluded from the quality response payload, and the six-factor §12.4 formula is correctly implemented with null-denominator guards and clamping. Three real issues warrant REJECT: the api-contract.yaml entry for `GET /partners/{id}/quality` omits the `400` and `404` response codes that the implementation actually produces; the `resolveWindow` function uses UTC midnight boundaries while the LLD explicitly specifies IST midnight; and the T12 formula-correctness unit test from FR-092-tests.md is absent — the spec test (with deterministic inputs producing score 64) is never exercised. An additional minor finding is that the swallowed cache-write error discards the caught error object rather than logging it.

## Findings

### MAJOR — `docs/contracts/api-contract.yaml:244`

The `GET /partners/{id}/quality` contract entry declares only `200` and `403` responses. The implementation also produces `400` (VALIDATION_ERROR on invalid UUID path param or bad date range) and `404` (partner not found), both of which are required error codes per the LLD Error Cases table and the error taxonomy. These are missing from the contract.

**Fix:** Add `"400": { $ref: '#/components/responses/ValidationError' }` and `"404": { $ref: '#/components/responses/NotFound' }` to the `/partners/{id}/quality` GET entry in `api-contract.yaml`.

### MAJOR — `apps/api/src/modules/partner/partner-quality.service.ts:197-204`

`resolveWindow()` converts the `from`/`to` YYYY-MM-DD strings to `T00:00:00.000Z` / `T23:59:59.999Z` (UTC midnight), but the LLD §Endpoint explicitly states window boundaries are converted "to TIMESTAMPTZ at IST midnight" (UTC+5:30). A query window that starts at UTC midnight is 5h30m earlier than the intended IST start, causing leads created before the IST business day to be erroneously included.

**Fix:** Apply the IST offset when constructing `fromTs`/`toTs`: use `T00:00:00.000+05:30` and `T23:59:59.999+05:30` (or compute `new Date(dateStr + 'T00:00:00+05:30')`) to match the LLD contract.

### MAJOR — `apps/api/src/modules/partner/partner-quality.service.spec.ts`

Test T12 from FR-092-tests.md ("§12.4 formula correctness — known inputs") is not implemented. The spec requires a test with deterministic inputs (`total=20, contactable=16, duplicate=2, rejected=1, handed_off=10, uploaded=40, verified_first=36, this_median_tat=4h, min_all_tat=3h`) producing `quality_score=64`. The existing happy-path test uses a different input set (45 leads, score=62) and does not exercise the named formula-verification scenario.

**Fix:** Add a dedicated Jest unit test in `partner-quality.service.spec.ts` matching T12's exact inputs and asserting each computed factor value and the final score of 64, per the test specification.

### MINOR — `apps/api/src/modules/partner/partner-quality.service.ts:113-117`

The cache-write catch block `catch { this.logger.warn({ partner_id: partnerId }, '...') }` does not bind the caught error value (`catch (err)`). The underlying DB error object is silently discarded; only a static warning message is emitted. This makes diagnosing cache-write failures impossible from logs alone.

**Fix:** Change to `catch (err) { this.logger.warn({ partner_id: partnerId, err }, 'quality_score cache write failed (response unaffected)'); }` to include the error in the structured log entry.


## Test coverage

Unit tests cover the core happy path (score computation + caching), insufficient-data branch, zero-denominator factors, speed_index null-TAT, NOT_FOUND, PARTNER scope (own/other), RM FORBIDDEN, BM in-branch/out-branch, and cache-write failure non-fatal — aligning with T03/T04/T05/T06/T07/T09/T13/T14/T15. Missing: T12 (deterministic formula-correctness test with named inputs). API integration tests (T01/T02/T08/T10/T11/T16/T17/T18) and e2e UI tests are deferred project-wide; no gap there per project policy. Score-clamping is covered implicitly in the happy-path test but lacks explicit edge-case assertions for T13/T14 — these are minor omissions. INV-01 through INV-04 SQL invariant checks are described in the test spec but have no unit-level harness; their enforcement depends on integration test execution.
