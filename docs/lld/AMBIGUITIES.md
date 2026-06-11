# LLD Ambiguities — Stage 6 (distilled)
*Generated: 2026-06-09. These are genuine specification gaps the LLD agents found in the upstream contracts and **did not invent around** — each is also recorded in the relevant `FR-NNN.md` §Ambiguities. Resolve (write back into the BRD/data-model/contracts) BEFORE Stage 7 code generation; until then they are the only sanctioned `AMBIGUITY.md` triggers for coding agents.*

## Resolution status — v5.3 (2026-06-09)
**RESOLVED** (written back to schema/contracts; details in `CORRECTIONS.md`):
- **A1–A4** → `schema.sql` + BRD §5 (v5.3): `users.totp_secret_enc`, `grant_status 'pending'`, `event_code 'DUPLICATE_FLAGGED'`, `audit_action 'abac_deny'`. Re-validated by DB load.
- **B1–B4** → `api-contract.yaml`: `POST /leads/bulk-action`, `POST /admin/break-glass/{id}/revoke`, `POST /audit/unmask`, `GET /leads ?q`. YAML re-validated.
- **C1–C2** → `environment-contract.md` (C3 captcha var already present; `CaptchaService` added to shared-utilities).
- **E1–E3** → `CORRECTIONS.md` / FR notes. Plus signature pins (`AuditAppender.append`, `OutboxService.emit`) + `LeadService.bulkReassign`.

**DEFERRED** — documented, not blocking code-gen:
- **A5** vehicle/asset identifier columns → Phase 1.5 (MVP uses `gstin`+`product_code`+trigram).
- **A6** consent re-parent on merge → FK re-parent only (DATA_MODEL note).
- **B5** partner doc-upload → standard `POST /leads/{id}/documents`.

**OPEN** — business/legal sign-off before go-live (config/seed, not code structure):
- **D1–D4** scoring/duplicate seed values; **OD-06** consent-bootstrap legal basis; **OD-08/OD-17** vendor selection.

## A. Data-model (schema.sql) gaps — need a Flyway migration + BRD §5 amendment
| # | Gap | Found in | Suggested resolution |
|---|---|---|---|
| A1 | `users` has no `totp_secret` column for MFA enrolment | FR-001 | Add `totp_secret_enc VARCHAR(255)` (app-layer encrypted); add a `POST /auth/mfa/enroll` endpoint |
| A2 | `grant_status` enum has no `pending` value, but break-glass is a pending→active two-step flow | FR-003 | Add `pending` to `grant_status` (or confirm single-step creation; interim: `approver_id IS NOT NULL` ⇒ active) |
| A3 | `event_code` enum has no `DUPLICATE_FLAGGED`/`DUPLICATE_RESOLVED` | FR-020 | Add the values, or accept `LEAD_STAGE_CHANGED` as the proxy |
| A4 | `audit_action` enum lacks `password_reset_requested`, `abac_deny` | FR-001, FR-002 | Add values, or map under `user_change`/`lead_view` + `detail.sub_action`/`detail.denied=true` |
| A5 | No first-class vehicle/asset (engine/chassis) identifier columns for duplicate matching | FR-020 | MVP uses `gstin`+`product_code` proxy + trigram name; true VAHAN match is Phase 1.5 |
| A6 | `consent_records` is append-only, but merge must re-parent `lead_id` | FR-021 | Ratify in DATA_MODEL.md that merge re-parents the FK only (no `consent_state` mutation) |

## B. API-contract (api-contract.yaml) gaps — endpoints referenced but not defined
| # | Gap | Found in | Suggested resolution |
|---|---|---|---|
| B1 | No transactional **bulk-action** endpoint; FR-050 AC-4 bulk actions modelled as client fan-out over per-lead mutators | FR-050 | Add `POST /leads/bulk-action` (scoped, one audit per action) if a single-transaction bulk op is intended |
| B2 | `GET /leads` has no free-text `q` param (AC-1 search by name/mobile/lead_code/masked-PAN/partner/GSTIN/LOS-id) | FR-050 | Add `q` to `GET /leads`, or route this to FR-054 global search |
| B3 | Break-glass **revoke** endpoint absent (BRD AC-4 allows early revoke) | FR-003 | Add `POST /admin/break-glass/{id}/revoke` (service method exists internally) |
| B4 | Privileged **unmask** endpoint (`POST /audit/unmask`) used by `MaskedField` has no FR tag | FR-002 | Assign to FR-003/FR-123 and add to api-contract.yaml |
| B5 | Partner **document-upload** route (FR-091 AC-4) not in `/partners/leads`; doc upload owned by M8 | FR-091 | Confirm partner docs use standard `POST /leads/{id}/documents` once the lead exists, or add a dedicated route |

## C. Environment-contract gaps — config referenced but not listed
| # | Var | Found in | Default suggested |
|---|---|---|---|
| C1 | `BREAK_GLASS_MAX_WINDOW_HOURS` | FR-003 | 48 |
| C2 | `MERGE_UNMERGE_WINDOW_HOURS` | FR-021 | 24 |
| C3 | Captcha provider + `CAPTCHA_SECRET` and a `CaptchaService` (shared-utilities) | FR-010 | reCAPTCHA v3 (vendor per OD-08/OD-17) — register in dependency-register.md before build |

## D. Configuration / seed-data gaps — "configurable" without seed values (business sign-off)
| # | Gap | Found in | Owner |
|---|---|---|---|
| D1 | Lead **scoring factors + default weights + thresholds** (FR-011 best-effort: 13 factors incl. PAN-missing penalty, source-rejection penalty, partner quality, amount threshold) | FR-011 | Product — encode in a `ConfigurationVersion` seed (`config_type='scoring_rules'`) |
| D2 | `hot_amount_threshold` JSONB key location (LLD uses `product_configs.sla_config.hot_amount_threshold`) | FR-011, FR-031 | Confirm against M5 product-config LLD |
| D3 | Historically-high-rejection **penalised-source list** + rejection-rate threshold | FR-011 | Business — seed data |
| D4 | Duplicate-match **thresholds** currently hardcoded in `DuplicateService` (no `DuplicateConfig` table) | FR-020 | Decide config table vs constants |

## E. Cross-FR coordination notes (record in the named FR's LLD before build)
| # | Note | Source → Target |
|---|---|---|
| E1 | ADMIN role/permission writes (FR-130) must call `EntitlementCacheService.invalidateRole(roleId)` to clear the Redis ABAC cache | FR-002 → FR-130 |
| E2 | `KYC.edit_lead` is "KYC fields only" — the exact field subset must be enumerated (shared constant) | FR-002 → FR-070/072 |
| E3 | Unmerge restore: store `relinked_ids` (documents/consents/tasks) in `audit_logs.detail` at merge time; read at unmerge | FR-021 |

---

**Process:** Per the project's amendment governance (BRD §14.5), each resolved item should be written back into the BRD/data-model/contracts (with a version bump + amendment-log entry), then the affected FR LLD updated, before the corresponding FR is dispatched in Stage 7. None of these block LLD completion; they block *correct code generation* for the specific affected FRs.
