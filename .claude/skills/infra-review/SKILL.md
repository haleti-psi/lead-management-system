---
name: infra-review
description: End-to-end architecture and infrastructure review covering system boundaries, performance, reliability, observability, Dockerfiles, CI/CD pipelines, environment configuration, and deployment readiness. Produces a prioritized improvement plan with a readiness verdict.
argument-hint: "[target] [phase]"
---

# Architecture & Infrastructure Review

Perform an end-to-end architecture and infrastructure review and produce a prioritized, actionable improvement plan with a readiness verdict.

## Scoping

If the user specifies a target (example: `/infra-review apps/api`), review only that app or package. Otherwise review the full codebase.

If the user specifies a phase (example: `/infra-review docker only`), run only that section.
Valid phase keywords: `preflight`, `map`, `boundaries`, `performance`, `reliability`, `observability`, `docker`, `ci`, `deploy`, `scalability`, `gates`, `bugs`, `backlog`, `quickwins`.

If target includes `/`, generate a safe output slug: replace `/` with `-`, remove spaces.

## Operating Rules

- Evidence-first: cite exact files and line numbers.
- Separate `confirmed` evidence from `inferred` conclusions.
- Never claim a check passed unless you ran or inspected it.
- If evidence is missing, state the gap and how to obtain it.
- Every recommendation must include: `what`, `where`, `how`, and `verify`.
- Prefer small, reversible fixes; propose phased migration for larger refactors.
- Recommend one default path when options exist; give short rationale.
- Prioritize: Build-breaking -> Data loss -> Reliability -> Security -> Performance -> Maintainability.
- Save final report to `docs/reviews/infra-review-{targetSlug}-{YYYY-MM-DD}.md`.

## Quality Bar (Definition of Done)

The review is complete only when all are present:

- System map with component diagram.
- Findings for all requested categories with evidence.
- Every finding has severity, confidence, and verification steps.
- QA gate scorecard with `PASS` / `PARTIAL` / `FAIL`.
- Readiness verdict (`READY` / `CONDITIONAL` / `NOT-READY`) with blocking issues listed.
- Prioritized improvement backlog and quick-win plan.

## Severity, Confidence, and Risk

Use these fields for every finding:

- `Severity`: `P0` (urgent — system failure risk), `P1` (high — fix this sprint), `P2` (medium — next sprint), `P3` (low — hardening/optimization)
- `Confidence`: `High` (direct evidence), `Medium` (strong inference), `Low` (hypothesis)
- `Status`: `Confirmed`, `Partially Confirmed`, `Unverified`

Risk scoring:

`Risk Score = Impact (1-5) x Likelihood (1-5)`

---

## Phase 0: Preflight

Before deep analysis, capture:

- Scope, assumptions, and explicit exclusions.
- Current commit hash and branch.
- Tech stack discovery: languages, frameworks, databases, queues, caches, cloud provider.
- Available build/deploy/test scripts.
- Environment constraints (Docker daemon, cloud access, CI runners).
- Deployment target: cloud provider, orchestrator, serverless, bare metal.

Output a preflight block so readers understand confidence boundaries.

## Phase 1: System Map

Scan and document:

- Runtime components: apps, services, workers, cron jobs.
- Tech stack per component (framework, runtime version, database, cache, queue).
- Module dependency graph (which app depends on which package/service).
- Data flow: representative request lifecycle through the system.
- External integrations: third-party APIs, SaaS services, cloud services.
- Deployment model: containers, serverless, VMs, hybrid.
- Secrets/config strategy: env vars, config files, secrets manager.

Include a Mermaid diagram showing component relationships and data flow.

## Phase 2: Architecture Boundaries and Organization

### A) Module Boundaries

- Workspace/package boundaries are respected (no illegal cross-imports).
- Shared packages have clean, intentional API surfaces.
- No circular dependencies between modules.
- Domain logic is separated from infrastructure (ports/adapters, clean architecture, etc.).

### B) Code Organization

- Consistent file and directory structure across modules.
- Clear separation of concerns: routes, handlers, services, data access, types.
- Configuration centralized (not scattered across files).
- Environment-specific code isolated (not interleaved with business logic).

### C) Dependency Management

- Workspace dependencies correctly declared.
- Build order respects dependency graph (shared packages build first).
- No phantom dependencies (using a package without declaring it).
- Dependency versions consistent across the monorepo (no conflicting versions).

### D) API Surface Discipline

- Shared packages export only what's needed (no `export *` leaking internals).
- Internal implementation details are not importable from outside the module.
- Type exports match runtime exports (no orphaned type-only exports).

## Phase 3: Performance and Scalability

### A) Database Performance

- Indexes exist for frequently queried columns, foreign keys, and search fields.
- No N+1 query patterns in list endpoints.
- Query complexity is bounded (no unbounded joins, missing LIMIT).
- Connection pooling configured with appropriate limits.
- Slow-query identification: any query patterns likely to degrade at scale.

### B) API Performance

- Pagination on all list endpoints (no unbounded result sets).
- Response payload sizes are reasonable (no over-fetching).
- Expensive operations are async (long-running tasks, file processing, AI/ML inference).
- Caching strategy for read-heavy endpoints (in-memory, Redis, HTTP cache headers).
- Rate limiting configured for public-facing endpoints.

### C) Frontend Performance

- Route-level code splitting and lazy loading.
- Bundle sizes within budget (flag bundles >250KB gzipped).
- Tree-shaking effective (no barrel exports defeating tree-shaking).
- Image optimization: appropriate formats, sizes, lazy loading.
- Render performance: no expensive computations in render path.

Frontend performance verification:

```bash
# Build and check output sizes
npm run build --workspace=<app-dir> 2>&1 | tail -20
# Check for barrel re-exports that defeat tree-shaking
rg -n "export \* from" --glob '*.ts' --glob '*.tsx' --glob '!node_modules'
# Check for React.lazy / dynamic imports (code splitting evidence)
rg -n "React\.lazy|import\(" --glob '*.tsx' | head -15
# Check for large inline assets
find <app-dir>/public -type f -size +100k 2>/dev/null
```

### D) Scalability Patterns

- Stateless services (no in-memory session state that breaks with multiple instances).
- Database connection limits compatible with horizontal scaling.
- File storage uses object storage (not local filesystem in production).
- Background jobs use a proper queue (not in-process timers).
- Search/indexing strategy scales (full-text search index, not LIKE queries).

## Phase 4: Reliability and Resilience

### A) Failure Isolation

- External service failures don't cascade (timeouts, circuit breakers).
- Database failure handling (connection retry, pool exhaustion recovery).
- Queue processing failures handled (dead-letter queues, retry with backoff).
- One component's failure doesn't bring down the whole system.

### B) Data Safety

- Multi-step mutations wrapped in transactions.
- Idempotency for operations that may be retried (queue consumers, webhooks).
- No partial-failure states for critical business operations.
- Backup and recovery strategy exists for databases.

### C) Graceful Shutdown

- SIGTERM handlers drain in-flight requests before exit.
- Database connections closed cleanly on shutdown.
- Queue consumers finish current messages before stopping.
- Shutdown timeout configured and appropriate.

### D) Health and Readiness

- Health check endpoints exist for each service.
- Health checks verify actual dependencies (database, cache, required services).
- Readiness check distinguishes "starting up" from "running but degraded."
- Health endpoints are lightweight (no expensive queries).

### E) SLA and Timeout Configuration

- Request timeouts configured at all layers (client, server, database, external calls).
- Timeout values are appropriate (not too long, not too short).
- SLA timers and breach detection if applicable.
- Graceful timeout behavior (meaningful error, not connection reset).

## Phase 5: Observability

### A) Structured Logging

- Logs use structured format (JSON) for machine parsability.
- Consistent log fields across services (timestamp, level, service, message).
- Request/correlation IDs propagated across service boundaries.
- Log levels used appropriately (not everything at INFO/DEBUG).
- No sensitive data in logs (passwords, tokens, PII).

### B) Health and Monitoring Endpoints

- Liveness endpoint: process is running.
- Readiness endpoint: process is ready to serve traffic.
- Metrics endpoint (if applicable): response times, error rates, queue depths.
- Custom health model for connectors or integrations (HEALTHY, DEGRADED, FAILED).

### C) Error Tracking

- Unhandled exceptions captured and reported.
- Error context includes: request ID, user context, stack trace.
- Error grouping and deduplication (Sentry or equivalent pattern).
- Alert thresholds for error rate spikes.

### D) Audit and Tracing

- Distributed tracing headers propagated (if multi-service).
- Key business events logged for operational visibility.
- Deployment events marked for correlation with behavior changes.

## Phase 6: Container and Build Pipeline

### A) Dockerfile Quality

For each Dockerfile, verify:

- **Base image**: pinned to specific version (not `latest`).
- **COPY order**: dependency manifests before source (for layer caching).
- **Dependency install**: lockfile-based install (`npm ci`, `pip install -r`, etc.).
- **Multi-stage build**: build tools excluded from production image.
- **Production stage**: only runtime artifacts and dependencies.
- **Non-root user**: `USER` directive with numeric UID.
- **EXPOSE**: matches the expected runtime port.
- **Entrypoint**: correct path to compiled/built output.
- **Image size**: minimal base (alpine/distroless); no unnecessary tools.

### B) Build Output Path Alignment

- Build tool output directory matches Dockerfile `COPY --from=build` source.
- For frontend builds: static file server (nginx) `root` matches copied assets path.
- For API builds: entrypoint matches compiled output location.
- Asset files referenced at runtime are included in the image.

### C) Layer Caching Efficiency

- Dependency manifests copied before source code.
- `.dockerignore` excludes: `node_modules`, `dist`, `.git`, `.env`, test files, docs.
- No unnecessary `RUN` layers that could be combined.
- Package manager cache cleaned after install.

### D) Docker Compose and Local Dev

- Service definitions match Dockerfiles.
- Port mappings are consistent and non-conflicting.
- Volumes configured appropriately for local development.
- Database containers have proper initialization.
- Service dependencies use `depends_on` with health checks where supported.

## Phase 7: CI/CD Pipeline

### A) Build Gates

Verify these gates exist (or should exist):

- Compilation/build succeeds.
- Unit tests pass.
- Integration tests pass.
- Static analysis (lint, typecheck) passes.
- Security scan (SAST, dependency audit).
- Performance budget checks (bundle size, response time).

For each: `Present and Passing`, `Present but Failing`, `Missing`, `Not Applicable`.

### B) Deployment Pipeline

- Automated deployment from CI (not manual scripts on developer machines).
- Environment separation: dev/staging/production with promotion controls.
- Canary or blue-green deployment strategy for production.
- Automatic rollback on health check failure.
- Database migrations run as part of deployment (not manual step).

### C) Pipeline Security

- Secrets not exposed in CI logs or build output.
- Workflow/job permissions follow least privilege.
- Third-party CI actions/plugins pinned to SHA (not floating version tags).
- Build artifacts signed or verified if applicable.

### D) Pipeline Reliability

- Build times reasonable (flag if >15 minutes).
- Flaky test detection and management.
- Caching configured for dependencies and build artifacts.
- Parallel execution where possible (independent test suites, independent builds).

## Phase 8: Environment and Configuration

### A) Environment Variable Audit

Cross-reference all environment variable reads against:

- Documentation (`.env.example` or equivalent).
- Container orchestration configs (docker-compose, Kubernetes, Cloud Run).
- Infrastructure-as-code (Terraform, CloudFormation, etc.).
- CI/CD configs (secrets, build args).

Flag:
- Required in code but missing from deployment configs.
- Present in deployment configs but not used in code (dead config).
- Different defaults across environments.
- Build-time vars treated as runtime or vice versa.

### B) Secret Safety

- No secrets in Dockerfiles, CI configs, or source code.
- Production secrets managed via secrets manager (not env files).
- `.gitignore` excludes all secret-bearing files.
- Build arguments don't persist secrets in image layers.

### C) Configuration Consistency

- Environment-specific overrides are minimal and documented.
- No hardcoded localhost/IP addresses in production code paths.
- Feature flags or environment switches use consistent patterns.

## Phase 9: Deployment Readiness

### A) Zero-Downtime Deployment

- Rolling deployment or blue-green supported.
- Graceful shutdown allows in-flight requests to complete.
- Database migrations are backward-compatible (old code works with new schema).
- New instances pass health checks before receiving traffic.

### B) Port and Network

- All services use the expected port (environment variable, not hardcoded).
- CORS configured for all frontend-to-API communications.
- Internal service communication uses correct hostnames/service discovery.
- TLS termination configured appropriately (load balancer or service level).

### B2) CORS Origin Cross-Reference (P0 if missing)

When an API serves multiple frontend apps, verify the full origin chain is configured:

1. **Enumerate all frontend consumers**: List every app/service that calls this API (Cloud Run URLs, custom domains, localhost for dev).
2. **Cross-reference against CORS config**: Verify every consumer origin appears in the `ALLOWED_ORIGINS` env var (or equivalent).
3. **Verify deployment configs include all origins**: Check that Cloud Run service env vars, docker-compose, and `.env.example` all list every consumer.
4. **Check for startup validation**: API must fail fast if `ALLOWED_ORIGINS` is unset in production — silent CORS failures are extremely hard to debug (browser shows opaque "Failed to fetch" with no server-side log).

```bash
# Step 1: Find all services that call this API
rg -rn "VITE_API_BASE_URL|API_URL|apiBaseUrl|baseURL" --glob '*.{ts,tsx,env*}' apps/ client/ | grep -v node_modules
# Step 2: Check what the API accepts
rg -n "ALLOWED_ORIGINS|corsOrigins|origin:" --glob '*.{ts,js}' server/
# Step 3: Check deployed config
gcloud run services describe <api-service> --format 'yaml(spec.template.spec.containers[0].env)' 2>/dev/null | grep -i origin
```

**Common failure mode**: A new frontend app is added (e.g., Ops Console) but `ALLOWED_ORIGINS` on the API is not updated. Login appears to work in server logs but the browser blocks the response due to missing `Access-Control-Allow-Origin` header.

### C) Database Migration Safety

- Migrations run automatically during deployment.
- Migrations are idempotent and backward-compatible.
- No destructive operations (DROP, TRUNCATE) in migrations without explicit plan.
- Connection string and credentials correctly configured for each environment.

### D) Static Asset Serving

- Frontend assets served via CDN or optimized static server.
- SPA routing configured (fallback to index.html for client-side routes).
- Cache headers set for static assets (fingerprinted filenames + long cache).
- Compression enabled (gzip/brotli).

## Phase 10: QA Gates and Readiness Verdict

Assess each gate as `PASS`, `PARTIAL`, `FAIL`.

Blocking gates:

1. **Build health** — All services build successfully.
2. **Architecture boundaries** — No circular deps; shared packages have clean APIs.
3. **Reliability** — Graceful shutdown, health checks, transaction safety.
4. **Container correctness** — Dockerfiles produce working images; paths aligned.
5. **Environment completeness** — All required vars documented and injected.
6. **Migration safety** — Idempotent, backward-compatible, no destructive ops.
7. **Deployment pipeline** — Automated deployment with rollback capability.

Non-blocking gates:

1. **Performance** — No critical N+1 patterns; pagination present; bundles within budget.
2. **Observability** — Structured logging, health endpoints, correlation IDs.
3. **Scalability** — Stateless services, appropriate connection limits, queue-based async.
4. **CI/CD completeness** — All recommended gates present and passing.

### Gate-to-Phase Mapping

| Gate | Primary Phase(s) | Key Evidence |
|------|-----------------|--------------|
| Build health | Phase 6A, 6B | Dockerfile builds, entrypoint alignment |
| Architecture boundaries | Phase 2A, 2C, 2D | madge output, import analysis |
| Reliability | Phase 4A-4E | Shutdown handlers, health checks, transactions |
| Container correctness | Phase 6A-6C | Dockerfile audit, layer caching |
| Environment completeness | Phase 8A-8C | Env var cross-reference |
| Migration safety | Phase 9C | Idempotent migrations, backward compat |
| Deployment pipeline | Phase 7A-7D | CI config, rollback capability |

Verdict policy:

- Any blocking gate `FAIL` => `NOT-READY`.
- Blocking gates all `PASS` or `PARTIAL` with no `FAIL` and 2+ `PARTIAL` => `CONDITIONAL`.
- Blocking gates all `PASS` with at most 1 `PARTIAL` => `READY`.

Verdict block:

```text
Build Status:          [PASS | FAIL]
Architecture:          [PASS | PARTIAL | FAIL]
Reliability:           [PASS | PARTIAL | FAIL]
Container Status:      [PASS | PARTIAL | FAIL]
Blocking Gates:        X/7 PASS, Y/7 PARTIAL, Z/7 FAIL
Non-Blocking Gates:    X/4 PASS, Y/4 PARTIAL, Z/4 FAIL
Readiness Verdict:     [READY | CONDITIONAL | NOT-READY]
```

## Phase 10.1: Common Fix Patterns

| Finding | Fix | Rollback |
|---------|-----|----------|
| Missing health check | Add `GET /health` route returning `{ status: "ok" }` with DB ping | Revert the route file |
| N+1 query in loop | Replace with single query using `WHERE id = ANY($1)` or JOIN | Revert query change |
| Missing SIGTERM handler | Add `process.on("SIGTERM", async () => { await server.close(); })` | Revert signal handler |
| Unbounded query | Add `LIMIT` clause and pagination parameters | Revert query change |
| Non-root Docker user missing | Add `USER 1000:1000` after final `COPY` in Dockerfile | Remove the USER line |
| Missing `.dockerignore` | Create file excluding `node_modules`, `.git`, `dist`, `.env`, `docs` | Delete the file |
| Hardcoded localhost in prod code | Replace with `process.env.HOST \|\| "0.0.0.0"` | Revert to hardcoded value |
| Missing env var documentation | Add to `.env.example` with placeholder value | Remove the line |

## Phase 11: Bugs and Foot-Guns

Minimum counts (high-impact = P0+P1, medium-impact = P2):

- Full-repo review: `10+` high-impact and `10+` medium-impact findings.
- Scoped review: `5+` high-impact and `5+` medium-impact findings.

Each finding must include:

- Severity, confidence, and status.
- Exact file:line evidence.
- Impact statement (build failure, runtime crash, data loss, scaling bottleneck).
- Specific fix with code-level guidance.
- Verification steps.

## Phase 12: Requirements Compliance Matrix

If requirements or architecture decision records are available, produce:

| Requirement ID | Description | Architecture Evidence | Status | Gap | Next Step |
|----------------|-------------|-----------------------|--------|-----|-----------|

If no formal requirements, produce an architecture-principles checklist based on observed patterns.

## Phase 13: Improvement Backlog

Backlog size:

- Full-repo: `25-60` items.
- Scoped: `10-25` items.

| ID | Title | Priority | Risk Score | Effort | Category | Where | Why | Fix | Verify | Dependencies |
|----|-------|----------|------------|--------|----------|-------|-----|-----|--------|--------------|

Priority:

- `P0`: urgent — system failure or build-breaking.
- `P1`: high — fix this sprint.
- `P2`: medium — next sprint.
- `P3`: low — optimization/hardening.

Effort:

- `S`: under 2 hours.
- `M`: 2 hours to 2 days.
- `L`: more than 2 days.

## Phase 14: Quick Wins and Stabilization

- Quick wins (2 hours): `5-10` fixes with immediate architectural improvement.
- 2-day stabilization: `8-15` fixes that materially reduce risk and improve reliability.

Each task must include exact file targets and verification steps.

For every fix recommendation, include rollback guidance:

- **S-effort fixes** (config, single-line): Rollback = revert the line.
- **M-effort fixes** (new middleware, migration): Rollback = revert file + verify no dependent changes.
- **L-effort fixes** (architectural): Rollback = revert branch; specify which downstream changes depend on this fix.

## Phase 15: Verification Commands

Adapt commands to the discovered tech stack. Examples:

```bash
# Build verification
npm run build 2>&1 | tail -20
# or: cargo build --release 2>&1 | tail -20

# Type checking
npx tsc --noEmit 2>&1 | head -50

# Dependency graph
npm ls --all --depth=1 2>&1 | head -50

# Circular dependency detection (pass specific app/package dir, not bare src/)
npx madge --circular --extensions ts apps/api/src/ 2>/dev/null || echo "madge not available"
# For monorepo: run per-app — npx madge --circular --extensions ts <app-dir>/src/

# Docker build (if daemon available)
docker build -f Dockerfile -t test-build . 2>&1 | tail -30

# Port binding verification (narrowed pattern to reduce false positives)
rg -n "\.listen\(|PORT\s*[:=]|EXPOSE " --glob '*.ts' --glob '*.js' --glob 'Dockerfile*' --glob '*.yml'

# Health endpoint verification
rg -n "health|ready|liveness" --glob '*.ts' --glob '*.js' -i

# Graceful shutdown
rg -n "SIGTERM|SIGINT|graceful|shutdown" --glob '*.ts' --glob '*.js'

# Environment variable usage
rg -n "process\.env\.|os\.environ|env\(" --glob '*.ts' --glob '*.js' --glob '*.py'

# N+1 query patterns
# NOTE: Not all matches are true N+1 — loops over a small fixed set (e.g., config keys) are usually fine.
# True N+1: loop iterates over user-data rows and issues a query per row. Verify the loop source.
rg -n "for.*await.*query\(|\.forEach.*await.*find|\.map.*await" --glob '*.ts' --glob '*.js'

# Transaction usage
rg -n "transaction|BEGIN|COMMIT|ROLLBACK" --glob '*.ts' --glob '*.js' --glob '*.sql'

# Connection pool configuration
rg -n "pool|connectionLimit|max.*connections" --glob '*.ts' --glob '*.js' -i

# Dockerfile quality
rg -n "^FROM|^USER|^EXPOSE|^COPY|^RUN|^CMD|^ENTRYPOINT" Dockerfile*

# CI/CD pipeline
rg -n "deploy|rollback|canary|health" --glob '*.yml' --glob '*.yaml' -i

# Hardcoded hosts
rg -n "localhost|127\.0\.0\.1|0\.0\.0\.0" --glob '*.ts' --glob '*.js' --glob '!*.test.*' --glob '!*.spec.*'
```

Record each command as `Executed` or `Not Executed` with reason.

## Output

Final report sections in order:

1. Scope and Preflight
2. System Map
3. Architecture Boundaries
4. Performance and Scalability
5. Reliability and Resilience
6. Observability
7. Container and Build Pipeline
8. CI/CD Pipeline
9. Environment and Configuration
10. Deployment Readiness
11. QA Gates and Verdict
12. Bugs and Foot-Guns
13. Requirements Compliance Matrix
14. Improvement Backlog
15. Quick Wins and Stabilization
16. Top 5 Priorities

If `docs/reviews/` does not exist, create it before writing the report.
