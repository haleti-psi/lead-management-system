---
name: codebase-sweep
description: Periodic cleanup of a codebase to remove junk, dead code, abandoned experiments, and stale artifacts that accumulate during AI-assisted development. Use this skill whenever the user asks to "clean up the codebase", "sweep the repo", "remove junk files", "find dead code", "declutter the project", "run a cleanup pass", "remove unused files", "tidy up", "prune the repo", "audit the project for unused code", or mentions that Claude Code has left behind intermediate/scratch files. Also trigger after a long development session, before a release, or when the user says the repo feels bloated, noisy, or hard to navigate. The skill produces a prioritized, human-reviewable cleanup report and — only with explicit approval — removes files on a dedicated branch with tests passing at every step.
---

# Codebase Sweep

A disciplined, conservative cleanup pass for codebases that have accumulated cruft — especially repos that have seen heavy AI-assisted development, where many intermediate files, abandoned experiments, and stale planning docs typically pile up.

## Core philosophy

**Removing the wrong file costs more than leaving the right one.** This skill defaults to *surfacing* candidates, not deleting them. Human review is the final gate on anything below HIGH confidence. Git history is our safety net — anything committed can be recovered — but we still treat deletions as irreversible in practice because nobody goes digging through git reflog to recover work.

**Junk isn't just wasted disk space — it's wasted context.** Every stale file is one more thing for humans and AI agents to sift through when searching, reading, or reasoning about the code. A clean repo is faster to onboard to, faster to navigate, and produces better AI output because tools like grep and embeddings return less noise.

**A "different perspective" on what's actually safe to remove.** AI-assisted development creates patterns traditional linters miss:
- Multiple near-identical files where the LLM re-solved the same problem (`auth.py`, `auth_v2.py`, `auth_fixed.py`)
- Planning/scratchpad docs at the repo root that were one-shot context for a task
- Dead branches of code the LLM wrote and then abandoned mid-refactor
- "Almost-orphaned" utilities — functions imported by exactly one caller that itself is dead
- Experimental notebooks, SQL files, curl scripts left over from debugging sessions
- Duplicate README variants (`README.md`, `NOTES.md`, `PLAN.md`, `ARCHITECTURE.md` that all overlap)

## When to invoke

Trigger this skill when:

- The user explicitly asks for a cleanup, sweep, prune, audit, declutter, or tidy-up.
- A feature has just shipped and the user wants to clean up the implementation phase's leftovers.
- The repo has grown beyond what the user can mentally model.
- Before cutting a release or opening the repo to new contributors.
- Periodic maintenance cadence (e.g., end of sprint, monthly).

**Do NOT invoke** for: one-off deletion of a specific named file (just use `rm`), restructuring/renaming (that's a refactor, not a sweep), or inside a directory the user hasn't explicitly scoped the sweep to.

## Procedure

Follow these phases in order. Do not skip phases. Produce a report at the end of Phase 4; never delete in Phases 1–4.

### Phase 0 — Establish a safety net

Before touching anything:

1. Confirm you're in a git repo: `git rev-parse --is-inside-work-tree`.
2. Confirm the working tree is clean: `git status --porcelain`. If not, stop and ask the user to commit or stash.
3. Create a dedicated branch: `git checkout -b chore/codebase-sweep-YYYY-MM-DD`.
4. Identify how to run the test suite (look at `package.json` scripts, `Makefile`, `pyproject.toml`, `.github/workflows/*.yml`, README). Confirm tests pass *before* any changes. If tests are broken before you start, stop and report — do not sweep a broken codebase.
5. Note the project's language, framework, package manager, and any frameworks with runtime-dynamic loading (Django, Rails, Next.js, Spring, etc.) — these affect what "unused" means.
6. Read `.gitignore`, `.dockerignore`, and similar files. Anything already ignored is out of scope.

### Phase 1 — Inventory the repo

Build a map of the codebase without making judgments yet:

1. List all tracked files: `git ls-files`.
2. List all untracked files not covered by `.gitignore`: `git status --porcelain --untracked-files=all`.
3. For each tracked file, capture last-modified commit date: `git log -1 --format=%cI -- <file>` (batch this — don't run it per-file on huge repos; use `git log --name-only --format='%H %cI'` and post-process).
4. Identify entry points: `main.*`, `index.*`, `app.*`, CLI scripts declared in `package.json`/`pyproject.toml`, framework route files, CI workflow files.
5. Identify config files, migrations, fixtures, and public-API surfaces (exported symbols in library packages).

### Phase 2 — Generate candidate removals, categorized

Bucket each candidate into one of three **confidence tiers**. The tier determines how the candidate is handled in Phase 5.

#### Tier HIGH — safe to remove, auto-approve on user's one-word consent

Candidates in this tier match strict, unambiguous patterns:

- **Build/cache artifacts not gitignored (mistake):** `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`, `.tox/`, `node_modules/` inside tracked paths, `dist/`, `build/`, `.next/`, `.turbo/`, `*.egg-info/`, `coverage/`, `.nyc_output/`, `.DS_Store`, `Thumbs.db`.
- **Editor/IDE scratch:** `.vscode/settings.json.bak`, `*.swp`, `*.swo`, `*~`, `.idea/workspace.xml` (not `.idea/` wholesale).
- **Obvious backup files:** `*.bak`, `*.orig`, `*.rej`, files ending in `.backup`, `.old`, `.copy`.
- **Explicit scratch naming:** `scratch.*`, `temp.*`, `tmp.*`, `untitled*`, `new_file*`, `test123.*`, `asdf.*`, `foo.py` / `bar.py` at root if not referenced anywhere.
- **Zero-byte files** with no purpose (not `__init__.py`, not `.gitkeep`, not `py.typed`, not `.nojekyll`).
- **Duplicate versioned files** where the "canonical" file exists: `auth_v2.py` when `auth.py` also exists and `auth_v2.py` is imported nowhere.

#### Tier MEDIUM — present to user, require explicit per-item approval

- **Unreferenced top-level docs:** `PLAN.md`, `NOTES.md`, `TODO.md`, `IDEAS.md`, `SCRATCH.md`, `CONVERSATION.md`, `claude_*.md`, plan documents that appear to be one-shot artifacts. Propose moving to `docs/archive/` rather than deletion by default.
- **Unreferenced scripts:** `.sh`, `.py`, `.js` files outside recognized directories with names like `debug_*`, `test_quick*`, `try_*`, `experiment_*`, `sandbox_*`.
- **Dead modules:** Files where no import, require, string reference, or dynamic loader reference exists anywhere in the tree *and* which aren't listed as entry points in any config file *and* aren't in a plugins/hooks directory.
- **Dead functions/classes/exports:** Symbols with zero references in the codebase. For library packages, only flag if also not in the public API (`__all__`, `index.ts` exports, package `main` field).
- **Commented-out code blocks** older than ~90 days (check with `git blame`).
- **TODOs/FIXMEs** older than a user-configurable threshold (default: 180 days).
- **Duplicate README-like docs:** Multiple overlapping top-level markdown files. Surface them together for the user to reconcile.
- **Old migration-like files** the user's framework doesn't actually need preserved (rare — default to keeping migrations).

#### Tier LOW — report only, never auto-remove

- **Framework-dynamic code:** Anything under `migrations/`, `routes/`, `pages/`, `app/`, `controllers/`, `views/`, `middleware/`, `plugins/`, `hooks/`, `fixtures/`, `seeds/`, `locales/`, `public/`, `static/`, `assets/`, `templates/`.
- **Runtime-loaded code:** Files referenced only via `importlib`, `require(path)`, `__import__`, `eval`, config-file string references, decorator-based registration.
- **Tests for removed code:** Surface but let the user decide; sometimes tests document intent.
- **Anything unclear.** When in doubt, this is the tier.

### Phase 3 — Cross-check every candidate

For each MEDIUM or HIGH candidate, run these checks. Demote to LOW or drop the candidate if any check finds a reference:

1. **String search across all tracked files** for the filename (without extension) and for each exported symbol. Use `git grep -F`. Include config files, YAML, JSON, env files, shell scripts, Dockerfiles, CI YAML.
2. **Entry-point check:** not listed in `package.json` `bin`/`scripts`/`main`/`exports`, `pyproject.toml` `[project.scripts]`, `setup.py` entry points, `Procfile`, `Dockerfile` `CMD`/`ENTRYPOINT`.
3. **Git recency:** touched in the last 30 days → demote one tier. Someone may still be working on it.
4. **Test reference:** referenced in any test file → demote one tier.
5. **External doc reference:** referenced in `README.md`, `CHANGELOG.md`, `docs/` → demote one tier.
6. **Plugin/hook location:** lives in a conventional dynamic-loading directory → force to LOW.

### Phase 4 — Produce the cleanup report

Write a report to `docs/cleanup-YYYY-MM-DD.md` (create `docs/` if absent) AND print a summary to the user. The report must contain:

- **Summary table:** counts per tier, total candidate bytes, total candidate file count.
- **HIGH section:** bulleted list of files with reason codes. Example: `scratch_test.py — matches scratch naming pattern, zero references, last touched 94 days ago`.
- **MEDIUM section:** each candidate with *why* it's medium (which check demoted it), proposed action (delete vs. archive vs. inline into canonical file), and a one-line reversal command.
- **LOW section:** surfaced as information only, with a note that no action will be taken.
- **Not-touched section:** explicit list of files that matched a junk pattern but were *preserved* due to a cross-check hit — this is the paper trail that proves the sweep wasn't reckless.
- **Next steps:** concrete commands the user can run, or can ask the skill to run.

Present the report in chat. Stop and wait for user approval before Phase 5.

### Phase 5 — Execute with test gating

Only after the user approves a tier or a specific list:

1. Remove files in **small batches** (≤ 10 per batch) grouped by area (all test scratch, all docs, all dead modules, etc.).
2. After each batch: run the test suite, run the linter/type-checker, run `git status` to confirm clean state.
3. If any check fails, **revert the batch** (`git checkout -- .` or `git reset --hard HEAD`) and report which batch failed. Do not power through.
4. Commit each successful batch separately with a descriptive message: `chore(sweep): remove <N> scratch files — <category>`.
5. At the end: push the branch, do not merge. The user reviews the branch diff and merges manually.

## Absolute do-not-touch list

Never remove, regardless of what any check says:

- `LICENSE`, `LICENSE.*`, `COPYING`, `NOTICE`, `AUTHORS`, `CONTRIBUTORS`
- `README.md` at the root (may consolidate others INTO it, but never delete the root)
- `CHANGELOG.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`
- `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc`, `.python-version`, `.tool-versions`
- Lockfiles: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `poetry.lock`, `uv.lock`, `Gemfile.lock`, `Cargo.lock`, `go.sum`
- Manifests: `package.json`, `pyproject.toml`, `setup.py`, `setup.cfg`, `Cargo.toml`, `go.mod`, `Gemfile`, `pom.xml`, `build.gradle`
- CI/CD: `.github/`, `.gitlab-ci.yml`, `.circleci/`, `azure-pipelines.yml`, `Jenkinsfile`, `.pre-commit-config.yaml`
- Container/deploy: `Dockerfile`, `docker-compose*.yml`, `Procfile`, `fly.toml`, `vercel.json`, `netlify.toml`, `railway.toml`, `.dockerignore`
- Envs and examples: `.env.example`, `.env.sample`, `.env.template` (never `.env` — but never delete it either; surface for user review)
- Migrations — always LOW, default keep
- Test fixtures unless the test file they support is also being removed
- `.gitkeep`, `.nojekyll`, `py.typed`, `__init__.py` — these are load-bearing despite being small/empty
- Anything under a path the user hasn't explicitly included in scope

## Safety guardrails (enforced every run)

1. **Branch required.** Never sweep on `main`, `master`, `develop`, `trunk`, or any branch matching the repo's default branch. Create `chore/codebase-sweep-YYYY-MM-DD` first.
2. **Clean tree required.** Refuse to start if `git status` shows uncommitted changes.
3. **Tests must pass before starting.** Sweeping a broken codebase masks which change broke things.
4. **Dry-run is the default.** The skill produces the report in Phase 4 and stops. No deletions happen without explicit user consent.
5. **Confidence tiers gate behavior.** HIGH: one-shot consent covers the whole tier. MEDIUM: item-by-item consent. LOW: never auto-remove.
6. **Batch size cap:** ≤ 10 deletions per commit. Makes bisecting easy if a regression shows up later.
7. **Test-gate every batch.** If tests fail, revert that batch, do not continue.
8. **Never delete across scope boundaries.** If the user said "clean up `src/legacy/`", do not touch anything outside that path even if it looks like junk.
9. **Log everything.** The report is the audit trail — keep it in `docs/cleanup-YYYY-MM-DD.md`.
10. **Push, don't merge.** The sweep ends at a pushed branch. The user reviews and merges.

## What the final output looks like

Your last chat message after a sweep should be roughly:

```
Sweep complete on branch chore/codebase-sweep-2026-04-23.

Removed: 47 files (2.3 MB) across 6 commits. Tests green after each commit.
Preserved despite matching patterns: 12 files (see report section "Not-touched").

Report: docs/cleanup-2026-04-23.md
Branch pushed. Please review the diff and merge when happy.

Summary of what was removed:
- 18 Python cache / build artifacts
- 9 backup files (*.bak, *.orig)
- 6 scratch/debug scripts at repo root
- 8 one-shot planning docs (moved to docs/archive/)
- 4 duplicate versioned files (auth_v2.py, auth_old.py, etc.)
- 2 unreferenced modules (with zero git-grep hits and 180+ day age)
```

## Quick reference — file patterns worth a second look

Presented not as rules but as "these are the shapes AI-assisted dev tends to leave behind":

- Filenames with version suffixes that aren't git tags: `_v2`, `_old`, `_new`, `_final`, `_FINAL`, `_FINAL2`, `_fixed`, `_working`, `_copy`, `_backup`, `(1)`, `(2)`
- Date-stamped files outside `logs/` or `reports/`: `something_2025_01_15.py`
- Files named after LLMs or agents: `claude_*.md`, `gpt_*.md`, `chatgpt_*.py`, `ai_notes.md`
- One-off executables: `run_once.sh`, `fix_db.py`, `migrate_once.py` past their usefulness
- Ever-growing `utils.py`, `helpers.py`, `common.py` files with many unused exports
- Overlapping top-level markdown: multiple of `PLAN.md`, `ROADMAP.md`, `TODO.md`, `NOTES.md`, `SCRATCH.md`, `IDEAS.md`, `ARCHITECTURE.md`, `DESIGN.md` where content overlaps

Treat these as *signals to investigate*, not as auto-deletes. Run them through Phase 3 checks like anything else.

## A note on scope creep

This skill is for *removal*, not refactoring. If you notice:

- Code that should be renamed
- Functions that should be extracted
- Modules that should be split
- Typing that should be added

**Surface these in the report as "refactor suggestions" but do not perform them.** A sweep that also refactors is a sweep that can't be trusted to have only removed junk. Keep the diff boringly deletion-only so the reviewer's job is easy.
