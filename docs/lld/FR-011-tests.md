# FR-011: Lead Quality Enrichment & Score at Capture — Test Specification

**Tier: 2** | **Source LLD:** `docs/lld/FR-011.md`

---

## Test Cases

Minimum required for Tier 2: ≥ 5 test cases covering happy path + each error code the FR can raise + authz both ways + validation + boundaries.

| # | Layer | Name | Setup | Action | Expected | Notes |
|---|---|---|---|---|---|---|
| T01 | Unit | `ScoringService.evaluate` returns correct score and reasons for a fully-enriched lead | Lead with `pan_token` set, `pin_code`, `requested_amount` = 1 500 000, active partner with `quality_score=80`, `preferred_language=Hindi`, `employment_type=salaried`, `asset_type=new` | `ScoringService.evaluate(leadId, mockTx)` | `score = 65` (mobile 10 + pin 8 + amount 7 + pan 15 + language 5 + partner_good 10 + employment 5 + asset 5 = 65); `score_reasons` includes `mobile_verified`, `pin_present`, `requested_amount_present`, `pan_present`, `language_preference_set`, `partner_quality_good`, `employment_type_present`, `asset_details_present` | Deterministic fixture; no DB |
| T02 | Unit | `ScoringService.evaluate` applies `pan_missing_penalty` when PAN absent at `pan_required_at=at_capture` | Lead with `pan_token=null`; `product_configs.pan_required_at='at_capture'`; all other fields absent | `ScoringService.evaluate(leadId, mockTx)` | `score_reasons` includes `pan_missing_penalty`; total score reduced by 15 relative to the base; score clamped to `[0, 100]` | BRD edge case: missing PAN lowers score |
| T03 | Unit | `ScoringService.evaluate` applies `source_high_rejection` penalty for penalised source | `source_attributions.source` is in the configured high-rejection list (seed: `'DSA'` with rejection rate above threshold); active `ConfigurationVersion` contains the penalised source list | `ScoringService.evaluate(leadId, mockTx)` | `score_reasons` includes `source_high_rejection`; score decreased by 10 | BRD edge case: historically-high-rejection source penalised |
| T04 | Unit | `ScoringService.evaluate` applies `partner_high_risk` penalty for risky partner | Partner `quality_score=30`, `risk_category=high`, `status=active` | `ScoringService.evaluate(leadId, mockTx)` | `score_reasons` includes `partner_high_risk`; score decreased by 10 (no `partner_quality_good` bonus) | Mutually exclusive with `partner_quality_good` |
| T05 | Unit | `ScoringService.evaluate` clamps score to 0 when all penalties apply | Lead with all penalty factors (no PAN at capture, high-rejection source, high-risk partner) and no positive factors except mobile | `ScoringService.evaluate(leadId, mockTx)` | `score >= 0` (never negative); `score_reasons` non-empty | DB constraint `ck_leads_score` enforced |
| T06 | Unit | `ScoringService.evaluate` clamps score to 100 when all positive factors apply simultaneously | All positive factors apply; raw sum exceeds 100 | `ScoringService.evaluate(leadId, mockTx)` | `score = 100`; all positive reason codes present | Ceiling clamp |
| T07 | Unit | `ScoringService.evaluate` falls back to built-in defaults when no active `ConfigurationVersion` exists | No `ConfigurationVersion` row with `config_type='scoring_rules'` and `status='active'` in mock | `ScoringService.evaluate(leadId, mockTx)` | Service uses built-in default weights; returns valid score and reasons | Graceful fallback |
| T08 | Unit | `ScoringService.evaluate` returns `{ score: null, reasons: null }` and logs when a dependency read fails | `ScoringRepository.loadContext` mock throws a database error | `ScoringService.evaluate(leadId, mockTx)` | Returns `{ score: null, reasons: null }`; does NOT rethrow; pino logger called with `level='error'` and `lead_id` | BRD rule: scoring error never blocks capture |
| T09 | Unit | `ScoringService.evaluate` skips partner lookup when `partner_id` is null | `source_attributions.partner_id=null` | `ScoringService.evaluate(leadId, mockTx)` | No `partner_quality_good` or `partner_high_risk` in reasons; no error | Direct source leads (no DSA partner) |
| T10 | Unit | Score re-evaluation is skipped on PATCH when no scoring-relevant field is in diff | `UpdateLeadUseCase` called with `{ priority: 'high' }` only (non-scoring field) | `updateLeadUseCase.execute(leadId, dto, user)` | `ScoringService.evaluate` is NOT called (mock assert `toHaveBeenCalledTimes(0)`) | Performance guard; avoids unnecessary re-scores |
| T11 | API | `POST /api/v1/leads` returns `score` and `score_reasons` in 201 response | Seeded DB; valid JWT for RM; `CreateLeadDto` with pin, amount, language | `POST /api/v1/leads` (supertest) | HTTP 201; `data.score` is integer `[0, 100]`; `data.score_reasons` is non-empty string array | Happy path: score present on create |
| T12 | API | `POST /api/v1/leads` returns `score: null` in 201 when `ScoringService` is mocked to throw | Seeded DB; `ScoringService` Jest mock throws on `evaluate` | `POST /api/v1/leads` | HTTP 201; `data.score = null`; `data.score_reasons = null`; lead row exists in DB | Scoring failure does not block capture |
| T13 | API | `PATCH /api/v1/leads/{id}` with scoring-relevant field returns updated score in 200 | Lead exists with `score=40`; RM owns the lead; valid JWT | `PATCH /api/v1/leads/{id}` `{ requested_amount: 2000000, expected_version: 1 }` | HTTP 200; `data.score` reflects re-evaluated score (greater due to `high_amount`); `data.score_reasons` contains `high_amount` | Re-score on relevant field change |
| T14 | API | `PATCH /api/v1/leads/{id}` returns 409 when `expected_version` is stale | Lead version=2 in DB; request sends `expected_version: 1` | `PATCH /api/v1/leads/{id}` `{ requested_amount: 500000, expected_version: 1 }` | HTTP 409; `error.code = 'CONFLICT'`; `data = null` | Optimistic-lock enforcement |
| T15 | API | `PATCH /api/v1/leads/{id}` returns 403 when RM tries to update another RM's lead | Lead `owner_id` = RM-B; JWT = RM-A; both in same branch | `PATCH /api/v1/leads/{id}` from RM-A | HTTP 403; `error.code = 'FORBIDDEN'` | Authz negative: RM scope = O (own leads only) |
| T16 | API | `PATCH /api/v1/leads/{id}` returns 401 when no JWT provided | Any lead | `PATCH /api/v1/leads/{id}` with no `Authorization` header | HTTP 401; `error.code = 'AUTH_REQUIRED'` | Authz negative: unauthenticated |
| T17 | API | `PATCH /api/v1/leads/{id}` returns 404 for a non-existent lead | No lead with the given `lead_id` | `PATCH /api/v1/leads/{id}` | HTTP 404; `error.code = 'NOT_FOUND'` | Standard not-found path |
| T18 | API | `score` and `score_reasons` are absent from response for PARTNER-role user | Lead submitted by PARTNER-A (their own submission); JWT = PARTNER-A | `GET /api/v1/leads/{id}` by PARTNER | HTTP 200; `data` does NOT contain `score` or `score_reasons` fields | Masking: internal score not exposed to PARTNER |
| T19 | API | `score` and `score_reasons` are present for BM-role user viewing own branch lead | Lead in BM's branch; JWT = BM | `GET /api/v1/leads/{id}` by BM | HTTP 200; `data.score` is integer or null; `data.score_reasons` present | BM has `view_lead` with scope B; score visible |
| T20 | API | Transaction rollback: if `LeadService.setScore` DB write fails, lead is not persisted | Force `leads` UPDATE to fail inside UnitOfWork (inject error after create, before setScore commit) | `POST /api/v1/leads` | HTTP 500 (INTERNAL_ERROR); NO lead row in DB; NO audit_log row | Full rollback: no partial state |
| T21 | API | Rate limit: 61st mutation within one minute returns 429 | Seeded RM; 60 PATCH requests sent within 60 s | 61st `PATCH /api/v1/leads/{id}` | HTTP 429; `error.code = 'RATE_LIMITED'`; `Retry-After` header present | NFR: 60 mutations/min per user |

---

## SQL Invariant Queries

Run after each test scenario; all must return 0 rows:

```sql
-- INV-01: No lead has a score outside [0, 100]
SELECT lead_id
FROM leads
WHERE score IS NOT NULL
  AND (score < 0 OR score > 100)
LIMIT 1;

-- INV-02: No lead has score_reasons=null when score is non-null
SELECT lead_id
FROM leads
WHERE score IS NOT NULL
  AND score_reasons IS NULL
LIMIT 1;

-- INV-03: No lead has score_reasons as an empty array when score is non-null
SELECT lead_id
FROM leads
WHERE score IS NOT NULL
  AND score_reasons IS NOT NULL
  AND jsonb_array_length(score_reasons) = 0
LIMIT 1;

-- INV-04: No audit_logs row has been UPDATEd or DELETEd (append-only)
-- (Validate via DB-level REVOKE or trigger; the invariant query confirms row count only increases)
-- Run before and after; count must be non-decreasing. Manual assertion.

-- INV-05: No lead has score_reasons with a value not in the known ScoreReasonCode set
-- (Expand the IN list to the full ScoreReasonCode enum)
SELECT lead_id, elem
FROM leads,
     jsonb_array_elements_text(score_reasons) AS elem
WHERE score_reasons IS NOT NULL
  AND elem NOT IN (
    'mobile_verified','pin_present','requested_amount_present','high_amount',
    'language_preference_set','pan_present','pan_missing_penalty',
    'partner_quality_good','partner_high_risk','source_high_rejection',
    'customer_type_business','employment_type_present','asset_details_present'
  )
LIMIT 1;
```

---

## UI Test Scenarios

### Component: `ScoreChip` (Vitest + Testing Library)

| # | Scenario | Setup | Assertion |
|---|---|---|---|
| U01 | Renders score badge with green colour for score >= 70 | `<ScoreChip score={75} score_reasons={['mobile_verified','pan_present']} />` (role=RM) | Badge is visible; has green variant class; text shows "75" |
| U02 | Renders amber badge for score 40–69 | `score={55}` | Amber variant class |
| U03 | Renders red badge for score < 40 | `score={30}` | Red/destructive variant class |
| U04 | Renders "—" when score is null | `score={null}` | Text "—" displayed; no number; tooltip shows i18n key `score.unavailable` |
| U05 | Opens popover with reason labels on info-icon click | `score={65}`, reasons include `pan_missing_penalty` | Popover content visible; reason label is localised string (not raw code `pan_missing_penalty`) |
| U06 | `ScoreChip` is not rendered for PARTNER role | `useSession` mock returns `{ role: 'PARTNER' }` | ScoreChip component returns `null` / not in DOM |
| U07 | Respects `prefers-reduced-motion` | `window.matchMedia` mock returns `prefers-reduced-motion: reduce` | No CSS transition classes applied to badge |

### E2E: Lead 360 — Score display (Playwright)

| # | Scenario | Steps | Expected |
|---|---|---|---|
| E01 | RM sees score on lead they own | Login as RM; navigate to `Lead 360` for own lead with `score=72` | Score chip displays "72"; click info icon opens popover listing reasons in English |
| E02 | RM sees "—" for lead where scoring failed (score null) | Login as RM; navigate to lead with `score=null` | Score chip shows "—"; info icon tooltip shows unavailable message |
| E03 | PARTNER user does not see score chip | Login as PARTNER; navigate to their submitted lead | No score chip present on the page (role-gated) |

---

## Coverage Checklist

| Requirement | Covered by |
|---|---|
| Happy path: score + reasons present on create | T11 |
| Happy path: score updated on relevant PATCH | T13 |
| Scoring error does not block capture | T08 (unit), T12 (API) |
| `pan_missing_penalty` reason code | T02 |
| `source_high_rejection` penalty | T03 |
| `partner_high_risk` penalty | T04 |
| Score clamped to `[0, 100]` | T05 (floor), T06 (ceiling) |
| ConfigurationVersion fallback to defaults | T07 |
| No partner lookup for null `partner_id` | T09 |
| Re-score skipped for non-scoring-field PATCH | T10 |
| `AUTH_REQUIRED` (401) | T16 |
| `FORBIDDEN` (403) — out-of-scope RM | T15 |
| `NOT_FOUND` (404) | T17 |
| `CONFLICT` (409) — stale optimistic lock | T14 |
| `INTERNAL_ERROR` (500) — tx rollback | T20 |
| `RATE_LIMITED` (429) | T21 |
| Score masked for PARTNER role | T18 |
| Score visible for BM role | T19 |
| Transaction rollback: no partial state on failure | T20, INV-01 through INV-05 |
| SQL invariants: score range, non-empty reasons, valid codes | INV-01 through INV-05 |
| UI: score chip colours, null state, role gate | U01–U06 |
| UI: accessibility (reduced motion) | U07 |
| E2E: RM sees score; PARTNER does not | E01, E03 |
