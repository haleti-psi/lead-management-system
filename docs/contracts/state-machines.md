# State Machine Definitions
*One section per entity with a status enum (BRD §5.5 / §10). Transitions, who triggers, side effects. Invalid transitions return `CONFLICT` (409); guard failures return `VALIDATION_ERROR` + `detail.reason=STAGE_GUARD_FAILED`.*

## Lead — `lead_stage` (BRD §10) — the core machine
### States
`captured`, `consent_pending`, `assigned`, `first_contact_pending`, `contacted`, `qualified`, `documents_pending`, `kyc_in_progress`, `eligibility_requested`, `ready_for_handoff`, `handed_off` (terminal in LMS), `rejected` (terminal unless reopened), `dormant`.

### Valid transitions (From → To · trigger · who · side effects)
| From | To | Trigger | Who | Side effects (one transaction) |
|---|---|---|---|---|
| captured | assigned | allocation | system/BM/SM | owner set; first-contact SLA timer starts; `LEAD_ASSIGNED`; +stage_history+audit+outbox |
| assigned | contacted | contact logged | RM/BM | first-contact TAT recorded |
| contacted | qualified | intent/product-fit captured | RM/BM | product checklist starts |
| qualified | documents_pending | checklist generated | RM/BM | customer link may be sent (`DOC_REQUEST`) |
| documents_pending | kyc_in_progress | mandatory docs uploaded/waived | RM/KYC/BM | KYC queue created |
| kyc_in_progress | eligibility_requested | KYC sufficient + consent(eligibility/LOS) | RM/BM/KYC | eligibility call; `data_sharing_logs` |
| eligibility_requested | ready_for_handoff | eligibility received or bypass; docs/KYC ready | system/BM/KYC | handoff-ready flag; `HANDOFF_READY` |
| ready_for_handoff | handed_off | guards pass | BM/KYC/RM (delegated) | LOS hand-off; `los_application_id` stored; `LEAD_HANDED_OFF` |
| any active | rejected | rejection reason+sub-reason | RM/BM/SM | reopen window opens; notification |
| rejected | prior active | within reopen window + reason | BM/SM/RM | `reopened_count++` (prior stage from `stage_history`) |
| any active | dormant | nurture reason + next date | RM/BM/SM | nurture task created |
| dormant | assigned/contacted | follow-up due / reactivation | RM/BM/SM/system | SLA reset per rule |

**Guards (`ready_for_handoff → handed_off`):** consent present, duplicate clear/overridden, mandatory docs verified/waived, KYC sign-off, valid payload. Failure → `STAGE_GUARD_FAILED` (lists failing guards).

### Invalid transitions (→ 409 CONFLICT)
- `handed_off` → any (terminal; LOS owns the application; only read-only status updates).
- skip-ahead (e.g. `captured` → `handed_off`) — must pass intervening guards.
- `rejected` → active outside the reopen window.

### Compensating actions
- Every transition writes `stage_history` + `audit_logs` + `event_outbox` **in the same transaction** as the `leads` update; if any fails, the whole transaction rolls back (no partial state). Notification/escalation are post-commit (retryable, do not roll back the transition).
- Optimistic lock: mutators take `expectedVersion`; stale → `CONFLICT`.

### Derived summary fields (not independent machines)
`leads.consent_status` (pending/partial/captured/withdrawn), `kyc_status` (not_started/in_progress/verified/exception/waived), `duplicate_status` (none/flagged/linked/merged) are **derived** from child records — recomputed on the relevant child change, never set directly.

## Document — `doc_status`
States: `not_required → pending → uploaded → under_review → (verified | mismatch | waived)`; any → `expired` (validity job).
| From | To | Trigger | Who | Side effects |
|---|---|---|---|---|
| pending | uploaded | upload (RM/customer/partner) | RM/KYC/CUSTOMER/PARTNER | virus scan; `DOC_UPLOADED` |
| uploaded | under_review | scan clean | system | enters KYC queue |
| under_review | verified | verify | KYC/BM | contributes to KYC readiness |
| under_review | mismatch | verify fail | KYC/BM | `DOC_MISMATCH`; re-upload request |
| any | waived | authorised waiver + reason | KYC/BM | audit |
| any | expired | validity passed | system | flagged |
Invalid: `verified → pending` (re-upload creates a new version, not a revert). Compensating: infected scan → reject (`VALIDATION_ERROR`), not stored.

## KYCVerification — `kyc_check_status`
States: `initiated → (success | failed → exception → resolved | waived)`.
| From | To | Trigger | Who | Side effects |
|---|---|---|---|---|
| initiated | success | provider OK | system | updates lead kyc_status |
| initiated | failed | provider fail/mismatch | system | creates exception (`exception_type`) |
| failed | exception | queued | system | `KYC_EXCEPTION`; SLA timer |
| exception | resolved | resolution + evidence | KYC/BM | unblocks hand-off |
| any | waived | authorised waiver | KYC/BM | audit |
Invalid: hand-off while an exception is open → `KYC_EXCEPTION_OPEN` (409). Provider downtime fallback only if compliance-enabled.

## ConsentRecord — `consent_state` (append-only)
States: `granted`, `denied`, `withdrawn`, `expired`, `superseded`. **No row is updated** — a new append-only row records the change; the prior row is referenced via `superseded_by`.
| Event | Effect |
|---|---|
| grant | new `granted` row; may unblock a stage gate |
| withdraw | new `withdrawn` row (affects only that purpose); `CONSENT_WITHDRAWN`; blocks dependent stages |
| expire | new `expired` row (system) |
| supersede | new row + `superseded_by` link |
Invalid: any UPDATE/DELETE (DB REVOKE). Withdrawing `los_handoff` before hand-off fails the hand-off guard.

## Grievance — `grievance_status`
`open → in_progress → (escalated) → resolved → closed`. Triggers: intake (any source) → owner assigned + SLA; resolve needs response; close needs closure proof; no/late response → escalation prompts. Invalid: `closed → open` (reopen creates a linked grievance). Side effects: `GRIEVANCE_CREATED`, escalation notifications.

## ConfigurationVersion — `config_change_status` (maker-checker)
`pending → (approved → active | rejected)`; `active → rolled_back`. Trigger: maker submits → checker approves/rejects (checker ≠ maker for high-impact); activate switches live config; rollback re-activates `rollback_ref`. Side effects: `CONFIG_CHANGED`. Invalid: self-approval → `FORBIDDEN`.

## IntegrationLog — `integration_status`
`pending → (success | failed → retrying → success/failed)`. System-managed by IntegrationGateway; idempotency_key dedupes; circuit-breaker on repeated failure. Feeds the integration monitor + handoff-failure report.

## Task — `task_status`
`open → in_progress → done`; `open/in_progress → cancelled`; `open → overdue` (sweep) → escalation. Side effects: overdue notifications; nurture task sets `leads.nurture_next_at`.

## Compact machines (status-bearing entities with simpler lifecycles)
| Entity | Enum | States / flow | Notes |
|---|---|---|---|
| User | `user_status` | active ↔ inactive; → locked (lockout) → active (unlock) | deactivate-with-open-leads needs reassignment |
| BreakGlassGrant | `grant_status` | active → expired (auto) / revoked | four-eyes; every use audited |
| DuplicateMatch | `dup_record_status` | open → resolved | action: blocked/warned/queued/linked/merged/overridden |
| CustomerLink | `link_status` | active → used / expired / revoked | OTP step-up; resend issues new token |
| DataRightsRequest | `rights_status` | open → in_review → (fulfilled | rejected_retained) | erasure vs legal hold → `LEGAL_HOLD` |
| Partner | `partner_status` | active → suspended / expired | suspended/expired blocks submission |
| ProductConfig / CommunicationTemplate / DLARegistry | `config_status` | draft → active → retired | versioned; retire doesn't affect in-flight leads |
| EligibilitySnapshot | `eligibility_status` | pending → received / failed | read-only LOS response |
| ExportJob / ImportJob | `job_status` | queued → running → completed / failed (Export also `awaiting_approval`) | export approval threshold (FR-122) |
| EventOutbox | `outbox_status` | pending → published / failed | transactional outbox; at-least-once relay |
| LOSApplicationMirror | (LOS string, read-only) | mirror of LOS status; keep latest by `status_date` | never edited by LMS |
| CommunicationLog | `delivery_status` | queued → sent → delivered / failed | retry/failover on failure; records provider_ref + reason |
| Document (scan) | `scan_status` | pending → clean / infected | infected → rejected, not stored; gates `under_review` |
| LeadProductDetail | `validation_status` | incomplete → valid / invalid | validated against active ProductConfig.field_schema |
| SourceAttribution | `attribution_status` | original → reassigned / merged_into | set on merge (FR-021); history preserved |
