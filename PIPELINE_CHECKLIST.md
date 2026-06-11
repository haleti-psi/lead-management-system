# Lead Management System — AI Dev Pipeline Checklist

**Last updated:** 2026-06-11
**Current position:** Stages 1–6 complete · Gates A/B/C **signed off** · monorepo scaffolded → **Stage 7 — Code Generation (`/phase-executor`) is the next action**

> The machine source-of-truth for state is `manifest.json` (written by the gates).
> This file is your human-readable tracker — tick `- [ ]` → `- [x]` as you finish each step.
> Each step lists the prompt to paste and the artefact it produces.

---

## Pre-flight setup (one-time)

- [x] Hooks copied to `.claude/hooks/`
- [x] Canonical BRD chosen: **V5 → v5.1** (amended in `docs/brd.md` during Gate A; supersedes V4. Source file in `docs/requirements/` is still v5.0 — don't re-copy from it)
- [x] BRD placed at canonical path `docs/brd.md`
- [x] `git init` + first commit  (repo live on `master`; pipeline artefacts + scaffold committed)
- [x] Fix `python3` → `python` in the hook commands (Windows) — hooks invoke via the `py` launcher
- [x] *(optional)* Wire hooks into `.claude/settings.json` — all 5 wired; `check_gate.py` `src/` block lifted now Gate C is signed

---

## SPECIFICATION ZONE  (project-level, produced once)

### Stage 1 — BRD  → `docs/brd.md`
- [x] BRD authored (V5)
- [x] *(optional insert)* Stress-test the idea — `/adversarial-idea-evaluator`
- [x] **◈ Gate A** — `/quality-gate-checker A`  → **PASS 10/10** (v5.1) · unblocks Stage 2

### Stage 2 — Data Model  → `docs/data-model/`
- [x] Generate schema — `/brd-data-modeler`  → `docs/data-model/` (46 tables, live on PG18)
- [ ] *(optional insert)* QA test plan from BRD — `/test-case-generator`
- [x] **◈ Gate B** — `/quality-gate-checker B`  → **PASS 10/10** · unblocks Stage 3

### Stage 3 — Architecture  → `docs/architecture.md`
- [x] `/architecture-doc-generator`  (+ BusinessCalendar entity, ADR-6)

### Stage 4 — Guidelines  → `docs/guidelines/`
- [x] `/guidelines-generator`  (Coding · UI · Security · Performance)

### Stage 5 — Contracts  → `docs/contracts/`
- [x] `/contracts-generator`  (10 files)
- [x] **◈ Gate C** — `/quality-gate-checker C`  → **PASS 10/10** · unblocks Stage 6 (lifts the `check_gate.py` `src/` write-block)

---

## GENERATION ZONE  (per-FR, runs in parallel)

### Stage 6 — LLD + Test Specs per FR  → `docs/lld/FR-NNN.md` (+ `-tests.md`)
- [x] `/lld-generator`  → 49 FRs (98 files) + `AMBIGUITIES.md` / `CORRECTIONS.md`; v5.3 spec-hardening

### Stage 7 — Code Generation  → `apps/*/src`, `packages/shared/src`
- [x] Confirm `git init` done (see pre-flight) · monorepo scaffold committed (foundation for worktrees)
- [ ] `/phase-executor`   ← **next action**

---

## VERIFICATION ZONE

### Stage 8 — Individual FR Review  → `docs/reviews/`
- [ ] `/full-review`  (bundles UI · quality · security · infra · BRD-coverage · guardrails · sanity-check)

### Stage 9 — Cross-FR Integration Review  → `docs/reviews/cross-fr-integration-report.md`
- [ ] `/cross-fr-review`

### Deploy
- [ ] `/project-config-init`  (once — creates `project.config.yaml`)
- [ ] `/local-deployment`  (verify end-to-end locally)
- [ ] `/deploy-app`  (Cloud Run)

### Stage 10 — Production Feedback Loop  (ongoing, post-ship)
- [ ] Feed prod signals back into upstream artefacts, then re-run the affected stage
- [ ] Periodic maintenance — `/codebase-sweep` · `/simplify` · `/security-review`

---

## Optional inserts (run any time they help)

- [ ] `/adversarial-idea-evaluator` — before any "should we do X or Y" decision
- [ ] `/test-case-generator` — acceptance test plan from the BRD
- [ ] `/demo-readiness-evaluation` — before a client demo
- [ ] `/security-review` · `/ui-review` · `/quality-review` · `/infra-review` — targeted standalone reviews (otherwise covered by `/full-review`)

**Not used in this project:** `local-deployment-ta` (different project), `website-file-downloader` (unrelated utility).
