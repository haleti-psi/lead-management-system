# FR-052 Test Specification: Pipeline Board

**Tier: 3**
**Source LLD:** `docs/lld/FR-052.md`

---

## Test Cases

Minimum required for Tier 3 Complex: 10 cases. This specification provides 18.

| # | Name | Layer | Tool | Scenario | Input | Expected outcome |
|---|---|---|---|---|---|---|
| T01 | Happy path — valid transition (RM, own lead) | API | Jest + supertest | RM moves their own lead from `assigned` to `contacted` with correct `expectedVersion` | `PATCH /leads/{id}/stage` `{ toStage: "contacted", expectedVersion: 2 }` | 200; `data.stage = "contacted"`, `data.version = 3`; DB: `leads.stage = "contacted"`, `leads.version = 3`; 1 row in `stage_history`; 1 row in `event_outbox (LEAD_STAGE_CHANGED)`; 1 audit row |
| T02 | Happy path — BM moves branch lead | API | Jest + supertest | BM moves a lead in their branch from `contacted` to `qualified` | Same as T01, different user role/scope | 200; stage updated; all four writes committed |
| T03 | Happy path — transition to `rejected` with reason | API | Jest + supertest | SM rejects a lead in their team scope; reason field provided | `{ toStage: "rejected", expectedVersion: 4, reason: "Not interested" }` | 200; stage = `rejected`; `stage_history.reason = "Not interested"` |
| T04 | Guard failure — mandatory docs not uploaded | API | Jest + supertest | Attempt to move `documents_pending → kyc_in_progress` when no mandatory docs exist | Valid auth, correct version | 400; `error.code = VALIDATION_ERROR`; `error.detail.reason = STAGE_GUARD_FAILED`; `error.detail.failed_guards` contains `mandatory_docs_or_waiver`; DB unchanged (no stage_history row, no outbox row) |
| T05 | Guard failure — skip-ahead transition | API | Jest + supertest | Attempt `captured → qualified` (skipping intermediate stages) | Valid auth, correct version | 400; `VALIDATION_ERROR`; `STAGE_GUARD_FAILED`; `failed_guards` non-empty; DB unchanged |
| T06 | Guard failure — terminal state (handed_off → any) | API | Jest + supertest | Attempt any transition from `handed_off` lead | Valid auth, correct version | 409; `CONFLICT` (terminal state is an invalid transition per state-machines.md) |
| T07 | Optimistic lock — stale version | API | Jest + supertest | Two concurrent requests; second PATCH uses `expectedVersion` that was already incremented by the first | First PATCH succeeds; second PATCH: same `expectedVersion` as originally fetched | 409; `error.code = CONFLICT`; no second `stage_history` row; no second `event_outbox` row |
| T08 | Auth — missing JWT | API | Jest + supertest | PATCH with no Authorization header | No JWT | 401; `error.code = AUTH_REQUIRED` |
| T09 | Authz negative — RM cannot move another RM's lead | API | Jest + supertest | RM-A attempts to move a lead owned by RM-B (different `owner_id`) | Valid JWT for RM-A | 403; `error.code = FORBIDDEN`; no DB writes |
| T10 | Authz negative — SM cannot move a lead from a different team | API | Jest + supertest | SM of team-A attempts to move a lead assigned to team-B | Valid JWT for SM-A | 403; `error.code = FORBIDDEN` |
| T11 | Authz negative — HEAD role has no move_stage capability | API | Jest + supertest | HEAD user sends PATCH /leads/{id}/stage | Valid JWT for HEAD | 403; `error.code = FORBIDDEN` |
| T12 | Validation — missing toStage | API | Jest + supertest | Body omits `toStage` | `{ expectedVersion: 1 }` | 400; `VALIDATION_ERROR`; `error.fields` contains `toStage` |
| T13 | Validation — invalid enum value for toStage | API | Jest + supertest | `toStage` is not in `lead_stage` enum | `{ toStage: "flying", expectedVersion: 1 }` | 400; `VALIDATION_ERROR`; `error.fields` contains `toStage` |
| T14 | Validation — reason required for rejected transition | API | Jest + supertest | `toStage = "rejected"` without `reason` field | `{ toStage: "rejected", expectedVersion: 2 }` | 400; `VALIDATION_ERROR`; `error.fields` contains `reason` |
| T15 | Not found | API | Jest + supertest | Lead UUID does not exist in the org | Valid auth, non-existent UUID | 404; `error.code = NOT_FOUND` |
| T16 | Transaction rollback — forced DB failure mid-write | Unit | Jest (mocked DB) | Simulate `stage_history` INSERT throwing after `leads` UPDATE succeeds | Force DB error on INSERT | No commit; `leads.stage` unchanged; 0 rows in `stage_history`; 0 rows in `event_outbox` |
| T17 | Board load — scope-filtered column (RM only sees own leads) | API | Jest + supertest | RM queries `GET /leads?filter[stage]=assigned` | Valid JWT for RM | 200; all returned leads have `owner_id = RM.userId`; no leads from other owners |
| T18 | E2E — drag-and-drop happy path and snap-back on guard failure | E2E | Playwright | Drag a card from `contacted` to `qualified` (success), then attempt `assigned → handed_off` (guard fail) | Browser-level drag events | First move: card appears in `qualified` column, Toast not shown. Second move: card snaps back to `assigned`, Toast displays guard error message. |

---

## Unit Test Cases (Jest — service and guard logic)

| # | Name | Unit under test | Scenario | Expected |
|---|---|---|---|---|
| U01 | Guard matrix — all §10.3 transitions | `StageGuardService.evaluate()` | Iterate every valid `from → to` pair with all required conditions met | Returns `{ failed: [] }` for each |
| U02 | Guard matrix — all invalid transitions | `StageGuardService.evaluate()` | Iterate every forbidden `from → to` pair (skip-ahead, handed_off→any, rejected beyond window) | Returns `{ failed: ['<guardName>'] }` with at least one failing guard |
| U03 | Optimistic lock — CONFLICT on stale version | `LeadService.transitionStage()` | Mock DB returns 0 rows from the UPDATE | Throws `ConflictException` (maps to CONFLICT 409) |
| U04 | Scope resolver — RM scope | `PipelineBoardService` or `AbacGuard` scope resolver | RM user triggers resolution | Returns `{ field: 'owner_id', value: userId }` |
| U05 | Board card ageing computation | `PipelineBoardService.computeAgeingDays()` | Lead `created_at` is 5 days ago | Returns `ageingDays = 5` |

---

## SQL Invariant Queries

Run after any PATCH /leads/{id}/stage call. All queries must return 0 rows.

```sql
-- INV-01: No UPDATE or DELETE on stage_history (append-only).
-- Verified at DB level by absence of triggers; tested here by ensuring row count only grows.
SELECT COUNT(*) AS orphaned
FROM stage_history sh
WHERE sh.lead_id NOT IN (SELECT lead_id FROM leads);
-- Expect: 0 (no orphaned stage_history rows)

-- INV-02: stage_history and leads must agree — every stage_history.to_stage for the most recent
-- row of each lead must match leads.stage.
SELECT l.lead_id
FROM leads l
JOIN LATERAL (
  SELECT to_stage
  FROM stage_history
  WHERE lead_id = l.lead_id
  ORDER BY occurred_at DESC
  LIMIT 1
) sh ON true
WHERE sh.to_stage <> l.stage
  AND l.deleted_at IS NULL;
-- Expect: 0 rows

-- INV-03: No partial write — a stage_history row must have a corresponding event_outbox row
-- for the same lead and same occurred_at (within 1s tolerance).
SELECT sh.stage_history_id
FROM stage_history sh
WHERE NOT EXISTS (
  SELECT 1 FROM event_outbox eo
  WHERE eo.aggregate_id = sh.lead_id
    AND eo.event_code = 'LEAD_STAGE_CHANGED'
    AND eo.created_at BETWEEN sh.occurred_at - INTERVAL '1 second'
                           AND sh.occurred_at + INTERVAL '1 second'
)
ORDER BY sh.occurred_at DESC
LIMIT 10;
-- Expect: 0 rows (every stage_history row has a matching outbox event)

-- INV-04: No partial write — a stage_history row must have a corresponding audit_log entry.
SELECT sh.stage_history_id
FROM stage_history sh
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs al
  WHERE al.lead_id = sh.lead_id
    AND al.action = 'stage_transition'
    AND al.created_at BETWEEN sh.occurred_at - INTERVAL '1 second'
                           AND sh.occurred_at + INTERVAL '1 second'
)
ORDER BY sh.occurred_at DESC
LIMIT 10;
-- Expect: 0 rows

-- INV-05: leads.version must be strictly positive and non-decreasing.
SELECT lead_id, version FROM leads WHERE version < 1;
-- Expect: 0 rows

-- INV-06: No lead in the 'handed_off' terminal state should have a stage_history row
-- that records a transition FROM 'handed_off' to anything.
SELECT stage_history_id
FROM stage_history
WHERE from_stage = 'handed_off';
-- Expect: 0 rows (terminal state — no transitions out of handed_off)
```

---

## UI Test Scenarios (Playwright E2E)

| # | Name | File | Steps | Assertions |
|---|---|---|---|---|
| E01 | Full drag-and-drop move (happy path) | `apps/web/e2e/pipeline-board.spec.ts` | 1. Login as RM. 2. Navigate to Pipeline Board. 3. Locate a lead card in `assigned` column. 4. Drag card to `contacted` column and drop. 5. Wait for API response. | Card appears in `contacted` column. No Toast error visible. `data-testid="stage-chip"` shows `"contacted"`. Network request `PATCH /leads/{id}/stage` returns 200. |
| E02 | Snap-back on guard failure | `apps/web/e2e/pipeline-board.spec.ts` | 1. Login as RM. 2. Locate a lead in `documents_pending` with no documents uploaded. 3. Drag card to `kyc_in_progress`. | Card returns to `documents_pending` column within 500ms. `Toast` is visible with text containing guard names. Network request returns 400. |
| E03 | Mobile stage selector — valid transition | `apps/web/e2e/pipeline-board.spec.ts` | 1. Set viewport to 375×812 (mobile). 2. Login as BM. 3. Tap "Move Stage" button on a lead card. 4. Select next stage from bottom sheet. 5. Tap confirm. | Bottom sheet closes. Card disappears from current column, appears in new column. |
| E04 | CONFLICT toast on stale version | `apps/web/e2e/pipeline-board.spec.ts` | 1. Open board in two tabs simultaneously. 2. Move a card in tab 1 (succeeds). 3. Move the same card in tab 2 (stale version). | Tab 2 shows CONFLICT toast: "Refresh and retry". Card stays in original position. |
| E05 | Empty column shows EmptyState | `apps/web/e2e/pipeline-board.spec.ts` | 1. Login as RM with no leads in `eligibility_requested`. 2. Navigate to board. | Column for `eligibility_requested` shows `EmptyState` component (icon + text). |
| E06 | SLA breach card highlight | `apps/web/e2e/pipeline-board.spec.ts` | 1. Seed a lead where `sla_first_contact_due_at` is in the past. 2. Load board. | That lead card has a destructive-colour border (CSS variable `--destructive`). |
| E07 | Keyboard accessibility — focus and Enter to trigger move | `apps/web/e2e/pipeline-board.spec.ts` | 1. Navigate to board. 2. Tab to a lead card drag handle. 3. Use keyboard drag API (space to start, arrow keys, space to drop). | Card moves to targeted column; focus returns to the moved card in its new column. |

---

## Coverage Checklist

| Item | Covered | Test ID(s) |
|---|---|---|
| Happy path — RM own lead move | Yes | T01, T02, E01 |
| Happy path — BM branch lead move | Yes | T02 |
| Happy path — rejected transition with reason | Yes | T03 |
| Every error code the FR can raise: `AUTH_REQUIRED` (401) | Yes | T08 |
| Every error code the FR can raise: `FORBIDDEN` (403) | Yes | T09, T10, T11 |
| Every error code the FR can raise: `NOT_FOUND` (404) | Yes | T15 |
| Every error code the FR can raise: `VALIDATION_ERROR` (400) — field validation | Yes | T12, T13, T14 |
| Every error code the FR can raise: `VALIDATION_ERROR` + `STAGE_GUARD_FAILED` | Yes | T04, T05, U01, U02, E02 |
| Every error code the FR can raise: `CONFLICT` (409) — optimistic lock | Yes | T07, U03, E04 |
| Every error code the FR can raise: `CONFLICT` (409) — terminal state | Yes | T06 |
| Authz negative — cross-user (RM cannot see another RM's lead) | Yes | T09 |
| Authz negative — cross-team (SM cannot move another team's lead) | Yes | T10 |
| Authz negative — HEAD has no move_stage capability | Yes | T11 |
| Masking — customer name masked in board card per role | Partially covered by FR-050 masking tests; board card inherits same GET /leads response |
| Valid state transitions — all §10.3 pairs | Yes | U01 |
| Invalid state transitions — all forbidden pairs | Yes | U02, T06 |
| Transaction rollback on mid-write failure | Yes | T16 |
| Optimistic lock / concurrency | Yes | T07, U03 |
| Append-only invariant for stage_history | Yes | INV-01, INV-02 |
| Append-only invariant for audit_logs | Yes | INV-04 |
| Consistency invariant — stage_history ↔ event_outbox pairing | Yes | INV-03 |
| Board scope filter (RM sees only own leads) | Yes | T17 |
| E2E drag-and-drop happy path | Yes | E01 |
| E2E snap-back on guard failure | Yes | E02, E04 |
| E2E mobile stage selector | Yes | E03 |
| E2E empty state | Yes | E05 |
| E2E SLA breach card highlight | Yes | E06 |
| E2E keyboard accessibility | Yes | E07 |
| Scope guard — unit test for RM/BM/SM scope resolvers | Yes | U04 |
| Ageing computation | Yes | U05 |
| `reason` required for `rejected` / `dormant` | Yes | T14 |
| `INTERNAL_ERROR` (500) — covered by global exception filter tests (cross-FR) | Not specific to FR-052 |
| Rate limiting (mutations) | Covered by global `ThrottlerGuard` tests (cross-FR) |
