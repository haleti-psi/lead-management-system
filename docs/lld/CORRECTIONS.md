# LLD Corrections — Stage-6 foundation spot-review (2026-06-09)
*Binding corrections over the per-FR LLDs. Where an LLD's pseudocode conflicts with an item here, THIS wins — these align the LLDs to the now-updated contracts. Coding agents read this alongside each FR's LLD.*

## Systemic fixes already applied to the source-of-truth (all FRs inherit these)
- **schema.sql** (re-validated, `LOAD_EXIT=0`): added `grant_status` value `pending`; `event_code` value `DUPLICATE_FLAGGED`; `audit_action` value `abac_deny`; `users.totp_secret_enc VARCHAR(255)`.
- **contracts/shared-utilities.md** — pinned canonical signatures: `AuditAppender.append(entry, tx)` (**method is `append`, never `emit`**; `entry = { action (audit_action enum), entity_type, entity_id, actor_id, lead_id?, detail? }`); `OutboxService.emit(event, tx)` where **`event` is the object `{ event_code, aggregate_type, aggregate_id, payload }`**; added `LeadService.bulkReassign` and `CaptchaService`.
- **contracts/api-contract.yaml** — added `POST /leads/bulk-action`, `POST /admin/break-glass/{id}/revoke`, `POST /audit/unmask`, and `?q` free-text on `GET /leads` (YAML re-validated, 65 paths).
- **contracts/environment-contract.md** — added `BREAK_GLASS_MAX_WINDOW_HOURS` (48), `MERGE_UNMERGE_WINDOW_HOURS` (24).

## Per-FR residual corrections (apply during coding)
**FR-052 (pipeline board):**
- Request/DTO field names follow `api-contract StageChange`: **`to`** and **`expected_version`** (not `toStage`/`expectedVersion`).
- `owner_name` ← **`users.full_name`** (fixed in LLD; `users` has no `display_name`).
- SM (`T` team) scope = **`leads.owner_id IN (team member user_ids)`** per `EntitlementService`/FR-002 — not `leads.team_id = user.team_id`.
- Use `state-machines.md §Lead` as the authoritative transition table.

**FR-010 (capture):** the lead insert MUST route through **`LeadService.create/insertLead(tx, …)`** — the inline `tx.insertInto('leads')` is illustrative only (owner-writes rule).

**FR-130 (admin):** bulk reassignment MUST use **`LeadService.bulkReassign(leadIds, ownerId, reason, tx)`** (LIMIT-bounded, bumps `version`, one `audit_logs(reassign)` per lead) — not a direct `db.updateTable('leads')`. `/admin/roles` and `/admin/teams` are served by FR-131's generic `/admin/{masterResource}` (no separate contract paths).

**FR-140 (integration):** audit uses `AuditAppender.append` (fixed) with action **`config_change`** (fixed); entry uses `entity_type:'webhook_subscriptions'`, `entity_id`, `detail` (not `targetId`/`orgId`). Idempotent replay returns **HTTP 200 `{ data:<original>, meta:{ reason:'IDEMPOTENT_REPLAY' }, error:null }`** — not 200 with a non-null `CONFLICT` error.

**FR-071 (KYC):** audit action **`kyc_response`** (success/mismatch) / **`kyc_exception`** (provider_down) (fixed); entry uses `entity_type:'kyc_verifications'`, `entity_id`, `detail` (not `subject_type/subject_id/meta`). `OutboxService.emit` uses the object form (`{ event_code:'KYC_EXCEPTION', aggregate_type:'Lead', aggregate_id:leadId, payload }`).

**FR-081 (LOS hand-off):** `OutboxService.emit` uses the object form; `aggregate_type:'Lead'` (consistent casing).

## Audit-entry shape (applies to every FR)
`AuditAppender.append` entry fields are exactly: `action, entity_type, entity_id, actor_id, lead_id?, detail?`. Any LLD using `targetId`/`subject_type`/`subject_id`/`meta`/`orgId` inside an audit entry is superseded by this shape.
