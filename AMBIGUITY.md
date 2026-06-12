# AMBIGUITY — FR-010 (Omnichannel Lead Capture)

## 1. Bulk-import XLSX parsing has no register-approved library

**The gap (precise):** `docs/lld/FR-010.md` requires `POST /leads/import` to accept
and process **CSV and XLSX** files ("Parse CSV/XLSX row by row"; error case 415
only for files that are *neither*). `docs/contracts/dependency-register.md`
contains **no XLSX/spreadsheet parsing library** (and no CSV library either), and
the hard rule is "only dependency-register libraries". CSV is hand-parseable
within the standard library (implemented — `csv.util.ts`, RFC-4180 subset), but
XLSX is a ZIP-of-XML container that cannot reasonably be parsed without a
library (e.g. `exceljs`).

**What was built (no silent failure):**
- Upload boundary accepts both CSV and XLSX per the api-contract (content-sniffed:
  ZIP magic → xlsx, clean UTF-8 text → csv, anything else → 415 `UNSUPPORTED_MEDIA`).
- CSV imports are fully processed end-to-end (per-row validation, per-row
  UnitOfWork commits, error CSV `(row_number, column, code, message)`, job counters).
- An XLSX job is marked `status='failed'` with an explanatory `error_file_ref`
  row ("XLSX parsing is not yet available …") — loud, durable, auditable; never a
  silent drop. See `apps/api/src/modules/capture/import-processor.job.ts`.

**Needed decision (Dev 1 / contracts owner):** add an XLSX parser (suggest
`exceljs`, security-reviewed) to `dependency-register.md`, then implement the
XLSX branch of `ImportProcessorService` — or amend FR-010/api-contract to CSV-only
for MVP.

---

*Note (not an ambiguity, resolved in-code):* the LLD's "Dispatch ImportProcessorJob
via Cloud Tasks" needs an HTTP worker endpoint that is not in `api-contract.yaml`.
Until that endpoint is contracted, dispatch is behind `ImportDispatchPort` with an
in-process post-commit adapter (`ports/import-dispatch.port.ts` documents the swap).
Captcha (former open item C3) is resolved per AMBIGUITIES.md: `CaptchaService` +
port + mock adapter in `core/integration`; the real vendor adapter (OD-08) will
consume `CAPTCHA_SECRET` from the environment contract.

---

# AMBIGUITY — FR-030 (Rules-Based Allocation)

## FR-030-1. "Branch default team" for the unassigned pool is not modelled in the schema

**The gap (precise):** `docs/lld/FR-030.md` §Backend Flow step 7 routes a
no-match lead to "`team_id = lead.branch_id`'s **default team**", but
`docs/data-model/schema.sql` §`teams` has **no default-team flag** (columns:
team_id, org_id, name, branch_id, manager_id, is_active, audit cols) and no
other artefact defines which of a branch's teams is "default".

**Resolution applied (deterministic, documented in-code):** the OLDEST active
team of the lead's branch (`ORDER BY created_at ASC, team_id ASC LIMIT 1`) is
used as the pool team — see
`apps/api/src/modules/allocation/allocation-rule.repository.ts`
(`findBranchDefaultTeam`). When the lead has no branch, or the branch has no
active team, `team_id` is left unchanged; the `LEAD_ASSIGNED` (owner_id=null,
reason `unassigned_pool`) outbox event and the `allocation.no_match` alert
still fire, so no routing decision is ever silent.

**Needed decision (Dev 1 / data-model owner):** either add an
`is_default`/`is_pool` flag (partial unique index per branch) to `teams` and
swap the lookup, or ratify the oldest-active-team convention in the FR-030 LLD.

## FR-030-2. No-match behaviour for a lead that ALREADY has an owner

**The gap (precise):** FR-030 LLD step 7 says no-match → `assignOwner(owner_id
= null, …)` + `LEAD_ASSIGNED(owner_id=null, reason 'unassigned_pool')`. FR-010
self-assigns RM-captured leads (`owner_id = actor`) at insert, and allocation
runs on EVERY creation — the LLD never says whether no-match should *clear* an
existing owner.

**Resolution applied (conservative):** the unassigned-pool path (team parking +
owner-null event + `allocation.no_match` alert) runs only for UNOWNED leads —
matching INV-01's own definition ("Unassigned pool leads have owner_id=null
…"). A no-match on an already-owned lead is a no-op (the RM keeps the lead in
`captured`); a matching rule still assigns normally (including to a different
RM). See `AllocationService.fallBackToUnassignedPool`.

**Needed decision:** ratify, or specify that auto-allocation strips RM
self-ownership on no-match.

---

# FR-030 — review write-backs pending (arbiter / Dev 1)

1. **auth-matrix.json `resource_governance`** still maps `allocation_rules` → `configuration` / M14 maker-checker; FR-030 (per its LLD §Auth) writes rules directly via M4 under `allocate`, active-immediately. Reconcile the matrix row (or revert to the governance path) — one-line contracts PR.
2. **allocation-rules edit/deactivate gap:** claiming the resource out of FR-131's generic master endpoints removed its PATCH; FR-030's LLD specifies only GET+POST. Decide: dedicated PATCH/deactivate endpoint (api-contract amendment) or route updates through FR-132 governance.
3. **FR-030 LLD step-5 write-back:** capacity filter is applied whenever `capacity_limit` is set (not only `method='capacity'`) — the only reading consistent with test T02; record in the LLD.
4. **FR-030-tests.md INV-08** contradicts INV-02 for reassignment of an already-assigned lead; implementation (correctly) writes `stage_history` only on real transitions — amend the test spec.

(The `assignOwner` options-object pin is already written back to `shared-utilities.md`. Stage-regression-on-reassign was FIXED in code before commit — reassign past `assigned` now preserves stage.)

---

# AMBIGUITY — FR-020 (Duplicate & Near-Duplicate Detection)

## FR-020-1. Same-mobile match where PANs differ (or only one side has a PAN) is not in the BRD match table

**The gap (precise):** the BRD default-match table (FR-020 LLD §Confidence Scoring
Rules) covers `same PAN + same mobile` (strong/block), `same PAN, different
mobile` (strong/warn) and `same mobile, NO PAN on either` (medium/warn). It does
not specify the same-mobile case where the two identities carry **different**
PAN tokens, or where exactly one side has a PAN.

**Resolution applied (conservative, in-code):** any same-mobile candidate not
upgraded by a same-PAN hit scores **medium/warned** (`matched_on: ['mobile']`) —
the same outcome as the table's mobile row, so a shared family phone flags for
review instead of being silently ignored or hard-blocked. Encoded in
`MATCH_RULES` (`apps/api/src/modules/dedupe/dedupe.service.ts`); T03 still holds.

**Needed decision (Dev 1 / product):** ratify medium/warn for the
different-PAN/one-PAN mobile variants, or specify a distinct row (e.g. weak for
PAN-mismatch) — then write it back into FR-020.md.

## FR-020-2. (process incident, for Dev 1) Cross-worktree `git stash` race during the build

`git stash` state is repo-wide — shared by ALL worktrees (`lms-wt/fr020`,
`fr050`, `fr110`). During this FR's build, this agent's `stash -u`/`pop` raced a
concurrent FR-110 agent's stash: each worktree popped the OTHER agent's WIP.
Recovered here from the dangling stash commits (this worktree's final state
verified byte-identical to its pre-stash state); the FR-110 WIP was re-stored as
`stash@{0}` ("restored by FR-020 agent…", commit `a6900af`) — **pop it in the
fr110 worktree**, whose working tree may also still hold FR-020 content from the
race. Rule for the team plan: **never use `git stash` in shared-repo worktrees**
(use `git worktree`-local commits or plain file copies instead).

## FR-020 — reviewer write-backs (minors, arbiter)
1. LLD Assumption 5 ("email as supplementary weak signal") has no MATCH_RULES rule — email absent from BRD match table and test spec; record/strike in LLD.
2. Zero-candidate early return reports duplicate_status='none' without recomputing — a previously-flagged lead with edited identity keeps stale 'flagged' in DB (LLD-literal); resolve in FR-021 resolution flow.
3. LLD yaml lists HEAD under roles_with_edit_lead but auth-matrix gives HEAD no edit_lead — contracts win (HEAD→403); reconcile LLD.
4. duplicate-check.port.ts:9 doc comment still links deleted NoopDuplicateCheckAdapter — fix comment in next touch.

---

# AMBIGUITY — FR-110 (Purpose-wise Consent Ledger)

## FR-110-1. LLD audit action `CONSENT_CAPTURED` is not an `audit_action` enum value

**The gap (precise):** `docs/lld/FR-110.md` §Backend Flow 4g and `FR-110-tests.md`
T01/T32/INV-07 use audit `action = 'CONSENT_CAPTURED'`, but the `audit_action`
enum (schema.sql §5.5 / `@lms/shared` `AuditAction`) has no such value — it has
`consent_grant`, `consent_withdraw`, `consent_expire`. CORRECTIONS.md binds every
FR to "action (audit_action enum)"; a literal `CONSENT_CAPTURED` would be
rejected by the DB enum column.

**Resolution applied (enum rule wins, per CORRECTIONS.md):**
`granted`/`denied` captures audit as **`consent_grant`**, withdrawals as
**`consent_withdraw`** (`detail = { purpose, state }` disambiguates denied).
Tests assert the mapped values. INV-07's `al.action = 'CONSENT_CAPTURED'`
should be read as `action IN ('consent_grant','consent_withdraw')`.

**Needed decision (Dev 1):** ratify the mapping in FR-110.md/-tests.md, or add a
`consent_denied` (and/or `consent_captured`) value to `audit_action` via the
amendment process.

## FR-110-2. `customer_links` has no `channel` (or `customer_profile_id`) column

**The gap (precise):** FR-110.md §Endpoint 3 says the customer-path consent
`channel` "is derived from the `customer_links.channel` column" and lead/profile
are resolved "from the `customer_links` row", but schema.sql `customer_links`
has neither a `channel` nor a `customer_profile_id` column (columns:
customer_link_id, org_id, lead_id, token_hash, purpose, status, expires_at,
opened_at, otp_verified_at, revoked_by, audit cols).

**Resolution applied:** the FR-060 seam contract (`CustomerLinkPort.
resolveForConsent → ResolvedCustomerLink { leadId, customerProfileId, orgId,
channel }`) carries the channel, making its source the FR-060 adapter's
decision; `customer_profile_id` falls back to `leads.customer_profile_id`.

**Needed decision (Dev 1 / data-model owner):** add `channel` to
`customer_links`, or ratify a fixed channel (e.g. `website`) for micro-site
consents in FR-060/FR-110.

## FR-110-3. Customer token machinery (FR-060) not yet built — endpoint live behind a port

Not a spec gap — the recorded cross-wave dependency (STAGE7-CONTINUATION §3/§9:
Dev 3 builds FR-110 before Dev 2's FR-060). `POST /c/{token}/consent` is
implemented per contract, but token validation (status/expiry/**OTP step-up**)
is `CustomerLinkGuard`/M7 territory, so resolution sits behind
`CUSTOMER_LINK_PORT` (`modules/compliance/ports/customer-link.port.ts`). The
bound `UnavailableCustomerLinkAdapter` resolves no token (every request → 404,
existence hidden, loud warn log) until FR-060 rebinds the port in
`compliance.module.ts`. T19–T24's full-HTTP assertions move to the deferred
integration wave alongside FR-060.

## FR-110-4. Dispatcher note vs LLD: `setConsentStatus` versioning

The dispatch brief described `LeadService.setConsentStatus` as "same
single-UPDATE + expectedVersion/version-bump pattern as the other mutators";
FR-110.md §Data Operations explicitly specifies **no version bump** ("volatile
system-managed field per architecture §11.2") and the §11.2 interface lists the
mutator without `expectedVersion`. The LLD governs: implemented as one
org-scoped UPDATE of `consent_status` + `updated_at` (no version bump, stage
untouched, NOT_FOUND on zero rows). One signature extension vs the frozen stub:
an `orgId` parameter, because the LLD's SQL is `WHERE lead_id = ? AND org_id = ?`.

## FR-110 — reviewer write-backs (minors, arbiter)
1. state-machines.md says consent_records "no row is updated / any UPDATE invalid" while FR-110 LLD §301 sanctions the superseded_by pointer UPDATE (implemented, tested) — write the pointer exception back into state-machines.md.
2. clientMeta records raw X-Forwarded-For (spoofable, multi-hop) per LLD §189 — standardise trusted-proxy-resolved client IP at the integration-test wave.

---

# AMBIGUITY — FR-050 (Lead List & Saved Work Queues)

*None of these blocked completion; each was resolved with the narrowest spec-consistent choice and is listed for Dev-1/contract write-back (CLAUDE.md §9).*

## FR-050-1. `audit_action` enum has no `bulk_action` value

**The gap (precise):** FR-050 LLD §Backend Flow (bulk step 4) and FR-050-tests INV-3 reference an
`audit_logs.action = 'bulk_action'` intent row, but the `audit_action` enum (schema.sql / BRD §5.5,
`@lms/shared` `AuditAction`, generated DB types) has no such value.

**Resolution applied:** the single bulk-action intent row is recorded as `action='reassign'` with
`detail.sub_action='bulk_action'` (the AMBIGUITIES.md **A4 precedent** — map under an existing
action + `detail.sub_action`). Per-lead audits remain the `reassign` rows written by
`LeadService.bulkReassign` (one per lead, pinned in shared-utilities.md). See
`apps/api/src/modules/workspace/bulk-action.service.ts`.

**Needed decision:** add `bulk_action` to `audit_action` (schema + enum + Flyway) and switch the
intent row, or ratify the `detail.sub_action` mapping in the LLD/tests (INV-3 query).

## FR-050-2. `POST /leads/bulk-action` request/response shapes are not in the contract

**The gap (precise):** api-contract.yaml v5.3 defines the path (summary "reassign/stage/tag; one
audit per lead", optional `Idempotency-Key`, 200/400/403/409) but no requestBody/response schemas,
and the FR-050 LLD §bulk predates the endpoint (it described a client-side fan-out).

**Resolution applied:** body = `{ action: 'reassign', lead_ids: uuid[] (1..100, deduped), reason
(1..500), params: { owner_id: uuid } }`; response `data` = `{ action, requested, succeeded, items:
[{ lead_id, status: 'succeeded' | 'skipped_out_of_scope' | 'skipped_ineligible' }] }` (the LLD's
"per-item result list"). `action: 'stage'/'tag'` are **rejected (400 VALIDATION_ERROR)**: `tag` has
no LeadService mutator at all, and `transitionStage` lands with FR-052 (calling it today throws a
typed INTERNAL_ERROR by Wave-1 convention — a 400 up front is strictly better).

**Needed decision:** add `BulkAction`/`BulkActionResult` schemas to api-contract.yaml; extend the
`action` enum when FR-052 lands.

## FR-050-3. Bulk-action idempotency semantics unspecified

**The gap:** the contract lists an optional `Idempotency-Key` header on `/leads/bulk-action`, but no
artefact specifies replay semantics for bulk operations (FR-010's Redis idempotency service is
capture-owned, keyed to lead creation).

**Resolution applied:** header accepted but not interpreted (the operation is bounded and
re-runnable; a replayed reassign to the same owner is an `owner_id` no-op, though it re-bumps
`version` and re-audits). Nothing was invented.

**Needed decision:** specify (or drop) bulk idempotency in the contract.

## FR-050-4. Resolved in-code (record in LLD on write-back)

- **`sla_state=due_soon` window** (LLD leaves the interval as "…"): reused FR-104's canonical
  `APPROACHING_WINDOW_MINUTES` (= 30, `core/sla/sla.constants.ts`) so the list filter and the SLA
  sweep agree on "approaching breach"; comparisons use DB `now()` (FR-050 only reads the stored
  due-at, per LLD).
- **`filter[date_from/date_to]` column** (not named in the LLD): applied to `leads.created_at`,
  inclusive both ends.
- **`applyScope` signature:** takes the AbacGuard-resolved `ScopePredicate` (not the raw user) —
  the team scope needs the member ids only `EntitlementService` resolves (FR-002/CORRECTIONS:
  `owner_id IN (team member user_ids)`, never `team_id`). Matches the FR-030 precedent.

## FR-050-5. Saved-view shared-visibility predicate underspecified

**The gap (precise):** LLD §Endpoint 2 says "own ∪ shared views whose scope the caller is inside",
but `saved_views` has no branch/team anchor columns, and TC-17 requires a BM to see an SM's
**team**-scoped share from the BM's branch (the BM is not *in* the team).

**Resolution applied:** a shared view is visible when EITHER (a) the caller is inside the audience
the owner shared into (`A` org-wide; `B`/`T`/`R` = caller in the same branch/team/region as the
owner, anchored on the owner's `users` row), OR (b) the owner falls inside the caller's own
`view_lead` scope (manager-over-subordinate containment — what TC-17 exercises). PARTNER/CUSTOMER
predicates contribute no shared legs (own views only). See
`apps/api/src/modules/workspace/saved-view.repository.ts`.

**Needed decision:** ratify the dual-leg rule in the LLD before FR-051..054 build on it.

## FR-050-6. Frontend slice deferred (not built here)

**The gap:** the LLD lists `apps/web` files (lead-list page, saved-view chips, filter drawer) built
on the shared web foundation (`AppShell`, `DataTable`, `apiClient` — BRD §4.5), which is Dev 2's
queue (TEAM-PLAN) and does not exist yet (`apps/web` is the scaffold + `MaskedField` only); the
dispatch scope for this FR was the backend module + registration.

**Resolution:** backend complete; the UI slice ships when the web foundation lands (building it now
would re-implement shared components, violating shared-utilities reuse).

## FR-050 — reviewer write-backs (minors, arbiter)
1. FR-050 LLD example shows name_masked="Ra***** K****" but FR-002 masking matrix governs (full name for internal roles, first-name for DPO/export) — amend LLD example.
2. core masking FIELD_MAP maps wire key "name"→full_name rule: DPO listing saved-views gets view NAMES truncated (non-PII collision) — rename wire key or exempt; FR-002/FR-050 cross-note.
3. bulk-action secondary denials (disallowed predicate type / target-owner out of scope) return FORBIDDEN without abac_deny audit — add audits (primary capability denial IS guard-audited).
4. (pre-existing) LeadService.bulkReassign sets updated_by/audit actor_id to the NEW OWNER (pinned signature has no actor param) — same fix as the FR-010 actorId item.
5. FR-050-tests INV-3 query (action='bulk_action') must be amended to the detail.sub_action mapping.

# AMBIGUITY — FR-021 (Merge & Source-Attribution Preservation)

## 1. `POST /leads/{id}/unmerge` is missing from api-contract.yaml
**The gap:** the LLD defines unmerge as a full companion endpoint ("same x-frs: [FR-021]"), but
`api-contract.yaml` has only `/leads/{id}/merge` (path 169). **Resolution:** implemented per the LLD
(it governs); a Dev-1 contracts PR should add the unmerge path + 403 (window) / 400 / 409 responses.

## 2. `LeadService.merge` pinned 4-arg signature cannot satisfy the LLD's locking requirements
**The gap:** shared-utilities/architecture §11.2 pin `merge(masterId, duplicateId, reason, tx)`, but
the LLD requires optimistic locks on BOTH rows (duplicate `expected_version` from the DTO, master
version) plus the field-precedence winners — none carriable in 4 args. **Resolution:** implemented
`merge(masterId, duplicateId, reason, input, tx)` — pinned positional prefix + an options object
(the ratified FR-030 `assignOwner` options-object precedent). It performs both `leads` writes and
emits the `lead_merge` audit (E3 detail incl. `relinked_ids`) + `LEAD_STAGE_CHANGED` outbox in-tx.
`LeadService.unmerge(duplicateId, masterId, reason, input, tx)` was added the same way (the LLD's
unmerge pseudocode calls it; it is absent from the §11.2 pinned list). Shared-utilities.md should
ratify both signatures.

## 3. Field-precedence contested-field set is not enumerated
**The gap:** the LLD never lists which master fields `field_precedence` arbitrates; the DTO models
only `manual_overrides.{owner_id,branch_id}` and T-018 evidences `priority`. **Resolution
(minimal, spec-evidenced):** `duplicate` precedence adopts the duplicate's non-null `owner_id` +
`priority`; `manual` writes the validated `owner_id` (+ optional `branch_id`); `master` writes
nothing. `branch_id` is NEVER taken from the duplicate (cross-branch: master's branch takes
precedence, T-020). Other columns (amounts, product, identity, attribution FK) are not adopted.
`manual_overrides.owner_id` is validated as an ACTIVE user whose `branch_id` equals the merged
record's final branch (override branch if given, else the master's).

## 4. Re-opening pair matches at unmerge would poison FR-020's recompute
**The gap:** LLD unmerge step 6 sets the pair rows to `status='open'` only — leaving
`action='merged'` on OPEN rows, which FR-020's `recomputeDuplicateStatus` ranks first and would
re-derive `duplicate_status='merged'` on the next duplicate-check of either lead. **Resolution:**
the merge audit detail also stores `duplicate_match_snapshots` (pre-merge `action`/`status`/
`action_by`/`action_reason` per pair row — an E3-adjacent extension); unmerge restores those exact
values. Needs LLD write-back.

## 5. Chained-merge error code conflict inside the LLD
LLD §Service-layer validations says master-already-merged → 400; §State Machine says chained merge
→ 409; T-010 accepts either. **Resolution:** 409 `CONFLICT` (taxonomy: "illegal state") for both
already-merged-duplicate and merged-master. Also added (beyond the LLD's validation table) a 409
guard refusing to merge a lead that is itself the MASTER of earlier merges — required by test-spec
INV-008 ("a master lead must not itself be merged").

## 6. Post-commit notification hook skipped
LLD step 13 calls `NotificationDispatchService` "if any notification rule triggers" — the M11
service (FR-101/103, Wave 3) does not exist and no merge notification rule is defined anywhere.
**Resolution:** skipped (conditional hook with no rules); wire when M11 lands.

## 7. Derived-status semantics after merge/unmerge (recorded, no action needed)
Per the dispatch scope, `recomputeDuplicateStatus` runs for the MASTER after merge (its open-match
picture changed; the duplicate's `merged` status is set directly by `LeadService.merge` — a
recompute would clobber it since the pair rows are now resolved). At unmerge the duplicate is
restored to `none` per the LLD and no recompute runs for either lead; with matches re-opened, both
statuses re-derive on the next FR-020 check/scan.

## FR-021 — reviewer write-backs (minors, arbiter)
1. Web slice (MergeConfirmDialog/UnmergeActionButton/hooks) deferred to Dev 2's web foundation — same precedent as FR-050-6.
2. Unmerge restores attribution_status='original' unconditionally (LLD-literal); a pre-merge 'reassigned' status is lost — fold into the snapshot-principle LLD write-back.
3. In-org out-of-scope merge → 403 (per LLD §Auth 4c + T-007); LLD §Error Cases' "out of scope → 404" line should be reconciled.
4. api-contract mergeLead lists only 200/403/409; implementation (per LLD) also emits 400/401/404/429 — completed in the FR-021 contracts amendment PR.
