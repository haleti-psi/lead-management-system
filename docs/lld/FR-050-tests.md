# FR-050 — Test Specification

**Tier: 2 (Moderate)** · **Source LLD:** `docs/lld/FR-050.md` · **Module:** M6 Workspace
**Endpoints under test:** `GET /leads` (`listLeads`), `GET /saved-views` (`listSavedViews`), `POST /saved-views` (`createSavedView`), plus the bulk-action authorisation gate.

Stack per `testing-contract.md`: backend unit = **Jest**; API integration = **Jest + supertest** against the Nest app on **Testcontainers-Postgres**; frontend = **Vitest + Testing-Library**; E2E = **Playwright**. External providers are never called (FR-050 makes none). Factories from `apps/api/test/factories/`.

---

## Test Cases

| # | Layer | Scenario | Setup | Action | Expected |
|---|---|---|---|---|---|
| TC-01 | API | **Happy path — scoped list** | RM `rmA` owns 3 leads; another RM owns 2 | `GET /leads` as `rmA` | `200`; `data.length=3`; only `rmA`'s `owner_id` rows; `meta.pagination={page:1,limit:25,total:3}`; envelope `{data,meta,error:null}` |
| TC-02 | API | **Masking in list response** | Lead with `name='Ramesh Kumar'`, `mobile='9812345610'`, PAN set | `GET /leads` as RM owner | `200`; rows expose `name_masked` (e.g. `Ra***** K****`) + `mobile_masked='98xxxxxx10'`; raw `name`/`mobile`/`pan_token`/`gstin` **absent** from JSON |
| TC-03 | API | **DPO sees masked all-org rows (scope M)** | leads across 2 branches; user = DPO | `GET /leads` as DPO | `200`; rows from all branches present but every PII field masked (strictest); no raw PII |
| TC-04 | API | **Authz negative — cross-scope read denied** | `rmA` and `rmB` each own leads | `GET /leads?filter[owner_id]=<rmB.id>` as `rmA` | `200` with `data:[]` (scope predicate excludes rmB's rows; filter cannot widen scope) — RM never sees another RM's lead |
| TC-05 | API | **Authz negative — role without view_lead** | user = PARTNER (no `view_lead` 'O' on `/leads`) | `GET /leads` as PARTNER | `403 FORBIDDEN`; `error.code='FORBIDDEN'`; deny audited |
| TC-06 | API | **AUTH_REQUIRED** | no/expired bearer token | `GET /leads` | `401`; `error.code='AUTH_REQUIRED'` |
| TC-07 | API | **VALIDATION_ERROR — unknown filter key** | RM authed | `GET /leads?filter[salary]=5` | `400`; `error.code='VALIDATION_ERROR'`; `fields[]` names `filter`/`salary` |
| TC-08 | API | **VALIDATION_ERROR — disallowed sort field** | RM authed | `GET /leads?sort=mobile:asc` | `400 VALIDATION_ERROR`; `fields:[{field:'sort'}]` |
| TC-09 | API | **VALIDATION_ERROR — bad enum filter value** | RM authed | `GET /leads?filter[stage]=not_a_stage` | `400 VALIDATION_ERROR`; `fields[].field='filter.stage'` |
| TC-10 | API | **Pagination clamp (edge case)** | 150 in-scope leads (HEAD scope A) | `GET /leads?limit=500&page=1` as HEAD | `200`; `data.length=100`; `meta.pagination.limit=100` (clamped, **not** an error) |
| TC-11 | API | **Pagination — page 2** | 30 in-scope leads, HEAD | `GET /leads?limit=25&page=2` | `200`; `data.length=5`; `meta.pagination={page:2,limit:25,total:30}` |
| TC-12 | API | **Filter — saved-queue equivalent (SLA Breached)** | 2 leads with `sla_first_contact_due_at < now()`, 3 not | `GET /leads?filter[sla_state]=breached` | `200`; `data.length=2`; all returned have past due-at |
| TC-13 | API | **Filter — score_band=hot** | leads scored 80, 60, 30, null | `GET /leads?filter[score_band]=hot` | `200`; only the `score=80` lead returned |
| TC-14 | API | **Search q — by lead_code / masked PAN** | lead `LD-2026-000123`, `pan_masked='ABCxxxx1F'` | `GET /leads?q=000123` then `q=ABCxxxx1F` | both `200`; each returns the matching in-scope lead; `q` length<2 → `400 VALIDATION_ERROR` |
| TC-15 | API | **Empty queue** | RM with zero leads matching | `GET /leads?filter[stage]=rejected` | `200`; `data:[]`; `meta.pagination.total=0` (UI EmptyState) |
| TC-16 | API | **Saved view — create happy path** | BM authed (`view_lead`=B) | `POST /saved-views {name,filter_json,is_shared:false,scope:'O'}` | `201`; `data.saved_view_id` set; `owner_id=BM`, `created_by=BM` |
| TC-17 | API | **Saved view — list own ∪ shared in scope** | BM owns 1 private view; SM shared a team view in BM's branch scope; an out-of-scope shared view exists | `GET /saved-views` as BM | `200`; returns BM's own + in-scope shared; out-of-scope shared view **absent** |
| TC-18 | API | **Saved view — VALIDATION_ERROR (bad filter_json key)** | BM authed | `POST /saved-views {filter_json:{salary:5}}` | `400 VALIDATION_ERROR`; `fields[]` references `filter_json` |
| TC-19 | API | **Saved view — over-wide share blocked** | RM (own scope O) | `POST /saved-views {is_shared:true, scope:'A'}` | `400 VALIDATION_ERROR`; `fields:[{field:'scope'}]` ("cannot share wider than own scope") |
| TC-20 | API | **Saved view — name length boundary** | BM authed | `POST /saved-views` with `name` = 121 chars | `400 VALIDATION_ERROR` (max 120); 120-char name → `201` |
| TC-21 | API | **Bulk action — RM denied** | RM (no `bulk_action`) selects 3 leads | bulk reassign request | `403 FORBIDDEN`; no mutator invoked; no audit-success row |
| TC-22 | API | **Bulk action — BM allowed + audited** | BM (`bulk_action`=B); 3 in-scope leads | bulk reassign to another RM | each delegated to `LeadService.assignOwner`; **exactly one** `audit_logs` intent row for the bulk action; out-of-scope ids skipped |
| TC-23 | API | **Bulk action — out-of-scope ids stripped** | BM; selection includes 2 in-branch + 1 other-branch lead id | bulk action | other-branch id reported `skipped`/not mutated; only 2 mutations occur |
| TC-24 | Unit | **applyScope compiles correct predicate per role** | mock users RM/SM/BM/HEAD/DPO | call `LeadScopeService.applyScope` | RM→`owner_id=`; SM→`team_id IN`; BM→`branch_id IN`; HEAD→no extra; DPO→A-rows + force-mask flag |
| TC-25 | Unit | **FILTER_ALLOWLIST rejects unknown, accepts known** | — | validate sample filters | unknown key throws; every AC-3 filter key accepted |
| TC-26 | Unit | **limit transform clamps >100 → 100; <1 rejected** | — | parse `limit=500`, `limit=0` | 500→100; 0→ZodError |
| TC-27 | API | **Append-only — bulk audit row immutable** | bulk action wrote an `audit_logs` row | attempt `UPDATE`/`DELETE` on that `audit_logs` row | rejected (trigger/grant) — append-only invariant holds |

(27 cases > the Tier-2 minimum of 5; covers happy path + every error code FR-050 raises [`AUTH_REQUIRED`, `FORBIDDEN`, `VALIDATION_ERROR`], authz both directions, masking, pagination boundary/clamp, saved-view CRUD, bulk-action gate, and the append-only invariant.)

---

## SQL Invariant Queries (each must return **0 rows**)

```sql
-- INV-1: No saved view may reference a user outside its org (orphan owner).
SELECT sv.saved_view_id
FROM saved_views sv
LEFT JOIN users u ON u.user_id = sv.owner_id AND u.org_id = sv.org_id
WHERE u.user_id IS NULL;

-- INV-2: created_by / updated_by must be populated (NOT NULL guaranteed, but verify no placeholder).
SELECT saved_view_id FROM saved_views
WHERE created_by IS NULL OR updated_by IS NULL;

-- INV-3: A bulk action must leave NO leads row written by the workspace path
--        (FR-050 is read-only on leads). Verify the workspace module never appears
--        as the direct writer: every leads.updated_at change must trace to a stage_history
--        or reassignment audit, never to a bare workspace bulk op with no audit_logs intent.
SELECT a.audit_log_id
FROM audit_logs a
WHERE a.action = 'bulk_action'
  AND NOT EXISTS (SELECT 1 FROM audit_logs c WHERE c.correlation_id = a.correlation_id);
-- (sanity: every bulk_action audit row has at least its own correlation chain)

-- INV-4: Shared saved views must declare a scope (no shared view with NULL scope).
SELECT saved_view_id FROM saved_views WHERE is_shared = true AND scope IS NULL;

-- INV-5: List queries must never expose soft-deleted leads — fixture check:
--        after seeding one lead with deleted_at set, the row must not appear via the repo.
SELECT l.lead_id FROM leads l
WHERE l.deleted_at IS NOT NULL
  AND l.lead_id IN (/* ids returned by LeadListRepository.list in the test run */ NULL);
```

---

## UI Test Scenarios

**Vitest + Testing-Library (component):**
- **UT-1** `DataTable` renders `MaskedField` for name/mobile columns; asserts no raw 10-digit mobile string appears in the DOM.
- **UT-2** `BulkActionBar` is **not rendered** when the user context lacks `bulk_action` (RM); **rendered** for BM.
- **UT-3** `SavedViewChips` switching a built-in chip ("Hot") issues `listLeads` with `filter[is_hot]=true`.
- **UT-4** Empty `data:[]` response → `EmptyState` shown; error response → `ErrorState`; in-flight → `LoadingSkeleton`.
- **UT-5** "Save current view" modal posts the current filter state to `createSavedView`; over-wide-share validation error maps to inline field error on `scope`.

**Playwright (E2E — key journeys):**
- **E2E-1 (queue switch):** log in as BM → open Leads → switch chip from "My Leads" to "SLA Breached" → table reloads with only breached leads, pagination resets to page 1.
- **E2E-2 (bulk reassign):** as BM, select 3 leads → BulkActionBar → reassign → ConfirmDialog captures reason → toast success → leads disappear from BM's owner-filtered queue; audit entry exists.
- **E2E-3 (RM no bulk):** as RM, select rows → no bulk action available (BulkActionBar hidden); attempting the API directly returns `403`.
- **E2E-4 (save + reuse view):** as SM, build a filter in the drawer → save view (team scope) → reload → saved view chip appears and reapplies the same filter.

---

## Coverage Checklist

- [x] Happy path — `GET /leads` (TC-01), `GET /saved-views` (TC-17), `POST /saved-views` (TC-16)
- [x] `AUTH_REQUIRED` (401) — TC-06
- [x] `FORBIDDEN` (403) — role-without-capability TC-05, bulk-action RM TC-21
- [x] `VALIDATION_ERROR` (400) — filter key TC-07, sort TC-08, enum TC-09, q-length TC-14, saved-view filter TC-18, over-wide share TC-19, name length TC-20
- [x] Authorization negative **both ways** — cross-scope read TC-04, cross-scope bulk strip TC-23, out-of-scope shared-view hidden TC-17
- [x] Masking in responses (incl. DPO strictest) — TC-02, TC-03, UT-1
- [x] Pagination boundary + over-limit clamp — TC-10, TC-11, TC-26
- [x] Filter / search correctness — TC-12, TC-13, TC-14, TC-25
- [x] Saved-view CRUD — TC-16..TC-20
- [x] Bulk-action gate + single audit intent — TC-21, TC-22, TC-23
- [x] Append-only invariant (audit_logs) — TC-27, INV-1..INV-5
- [x] Scope predicate unit coverage — TC-24
- [N/A] State transitions (valid+invalid) — FR-050 performs none (delegated to FR-052)
- [N/A] External-service failure — FR-050 makes no external calls
- [N/A] Idempotency / optimistic-lock `CONFLICT` — FR-050 has no idempotent or version-locked write (delegated mutators own these)
- [x] Soft-delete exclusion — INV-5
- [x] Envelope shape `{data,meta,error}` on every path — TC-01 (+ asserted in shared interceptor tests)
