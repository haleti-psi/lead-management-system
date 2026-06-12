# LMS — Parallel Development Plan (Stage 7, Wave 2 onward)

*Created 2026-06-12. Authoritative team plan; assignment summary also in `docs/STAGE7-CONTINUATION.md` §9.
Everyone works from `master` on GitHub (`haleti-psi/lead-management-system`). Wave 1 (foundation, 13 FRs, 546 tests) is complete — all three developers start **now, in parallel**.*

---

## 1. Team, responsibilities & ownership

| | Dev 1 (integrator) | Dev 2 | Dev 3 |
|---|---|---|---|
| **Owns (modules)** | M1–M6: identity, capture, dedupe, allocation, product-config, workspace | M7, M8, M10: self-service, KYC/documents, partner — **plus the shared web UI foundation** | M9, M11–M15: LOS, engagement/comms, compliance, reporting (admin & integration done in Wave 1) |
| **Remaining FRs** | 11 | 9 (+ web foundation, + integration-test wave at the end) | 16 |
| **Extra responsibilities** | Merges **all** PRs · arbiter for any schema/contract change (BRD §14.6) · resolves `AMBIGUITY.md` items · owns `manifest.json` / migration numbering | Owns the shared component library every screen reuses (BRD §4.5) | Ships **FR-110 first** — the one FR others wait on |

Module/entity ownership = write ownership (§11 owner-writes): your module's service is the only writer of its tables; everyone else calls your service. Notably: only Dev 1's `LeadService` writes `leads`; `grievances` belongs to Dev 3 (M12) even though Dev 2's FR-061 captures them.

## 2. Start TODAY (all three in parallel)

| Dev | First task | First deliverable |
|---|---|---|
| **Dev 1** | **FR-010/011** — capture module, `LeadService` (sole `leads` writer), `StageGuardService`, stage-history | LeadService merged; Wave-1 port seams (SLA due-date writer, admin bulk-reassign) wired |
| **Dev 2** | **Web foundation** — `AppShell`, `DataTable`, `EntityForm`, `MaskedField`, `StatusChip`, view states, `apiClient`, login page against FR-001 API (per BRD §4.5 / `shared-utilities.md`) | Component library + working login merged; then straight into FR-070 |
| **Dev 3** | **FR-110** — purpose-wise consent ledger | Consent service merged → unblocks Dev 2's FR-061/062 and the consent gates in stage transitions & LOS hand-off |

## 3. Work queues (do in this order)

### Dev 1 — M2 → M3 → M4 → M6
| # | FR | Delivers |
|---|---|---|
| 1 | FR-010 | Omnichannel lead capture + `LeadService` + stage guards |
| 2 | FR-011 | Quality enrichment & score at capture *(known open item: business seed values — resolve via `AMBIGUITIES.md`, don't guess)* |
| 3 | FR-020 | Duplicate & near-duplicate detection *(same seed caveat)* |
| 4 | FR-021 | Merge & source-attribution preservation |
| 5 | FR-030 | Rules-based allocation |
| 6 | FR-031 | Hot-lead flag & lead score |
| 7–11 | FR-050…054 | Workspace read models: lists/queues, lead-360, board, dashboard, search — **last** (they read everyone's data) |

### Dev 2 — web foundation → M8 → M7 → M10
| # | FR | Delivers |
|---|---|---|
| 0 | Web foundation | Shared component library + login (see §2) |
| 1 | FR-070 | Document checklist & upload (GCS, signed URLs, virus-scan hook) |
| 2 | FR-071 | KYC verification orchestration (via `IntegrationGateway` + `KycPort` mock) |
| 3 | FR-072 | KYC exception handling |
| 4 | FR-060 | Secure customer action link (`/c/{token}` + OTP, `CustomerLinkGuard`) |
| 5 | FR-090 | Partner master & onboarding |
| 6 | FR-091 | Partner lead submission |
| 7 | FR-061 | Customer grievance intake — *after Dev 3's FR-110 & FR-114 (calls M12's `GrievanceService`; port seam if needed)* |
| 8 | FR-062 | Customer status tracking & callback |
| 9 | FR-092 | Partner quality score & dashboard — **after Dev 3's FR-120** (needs report metrics) |
| 10 | Integration-test wave | The deferred Testcontainers e2e tier (see §6) |

### Dev 3 — FR-110 → M11 → M12 → M9 → M13
| # | FR | Delivers |
|---|---|---|
| 1 | FR-110 | **Consent ledger — first, others wait on it** |
| 2–5 | FR-100…103 | Tasks · communication templates & audit · telephony/visit logging · notification preferences & opt-out |
| 6–10 | FR-111…115 | Data minimisation · data-principal rights · DLA/LSP registry · grievance workflow · retention/purge engine |
| 11–13 | FR-080…082 | LOS eligibility, hand-off, status mirror — all against `LosMockAdapter` (real adapter comes last, per ADR-4) |
| 14–16 | FR-120…122 | Core reports, differentiator reports, export governance — **last** (FR-123 already done) |

*Load-balancing rule: Dev 3's queue is longest. Whoever finishes their queue first takes M13 (FR-120–122) or the integration-test wave — Dev 1 decides at Checkpoint 3.*

## 4. Cross-dev dependency map (the ONLY waits)

| Waiting work | Waits for | Owner | Expected gap |
|---|---|---|---|
| Dev 2: FR-061/062 | FR-110 (+ FR-114 for grievance service) | Dev 3 | days — both early/mid in Dev 3's queue |
| Dev 2: FR-092 | FR-120 report metrics | Dev 3 | end of project — FR-092 is last in Dev 2's queue anyway |
| Wave-1 port seams go live | FR-010 `LeadService` | Dev 1 | days — it's Dev 1's first FR |

Everything else is fully parallel. If a queue stalls on one of these, pull the next FR forward rather than waiting.

## 5. Working agreement (how everyone works, every FR)

1. **Own clone, own Claude session.** Coordination via git + `docs/`, never by sharing chats or spec excerpts.
2. **One branch per FR** (`feature/FR-NNN`), rebased on `master` daily. Only Dev 1 merges; nobody pushes to `master`.
3. **Prompt template:** *"Read `docs/STAGE7-CONTINUATION.md` first. Implement FR-NNN per `docs/lld/FR-NNN.md` + `FR-NNN-tests.md`. Reuse the §3 foundation services — never re-implement. Check `docs/lld/CORRECTIONS.md`."*
4. **Definition of done (per FR):** all tests named in `FR-NNN-tests.md` implemented and green · `npm run build` + `npx tsc --noEmit` + `npm test -w @lms/api` clean · endpoints exactly per `api-contract.yaml` · no new env vars/libraries/error codes/enums outside the contracts · PR opened with FR number in the title.
5. **Contract changes:** a new field, enum value, error code, endpoint, shared component, or library = a **separate PR** touching `docs/` + `packages/shared` only, approved by Dev 1 and merged **before** the code that uses it (BRD §14.5). Schema changes additionally get their Flyway migration numbered by Dev 1 on `master` only.
6. **Ambiguity:** spec doesn't cover something → write `AMBIGUITY.md`, message Dev 1, stop that FR (switch to the next one). Resolution is written back into the LLD. Never silently decide.
7. **Daily 15-min sync:** blockers + contract-change requests only.

## 6. Checkpoints & milestone deliverables

*Indicative sequence, not calendar promises — agent-assisted velocity varies.*

| Checkpoint | Trigger | Expected deliverables on `master` | Joint action |
|---|---|---|---|
| **CP-1** | FR-010 + FR-110 merged | LeadService live, seams wired; consent ledger live; web foundation merged | 30-min review: lead lifecycle + consent gating sanity; after this there are no day-to-day waits |
| **CP-2** | M3 + M8 + M11 done | Dedupe/merge; document+KYC flow vs mocks; tasks/comms/notifications | Run `cross-fr-review` scope: lead lifecycle ↔ duplicate/merge ↔ outbox events (BRD §14.4 #2) |
| **CP-3** | M12 + M9 done | Full compliance suite; LOS hand-off vs `LosMockAdapter` | Verify consent gates on every transition + hand-off guards (§14.4 #3–4); Dev 1 reassigns spare capacity (M13 / test wave) |
| **CP-4** | M6 + M13 + M10 done | All 49 FRs merged | **Integration-test wave** (deferred Testcontainers e2e tier — Dev 2 leads); wire any remaining port seams |
| **Go-live gate** | tests green incl. e2e | — | Stage 8 residual reviews + **Stage 9 `cross-fr-review`** including the Wave-1 watchlist (master-resource overlaps, regions/branches capability, lead-attach endpoints — see `STAGE7-CONTINUATION.md` §6) + BRD §14.7 regression scenarios |

## 7. Standing references

| Question | Answer lives in |
|---|---|
| What do I build & how | `docs/lld/FR-NNN.md` + `-tests.md` |
| What exists that I must reuse | `docs/STAGE7-CONTINUATION.md` §3 + `docs/contracts/shared-utilities.md` |
| API shape / auth / errors / states | `docs/contracts/` (api-contract, auth-matrix, error-taxonomy, state-machines) |
| Tables & enums | `docs/data-model/schema.sql` + `@lms/shared` |
| The rules | `CONTRIBUTING.md` + `docs/STAGE7-CONTINUATION.md` §4 |
| Who decides | Dev 1 (arbiter) |
