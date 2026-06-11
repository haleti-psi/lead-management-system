# Contributing

This project is built with a **specification-first, pipeline-driven** process. Decisions are
made *before* code is written and frozen into artefacts under `docs/`. Code (Stage 7+) must
conform to those artefacts — it does not re-decide them.

## How the build is organised

The pipeline runs in stages, gated by quality checks (state in `manifest.json`):

```
1 BRD → ◈Gate A → 2 Data Model → ◈Gate B → 3 Architecture → 4 Guidelines
      → 5 Contracts → ◈Gate C → 6 LLD per FR → 7 Code → 8 Review → 9 Cross-FR Review
```

Do not skip stages. If an artefact you need doesn't exist, the stage that produces it isn't
done — stop and say so rather than inventing its contents. Human-readable tracker:
`PIPELINE_CHECKLIST.md`; machine source of truth: `manifest.json`.

## Where decisions live (don't re-decide these in code)

| Topic | Artefact |
| --- | --- |
| Tables / columns / enums | `docs/data-model/schema.sql` |
| API endpoint shapes | `docs/contracts/api-contract.yaml` |
| Who can do what | `docs/contracts/auth-matrix.json` |
| Permitted error codes | `docs/contracts/error-taxonomy.md` |
| State transitions | `docs/contracts/state-machines.md` |
| Approved libraries | `docs/contracts/dependency-register.md` |
| Environment variables | `docs/contracts/environment-contract.md` |
| Shared services/components | `docs/contracts/shared-utilities.md` |
| Folder structure / ADRs | `docs/architecture.md` |
| Per-FR implementation + tests | `docs/lld/FR-NNN.md` (+ `-tests.md`) |
| Binding LLD corrections / open gaps | `docs/lld/CORRECTIONS.md` · `docs/lld/AMBIGUITIES.md` |

## Non-negotiable rules (every line of code)

**Security**
- Every endpoint is either `@Public()` (and listed in `auth-matrix.json`) or protected by
  `JwtAuthGuard` + `AbacGuard` + `@Requires(...)`.
- Parameterised queries (Kysely) only — never string-interpolate SQL.
- Secrets only via env / Secret Manager — never hardcoded. Never log PII, tokens, or passwords.
- Never expose stack traces, internal IDs, or paths in API responses.

**Data integrity**
- Multi-entity writes use `UnitOfWork` transactions — no partial state on failure.
- **Owner-writes:** only the owning module's service writes its entity (only `LeadService`
  writes `leads`, via mutators with `expectedVersion`).
- Every list query has a `LIMIT` (≤100). Respect FK constraints; no orphans.

**Code quality**
- No `any` / `as any`. No swallowed errors (`catch {}`). No `console.log` in server code
  (use the structured logger). No hardcoded localhost in production paths.
- Only libraries in the dependency register; only env vars in the environment contract;
  only error codes in the taxonomy.

## Ambiguity

If a spec genuinely doesn't cover something, **name it precisely and surface it** — write it to
`AMBIGUITY.md` in your worktree (coding agents) or raise it with a human. Do not resolve it
silently. Resolved ambiguities are written back into the relevant artefact.

## Conventions

- **Commits:** small and focused; message explains the *why*. Pipeline/spec changes bump the
  artefact version and add an amendment-log row (e.g. BRD §"Amendments log").
- **Hooks** (`.claude/hooks/`, wired in `.claude/settings.json`) run on edits: `check_gate`
  (blocks repo-root `src/` writes until Gate C), `validate_sql`, `capture_ambiguities`,
  `run_tests_if_changed`, `lint_changed`. Don't bypass them; fix the underlying issue.
- **Migrations** are owned by Flyway (`docs/data-model/migrations/`); the app never auto-migrates.

## Local setup

See `README.md` → *Quick start*. Build `@lms/shared` before the apps.
