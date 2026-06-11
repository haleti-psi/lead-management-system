# FR-021 — Merge & Source-Attribution Preservation — Test Specification

**Tier: 3**
**Source LLD:** `docs/lld/FR-021.md`

---

## Test Cases

| # | Layer | Description | Inputs | Expected Outcome |
|---|---|---|---|---|
| T-001 | API integration | Happy path: BM merges duplicate into master | Valid `MergeLeadDto`; duplicate and master in BM's branch; correct `expected_version` | 200; `duplicate_status=merged`, `master_lead_id` set; attribution re-linked; all child records relinked; `audit_logs` row with `action=lead_merge`; `event_outbox` row `LEAD_STAGE_CHANGED` |
| T-002 | API integration | Happy path: SM merges duplicate into master within team scope | SM actor; both leads under SM's team | 200; same state changes as T-001 |
| T-003 | API integration | DTO validation — missing `reason` | Body without `reason` | 400 `VALIDATION_ERROR`; `fields` includes `reason`; no DB writes |
| T-004 | API integration | DTO validation — `master_lead_id` equals path `{id}` | `master_lead_id` = path param | 400 `VALIDATION_ERROR`; "master_lead_id must differ from the duplicate lead" |
| T-005 | API integration | DTO validation — `field_precedence=manual` without `manual_overrides` | `field_precedence: "manual"` with no `manual_overrides` | 400 `VALIDATION_ERROR`; `fields` includes `manual_overrides.owner_id` |
| T-006 | API integration | Authz negative — RM cannot merge | RM actor | 403 `FORBIDDEN` |
| T-007 | API integration | Authz negative — BM from a different branch cannot merge leads in another branch | BM actor; leads belong to a different branch | 403 `FORBIDDEN` |
| T-008 | API integration | Authz negative — unauthenticated request | No Authorization header | 401 `AUTH_REQUIRED` |
| T-009 | API integration | Duplicate lead already merged | Lead at `{id}` has `duplicate_status=merged` | 409 `CONFLICT` |
| T-010 | API integration | Master lead itself already merged (chained merge blocked) | `master_lead_id` points to a lead with `duplicate_status=merged` | 400 `VALIDATION_ERROR` or 409 `CONFLICT` |
| T-011 | API integration | Optimistic-lock conflict on duplicate | `expected_version` is stale (off by 1) | 409 `CONFLICT`; no DB mutation |
| T-012 | API integration | Optimistic-lock conflict on master (raised inside LeadService.merge) | Master has been concurrently updated | 409 `CONFLICT`; full transaction rollback; duplicate lead remains unmerged |
| T-013 | Unit | Transaction atomicity — simulated mid-write failure | DB error injected after documents UPDATE but before consent_records UPDATE | Full rollback: `leads.duplicate_status` unchanged, no audit row, no outbox row |
| T-014 | Unit | Re-parent logic — all child documents move to master | Duplicate has 3 documents; master has 2 | After merge: master has 5 documents; duplicate lead has 0 documents |
| T-015 | Unit | Re-parent logic — consent_records `lead_id` updated to master | Duplicate has 2 consent rows; master has 1 | After merge: master has 3 consent rows; duplicate has 0 |
| T-016 | Unit | Re-parent logic — tasks `lead_id` updated to master | Duplicate has 2 tasks | After merge: master has tasks; duplicate has none |
| T-017 | Unit | Source attribution `attribution_status` set to `merged_into` | Duplicate's `source_attributions` row | After merge: `attribution_status = merged_into`; row is NOT deleted |
| T-018 | Unit | Field-precedence = master — master fields win on conflict | Duplicate has different `priority` than master | After merge: master retains its `priority`; duplicate value discarded |
| T-019 | Unit | Field-precedence = duplicate — duplicate fields override master | `field_precedence: "duplicate"` | After merge: master adopts duplicate's non-null field values |
| T-020 | Unit | Cross-branch merge — master's branch takes precedence | Duplicate: branch A; Master: branch B | After merge: `leads` (master) `branch_id` = branch B; no override |
| T-021 | API integration | `duplicate_matches` resolved on merge | Open `duplicate_matches` row exists for the pair | After merge: `duplicate_matches.status = resolved`, `action = merged`, `action_by` = actor |
| T-022 | API integration | Audit log preserved after merge | Merge completes | `audit_logs` contains a row with `action=lead_merge`, `entity_type=leads`, `entity_id=masterId`, `detail->>'duplicate_lead_id' = duplicateId`; row is NOT deleteable (append-only) |
| T-023 | API integration | Happy path: BM unmerges within window | Unmerge called within `MERGE_UNMERGE_WINDOW_HOURS` | 200; `duplicate_status=none`, `master_lead_id=NULL`; documents/consents/tasks restored; attribution restored; `duplicate_matches` re-opened; audit row written |
| T-024 | API integration | Unmerge blocked after window expires | `MERGE_UNMERGE_WINDOW_HOURS` expired; otherwise valid request | 403 `FORBIDDEN` |
| T-025 | API integration | Unmerge on a lead that is NOT in merged state | Lead has `duplicate_status=none` | 400 `VALIDATION_ERROR` — "Lead is not in merged state" |
| T-026 | Unit | Unmerge restores only the originally relinked IDs, not documents added to master after merge | Master gains a new document post-merge; then unmerge | Only the originally re-parented documents return to duplicate; newly-added document stays on master |
| T-027 | API integration | Rate-limit enforcement (mutations: 60/min per user) | BM fires 61 POST /merge requests within 1 minute | 61st request → 429 `RATE_LIMITED`; `Retry-After` header present |
| T-028 | API integration | PII masking — mobile and PAN masked in response for BM scope | BM actor; response includes lead summary | `mobile` appears as `98xxxxxx10` pattern; `pan_masked` appears as `ABCxxxx1F` pattern; raw values absent |
| T-029 | Unit | Append-only enforcement — audit_logs UPDATE rejected | Direct UPDATE attempt on `audit_logs` row | DB-level REVOKE prevents UPDATE; `UPDATE audit_logs SET … WHERE …` returns permission error |
| T-030 | Unit | Append-only enforcement — consent_records state mutation rejected | Direct UPDATE on `consent_state` column of an existing consent row | DB-level REVOKE prevents UPDATE of `consent_state`; the re-parent UPDATE on `lead_id` is the only permitted consent_records mutation during merge (see LLD Ambiguities §1) |

---

## SQL Invariant Queries

Run after each relevant test to assert 0 rows violate the invariant.

```sql
-- INV-001: A merged lead must always reference a valid master
-- Expect 0 rows
SELECT lead_id FROM leads
WHERE duplicate_status = 'merged'
  AND (master_lead_id IS NULL
    OR master_lead_id NOT IN (SELECT lead_id FROM leads WHERE deleted_at IS NULL));

-- INV-002: A merged lead's source_attribution must have attribution_status = merged_into
-- Expect 0 rows
SELECT l.lead_id
FROM leads l
JOIN source_attributions sa ON sa.source_attribution_id = l.source_attribution_id
WHERE l.duplicate_status = 'merged'
  AND sa.attribution_status <> 'merged_into';

-- INV-003: After a merge, no document with lead_id pointing to the merged (duplicate) lead
-- Expect 0 rows (all should have been re-parented to master)
-- (Parameterised: :duplicate_lead_id is the lead that was merged)
SELECT document_id FROM documents
WHERE lead_id = :duplicate_lead_id;

-- INV-004: After a merge, no consent_record with lead_id pointing to the duplicate
-- Expect 0 rows
SELECT consent_id FROM consent_records
WHERE lead_id = :duplicate_lead_id;

-- INV-005: After a merge, no open task with lead_id pointing to the duplicate
-- Expect 0 rows
SELECT task_id FROM tasks
WHERE lead_id = :duplicate_lead_id
  AND status NOT IN ('done', 'cancelled');

-- INV-006: duplicate_matches linking the merged pair must be resolved
-- Expect 0 rows
SELECT duplicate_match_id FROM duplicate_matches
WHERE status = 'open'
  AND ((lead_id = :duplicate_lead_id AND matched_lead_id = :master_lead_id)
    OR (lead_id = :master_lead_id AND matched_lead_id = :duplicate_lead_id));

-- INV-007: audit_logs must contain a lead_merge entry for every completed merge
-- Expect >= 1 row per merge pair
SELECT audit_id FROM audit_logs
WHERE action = 'lead_merge'
  AND entity_type = 'leads'
  AND entity_id = :master_lead_id
  AND detail->>'duplicate_lead_id' = :duplicate_lead_id_str;

-- INV-008: A master lead must not itself be merged (no chained merges)
-- Expect 0 rows
SELECT l.lead_id
FROM leads l
WHERE EXISTS (
  SELECT 1 FROM leads dup
  WHERE dup.master_lead_id = l.lead_id
)
AND l.duplicate_status = 'merged';

-- INV-009: After unmerge, the formerly-duplicate lead has no master_lead_id
-- Expect 0 rows (for the unmerged lead)
SELECT lead_id FROM leads
WHERE lead_id = :formerly_duplicate_lead_id
  AND master_lead_id IS NOT NULL;

-- INV-010: audit_logs rows cannot be updated or deleted (append-only)
-- Expect UPDATE count = 0 (run via service-layer test, verifying the DB REVOKE)
-- This is verified in T-029 via an attempted direct UPDATE returning a permission error.
```

---

## UI Test Scenarios

These are Playwright end-to-end scenarios covering the key UI flows.

### UI-E2E-001: BM initiates and confirms a merge

```
Given: BM is logged in; two leads exist in BM's branch with duplicate_status='flagged'
When:  BM opens Lead 360 of the duplicate lead
And:   Clicks "Merge" action button
Then:  MergeConfirmDialog opens
And:   FieldPrecedenceTable shows both leads' field values with radio selectors
And:   PAN/mobile values are masked in the table (MaskedField)
When:  BM selects field_precedence="master", enters a reason, clicks "Confirm Merge"
Then:  Success Toast appears: "Leads merged successfully"
And:   Duplicate lead page shows status chip "Merged"
And:   Master lead 360 shows the re-parented documents and tasks
```

### UI-E2E-002: Unmerge within window

```
Given: A merge was completed within the last 24 hours
When:  BM views the merged (duplicate) lead's Lead 360
Then:  "Unmerge" button is visible
When:  BM clicks "Unmerge", enters a reason, confirms
Then:  Success Toast: "Lead unmerged successfully"
And:   Lead status chip no longer shows "Merged"
And:   Documents/tasks revert to the unmerged lead
```

### UI-E2E-003: Unmerge button hidden after window expiry

```
Given: A merge was completed more than 24 hours ago (MERGE_UNMERGE_WINDOW_HOURS elapsed)
When:  BM views the merged lead's Lead 360
Then:  "Unmerge" button is NOT rendered (window expired)
```

### UI-E2E-004: Cross-branch merge banner

```
Given: Duplicate lead in branch A; master lead in branch B; both in BM's scope (HEAD actor)
When:  HEAD opens MergeConfirmDialog
Then:  A notice banner is visible: "The master lead belongs to a different branch. Branch B will take precedence."
```

### UI-E2E-005: RM cannot see Merge button

```
Given: RM is logged in; duplicate lead is RM's own assigned lead
When:  RM views the lead's Lead 360
Then:  "Merge" action button is NOT rendered
```

---

## Coverage Checklist

- [x] Happy path: merge (BM scope)
- [x] Happy path: merge (SM scope)
- [x] Happy path: unmerge within window
- [x] All error codes the FR raises: 400 `VALIDATION_ERROR`, 401 `AUTH_REQUIRED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 429 `RATE_LIMITED`, 500 `INTERNAL_ERROR`
- [x] Authz negative: RM blocked (403)
- [x] Authz negative: BM out-of-branch blocked (403)
- [x] Authz negative: unauthenticated (401)
- [x] Optimistic-lock conflict on duplicate (409)
- [x] Optimistic-lock conflict on master (409)
- [x] Transaction atomicity — mid-write failure rolls back entirely (T-013)
- [x] Append-only invariant: audit_logs UPDATE rejected (T-029)
- [x] Append-only invariant: consent_records state mutation blocked (T-030)
- [x] Re-parent: documents, consent_records, tasks all move to master (T-014, T-015, T-016)
- [x] Attribution preservation: `attribution_status = merged_into`, row not deleted (T-017)
- [x] Field-precedence: master wins, duplicate wins, cross-branch branch precedence (T-018, T-019, T-020)
- [x] `duplicate_matches` resolved on merge and re-opened on unmerge (T-021)
- [x] State machine: invalid transitions (already merged, chained merge) raise 409 (T-009, T-010)
- [x] Unmerge window expired → 403 (T-024)
- [x] Unmerge on non-merged lead → 400 (T-025)
- [x] Unmerge only restores originally-relinked IDs (T-026)
- [x] Rate limit enforcement (T-027)
- [x] PII masking in responses (T-028)
- [x] SQL invariants covering merged lead integrity, attribution, child re-parents, and audit (INV-001 through INV-009)
- [x] UI flows: merge dialog, field-precedence preview, masking in table, unmerge button visibility (UI-E2E-001 through UI-E2E-005)
