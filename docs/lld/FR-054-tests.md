# FR-054: Global Search — Test Specification

**Tier: 2**
**Source LLD:** `docs/lld/FR-054.md`

---

## Test Cases

| # | Test name | Type | Layer | Scenario | Input | Expected outcome | Error code |
|---|---|---|---|---|---|---|---|
| T01 | Happy path — lead match by name | API integration | supertest | RM user searches by partial name; trigram match returns up to 5 leads within scope | `GET /search?q=Ravi` (RM role, own leads) | 200; `data.leads` contains matching leads; `data.partners` and `data.tasks` returned (may be empty); mobile and name masked | — |
| T02 | Happy path — lead match by lead_code prefix | API integration | supertest | BM user searches by `LD-2026`; finds leads in branch scope | `GET /search?q=LD-2026` (BM role) | 200; `data.leads` contains leads with matching lead_code prefix | — |
| T03 | Happy path — partner match by legal_name | API integration | supertest | HEAD user searches by partner name | `GET /search?q=ABC Finance` | 200; `data.partners` contains matching partner; `legal_name` present unmasked | — |
| T04 | Happy path — task match via lead_code | API integration | supertest | RM user searches by lead_code; associated open task returned | `GET /search?q=LD-2026-000045` (RM who owns that lead) | 200; `data.tasks` contains task linked to that lead | — |
| T05 | Top-N cap enforced | API integration | supertest | HEAD with 20 matching leads; query returns only 5 per type | `GET /search?q=Kumar` (HEAD, org has 20 leads named Kumar) | 200; `data.leads.length <= 5`; `meta.top_n = 5` | — |
| T06 | Scope filter — RM cannot see another RM's lead | API integration | supertest | RM-A searches for a lead owned by RM-B | `GET /search?q=LD-2026-000099` (RM-A; lead owned by RM-B) | 200; `data.leads` is empty (lead is out of scope); no FORBIDDEN | — |
| T07 | Scope filter — PARTNER sees only own submitted leads | API integration | supertest | PARTNER-A searches; PARTNER-B's lead not returned | `GET /search?q=Sharma` (PARTNER-A) | 200; results contain only leads attributed to PARTNER-A's `partner_id` | — |
| T08 | Auth negative — no JWT | API integration | supertest | Unauthenticated request | `GET /search?q=test` (no Authorization header) | 401 AUTH_REQUIRED | `AUTH_REQUIRED` |
| T09 | Auth negative — ADMIN role (no view_lead) | API integration | supertest | ADMIN user without break-glass grant attempts search | `GET /search?q=Ravi` (ADMIN role) | 403 FORBIDDEN | `FORBIDDEN` |
| T10 | Validation — q shorter than 2 chars | API integration | supertest | Query string is 1 character | `GET /search?q=R` | 400 VALIDATION_ERROR; `fields[0].field = "q"` | `VALIDATION_ERROR` |
| T11 | Validation — q missing entirely | API integration | supertest | No `q` parameter | `GET /search` | 400 VALIDATION_ERROR; `fields[0].field = "q"` | `VALIDATION_ERROR` |
| T12 | Validation — q exceeds 100 chars | API integration | supertest | Query string is 101 characters | `GET /search?q=<101-char string>` | 400 VALIDATION_ERROR | `VALIDATION_ERROR` |
| T13 | Rate limit enforcement | API integration | supertest | User fires >300 requests/min | 301 requests in 60 s (Redis throttle mock) | 429 RATE_LIMITED; `Retry-After` header present | `RATE_LIMITED` |
| T14 | Masking — mobile always masked for all roles | Unit + API | supertest | RM searches and receives lead results | `GET /search?q=Ravi` (RM role) | `data.leads[].mobile` matches `98xxxxxx10` pattern; raw mobile not present | — |
| T15 | Masking — DPO receives masked name | API integration | supertest | DPO user searches; all leads returned masked | `GET /search?q=Ravi` (DPO role, M scope) | 200; `data.leads[].applicant_name` is masked; `pan_masked` is in masked format | — |
| T16 | No-match returns empty grouped result | API integration | supertest | Query matches nothing in any entity type | `GET /search?q=ZZNOTEXIST` | 200; `data.leads = []`, `data.partners = []`, `data.tasks = []`; `meta.counts = {leads:0, partners:0, tasks:0}` | — |
| T17 | Partial sub-query failure — graceful degradation | Unit | Jest | `LeadSearchRepository.search()` throws; other queries succeed | Mock: lead repo rejects, partner and task repos resolve | 200; `data.leads = []`; `data.partners` and `data.tasks` populated; error logged server-side | — |
| T18 | BM scope — only branch leads returned | API integration | supertest | BM searches for a name that exists in multiple branches | `GET /search?q=Mehta` (BM for branch-B) | 200; all returned leads have `branch_id = branch-B` | — |
| T19 | SM scope — only team leads returned | API integration | supertest | SM searches; leads outside team not returned | `GET /search?q=Patel` (SM for team-T1) | 200; all returned leads have `team_id = team-T1` | — |
| T20 | Injection safety — SQL metacharacters in q | Unit + API | supertest | Query contains `%`, `_`, `'`, `--`, `;` | `GET /search?q=%' OR 1=1--` | 200; no SQL error; empty or non-injected results; query treated as literal ILIKE pattern | — |
| T21 | PAN-like input — masked in result | API integration | supertest | User searches by PAN pattern | `GET /search?q=ABCDE1234F` | 200; if matched, `data.leads[].pan_masked` is in masked format (raw pan_token never returned) | — |
| T22 | q = exactly 2 chars — boundary valid | API integration | supertest | Minimum valid query length | `GET /search?q=Ra` | 200; search executes (results may be empty) | — |
| T23 | HEAD scope — all org leads visible | API integration | supertest | HEAD searches across all branches | `GET /search?q=Singh` (HEAD role) | 200; leads from multiple branches returned (not limited to one branch) | — |

---

## SQL Invariant Queries

Run after each test execution. All queries must return 0 rows.

```sql
-- INV-01: No lead returned by search has deleted_at set
-- (search must filter deleted leads)
SELECT l.lead_id
FROM leads l
WHERE l.deleted_at IS NOT NULL
  AND l.lead_id IN (
    -- replace with the lead_ids from the last search response
    :searched_lead_ids
  );

-- INV-02: No lead returned to RM-A is owned by a different RM (scope leak)
-- Parameterise with the RM user_id and the returned lead_ids
SELECT l.lead_id
FROM leads l
WHERE l.owner_id <> :rm_user_id
  AND l.lead_id IN (:lead_ids_returned_to_rm);

-- INV-03: No partner lead returned to PARTNER-A belongs to PARTNER-B
-- (partner scope leak)
SELECT l.lead_id
FROM leads l
JOIN source_attributions sa ON sa.source_attribution_id = l.source_attribution_id
WHERE sa.partner_id <> :partner_a_id
  AND l.lead_id IN (:lead_ids_returned_to_partner_a);

-- INV-04: No task returned has lead_id = NULL
-- (task search must exclude standalone system tasks)
SELECT t.task_id
FROM tasks t
WHERE t.task_id IN (:task_ids_returned)
  AND t.lead_id IS NULL;

-- INV-05: No raw mobile (unmasked) ever stored in a search response row
-- (invariant verified at application layer — the mobile field in lead_identities
--  is never transmitted raw; verified by T14)
-- SQL check: confirm mobile is stored as 10-digit; masking happens in app layer
SELECT COUNT(*) AS raw_mobile_rows
FROM lead_identities
WHERE mobile !~ '^[6-9][0-9]{9}$';
-- Expected: 0

-- INV-06: Search endpoint never writes to any table
-- Confirm audit_logs count unchanged after a search call
-- (Run before and after the search; delta must be 0)
SELECT COUNT(*) FROM audit_logs WHERE created_at > :before_search_ts;
-- Expected: 0
```

---

## UI Test Scenarios (Playwright)

Located in `apps/web/e2e/workspace/search.spec.ts`.

| # | Scenario | Steps | Expected |
|---|---|---|---|
| E01 | cmd-k opens search palette | 1. Log in as RM. 2. Press `cmd-k` (macOS) / `ctrl-k` (Windows). | Dialog with `aria-label="Global search"` is visible; input is focused. |
| E02 | Typing < 2 chars does not trigger API | 1. Open palette. 2. Type `R`. | No network request to `/api/v1/search`. Loading skeleton not shown. |
| E03 | Typing ≥ 2 chars triggers search and shows results | 1. Open palette. 2. Type `Ra`. 3. Wait for results. | Lead group visible; each row shows masked mobile; no raw PII. |
| E04 | Clicking a lead result navigates to lead detail | 1. Open palette. 2. Type a known lead_code. 3. Click the result item. | URL changes to `/leads/:id`; lead detail page loads. |
| E05 | "See all leads" link navigates to scoped list | 1. Open palette. 2. Type `Ravi`. 3. Click "See all leads →". | URL changes to `/leads?q=Ravi`; leads list page shown. |
| E06 | Empty state shown when no results | 1. Open palette. 2. Type `ZZNOTEXIST99`. 3. Wait. | `EmptyState` component visible; no error state; groups not rendered. |
| E07 | `Escape` closes palette | 1. Open palette. 2. Press `Escape`. | Dialog is closed; focus returns to trigger button. |
| E08 | RATE_LIMITED shows Toast | 1. Mock API to return 429. 2. Open palette and type. | `Toast` with "Too many attempts. Please wait and try again." is visible. |
| E09 | Keyboard navigation — arrow keys select items | 1. Open palette. 2. Type `Ravi`. 3. Press `ArrowDown` twice. 4. Press `Enter`. | Third result is selected; navigation fires. |
| E10 | Mobile viewport — search accessible via bottom nav | 1. Set viewport to 390×844. 2. Tap the Search icon in bottom nav. | Search palette opens; input is focused; touch keyboard not blocking results. |

---

## Coverage Checklist

- [x] Happy path — all three entity types returned (T01–T04)
- [x] Top-N cap enforced (T05)
- [x] Scope filter — RM cannot see out-of-scope leads (T06)
- [x] Scope filter — PARTNER restricted to own partner_id (T07)
- [x] AUTH_REQUIRED raised when unauthenticated (T08)
- [x] FORBIDDEN raised when role has no view_lead capability (T09)
- [x] VALIDATION_ERROR — q < 2 chars (T10)
- [x] VALIDATION_ERROR — q missing (T11)
- [x] VALIDATION_ERROR — q > 100 chars (T12)
- [x] RATE_LIMITED — throttle enforced (T13)
- [x] Masking — mobile always masked for all roles (T14)
- [x] Masking — DPO masked name (T15)
- [x] Empty state — no results (T16)
- [x] Graceful degradation — partial sub-query failure (T17)
- [x] BM/SM scope filter correctness (T18–T19)
- [x] SQL injection safety — metacharacters in q (T20)
- [x] PAN-like input handled safely and result masked (T21)
- [x] Boundary — q = 2 chars is valid (T22)
- [x] HEAD sees all org leads (T23)
- [x] SQL invariants — no deleted leads, no scope leak, no writes (INV-01..06)
- [x] E2E — cmd-k open, navigate, empty state, escape, rate-limit toast, mobile (E01–E10)
- [x] No UPSTREAM_UNAVAILABLE, CONFLICT, or NOT_FOUND paths (endpoint has no external calls or writes)
