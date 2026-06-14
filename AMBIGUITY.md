# AMBIGUITY â€” FR-031 (Hot-Lead Flag)

## FR-031-A1: NotificationDispatchService not yet built (M11 deferred)

**The gap (precise):** FR-031.md Â§Step 12 requires `NotificationDispatchService.send(lead, 'HOT_LEAD_ALERT', ['in_app', 'sms'])` be called post-commit when `is_hot` transitions `false â†’ true`. The LLD explicitly notes: "This is a post-commit async call â€” failure here does not roll back the lead write or scoring." M11 (engagement module) is not yet built â€” `NotificationDispatchService` does not exist.

**FR-021 precedent:** FR-021 (merge) had the same gap; the precedent is to skip the call and document it here.

**What was built:** The `HOT_LEAD` outbox event IS emitted (via `OutboxService`) on falseâ†’true transition. The downstream engagement module (M11/FR-100/101/102) will subscribe to that event via Pub/Sub and trigger in-app/SMS notification when built. The `ScoringAdapter` does NOT call `NotificationDispatchService` directly â€” the coupling is deferred to M11's Pub/Sub consumer.

**Needed action (Wave 3 / M11):** When `NotificationDispatchService` is built, wire it into `ScoringAdapter.evaluateAsync` as a post-commit call (after `uow.run` completes). No code change is needed in FR-031's boundary â€” `OutboxService` already emits the event that M11 consumes.

---

# AMBIGUITY â€” FR-010 (Omnichannel Lead Capture)

## 1. Bulk-import XLSX parsing has no register-approved library

**The gap (precise):** `docs/lld/FR-010.md` requires `POST /leads/import` to accept
and process **CSV and XLSX** files ("Parse CSV/XLSX row by row"; error case 415
only for files that are *neither*). `docs/contracts/dependency-register.md`
contains **no XLSX/spreadsheet parsing library** (and no CSV library either), and
the hard rule is "only dependency-register libraries". CSV is hand-parseable
within the standard library (implemented â€” `csv.util.ts`, RFC-4180 subset), but
XLSX is a ZIP-of-XML container that cannot reasonably be parsed without a
library (e.g. `exceljs`).

**What was built (no silent failure):**
- Upload boundary accepts both CSV and XLSX per the api-contract (content-sniffed:
  ZIP magic â†’ xlsx, clean UTF-8 text â†’ csv, anything else â†’ 415 `UNSUPPORTED_MEDIA`).
- CSV imports are fully processed end-to-end (per-row validation, per-row
  UnitOfWork commits, error CSV `(row_number, column, code, message)`, job counters).
- An XLSX job is marked `status='failed'` with an explanatory `error_file_ref`
  row ("XLSX parsing is not yet available â€¦") â€” loud, durable, auditable; never a
  silent drop. See `apps/api/src/modules/capture/import-processor.job.ts`.

**Needed decision (Dev 1 / contracts owner):** add an XLSX parser (suggest
`exceljs`, security-reviewed) to `dependency-register.md`, then implement the
XLSX branch of `ImportProcessorService` â€” or amend FR-010/api-contract to CSV-only
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

# AMBIGUITY â€” FR-030 (Rules-Based Allocation)

## FR-030-1. "Branch default team" for the unassigned pool is not modelled in the schema

**The gap (precise):** `docs/lld/FR-030.md` Â§Backend Flow step 7 routes a
no-match lead to "`team_id = lead.branch_id`'s **default team**", but
`docs/data-model/schema.sql` Â§`teams` has **no default-team flag** (columns:
team_id, org_id, name, branch_id, manager_id, is_active, audit cols) and no
other artefact defines which of a branch's teams is "default".

**Resolution applied (deterministic, documented in-code):** the OLDEST active
team of the lead's branch (`ORDER BY created_at ASC, team_id ASC LIMIT 1`) is
used as the pool team â€” see
`apps/api/src/modules/allocation/allocation-rule.repository.ts`
(`findBranchDefaultTeam`). When the lead has no branch, or the branch has no
active team, `team_id` is left unchanged; the `LEAD_ASSIGNED` (owner_id=null,
reason `unassigned_pool`) outbox event and the `allocation.no_match` alert
still fire, so no routing decision is ever silent.

**Needed decision (Dev 1 / data-model owner):** either add an
`is_default`/`is_pool` flag (partial unique index per branch) to `teams` and
swap the lookup, or ratify the oldest-active-team convention in the FR-030 LLD.

## FR-030-2. No-match behaviour for a lead that ALREADY has an owner

**The gap (precise):** FR-030 LLD step 7 says no-match â†’ `assignOwner(owner_id
= null, â€¦)` + `LEAD_ASSIGNED(owner_id=null, reason 'unassigned_pool')`. FR-010
self-assigns RM-captured leads (`owner_id = actor`) at insert, and allocation
runs on EVERY creation â€” the LLD never says whether no-match should *clear* an
existing owner.

**Resolution applied (conservative):** the unassigned-pool path (team parking +
owner-null event + `allocation.no_match` alert) runs only for UNOWNED leads â€”
matching INV-01's own definition ("Unassigned pool leads have owner_id=null
â€¦"). A no-match on an already-owned lead is a no-op (the RM keeps the lead in
`captured`); a matching rule still assigns normally (including to a different
RM). See `AllocationService.fallBackToUnassignedPool`.

**Needed decision:** ratify, or specify that auto-allocation strips RM
self-ownership on no-match.

---

# FR-030 â€” review write-backs pending (arbiter / Dev 1)

1. **auth-matrix.json `resource_governance`** still maps `allocation_rules` â†’ `configuration` / M14 maker-checker; FR-030 (per its LLD Â§Auth) writes rules directly via M4 under `allocate`, active-immediately. Reconcile the matrix row (or revert to the governance path) â€” one-line contracts PR.
2. **allocation-rules edit/deactivate gap:** claiming the resource out of FR-131's generic master endpoints removed its PATCH; FR-030's LLD specifies only GET+POST. Decide: dedicated PATCH/deactivate endpoint (api-contract amendment) or route updates through FR-132 governance.
3. **FR-030 LLD step-5 write-back:** capacity filter is applied whenever `capacity_limit` is set (not only `method='capacity'`) â€” the only reading consistent with test T02; record in the LLD.
4. **FR-030-tests.md INV-08** contradicts INV-02 for reassignment of an already-assigned lead; implementation (correctly) writes `stage_history` only on real transitions â€” amend the test spec.

(The `assignOwner` options-object pin is already written back to `shared-utilities.md`. Stage-regression-on-reassign was FIXED in code before commit â€” reassign past `assigned` now preserves stage.)

---

# AMBIGUITY â€” FR-020 (Duplicate & Near-Duplicate Detection)

## FR-020-1. Same-mobile match where PANs differ (or only one side has a PAN) is not in the BRD match table

**The gap (precise):** the BRD default-match table (FR-020 LLD Â§Confidence Scoring
Rules) covers `same PAN + same mobile` (strong/block), `same PAN, different
mobile` (strong/warn) and `same mobile, NO PAN on either` (medium/warn). It does
not specify the same-mobile case where the two identities carry **different**
PAN tokens, or where exactly one side has a PAN.

**Resolution applied (conservative, in-code):** any same-mobile candidate not
upgraded by a same-PAN hit scores **medium/warned** (`matched_on: ['mobile']`) â€”
the same outcome as the table's mobile row, so a shared family phone flags for
review instead of being silently ignored or hard-blocked. Encoded in
`MATCH_RULES` (`apps/api/src/modules/dedupe/dedupe.service.ts`); T03 still holds.

**Needed decision (Dev 1 / product):** ratify medium/warn for the
different-PAN/one-PAN mobile variants, or specify a distinct row (e.g. weak for
PAN-mismatch) â€” then write it back into FR-020.md.

## FR-020-2. (process incident, for Dev 1) Cross-worktree `git stash` race during the build

`git stash` state is repo-wide â€” shared by ALL worktrees (`lms-wt/fr020`,
`fr050`, `fr110`). During this FR's build, this agent's `stash -u`/`pop` raced a
concurrent FR-110 agent's stash: each worktree popped the OTHER agent's WIP.
Recovered here from the dangling stash commits (this worktree's final state
verified byte-identical to its pre-stash state); the FR-110 WIP was re-stored as
`stash@{0}` ("restored by FR-020 agentâ€¦", commit `a6900af`) â€” **pop it in the
fr110 worktree**, whose working tree may also still hold FR-020 content from the
race. Rule for the team plan: **never use `git stash` in shared-repo worktrees**
(use `git worktree`-local commits or plain file copies instead).

## FR-020 â€” reviewer write-backs (minors, arbiter)
1. LLD Assumption 5 ("email as supplementary weak signal") has no MATCH_RULES rule â€” email absent from BRD match table and test spec; record/strike in LLD.
2. Zero-candidate early return reports duplicate_status='none' without recomputing â€” a previously-flagged lead with edited identity keeps stale 'flagged' in DB (LLD-literal); resolve in FR-021 resolution flow.
3. LLD yaml lists HEAD under roles_with_edit_lead but auth-matrix gives HEAD no edit_lead â€” contracts win (HEADâ†’403); reconcile LLD.
4. duplicate-check.port.ts:9 doc comment still links deleted NoopDuplicateCheckAdapter â€” fix comment in next touch.

---

# AMBIGUITY â€” FR-110 (Purpose-wise Consent Ledger)

## FR-110-1. LLD audit action `CONSENT_CAPTURED` is not an `audit_action` enum value

**The gap (precise):** `docs/lld/FR-110.md` Â§Backend Flow 4g and `FR-110-tests.md`
T01/T32/INV-07 use audit `action = 'CONSENT_CAPTURED'`, but the `audit_action`
enum (schema.sql Â§5.5 / `@lms/shared` `AuditAction`) has no such value â€” it has
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

**The gap (precise):** FR-110.md Â§Endpoint 3 says the customer-path consent
`channel` "is derived from the `customer_links.channel` column" and lead/profile
are resolved "from the `customer_links` row", but schema.sql `customer_links`
has neither a `channel` nor a `customer_profile_id` column (columns:
customer_link_id, org_id, lead_id, token_hash, purpose, status, expires_at,
opened_at, otp_verified_at, revoked_by, audit cols).

**Resolution applied:** the FR-060 seam contract (`CustomerLinkPort.
resolveForConsent â†’ ResolvedCustomerLink { leadId, customerProfileId, orgId,
channel }`) carries the channel, making its source the FR-060 adapter's
decision; `customer_profile_id` falls back to `leads.customer_profile_id`.

**Needed decision (Dev 1 / data-model owner):** add `channel` to
`customer_links`, or ratify a fixed channel (e.g. `website`) for micro-site
consents in FR-060/FR-110.

## FR-110-3. Customer token machinery (FR-060) not yet built â€” endpoint live behind a port

Not a spec gap â€” the recorded cross-wave dependency (STAGE7-CONTINUATION Â§3/Â§9:
Dev 3 builds FR-110 before Dev 2's FR-060). `POST /c/{token}/consent` is
implemented per contract, but token validation (status/expiry/**OTP step-up**)
is `CustomerLinkGuard`/M7 territory, so resolution sits behind
`CUSTOMER_LINK_PORT` (`modules/compliance/ports/customer-link.port.ts`). The
bound `UnavailableCustomerLinkAdapter` resolves no token (every request â†’ 404,
existence hidden, loud warn log) until FR-060 rebinds the port in
`compliance.module.ts`. T19â€“T24's full-HTTP assertions move to the deferred
integration wave alongside FR-060.

## FR-110-4. Dispatcher note vs LLD: `setConsentStatus` versioning

The dispatch brief described `LeadService.setConsentStatus` as "same
single-UPDATE + expectedVersion/version-bump pattern as the other mutators";
FR-110.md Â§Data Operations explicitly specifies **no version bump** ("volatile
system-managed field per architecture Â§11.2") and the Â§11.2 interface lists the
mutator without `expectedVersion`. The LLD governs: implemented as one
org-scoped UPDATE of `consent_status` + `updated_at` (no version bump, stage
untouched, NOT_FOUND on zero rows). One signature extension vs the frozen stub:
an `orgId` parameter, because the LLD's SQL is `WHERE lead_id = ? AND org_id = ?`.

## FR-110 â€” reviewer write-backs (minors, arbiter)
1. state-machines.md says consent_records "no row is updated / any UPDATE invalid" while FR-110 LLD Â§301 sanctions the superseded_by pointer UPDATE (implemented, tested) â€” write the pointer exception back into state-machines.md.
2. clientMeta records raw X-Forwarded-For (spoofable, multi-hop) per LLD Â§189 â€” standardise trusted-proxy-resolved client IP at the integration-test wave.

---

# AMBIGUITY â€” FR-050 (Lead List & Saved Work Queues)

*None of these blocked completion; each was resolved with the narrowest spec-consistent choice and is listed for Dev-1/contract write-back (CLAUDE.md Â§9).*

## FR-050-1. `audit_action` enum has no `bulk_action` value

**The gap (precise):** FR-050 LLD Â§Backend Flow (bulk step 4) and FR-050-tests INV-3 reference an
`audit_logs.action = 'bulk_action'` intent row, but the `audit_action` enum (schema.sql / BRD Â§5.5,
`@lms/shared` `AuditAction`, generated DB types) has no such value.

**Resolution applied:** the single bulk-action intent row is recorded as `action='reassign'` with
`detail.sub_action='bulk_action'` (the AMBIGUITIES.md **A4 precedent** â€” map under an existing
action + `detail.sub_action`). Per-lead audits remain the `reassign` rows written by
`LeadService.bulkReassign` (one per lead, pinned in shared-utilities.md). See
`apps/api/src/modules/workspace/bulk-action.service.ts`.

**Needed decision:** add `bulk_action` to `audit_action` (schema + enum + Flyway) and switch the
intent row, or ratify the `detail.sub_action` mapping in the LLD/tests (INV-3 query).

## FR-050-2. `POST /leads/bulk-action` request/response shapes are not in the contract

**The gap (precise):** api-contract.yaml v5.3 defines the path (summary "reassign/stage/tag; one
audit per lead", optional `Idempotency-Key`, 200/400/403/409) but no requestBody/response schemas,
and the FR-050 LLD Â§bulk predates the endpoint (it described a client-side fan-out).

**Resolution applied:** body = `{ action: 'reassign', lead_ids: uuid[] (1..100, deduped), reason
(1..500), params: { owner_id: uuid } }`; response `data` = `{ action, requested, succeeded, items:
[{ lead_id, status: 'succeeded' | 'skipped_out_of_scope' | 'skipped_ineligible' }] }` (the LLD's
"per-item result list"). `action: 'stage'/'tag'` are **rejected (400 VALIDATION_ERROR)**: `tag` has
no LeadService mutator at all, and `transitionStage` lands with FR-052 (calling it today throws a
typed INTERNAL_ERROR by Wave-1 convention â€” a 400 up front is strictly better).

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

- **`sla_state=due_soon` window** (LLD leaves the interval as "â€¦"): reused FR-104's canonical
  `APPROACHING_WINDOW_MINUTES` (= 30, `core/sla/sla.constants.ts`) so the list filter and the SLA
  sweep agree on "approaching breach"; comparisons use DB `now()` (FR-050 only reads the stored
  due-at, per LLD).
- **`filter[date_from/date_to]` column** (not named in the LLD): applied to `leads.created_at`,
  inclusive both ends.
- **`applyScope` signature:** takes the AbacGuard-resolved `ScopePredicate` (not the raw user) â€”
  the team scope needs the member ids only `EntitlementService` resolves (FR-002/CORRECTIONS:
  `owner_id IN (team member user_ids)`, never `team_id`). Matches the FR-030 precedent.

## FR-050-5. Saved-view shared-visibility predicate underspecified

**The gap (precise):** LLD Â§Endpoint 2 says "own âˆª shared views whose scope the caller is inside",
but `saved_views` has no branch/team anchor columns, and TC-17 requires a BM to see an SM's
**team**-scoped share from the BM's branch (the BM is not *in* the team).

**Resolution applied:** a shared view is visible when EITHER (a) the caller is inside the audience
the owner shared into (`A` org-wide; `B`/`T`/`R` = caller in the same branch/team/region as the
owner, anchored on the owner's `users` row), OR (b) the owner falls inside the caller's own
`view_lead` scope (manager-over-subordinate containment â€” what TC-17 exercises). PARTNER/CUSTOMER
predicates contribute no shared legs (own views only). See
`apps/api/src/modules/workspace/saved-view.repository.ts`.

**Needed decision:** ratify the dual-leg rule in the LLD before FR-051..054 build on it.

## FR-050-6. Frontend slice deferred (not built here)

**The gap:** the LLD lists `apps/web` files (lead-list page, saved-view chips, filter drawer) built
on the shared web foundation (`AppShell`, `DataTable`, `apiClient` â€” BRD Â§4.5), which is Dev 2's
queue (TEAM-PLAN) and does not exist yet (`apps/web` is the scaffold + `MaskedField` only); the
dispatch scope for this FR was the backend module + registration.

**Resolution:** backend complete; the UI slice ships when the web foundation lands (building it now
would re-implement shared components, violating shared-utilities reuse).

## FR-050 â€” reviewer write-backs (minors, arbiter)
1. FR-050 LLD example shows name_masked="Ra***** K****" but FR-002 masking matrix governs (full name for internal roles, first-name for DPO/export) â€” amend LLD example.
2. core masking FIELD_MAP maps wire key "name"â†’full_name rule: DPO listing saved-views gets view NAMES truncated (non-PII collision) â€” rename wire key or exempt; FR-002/FR-050 cross-note.
3. bulk-action secondary denials (disallowed predicate type / target-owner out of scope) return FORBIDDEN without abac_deny audit â€” add audits (primary capability denial IS guard-audited).
4. (pre-existing) LeadService.bulkReassign sets updated_by/audit actor_id to the NEW OWNER (pinned signature has no actor param) â€” same fix as the FR-010 actorId item.
5. FR-050-tests INV-3 query (action='bulk_action') must be amended to the detail.sub_action mapping.

# AMBIGUITY â€” FR-021 (Merge & Source-Attribution Preservation)

## 1. `POST /leads/{id}/unmerge` is missing from api-contract.yaml
**The gap:** the LLD defines unmerge as a full companion endpoint ("same x-frs: [FR-021]"), but
`api-contract.yaml` has only `/leads/{id}/merge` (path 169). **Resolution:** implemented per the LLD
(it governs); a Dev-1 contracts PR should add the unmerge path + 403 (window) / 400 / 409 responses.

## 2. `LeadService.merge` pinned 4-arg signature cannot satisfy the LLD's locking requirements
**The gap:** shared-utilities/architecture Â§11.2 pin `merge(masterId, duplicateId, reason, tx)`, but
the LLD requires optimistic locks on BOTH rows (duplicate `expected_version` from the DTO, master
version) plus the field-precedence winners â€” none carriable in 4 args. **Resolution:** implemented
`merge(masterId, duplicateId, reason, input, tx)` â€” pinned positional prefix + an options object
(the ratified FR-030 `assignOwner` options-object precedent). It performs both `leads` writes and
emits the `lead_merge` audit (E3 detail incl. `relinked_ids`) + `LEAD_STAGE_CHANGED` outbox in-tx.
`LeadService.unmerge(duplicateId, masterId, reason, input, tx)` was added the same way (the LLD's
unmerge pseudocode calls it; it is absent from the Â§11.2 pinned list). Shared-utilities.md should
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
**The gap:** LLD unmerge step 6 sets the pair rows to `status='open'` only â€” leaving
`action='merged'` on OPEN rows, which FR-020's `recomputeDuplicateStatus` ranks first and would
re-derive `duplicate_status='merged'` on the next duplicate-check of either lead. **Resolution:**
the merge audit detail also stores `duplicate_match_snapshots` (pre-merge `action`/`status`/
`action_by`/`action_reason` per pair row â€” an E3-adjacent extension); unmerge restores those exact
values. Needs LLD write-back.

## 5. Chained-merge error code conflict inside the LLD
LLD Â§Service-layer validations says master-already-merged â†’ 400; Â§State Machine says chained merge
â†’ 409; T-010 accepts either. **Resolution:** 409 `CONFLICT` (taxonomy: "illegal state") for both
already-merged-duplicate and merged-master. Also added (beyond the LLD's validation table) a 409
guard refusing to merge a lead that is itself the MASTER of earlier merges â€” required by test-spec
INV-008 ("a master lead must not itself be merged").

## 6. Post-commit notification hook skipped
LLD step 13 calls `NotificationDispatchService` "if any notification rule triggers" â€” the M11
service (FR-101/103, Wave 3) does not exist and no merge notification rule is defined anywhere.
**Resolution:** skipped (conditional hook with no rules); wire when M11 lands.

## 7. Derived-status semantics after merge/unmerge (recorded, no action needed)
Per the dispatch scope, `recomputeDuplicateStatus` runs for the MASTER after merge (its open-match
picture changed; the duplicate's `merged` status is set directly by `LeadService.merge` â€” a
recompute would clobber it since the pair rows are now resolved). At unmerge the duplicate is
restored to `none` per the LLD and no recompute runs for either lead; with matches re-opened, both
statuses re-derive on the next FR-020 check/scan.

## FR-021 â€” reviewer write-backs (minors, arbiter)
1. Web slice (MergeConfirmDialog/UnmergeActionButton/hooks) deferred to Dev 2's web foundation â€” same precedent as FR-050-6.
2. Unmerge restores attribution_status='original' unconditionally (LLD-literal); a pre-merge 'reassigned' status is lost â€” fold into the snapshot-principle LLD write-back.
3. In-org out-of-scope merge â†’ 403 (per LLD Â§Auth 4c + T-007); LLD Â§Error Cases' "out of scope â†’ 404" line should be reconciled.
4. api-contract mergeLead lists only 200/403/409; implementation (per LLD) also emits 400/401/404/429 â€” completed in the FR-021 contracts amendment PR.

---

# AMBIGUITY â€” FR-011 (Lead Quality Enrichment & Score at Capture)

## FR-011-1. updateLead endpoint (PATCH /leads/{id}) does not exist on this worktree

**The gap:** FR-011 LLD Â§Backend Flow "Trigger: PATCH /api/v1/leads/{id}" requires scoring
re-evaluation on relevant field changes. This endpoint (operationId: updateLead) is owned by
FR-050 (Wave 3) and does not exist in this worktree (Wave 2). Per dispatch instructions, the
scoring path was not wired to a non-existent endpoint.

**Resolution applied:** `ScoringService.evaluate(leadId, db, orgId)` is fully implemented and
available for the update FR to call. Wire `ScoringService.evaluate` into `UpdateLeadUseCase`
when FR-050 builds the PATCH endpoint â€” pass the `ScoringService` from `AllocationModule`
(already exported) and call `LeadService.setScore` on scoring-relevant field changes.

**Needed action (Dev 1 / FR-050 implementor):** import `ScoringService` from AllocationModule
in the FR-050 use case and wire the scoring side-effect identical to the create path.

## FR-011-2. score/score_reasons masking (stripping for PARTNER/CUSTOMER) not implemented

**The gap:** FR-011 LLD Â§Score visibility says `MaskingService`/`ResponseEnvelopeInterceptor`
strips `score` and `score_reasons` from the response for PARTNER/CUSTOMER roles. The current
`MaskingInterceptor.FIELD_MAP` transforms PII values (partial masking) â€” it does not support
field deletion based on role scope. The LLD's test T18 (`score` absent for PARTNER) and T19
(`score` present for BM) both require the `GET /api/v1/leads/{id}` endpoint (FR-050) to exist.

**Resolution applied:** `ScoringService` and `LeadService.setScore` are fully implemented.
The masking gap is deferred: when FR-050 builds the getLeadById endpoint and its DTO, add
a role-scoped `score`/`score_reasons` exclusion (either via a NestJS class-transformer `@Exclude`
with the ABAC-resolved role, or a response-shape discriminator in the serialization layer).

**Needed action (Dev 1 / FR-050 + FR-002 owner):** extend the masking layer to support
field-deletion (not value-masking) for role-scoped fields; record in FR-002 FIELD_MAP or
create a complementary `ROLE_STRIP_MAP`. T18/T19 API tests move to the FR-050 wave.

## FR-011-3. Scoring port wiring: ScoringAdapter opens its own UnitOfWork (post-commit)

The capture path calls `evaluateAsync(leadId)` fire-and-forget AFTER the lead commit
(capture.service.ts lines 366-368). `ScoringAdapter` opens its own `UnitOfWork.run` to
load `org_id`, evaluate the score, and call `LeadService.setScore`. This means the score
write is in a SEPARATE transaction from the lead creation, not the same tx as described in
the LLD's "within UnitOfWork" flow (FR-011.md Â§389-392). The trade-off: the score is null
immediately after the 201 response and updated within milliseconds by the post-commit hook.

**Rationale:** the LLD's transaction diagram was written for a synchronous inline path, but
the built wiring (capture.service.ts:366) is explicitly asynchronous post-commit. Both
patterns satisfy the LLD's non-blocking requirement; the post-commit approach prevents the
scoring I/O from extending the lead-capture transaction latency. The lead.score field will
be non-null before any real user reads the lead via the GET endpoint (FR-050).

**Needed decision (Dev 1):** ratify the post-commit async wiring, OR wire ScoringService
synchronously inside the UnitOfWork (requires changing capture.service.ts scoring call from
fire-and-forget to awaited inside the tx). Either is spec-consistent; the async variant is
live in the code.

---

# AMBIGUITY â€” FR-051 (Lead 360 View)

## Foundation UI gaps (Dev 2)

The merged web foundation does NOT ship `StatusChip`, `PageHeader`, or a shadcn
`Tabs` primitive (no `@radix-ui/react-tabs` dep) that `shared-utilities.md Â§Shared UI`
and the FR-051 LLD Â§UI Component Tree require. FR-051 ships minimal LOCAL
`StatusChip`/`SectionTabs` and omits `PageHeader` (lead code + stage chip rendered
inline) to stay unblocked.

**Action: Dev 2 to provide the canonical primitives; FR-051 to swap to them.**
Keep the local components; do NOT create canonical primitives in
`components/common` â€” that is Dev 2's ownership.

## e2e deferral

`apps/web/e2e/lead360.spec.ts` (Playwright E2E-051-01..05) deferred to the
project-wide integration-test wave (manifest `stage7.test_strategy`), consistent
with every other FR. Not built now.

## LLD write-backs (MINOR, for arbiter)

(a) Â§Auth Check step 2 â€” `scopeResolver` returns only `{resourceType:'leads'}`;
scope is enforced in SQL by AbacGuard, not a resource-attribute pre-check.

(b) Â§Endpoint error table 403/FORBIDDEN row contradicts Â§Auth Check step 3 /
Â§Error Cases (endpoint returns 404 only) â€” strike the 403 row from the LLD error
table.

(c) Â§Data Operations step-1 pseudocode `owner.display_name` should read
`owner.full_name` (matches schema column + implementation).

(d) DPO notes path returns `[]` (break-glass notes deferred, needs FR-003
break-glass context) â€” intentional; document in LLD.

## Resolved

`view_sensitive` added to `audit_action` enum (schema.sql line 112 +
`V4__add_view_sensitive_audit_action.sql` + `@lms/shared` AuditAction +
`types.generated.ts`). `DPO_VIEW_AUDIT_ACTION` now correctly set to
`AuditAction.VIEW_SENSITIVE`.

---

# AMBIGUITY â€” FR-052 (Pipeline Board + Stage Transitions)

## FR-052-1. Deferred guards â€” owning FR table

The following named guards on `ready_for_handoff â†’ handed_off` are deferred
(return `true` until the owning module builds the child table):

| Guard | Owning FR | Backing table (not yet built) |
|---|---|---|
| `mandatory_docs_verified` | FR-070 (M8 Documents) | `documents` |
| `kyc_signoff` | FR-080 (M8 KYC) | `kyc_verifications` |
| `mandatory_docs_or_waiver` | FR-070 (M8 Documents) | `documents` |
| `kyc_sufficient` | FR-080 (M8 KYC) | `kyc_verifications` |

The following guards are also deferred because they require runtime data that
is only available at the moment of the relevant field-level action (not on the
lead row loaded by the guard service):

| Guard | Deferred reason |
|---|---|
| `valid_branch_product_source` | Validated at capture (FR-010); no re-check at transition |
| `contact_logged` | Requires tasks/notes child rows (FR-104) |
| `intent_captured` | Requires progressive-fields check (FR-050 updateLead) |
| `progressive_fields` | Same as above |
| `checklist_generated` | Requires doc checklist child rows (FR-070) |
| `consent_eligibility` | Requires KYC consent step (FR-080) |
| `eligibility_received` | Requires eligibility_snapshots (FR-090) |
| `docs_kyc_ready` | Composite of docs + KYC (FR-070/080) |
| `valid_payload` | Validated at DTO boundary (Zod); no additional service check |
| `within_reopen_window` | Requires FR-025 config window |
| `followup_due_or_reactivation` | Requires SLA/task check (FR-104) |
| `next_followup_date` | Validated at DTO boundary (FR-052 Zod schema) |

## FR-052-2. ipDevice not plumbed to LeadService mutators

**Checked:** `LeadService.assignOwner`, `LeadService.bulkReassign`,
`LeadService.transitionStage` â€” none accept or forward an `ipDevice` parameter
to `AuditAppender.append`. The audit appender stores `null` in the `ip_device`
column for all mutator-driven audit rows.

**Resolution:** ipDevice capture is a cross-cutting concern. Wiring it requires
a request-context provider (e.g. `AsyncLocalStorage`) threaded from the HTTP
layer through every mutator call â€” this is not an FR-052 change but a
project-wide plumbing pass.

**Action (Dev 1 / architecture owner):** introduce a `RequestContextService`
that stores `{ ip, user_agent }` in an `AsyncLocalStorage` context and is
injected into `LeadService` (or the `AuditAppender` itself). FR-052 does not
implement this; it records the gap here so the next plumbing pass covers all
mutators uniformly.

## FR-052-3. PARTNER move_stage scope mismatch (matrix vs LLD)

`auth-matrix.json` grants `PARTNER.move_stage = 'P'` (partner's own
submissions). The FR-052 LLD Â§Auth Check lists only RM, BM, SM as allowed roles
for `move_stage` (no PARTNER). `pipeline-board.service.ts isInScope` returns
`false` for `type: 'partner'`.

**Implementation decision (LLD governs):** PARTNER is silently blocked at the
scope check (`isInScope` â†’ false â†’ FORBIDDEN). The ABAC guard still fires
before the service method, so a PARTNER with the capability passes `AbacGuard`
but hits FORBIDDEN in the service scope check.

**Action for arbiter:** reconcile the matrix row â€” either remove
`PARTNER.move_stage` from `auth-matrix.json` (if partners cannot move stages
per product intent) or implement the P-scope predicate in `isInScope` (PARTNER
may move only their OWN submitted leads). The LLD says partners cannot move
stages; updating the matrix to match is the minimal change.

## FR-052-4. shadcn Sheet primitive absent from web foundation

`MobileStageSelectorSheet` is built as a minimal accessible modal (role="dialog",
aria-modal, Escape key) on Tailwind only. The shadcn `Sheet` primitive is not
yet in the foundation (same situation as FR-051's `StatusChip` / `SectionTabs`).

**Action (Dev 2):** provide the canonical `Sheet` primitive; FR-052 to swap
`MobileStageSelectorSheet` to use it.
---
# AMBIGUITY â€” FR-053 (Role-Based Dashboard & Home)

## A-FR053-1: MiniChart not implemented (SourceSummaryWidget)

The LLD Â§UI Component Tree mentions a `MiniChart` (bar) for `SourceSummaryWidget`
when bandwidth is not constrained. No chart library is listed in
`docs/contracts/dependency-register.md`. `SourceSummaryWidget` renders a `<table>`
only (the documented low-bandwidth fallback). If a chart library is approved,
the bar variant can be added without changing any other component.

## A-FR053-2: `name_masked`/`mobile_masked` columns absent from `lead_identities`

LLD Query 3 references `li.name_masked` and `li.mobile_masked` as stored-masked
columns. The actual `schema.sql` and `types.generated.ts` have only `name` and
`mobile` (raw values). `DashboardRepository.getHotLeads()` selects raw `name` and
`mobile`, and `DashboardService` applies `MaskingService` before serialisation â€”
consistent with the FR-050 `LeadListService` pattern.

## A-FR053-3: `SourceAttributions` has no `source_name` column

LLD Query 5 groups by `sa.source_name`. The schema column is `source` (a
`lead_source` enum), not `source_name`. The query groups by `sa.source` and
aliases it `source_name` in the SELECT to preserve the response shape.

## A-FR053-4: `filterWhere(sql\`...\`)` not supported by Kysely aggregate functions

The LLD shows this form for conditional aggregation. Kysely's aggregate
`filterWhere()` requires an expression-builder predicate, not a raw `sql\`\``
template. Rewrote Query 1 to use `eb.and([...])` with typed column refs inside
`filterWhere`, and `sql<boolean>\`...\`` only for date-trunc expressions where no
typed form exists. All predicates remain parameterised.

## A-FR053-5: KYC and DPO widget sets (LLD Ambiguities A1 and A2)

Implementing best-effort resolutions from LLD: KYC sees KPI + SLA alerts only;
DPO passes the ABAC guard (reports:M) and receives aggregate counts with all
name/mobile fields strictly masked.
---
# AMBIGUITY â€” FR-054 (Global Search)

## 1. cmdk/Command and @radix-ui/react-dialog not in dependency register

**The gap (precise):** FR-054 LLD Â§UI specifies the `SearchPalette` be built
using `shadcn/ui` `Command` (backed by `cmdk`) and `Dialog` (backed by
`@radix-ui/react-dialog`). Neither `cmdk` nor `@radix-ui/react-dialog` appear
in `docs/contracts/dependency-register.md`. Only `@radix-ui/react-slot` and
`@radix-ui/react-label` are registered.

**Resolution applied:** The palette was implemented using a native HTML
`<dialog open>` element with `role="dialog"` and `aria-modal="true"`, providing
equivalent semantics and full WCAG 2.1 AA keyboard accessibility. The LLD
instruction "missing primitive â†’ reuse a prior FR's local version or minimal
local + AMBIGUITY note" was followed.

**Action required before merge:** If `cmdk` and `@radix-ui/react-dialog` should
be added to the dependency register, a contracts PR from Dev 1 is required first.
The `SearchPalette` can then be migrated to the `Command`/`Dialog` primitives
without changing any API surface.

## 2. DPO task visibility in search

**The gap (precise):** The auth-matrix gives DPO `view_lead: M` (masked
compliance view) but does not explicitly list task visibility for DPO.

**Resolution applied (best-effort):** DPO receives tasks scoped identically to
leads â€” the `masked` predicate adds no row restriction, so DPO can see all org
tasks linked to leads (same as their lead view). If compliance requires DPO to
receive no task results, the `TaskSearchRepository.search` must return `[]` for
`predicate.type === 'masked'`.

## 3. PAN token lookup in search

**The gap (precise):** `lead_identities.pan_token` stores a tokenised value.
The LLD says to do PAN equality lookup when the query matches the PAN regex
(`[A-Z]{5}[0-9]{4}[A-Z]`). No `PanTokenService` exists in `shared-utilities.md`
to tokenise the input before lookup.

**Resolution applied (best-effort):** The raw PAN regex is detected in
`LeadSearchRepository.search` and the raw value is compared directly to
`pan_token`. This will only work if `pan_token` stores the raw PAN (not a hash
or vault reference). If `pan_token` is truly tokenised, the equality check will
never match and the PAN search path is silently a no-op until a `PanTokenService`
is registered in `shared-utilities.md`.

## 4. Supertest E2E tier deferred (T01â€“T23)

`apps/api/test/.../search.e2e-spec.ts` (T01â€“T23) is deferred project-wide per
`manifest.stage7.test_strategy` (same convention as every prior FR). Unit and
component-level tests in `*.spec.ts` are the per-FR deliverable for this wave.
The e2e supertest suite will be built in the integration-test wave alongside
all other deferred e2e specs.

---

# AMBIGUITY — FR-100 (Task Management)

## FR-100-A1: audit_action enum has no task_created / task_updated values

**The gap (precise):** FR-100.md §Data Operations and §Backend Flow specify
`AuditAppender.append({ action: 'task_created', ... })` and
`AuditAppender.append({ action: 'task_updated', ... })` but `audit_action`
(schema.sql line 112 / `@lms/shared` `AuditAction`) has no such values.

**Resolution applied (enum rule wins, per CORRECTIONS.md):**
- Task create appends `action: AuditAction.LEAD_UPDATE`, `entity_type: 'tasks'`,
  `detail.op: 'task_create'`, `detail.task_id`, `detail.type`, `detail.owner_id`,
  `detail.due_at`.
- Task update appends `action: AuditAction.LEAD_UPDATE`, `entity_type: 'tasks'`,
  `detail.op: 'task_update'`, `detail.from_status`, `detail.to_status`,
  `detail.disposition`.
  Consistent with the FR-050 precedent (`detail.sub_action='bulk_action'`).

**Needed action (Dev 1):** add `task_create` and `task_update` to `audit_action`
in schema.sql + Flyway migration + `@lms/shared` `AuditAction` + update
CORRECTIONS.md. Once added, replace `AuditAction.LEAD_UPDATE` + `detail.op` with
the dedicated enum values in `task.service.ts`.

## FR-100-A2: EventCode has no TASK_OVERDUE value

**The gap (precise):** FR-100.md §Overdue Sweep Job specifies
`OutboxService.emit('TASK_OVERDUE', {...}, tx)` but `event_code` enum
(schema.sql / `@lms/shared` `EventCode`) has no `TASK_OVERDUE` value.
`OutboxService.emit` validates against this enum and would throw INTERNAL_ERROR.

**Resolution applied:** `TaskOverdueSweepJob` emits a structured pino `warn`
log listing the overdue task IDs instead of the outbox event. The status update
to `overdue` completes correctly. The outbox emit is commented out with a TODO.

**Needed action (Dev 1):** add `TASK_OVERDUE = 'TASK_OVERDUE'` to `event_code`
enum in schema.sql + Flyway migration + `@lms/shared` `EventCode`, then
uncomment the `OutboxService.emit` block in `task-overdue-sweep.job.ts`.

## FR-100-A3: LeadService.setNurtureNextAt does not exist

**The gap (precise):** FR-100.md §Data Operations and §Ambiguities 1 requires
`LeadService.setNurtureNextAt(leadId, nextAt, tx)` to update
`leads.nurture_next_at` when a nurture task is completed. This method was absent
from `apps/api/src/modules/capture/lead.service.ts`.

**Resolution applied:** Added `setNurtureNextAt(leadId, nextAt, tx)` to
`LeadService` — no version bump (volatile field, same pattern as `setScore` and
`setDuplicateStatus`). The implementation uses a single parameterised UPDATE
`WHERE lead_id = ? AND deleted_at IS NULL`.

**Needed action (Dev 1):** ratify and write `setNurtureNextAt` back into
`docs/contracts/shared-utilities.md` §LeadService interface.

## FR-100-A4: owner_id scope validation on create (FR-100 Ambiguity 3)

**The gap (precise):** the LLD Ambiguities §3 asks whether an RM may assign a
task to another RM. Resolution: only BM/SM may assign to users other than
themselves (`owner_id != caller.userId`). An RM attempting to create a task with
`owner_id` different from their own `userId` receives `FORBIDDEN` (403).

## FR-100-A5: Supertest E2E tier deferred

FR-100-tests.md T01–T13 are API component tests; the Playwright UI tests
UI-01..UI-05 and SQL invariant tests are deferred per `manifest.stage7.test_strategy`.
Unit tests T14–T20 are implemented as Jest unit specs.
---

# AMBIGUITY — FR-101 (Communication Templates & Audit, M11 Engagement)

## FR-101-A1: GET /leads/{id}/communications not in api-contract.yaml

**The gap (precise):** `CommunicationHistory` component and `useCommunicationLogs` hook
reference a `GET /api/v1/leads/{id}/communications` endpoint for fetching a lead's
communication log list. This path does not appear in `docs/contracts/api-contract.yaml`
(v5.3). `POST /leads/{id}/communications` (the send endpoint, operationId `sendCommunication`)
IS contracted.

**What was built:** The `useCommunicationLogs` hook declares the query key and type shape;
the `apiClient.get(...)` call is present and functional. The endpoint will return 404 until
the contract is added and the GET controller method is implemented.

**Needed action (Dev 1 / contracts owner):** Add `GET /api/v1/leads/{id}/communications`
to `api-contract.yaml` with the `CommLogListResponse` schema (paginated list of
`CommunicationLog`), then add the corresponding controller method to
`CommunicationController`.

## FR-101-A2: FR-103 notification_preferences not yet built — direct DB query with defaults

**The gap (precise):** `NotificationDispatchService` queries `notification_preferences`
directly (raw Kysely, no service abstraction) because FR-103 (Notification Preferences
module) is not yet built. The opt-in/opt-out defaults applied are:

- Absent preference row + transactional category → treat as opted-in (allow send)
- Absent preference row + marketing category → treat as opted-out (block send)

These defaults are code-level conventions, not documented in any contract.

**What was built:** `NotificationDispatchService.checkOptOut` queries
`notification_preferences` where `subject_ref = leadId AND purpose = consent_basis AND
opted_in = false`. Absence of a row does NOT block transactional sends.

**Needed action (Dev 1 / FR-103 owner):** When FR-103 builds `NotificationPreferenceService`,
replace the direct Kysely query in `NotificationDispatchService` with the service call.
Ratify the absence-default semantics in the FR-103 LLD.

## FR-101-A3: AuditAction enum has no TEMPLATE_CREATED value

**The gap (precise):** FR-101.md §Data Operations specifies
`AuditAppender.append({ action: 'TEMPLATE_CREATED', ... })` but `audit_action`
(schema.sql / `@lms/shared` `AuditAction`) has no such value.

**Resolution applied (enum rule wins, per CORRECTIONS.md):**
Template creation appends `action: AuditAction.CONFIG_CHANGE` with
`detail.sub_action = 'TEMPLATE_CREATED'`, `detail.template_id`, `detail.code`,
`detail.channel`. Consistent with the FR-050 precedent (`detail.sub_action='bulk_action'`).
Communication send appends `action: AuditAction.COMM_SEND` (this value exists in the enum).

**Needed action (Dev 1):** add `template_created` to `audit_action` enum in schema.sql +
Flyway migration + `@lms/shared` `AuditAction`, then replace `AuditAction.CONFIG_CHANGE` +
`detail.sub_action` with `AuditAction.TEMPLATE_CREATED` in `template.service.ts`.

## FR-101-A4: DispatchCommunicationWorker internal endpoint not in auth-matrix

**The gap (precise):** `DispatchCommunicationWorker` is a Cloud Tasks HTTP worker endpoint.
Internal worker endpoints should appear in `docs/contracts/auth-matrix.json`
`service_to_service_only` list (or equivalent). No such list exists in the current matrix,
and the worker is not registered there.

**Resolution applied:** The worker controller is decorated with `@Public()` (exempt from
`JwtAuthGuard`) per the Cloud Tasks pattern established by other worker endpoints in the
project. Cloud Tasks adds a task-origin header; the worker validates only that the payload
is well-formed.

**Needed action (Dev 1 / contracts owner):** Add an `internal_worker_endpoints` or
`service_to_service_only` section to `auth-matrix.json` and list the worker paths there,
so the auth reviewer knows which `@Public()` uses are intentional Cloud Tasks workers vs.
truly public endpoints.

---

# AMBIGUITY — FR-114 (Grievance Workflow)

## FR-114-A1: No EventCode for GRIEVANCE_ESCALATED in shared enums

**The gap (precise):** The `GrievanceService.runEscalationSweep` method promotes
breached `open`/`in_progress` grievances to `escalated` status. The LLD for FR-114
(and the TASK_OVERDUE pattern from FR-100) requires an outbox event to be emitted
inside the per-row UnitOfWork transaction so that downstream consumers (e.g.
notification engine, reporting) can react to escalations.

`packages/shared/src/enums/index.ts` defines the `EventCode` enum. It contains
`GRIEVANCE_CREATED` but does NOT contain a `GRIEVANCE_ESCALATED` (or equivalent)
event code. The hard rule is: "never invent an EventCode — use only those in
`@lms/shared`." No suitable existing code covers this semantic.

**What was built:** The escalation sweep writes the `status = 'escalated'` row
update and the audit entry atomically per grievance, and logs a structured summary.
No outbox event is emitted on escalation — this is intentional per the constraint
above, not an oversight.

**Needed action (before Wave C or the next compliance sprint):**
1. Add `GRIEVANCE_ESCALATED: 'GRIEVANCE_ESCALATED'` to the `EventCode` const in
   `packages/shared/src/enums/index.ts` (one-line change; requires Gate C re-sign
   on the shared package or a tracked amendment).
2. In `GrievanceService.runEscalationSweep`, inside the per-row `uow.run` block
   (after `this.repo.update`), add:
   ```ts
   await this.outbox.emit(
     {
       event_code: EventCode.GRIEVANCE_ESCALATED,
       aggregate_type: 'grievance',
       aggregate_id: grievance.grievance_id,
       payload: {
         orgId,
         grievanceNo: grievance.grievance_no,
         previousStatus: grievance.status,
       },
     },
     tx,
   );
   ```
3. Update `T34` in `grievance.service.spec.ts` to assert `outbox.emit` is called
   once per escalated grievance with `event_code: EventCode.GRIEVANCE_ESCALATED`.
