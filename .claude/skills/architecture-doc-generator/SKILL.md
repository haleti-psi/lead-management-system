---
name: architecture-doc-generator
description: "Generate a structured Architecture Document from a BRD and Data Model. Use this skill whenever the user wants to define the technical architecture before writing guidelines or LLDs, says things like 'create the architecture document', 'define the tech stack', 'document the system architecture', 'what runtime should we use', 'create the architecture decision record', 'define the deployment target', 'specify the API style', or 'document how the system is structured'. Also trigger when a user has completed Gate B (data model sign-off) and is ready to start Stage 3 of the AI Dev Pipeline. The output is docs/architecture.md — the single reference all downstream skills (guidelines-generator, contracts-generator, lld-generator, phase-executor) read to understand where code lives and how it is structured."
allowed-tools: Read Write Bash Glob WebSearch
---

# Architecture Document Generator

Produce `docs/architecture.md` — the authoritative reference defining runtime, deployment, folder structure, API style, auth approach, and all structural decisions that every downstream coding agent must follow.

## Why This Document Matters

Without an architecture document, each FR's coding agent makes its own structural decisions. Two agents working in parallel will choose different folder structures, different middleware approaches, different error handling patterns. The codebase becomes incoherent at the seams. This document makes structural decisions once and enforces them everywhere.

## Inputs

- `docs/brd.md` — for domain context, external integrations, and NFRs
- `docs/data-model/DATA_MODEL.md` — for storage context, tech implications
- User preferences (stack, deploy target) if provided via arguments
- CLAUDE.md if present — for project conventions already established

## Process

### Step 1: Read Inputs and Infer Context

```bash
# Read all inputs
cat docs/brd.md | head -100
cat docs/data-model/DATA_MODEL.md
cat CLAUDE.md 2>/dev/null | head -50
```

Extract from the BRD:
- **Domain type** (B2B SaaS / consumer app / internal tool / API-only)
- **Expected scale** (NFR thresholds: concurrent users, data volume)
- **External integrations** (auth provider, payment, email, storage)
- **Compliance requirements** (SOC 2, HIPAA, GDPR — from NFRs)
- **Team context** (single developer, small team, parallel agents)

Extract from the data model:
- **Database** (already chosen: PostgreSQL / Supabase)
- **Expected query patterns** (read-heavy vs write-heavy, search requirements)
- **Real-time requirements** (any tables needing Supabase Realtime)

### Step 2: Ask Clarifying Questions (if ambiguous)

If the BRD does not make the following clear, ask ONE consolidated question before proceeding:

```
Before generating the architecture document, I need a few choices:

1. Frontend framework: Next.js App Router / Vite + React SPA / None (API-only)
2. Backend style: Next.js API routes / FastAPI / Express / Supabase Edge Functions
3. Deployment target: Vercel / Cloud Run / Supabase hosted / Other
4. Auth: Supabase Auth / Clerk / Auth.js / Custom JWT

(Or say 'use best defaults' and I'll choose based on the BRD context)
```

If the user says "use best defaults", apply these defaults based on database choice:
- **Supabase DB** → Next.js App Router + Supabase Edge Functions + Supabase Auth + Vercel
- **Cloud SQL** → FastAPI or Express + Cloud Run + Custom JWT + Cloud Run
- **Generic PostgreSQL** → Next.js App Router + Express API + JWT + Vercel or Cloud Run

### Step 3: Generate the Architecture Document

Write `docs/architecture.md` with all of the following sections. Every section must be specific — no placeholders, no "TBD".

---

```markdown
# Architecture Document
*Project: <name> | Generated: <date> | Status: Active*

## 1. System Overview

[2-3 sentences describing what the system is and who uses it, derived from BRD]

## 2. Technology Choices

### Runtime and Framework
- **Frontend**: [e.g. Next.js 15 App Router with React 19, TypeScript 5.x]
- **Backend**: [e.g. Next.js API Routes / FastAPI 0.115 / Express 4.x]
- **Database**: [PostgreSQL 15 via Supabase / Cloud SQL]
- **ORM/Query layer**: [Drizzle ORM / Prisma / SQLAlchemy / raw pg]
- **Language**: [TypeScript strict mode / Python 3.12+]

### Deployment Target
- **Hosting**: [Vercel / Cloud Run / Supabase hosted]
- **Region**: [e.g. asia-southeast1 / us-east-1]
- **Container strategy**: [Dockerfile names, multi-stage build approach]
- **CI/CD**: [GitHub Actions / Cloud Build]

### Authentication
- **Provider**: [Supabase Auth / Clerk / Custom JWT]
- **Session model**: [JWT in httpOnly cookie / Supabase session / server-side session]
- **Token storage**: [httpOnly cookie — never localStorage]
- **Auth middleware name**: [e.g. `requireAuth`, `withAuth`, `authenticate`]
  Every protected endpoint calls this middleware. The LLD-generator will reference it by this name.

### External Services
[For each service from the BRD Integration Map:]
| Service | Provider | SDK | Abstraction Layer |
|---------|----------|-----|-------------------|
| Email | Resend | `resend` npm | `lib/email.ts → sendEmail()` |
| Storage | Supabase Storage | Supabase client | `lib/storage.ts → uploadFile()` |
| Payments | Stripe | `stripe` npm | `lib/payments.ts → createPaymentIntent()` |

## 3. Project Structure

[Exact folder layout — every coding agent will use this]

### Example: Next.js Full-Stack
```
<project-root>/
├── CLAUDE.md                    # Always-active agent instructions
├── manifest.json                # Pipeline state
├── docs/                        # All pipeline artefacts
├── src/
│   ├── app/                     # Next.js App Router pages and layouts
│   │   ├── (auth)/              # Auth route group
│   │   ├── api/                 # API route handlers
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/                  # Shadcn/ui primitives (never modify directly)
│   │   └── [feature]/           # Feature-specific components
│   ├── lib/
│   │   ├── db.ts                # Database client singleton
│   │   ├── auth.ts              # Auth helpers
│   │   ├── email.ts             # Email abstraction
│   │   └── [service].ts         # One file per external service
│   ├── hooks/                   # Shared React hooks
│   ├── types/                   # Shared TypeScript types
│   └── utils/                   # Pure utility functions
├── prisma/ OR drizzle/          # Schema and migrations
└── public/                      # Static assets
```

### Example: FastAPI + React SPA
```
<project-root>/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app entry point
│   │   ├── routers/             # One router file per resource
│   │   ├── services/            # Business logic, one file per domain
│   │   ├── models/              # SQLAlchemy models
│   │   ├── schemas/             # Pydantic schemas
│   │   ├── deps.py              # Dependency injection (auth, db session)
│   │   └── core/
│   │       ├── config.py        # Settings from env vars
│   │       ├── security.py      # JWT creation and verification
│   │       └── database.py      # DB connection pool
│   └── alembic/                 # Migrations
├── frontend/
│   ├── src/
│   │   ├── pages/ OR app/       # Route-level components
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/api.ts           # Typed API client
│   │   └── types/
└── docs/
```

[Use the appropriate structure for the chosen stack. Be specific about every directory.]

## 4. API Design

### Style
- **API style**: [REST with JSON / tRPC / GraphQL]
- **Base path**: [e.g. `/api/v1/`]
- **Versioning**: [URL versioning `/api/v1/` — v2 introduces a new base path]

### Response Envelope
All list endpoints return:
```json
{
  "data": [...],
  "meta": { "total": 100, "page": 1, "limit": 20 }
}
```

All single-resource endpoints return the resource directly:
```json
{ "id": "...", "field": "..." }
```

### Error Format
All errors return:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": [{ "field": "email", "message": "Must be a valid email" }]
  }
}
```
Error codes come from the Error Taxonomy in `docs/contracts/error-taxonomy.md`. No other error codes may be used.

### HTTP Status Codes
| Scenario | Status |
|----------|--------|
| Created | 201 |
| No content | 204 |
| Validation error | 422 |
| Unauthenticated | 401 |
| Unauthorised | 403 |
| Not found | 404 |
| Conflict | 409 |
| Server error | 500 |

## 5. Middleware and Cross-Cutting Concerns

### Auth Middleware
Name: `[requireAuth / withAuth / authenticate]`
Location: `[src/lib/auth.ts / app/deps.py]`
Behaviour: Validates session token, attaches user to request context, returns 401 if invalid.
All protected routes must use this middleware. The LLD for each FR specifies whether the FR's endpoints are public or protected.

### Request Logging
Every request logs: `{ method, path, status, duration_ms, user_id, trace_id }`
Implementation: [Express middleware / FastAPI middleware / Next.js middleware]

### Error Boundary
Unhandled errors are caught at the framework level, logged with stack trace (never exposed to client), and return a 500 with the standard error format.

### CORS
Allowed origins: determined by `ALLOWED_ORIGINS` env var (comma-separated).
Credentials: `true` (for cookie-based auth).

### Rate Limiting
Applied to: auth endpoints (10/minute), mutation endpoints (60/minute), read endpoints (300/minute).
Implementation: [express-rate-limit / slowapi / Vercel Edge middleware]

## 6. Configuration and Secrets

### Environment Variables
All configuration via environment variables. No hardcoded values.
Full list in `docs/contracts/environment-contract.md`.

### Validated at Startup
The app reads and validates all required env vars at startup. Missing required vars cause immediate crash with a clear error message — not a silent failure later.

### Local Development
```bash
cp .env.example .env.local
# Fill in values from the team secrets store
```

## 7. Observability

### Logging
- Format: structured JSON (`{ timestamp, level, service, message, ...context }`)
- Mandatory fields per log line: `trace_id`, `user_id` (if authenticated), `service`
- Library: [pino / structlog / winston]
- Log levels: `debug` (dev only), `info` (normal operations), `warn` (recoverable issues), `error` (exceptions)

### Tracing
- Trace IDs generated per request, propagated via `X-Trace-ID` header
- Included in every log line and every error response

### Health Checks
- `GET /health` — returns `{ status: "ok" }`, no auth required, lightweight
- `GET /ready` — returns DB connectivity status (used by load balancer)

## 8. Testing Strategy

### Test Types by Layer
| Layer | Type | Tool | Location |
|-------|------|------|----------|
| Business logic | Unit | Jest / pytest | `*.test.ts` / `test_*.py` adjacent to source |
| API endpoints | Integration | supertest / httpx | `*.integration.test.ts` |
| UI flows | E2E | Playwright | `e2e/` |
| Auth/permissions | Integration | supertest | Per-resource test file |

### Test Data
Strategy: [factory functions / fixtures / seeded test DB]
Implementation: `src/test/factories/` or `tests/factories/`

### Coverage Expectation
Every happy path and every named error path in the Error Taxonomy must have a test.

## 9. Deployment Architecture

### Environments
| Env | Branch | Auto-deploy | Database |
|-----|--------|-------------|----------|
| development | `main` | Yes | Dev DB |
| staging | `release/*` | Yes | Staging DB |
| production | tags `v*` | Manual approval | Prod DB |

### Build Process
[Specific commands for the chosen stack]

### Database Migrations
Migrations run as part of deployment, before the new code starts serving traffic.
Migration tool: [Flyway / Alembic / Supabase CLI]
Migration files: `migrations/` or `alembic/versions/`

## 10. Shared Conventions

These conventions apply to every FR. Coding agents must not deviate.

- **Primary keys**: UUID v4 via `gen_random_uuid()` — never integer sequences
- **Timestamps**: `TIMESTAMPTZ NOT NULL DEFAULT now()` — always UTC
- **Soft deletes**: `deleted_at TIMESTAMPTZ` — tables with soft-delete requirements listed in DATA_MODEL.md
- **Naming**: `snake_case` for DB columns and Python, `camelCase` for TypeScript variables, `PascalCase` for components and classes
- **Imports**: absolute imports from project root (e.g. `@/lib/auth` not `../../lib/auth`)
- **No `any` type**: TypeScript strict mode enforced — all types must be explicit
- **Error handling**: never swallow errors silently — always log and re-throw or return typed error
- **Async**: async/await throughout — no `.then()` chains
```

### Step 4: Update CLAUDE.md

After writing `docs/architecture.md`, update or create `CLAUDE.md` to include the architecture reference:

```markdown
## Project Structure
See docs/architecture.md for the complete folder structure, API conventions, middleware names, and shared conventions.

## Key Paths
- Auth middleware: [exact import path from architecture doc]
- DB client: [exact import path]
- Error types: docs/contracts/error-taxonomy.md
- Approved libraries: docs/contracts/dependency-register.md
```

If CLAUDE.md already exists, add the architecture reference without removing existing content.

### Step 5: Verify and Report

```bash
# Verify the file was written
wc -l docs/architecture.md

# Check all mandatory sections present
for section in "Technology Choices" "Project Structure" "API Design" "Middleware" "Configuration" "Observability" "Testing Strategy" "Deployment Architecture" "Shared Conventions"; do
  grep -q "$section" docs/architecture.md && echo "✓ $section" || echo "✗ MISSING: $section"
done
```

Report to the user:
- The key choices made (framework, deployment, auth)
- Any assumptions made that the user should verify
- That CLAUDE.md has been updated
- That Gate B must be signed off before running this skill, and this skill's output feeds into `guidelines-generator` and `contracts-generator`

## Output

Primary: `docs/architecture.md`
Secondary: Updated `CLAUDE.md`

## Quality Checklist

Before finalising:

- [ ] Every section has specific content — no "TBD" or placeholder text
- [ ] Folder structure example matches the chosen stack
- [ ] Auth middleware is named specifically (not "auth middleware" generically)
- [ ] Error format specifies the exact JSON shape
- [ ] All external services from the BRD are listed with their abstraction layer
- [ ] CLAUDE.md updated with architecture reference
- [ ] Shared conventions section is complete (naming, imports, async, error handling)
