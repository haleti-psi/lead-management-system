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
