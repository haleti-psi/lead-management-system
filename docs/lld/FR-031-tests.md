# FR-031 Test Specification: Hot-Lead Flag & Lead Score

**Tier: 2**
**Source LLD:** `docs/lld/FR-031.md`

---

## Test Cases

| # | Name | Layer | Tool | Type | Setup | Action | Expected |
|---|---|---|---|---|---|---|---|
| T-01 | Score and hot flag set on lead create — priority high | Unit | Jest | Happy path | Lead with `priority='high'`, `requested_amount=1000000`, product config `hot_threshold=500000` | `ScoringService.evaluate(leadId, orgId, 'create')` | `score >= 25`, `is_hot=true`, `score_reasons` contains `PRIORITY_HIGH` and `AMOUNT_ABOVE_THRESHOLD` |
| T-02 | All eight hot rules — each fires independently | Unit | Jest | Happy path — rule coverage | Eight separate lead fixtures, one per hot rule (H1–H8) | `ScoringService.evaluateHotRules(ctx)` for each fixture | Each returns `{ isHot: true, hotReasons: [<expected_code>] }`; no rule bleeds into another fixture |
| T-03 | Lead cools when no rule fires | Unit | Jest | Cool-down path | Lead previously `is_hot=true`; update `priority='low'`, `requested_amount=100000`, no partner, no docs, no callback task, no LOS snap | `ScoringService.evaluate(leadId, orgId, 'update')` after update | `is_hot=false`, `score_reasons` contains `COOLED`, `LeadService.setHotFlag` called with `isHot=false` |
| T-04 | HOT_LEAD outbox event emitted on false→true transition | Unit | Jest | Side-effect | Lead `is_hot=false`; scoring resolves hot=true | `ScoringService.evaluate()` | `OutboxService.emit` called once with `event_code='HOT_LEAD'`; `aggregate_id=leadId`; payload contains `score`, `reasons`, `triggered_by` |
| T-05 | HOT_LEAD outbox NOT emitted when already hot | Unit | Jest | Idempotency | Lead `is_hot=true`; scoring resolves hot=true again | `ScoringService.evaluate()` | `OutboxService.emit` not called; `LeadService.setHotFlag` still called to persist refreshed reasons |
| T-06 | HOT_LEAD outbox NOT emitted on cool-down | Unit | Jest | Side-effect boundary | Lead `is_hot=true`; scoring resolves hot=false | `ScoringService.evaluate()` | `OutboxService.emit` not called; `LeadService.setHotFlag` called with `isHot=false` |
| T-07 | Scoring error does not block lead create | API integration | Jest + supertest | Error resilience | Mock `ScoringService.evaluate` to throw an error | `POST /api/v1/leads` with valid payload | Response 201 Created; lead row exists with `is_hot=false`, `score=null`; error logged (not in response); no 500 returned |
| T-08 | Score clamped to 0–100 | Unit | Jest | Boundary | All signals fire simultaneously (theoretical max > 100) | `ScoringService.computeScore(ctx)` | Returned score is exactly 100; `score_reasons` non-empty |
| T-09 | Product config missing hot_threshold — default applied | Unit | Jest | Boundary | Product config `field_schema` has no `hot_threshold` key; `requested_amount=600000` | `ScoringService.evaluateHotRules(ctx)` | `isHot=true`; `hotReasons` contains `AMOUNT_ABOVE_DEFAULT_THRESHOLD`; no error thrown |
| T-10 | PATCH lead rescores correctly | API integration | Jest + supertest | Happy path | Create lead; PATCH to change `priority='high'` | `PATCH /api/v1/leads/:id` | Response 200; `is_hot=true`; `score >= 25`; `score_reasons` contains `PRIORITY_HIGH` |
| T-11 | Authz — RM cannot see another RM's lead score | API integration | Jest + supertest | Authz negative | Two RM users in same org, different scopes; lead owned by RM-A | RM-B calls `PATCH /api/v1/leads/:id` for RM-A's lead | Response 403 FORBIDDEN; no score returned |
| T-12 | Authz — unauthenticated PATCH returns 401 | API integration | Jest + supertest | Authz negative | No JWT header | `PATCH /api/v1/leads/:id` | Response 401 AUTH_REQUIRED; no lead data in body |
| T-13 | Score/hot fields absent from PARTNER response | API integration | Jest + supertest | Masking | PARTNER role JWT; PARTNER's own submitted lead | `GET /api/v1/leads/:id` (FR-051 endpoint) | Response 200; `is_hot`, `score`, `score_reasons` absent from `data` object |
| T-14 | Score/hot fields absent from CUSTOMER response | API integration | Jest + supertest | Masking | CustomerLinkGuard token; `/c/{token}/status` endpoint | Request lead status | Response 200; no `is_hot`, `score`, `score_reasons` fields in response |
| T-15 | Transaction rollback — scoring tx failure does not corrupt lead | API integration | Jest + supertest (Testcontainers) | TX rollback | Force scoring UPDATE to fail (e.g. constraint violation mock) mid-scoring tx | `POST /api/v1/leads` | Lead row exists with original `is_hot=false`, `score=null`; no partial update persists; error logged |

---

## SQL Invariant Queries

Run against the test database after each scenario. All should return 0 rows.

```sql
-- INV-01: is_hot=true but score_reasons is NULL or empty array
SELECT lead_id FROM leads
WHERE is_hot = true
  AND (score_reasons IS NULL OR score_reasons = '[]'::jsonb)
  AND deleted_at IS NULL;

-- INV-02: score outside allowed range (CHECK constraint, but verify at test level too)
SELECT lead_id FROM leads
WHERE score IS NOT NULL
  AND (score < 0 OR score > 100)
  AND deleted_at IS NULL;

-- INV-03: HOT_LEAD event in event_outbox without a corresponding hot lead
SELECT eo.event_id
FROM event_outbox eo
LEFT JOIN leads l ON l.lead_id = eo.aggregate_id AND l.is_hot = true
WHERE eo.event_code = 'HOT_LEAD'
  AND l.lead_id IS NULL;

-- INV-04: is_hot=true leads with no reason codes in score_reasons (empty array)
SELECT lead_id FROM leads
WHERE is_hot = true
  AND jsonb_array_length(score_reasons) = 0
  AND deleted_at IS NULL;

-- INV-05: score column updated without updated_at changing (sanity — volatile write must bump updated_at)
-- (evaluated by comparing updated_at > created_at on any lead that has a score)
SELECT lead_id FROM leads
WHERE score IS NOT NULL
  AND updated_at = created_at
  AND deleted_at IS NULL;
```

---

## UI Test Scenarios

### Component unit tests (Vitest + Testing Library)

| # | Component | Scenario | Expected |
|---|---|---|---|
| U-01 | `LeadHotBadge` | `isHot=true` | Renders `<Badge>` with text matching `t('lead.hot')` (e.g. "Hot"); has `aria-label="Hot lead"` |
| U-02 | `LeadHotBadge` | `isHot=false` | Renders nothing (null); no badge in DOM |
| U-03 | `LeadScoreChip` | `score=72`, `reasons=['PRIORITY_HIGH','PARTNER_VERIFIED']` | Shows "72 / 100"; HoverCard trigger present; after focus/hover, factor list contains two items with correct i18n labels |
| U-04 | `LeadScoreChip` | `score=null` | Shows "—" (dash); tooltip shows `t('score.unavailable')` |
| U-05 | `LeadScoreChip` | rendered as PARTNER role (prop `hideScore=true`) | Nothing rendered; no badge or chip in DOM |
| U-06 | `LeadScoreChip` | disclaimer text | HoverCard body contains `t('score.disclaimer')` — "Used for prioritisation only — not a credit decision" |

### E2E test (Playwright — `apps/web/e2e/hot-lead.spec.ts`)

| # | Scenario | Steps | Expected |
|---|---|---|---|
| E-01 | Hot badge appears on Lead 360 after create with high priority | Login as RM; capture lead with `priority=high`, `requested_amount=1000000`; open Lead 360 | Hot badge visible in lead header adjacent to stage chip |
| E-02 | Score chip shows factor breakdown | Same lead from E-01; hover/focus score chip | HoverCard opens; at least two factor rows visible; disclaimer visible |
| E-03 | Hot badge absent for PARTNER user | Login as PARTNER user; view own submitted lead | No hot badge, no score chip rendered |

---

## Coverage Checklist

| Requirement | Test(s) | Status |
|---|---|---|
| Happy path — all 8 hot rules each fire independently | T-02 | Required |
| Happy path — score set on create | T-01 | Required |
| Happy path — rescore on PATCH update | T-10 | Required |
| Cool-down (was hot, no rule now fires) | T-03 | Required |
| HOT_LEAD outbox emitted on false→true only | T-04, T-05, T-06 | Required |
| Scoring error never blocks lead create | T-07 | Required |
| Score clamped to 100 | T-08 | Required |
| Default threshold when product config absent | T-09 | Required |
| Authz negative — out-of-scope RM denied | T-11 | Required |
| Authz negative — unauthenticated | T-12 | Required |
| Masking — PARTNER role sees no scoring fields | T-13 | Required |
| Masking — CUSTOMER surface sees no scoring fields | T-14 | Required |
| TX rollback — partial scoring write does not corrupt lead | T-15 | Required |
| SQL invariants — hot without reasons, out-of-range score, orphaned HOT_LEAD event | INV-01..INV-05 | Required |
| UI — hot badge renders and hides correctly | U-01, U-02 | Required |
| UI — score chip shows factors and disclaimer | U-03, U-06 | Required |
| UI — score chip handles null score | U-04 | Required |
| UI — score chip hidden for PARTNER role | U-05 | Required |
| E2E — hot badge visible on Lead 360 | E-01 | Required |
| E2E — factor breakdown accessible | E-02 | Required |
| E2E — PARTNER sees no badge | E-03 | Required |
| Every error taxonomy code this FR raises has a test | T-07 (INTERNAL_ERROR logged), T-11 (FORBIDDEN), T-12 (AUTH_REQUIRED), T-15 (INTERNAL_ERROR) | Required |
| Append-only: no UPDATE/DELETE on audit_logs, event_outbox | INV-03 + testing-contract global rule | Required (CI constraint) |
| Rate limit — 60 mutations/min on PATCH | Covered by FR-050 rate-limit tests (shared endpoint) | Delegate to FR-050 |
