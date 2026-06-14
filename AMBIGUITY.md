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

---

# AMBIGUITY — FR-071 (KYC Verification Orchestration)

*All resolved in-code with the narrowest spec-consistent choice; listed for Dev-1/contract write-back (CLAUDE.md §9). The LLD pseudocode pre-dates the real FR-140 IntegrationGateway API.*

## FR-071-1. Gateway does not return the `integration_log_id`
**Gap:** LLD §Step 5a sets `kyc_verifications.integration_log_id = providerResult.integrationLogId`, but `IntegrationGateway.call` returns only `{ httpStatus, body, idempotent }` (no log id). INV-4 requires the id on every non-manual row.
**Resolution applied:** the service pre-creates the `integration_logs` row via `IntegrationLogRepository.createLog(...)`, passes its id as `GatewayOptions.integrationLogId` (the gateway reuses it), and stores it on `kyc_verifications`. Clean and INV-4/INV-8-safe.

## FR-071-2. `KycMockAdapter` returns a generic body (no KYC outcome)
**Gap:** the bound mock returns `{ mock:'kyc', integration }` with only `status`/`fail` directives — it cannot express a business **mismatch** (TC-002). The real PAN/CKYC/… adapters are Phase-1.5/unbuilt (LLD Assumption 2).
**Resolution applied:** KYC outcome interpretation lives in `kyc-provider.ts` (per kyc.port.ts: the calling module masks/interprets). A 2xx with no explicit `body.outcome` is treated as a successful `valid` check; `body.outcome:'mismatch'` → failed + `exceptionType`. Unit tests mock the gateway to drive both paths.
**Needed decision:** extend `KycMockAdapter` with an `outcome` directive (and a KYC-shaped body) so the deferred integration-test wave can exercise mismatch/exception over real HTTP.

## FR-071-3. `pan_token` / `aadhaar_ref_token` / `ckyc_id` source
**Gap:** the LLD reads these off `providerResult.*`, but the mock returns none, and raw values must never be persisted (BRD §2.4 / INV-1/INV-2).
**Resolution applied:** the service generates OPAQUE, non-reversible surrogate tokens (`pan_…`, `aadhaar_…`) and a masked PAN (`ABCDE****F`); the raw PAN/Aadhaar are sent to the provider but never stored. A real provider/vault returns its own token — swap in the adapter.

## FR-071-4. TC-071-025 (optimistic-lock CONFLICT on `setKycStatus`) is unsatisfiable
**Gap:** the test expects `LeadService.setKycStatus` to fail on a stale `expectedVersion`, but the frozen signature is `setKycStatus(leadId, status, tx)` with NO version bump (volatile derived field, per FR-070 / FR-110-4). `leads.version` is never consulted for kyc_status.
**Resolution applied:** no optimistic lock on kyc_status (matches the frozen mutator). TC-071-025 omitted at the unit tier.
**Needed decision:** strike TC-071-025 from FR-071-tests, or add an `expectedVersion` overload to `setKycStatus` (cross-FR contract change).

## FR-071-5. Provider-down 503 envelope cannot carry `data`
**Gap:** LLD §Response shows the 503 carrying BOTH `data.kycVerificationId` and `error`; the standard `AllExceptionsFilter` sets `data:null` on any error.
**Resolution applied:** the exception `kyc_verifications` row is persisted (FR-072 resolves it) and the service throws `UPSTREAM_UNAVAILABLE` (503, standard envelope). The id isn't surfaced in the 503 body; the UI reloads the KYC list to show the exception row.

## FR-071-6. `IDEMPOTENT_REPLAY` reason has no success-envelope channel
A success replay returns the original verification (200, identical `kycVerificationId`); the standard success envelope `{data,meta,error}` has no `detail.reason` slot, so the `IDEMPOTENT_REPLAY` marker is omitted (informational only).

## FR-071-7. `data_sharing_logs.consent_id` uses the resolved active consent
To guarantee INV-5 referential integrity, the log records the resolved active granted `kyc` consent id (not the raw body `consentId`). TC-022 holds because the test's body `consentId` is the active one. **Needed decision:** ratify, or specify that the body `consentId` must equal the active consent.

## FR-071-8. Phase-1.5 types run through the mock
ckyc/digilocker/aadhaar_otp/vcip are Phase-1.5; only `KycMockAdapter` is bound, so they currently succeed via the mock (LLD Assumption 5's "VcipAdapter returns phase-not-enabled" is an unbuilt-adapter behaviour). The web UI gates these as disabled until enabled.

## FR-071-9. `consentId` made optional (server resolves the active consent)
**Gap:** the LLD/DTO mark `consentId` required for all types, but the service never reads it — the `kyc` consent gate and `data_sharing_logs.consent_id` use the server-resolved active granted consent. The web KYC workbench has no way to obtain a consent id (the consent ledger GET is FR-110's domain and isn't wired here).
**Resolution applied:** `consentId` is OPTIONAL in the body (validated as a UUID when present); the server resolves the active consent authoritatively. Decouples the UI from a consent-id lookup with no behavioural change (TC-022 still holds — the resolved id equals the active one).
**Needed decision:** ratify optional `consentId` in FR-071.md/api-contract, or wire an FR-110 "active kyc consent" read the UI can call.

## FR-071-10. No GET for the KYC verification list (web workbench)
**Gap:** the LLD UI tree's `KycCheckList` "lists all kyc_verifications for this lead", but FR-071 contracts only `POST /leads/{id}/kyc/{type}` — there is no GET.
**Resolution applied:** the workbench renders the fixed KYC check types (PAN enabled; ckyc/digilocker/aadhaar/vcip disabled — Phase 1.5) and reflects each check's result from the run-mutation response; the consent gate surfaces reactively on `403 CONSENT_MISSING`. The persisted-list view awaits a contracted GET (read-model/FR-072 concern).
**Needed decision:** add `GET /leads/{id}/kyc` to the contract if a list view is required.

---

# AMBIGUITY — FR-072 (KYC Exception Handling)

*All resolved in-code with the narrowest spec-consistent choice; listed for Dev-1/contract write-back (CLAUDE.md §9). The first two are the LLD's own A-1/A-3; A-4/A-5 are schema↔LLD conflicts found in build.*

## FR-072-A5. `kyc_check_status` enum has no `resolved` value (schema wins)
**Gap:** the LLD §Response/state-machine, `FR-072-tests` T-01/T-02/T-10, and INV-01 all use `status = 'resolved'`, but `schema.sql:64` defines `kyc_check_status AS ENUM ('initiated','success','failed','exception','waived')` — there is no `resolved`. A literal `resolved` would be rejected by the DB enum (the FR-110 `CONSENT_CAPTURED` precedent: enum wins).
**Resolution applied:** resolving an exception maps to an existing enum value — **`waived`** for waiver-class codes (`waiver`, `name_variance_waiver`, `address_variance_waiver`), **`success`** for all other (verification-class) codes; `resolution_code` (VARCHAR(40)) records the specific code. The API response `status` reflects the enum value (`success`/`waived`), not a literal `resolved`.
**Needed decision:** amend FR-072.md/-tests/state-machines.md to the enum mapping, or add a `resolved` value to `kyc_check_status` (schema + enum + Flyway). The T-01/T-02/T-10 `status='resolved'` assertions must be updated.

## FR-072-A4. The `failed → exception` transition consumer is unbuilt (open-state seam)
**Gap:** FR-071 persists provider mismatch/down as `status='failed'` (+ `exception_type`), and its LLD says "FR-072 transitions to 'exception' via queue", but no FR defines that KYC_EXCEPTION→`exception` consumer (nor the `exception_sla_due_at` set). FR-072's resolve guard is `WHERE status='exception'` — so against the running system nothing would ever be resolvable.
**Resolution applied:** FR-072 treats the OPEN exception state as `status IN ('exception','failed') AND resolution_code IS NULL` (shared `deriveLeadKycStatus` agrees). T-10 (resolved) and T-11 (success) still → CONFLICT. This makes the endpoint functional against FR-071's actual output.
**Needed decision:** build the `failed→exception` consumer (with SlaEngine due-at) and assign its owner, or ratify that `failed` (with an `exception_type`, unresolved) IS the open-exception state and drop the separate `exception` status from the model.

## FR-072-A1. `kyc_manual_fallback_enabled` compliance flag has no schema home
**Gap (LLD A-1):** the flag gating `provider_down_manual` is not a column anywhere.
**Resolution applied:** read as a boolean key `kyc_manual_fallback_enabled` from `product_configs.sla_config` (JSONB) via the lead's `product_config_id` (the LLD's best-effort location); absent/false → FORBIDDEN. No column invented.
**Needed decision:** ratify `product_configs.sla_config.kyc_manual_fallback_enabled`, or define an org-level compliance config and point the read there.

## FR-072-A3. `resolution_code` allowed list is not a contract artefact
**Gap (LLD A-3):** the column is `VARCHAR(40)`, not an enum; the 9-value list is LLD best-effort.
**Resolution applied:** the list lives in `kyc.constants.ts ALLOWED_RESOLUTION_CODES` and is enforced by the Zod DTO.
**Needed decision:** ratify the list (and the waiver-subset) in `error-taxonomy.md` or a `@shared/enums` addition.

## FR-072-A6. No GET exception-queue; resolution integrated into the FR-071 workbench
The LLD UI tree shows an `ExceptionQueue` DataTable, but no GET endpoint exists (FR-071-10). **Resolution applied:** the `ExceptionResolutionModal` is wired into the existing `KycWorkbench` — a check row in the open-exception state exposes a "Resolve" action — so no list GET is needed. Notification side-effect (LLD step 8) is deferred (NotificationDispatchService not yet wired into M8).

---

# AMBIGUITY — FR-060 (Secure Customer Action Link)

*Resolved in-code with the narrowest spec-consistent choice; listed for Dev-1/contract write-back (CLAUDE.md §9). The LLD's AMB-1..4 are carried here with what was applied.*

## FR-060-1. `CUSTOMER_LINK_PORT` rebind moved to a @Global SelfServiceModule
The seam was provided+exported by `compliance.module` (`UnavailableCustomerLinkAdapter`). FR-060 owns the real adapter (M7), so the binding moved: the @Global `SelfServiceModule` now provides `{ CUSTOMER_LINK_PORT → CustomerLinkAdapter }`, and `compliance.module` no longer provides/exports it (its consumers resolve the global). `UnavailableCustomerLinkAdapter` is left in `ports/customer-link.port.ts` as the documented fallback. Verified: FR-070/FR-110 customer endpoints still green (1037 tests).

## FR-060-2. OTP gate on /documents & /consent returns 404, not 401 (port-based)
The LLD §Auth describes a guard returning `AUTH_REQUIRED` (401) when the OTP session is missing on the upload/consent endpoints. But those endpoints (built in FR-070/FR-110) resolve via `CustomerLinkPort` (binary `ResolvedCustomerLink | null`), not `CustomerLinkGuard`. **Resolution applied:** the adapter returns `null` (→ NOT_FOUND 404) for token-invalid/expired/no-OTP-session/wrong-purpose — uniformly hiding existence (arguably stronger than 401). The landing (`GET /c/{token}`) and `POST /c/{token}/otp` use the guard (no OTP gate, by design).
**Needed decision:** ratify 404-for-all on the port path, or enrich the port to signal "valid-but-unverified" so the controllers can return 401.

## FR-060-3. Purpose gating on /documents & /consent → 404 (not 403)
The LLD wants `FORBIDDEN` (403) when the action isn't in the link's `purpose`. The port adapter folds this into the same `null`→404 (binary contract). Ratify or enrich the port.

## FR-060-4. (LLD AMB-2) `CUSTOMER_LINK_*` event code absent → `DOC_REQUEST`
Applied per the LLD: link creation emits `DOC_REQUEST` (closest `event_code`). Add a `CUSTOMER_LINK_CREATED` value if a distinct event is wanted.

## FR-060-5. (LLD AMB-1) OTP resend endpoint not built
`POST /c/{token}/otp/resend` is not in the contract; deferred. The OTP is generated+dispatched at link create; a customer whose 10-min OTP TTL lapses currently needs a staff resend (new link). Add the resend endpoint if required.

## FR-060-6. (LLD AMB-4) `link_status='used'` left unset
Links remain `active` until expiry or staff revoke (resend revokes the prior). The auto-`used` transition (all purposes complete) is not implemented (LLD default). Ratify.

## FR-060-7. `lead_display.product_display_name` uses `product_code`
`product_configs` has no display-name column, so the customer landing shows `product_code` as the product name and a stage→label map for `status_label`. Add a display-name column/config if a friendlier product label is required.

## FR-060-8. `ResolvedCustomerLink.channel = 'api'` (resolves FR-110-2)
The adapter sets the consent `channel` to `CreationChannel.API` for customer self-service (the FR-110-2 open question on the channel source). Ratify, or carry the delivery channel (sms/whatsapp/email) through instead.

*Reused, not rebuilt (already shipped):* customer document upload (FR-070 `POST /c/{token}/documents` + VirusScanPort — LLD AMB-3 is moot), customer consent (FR-110 `POST /c/{token}/consent`), the `CustomerUploadPage`. FR-060 adds the token/OTP machinery + landing that make them reachable.

---

# AMBIGUITY — FR-061 (Customer Grievance & Service Request)

*Resolved in-code with the narrowest spec-consistent choice; for Dev-1/contract write-back (CLAUDE.md §9). The LLD's AMB-1..5 are carried with what was applied.*

## FR-061-A1. `audit_action` has no `grievance_create` value → `lead_create`
The audit appender writes `action = 'lead_create'` with `entity_type = 'grievance'` (LLD AMB-1's option a — the closest enum value). This pollutes lead-creation audit queries; add a `grievance_create` value to `audit_action` (schema + enum + Flyway) and switch, or ratify the mapping.

## FR-061-A2. Token resolution via the adapter (404), not a guard (409)
The LLD §Auth wants `CONFLICT` (409) for status≠active / expired / OTP-unverified and `NOT_FOUND` (404) only for unknown token. **Resolution applied:** grievance resolves via `CustomerLinkAdapter.resolveForGrievance` (purpose-gated, OTP-gated) → `null` → uniform `NOT_FOUND` (404) for ALL token problems — consistent with the FR-070/110 customer endpoints and FR-060-2/3 (existence hiding). Ratify, or enrich the port to distinguish 409.

## FR-061-A3. Grievance SLA due-at is wall-clock, not business-time
The global `SlaEngine.computeDueAt`/`setGrievanceDue` require `SLA_POLICY_READER_PORT`, which is bound only in EngagementModule's local scope (not visible to the @Global SlaEngine singleton) — calling them would throw `not bound` (pre-existing seam gap). **Resolution applied:** the service reads the active grievance `sla_policies.threshold_minutes` directly and sets `sla_due_at = now + threshold` (wall-clock). SLA is non-blocking here ("should"); the FR-104 sweep owns escalation. **Needed decision:** bind `SLA_POLICY_READER_PORT` globally (or in SlaModule) so business-time computation works, then switch grievance intake to `computeDueAt(GRIEVANCE, …)`.

## FR-061-A4. (LLD AMB-2) `created_by`/`updated_by` = SYSTEM_USER_ID
Customer-link writes have no JWT user; `grievances.created_by/updated_by` use the seeded `SYSTEM_USER_ID` (the FR-060/customer-write convention).

## FR-061-A5. (LLD AMB-3/4/5) attachment, owner, duplicate-link deferred
`attachmentNote` is free-text only (no binary — `grievances` has no `attachment_ref`); `owner_id` left null at intake (routing is FR-114); no duplicate-complaint linking (`grievances` has no `parent_grievance_id`). All per the LLD ambiguities; FR-061 is intake-only (`(none) → open`).

## FR-061-A6. `CodeGenerator` extended + exported
`CodeGenerator.nextGrievanceNo` (GRV-{YYYY}-{seq5}) was added (same advisory-lock + MAX()+1 pattern as `nextLeadCode`) and `CodeGenerator` is now exported from the @Global `CaptureModule` so M7 can inject it. `resolveForGrievance` was added to `CustomerLinkAdapter` (M7-internal; NOT on the cross-module `CustomerLinkPort`).

## FR-061-A7. Grievance-officer info block deferred (web)
The LLD's `GrievanceOfficerInfoBlock` reads `dla_registry.grievance_officer` from the FR-060 `GET /c/{token}` payload, but FR-060's landing doesn't expose `dla_registry` (no PII/registry data added there). The grievance form ships without the officer block (a generic "contact your RM" note); surfacing the officer requires adding `grievance_officer` to the FR-060 landing response.

---

# AMBIGUITY — FR-062 (Customer Status Tracking & Callback)

*Resolved in-code with the narrowest spec-consistent choice; for Dev-1/contract write-back (CLAUDE.md §9).*

## FR-062-A1. `tasks` has no owner service — FR-062 is the de-facto first writer
The yaml names "sole writer: TaskService / M11", but no `TaskService`/M11 task module exists yet (zero `tasks` writers in the codebase). **Resolution applied:** FR-062 inserts the callback `tasks` row via its own `StatusRepository` (no competing writer → no owner-writes conflict today). **Needed decision:** when M11/FR-100 lands, it should own `tasks` (a `TaskService.createCallbackTask` or a port seam) and FR-062 should delegate. Stage-9 ownership reconciliation item.

## FR-062-A2. Hot-flag side effect deferred (`LeadService.setHotFlag` is a stub)
`LeadService.setHotFlag` is a FR-031 stub that REJECTS (`notYetWired`). The LLD §2.4 wants the callback to set `leads.is_hot=true` (high-intent signal). **Resolution applied (per LLD Assumption 3):** the callback task is created; the hot-flag is SKIPPED (calling the stub would throw and roll back the task). Wire it when FR-031 implements `setHotFlag(leadId, isHot, reasons, tx)`.

## FR-062-A3. `UNASSIGNED_LEAD_OWNER_ID` env var absent → SYSTEM_USER_ID
`tasks.owner_id` is NOT NULL; the LLD assigns an unassigned lead's callback to `UNASSIGNED_LEAD_OWNER_ID`, which is not in the environment contract. **Resolution applied:** fall back to the seeded `SYSTEM_USER_ID` (a valid users FK) + warn log. Add the env var (and a real ops-queue user) if a dedicated unassigned owner is required.

## FR-062-A4. Token resolution via the adapter (404), not the LLD's 401/404 split
`GET /status` + `POST /callback` resolve via `CustomerLinkAdapter.resolveForStatus`/`resolveForCallback` (purpose + OTP-session gated) → `null` → uniform NOT_FOUND (404). The LLD's 401-for-OTP-missing is folded into 404 (existence hiding — consistent with FR-060/061/070/110). Ratify or enrich the port.

## FR-062-A5. Idempotency-Key optional (not strictly required)
The LLD marks `Idempotency-Key` required on the callback POST; FR-062 treats it as optional — when present, replays return the original `task_id` (Redis, 24h TTL); when absent, the request proceeds without dedupe. The `IDEMPOTENT_REPLAY` `meta.detail.reason` is not surfaced (no success-envelope channel). Ratify.

## FR-062-A6. No external GET-status caching / LOS status label
`los_status_label` is always `null` (LOS status surfacing is M9/FR-08x). The status view is a live read; no stage transition occurs.
