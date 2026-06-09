---
name: guidelines-generator
description: "Generate the four-part Guidelines Package (Coding, UI, Security, Performance) from the Architecture Document. Use this skill whenever the user wants to define coding standards before LLD generation, says 'create the guidelines', 'define our coding standards', 'write the development guidelines', 'document the UI standards', 'define security rules for the codebase', 'set up the performance guidelines', or 'generate the guidelines package'. Also trigger automatically after architecture-doc-generator completes — this is Stage 4 of the AI Dev Pipeline. The output is four files in docs/guidelines/ that serve as the single source of truth consumed by both the lld-generator (so agents build correctly) and the review skill (so reviewers check against the same standards)."
allowed-tools: Read Write Bash Glob
---

# Guidelines Generator

Produce the four-part Guidelines Package in `docs/guidelines/` from the Architecture Document. These files are the single source of truth for how every line of generated code should be written.

## Why One Source, Two Consumers

The same guidelines document is consumed by:
1. **lld-generator** — embeds guidelines into each LLD so coding agents build correctly the first time
2. **review-skill / full-review** — checks generated code against the same standards

If guidelines exist in two places with different content, agents will build against one version and be reviewed against another. This skill produces a single authoritative set.

## Inputs

- `docs/architecture.md` — mandatory (framework, runtime, auth approach, observability stack)
- `docs/brd.md` — for UI requirements (accessibility, i18n, responsive targets)
- `docs/data-model/DATA_MODEL.md` — for database-specific performance rules
- CLAUDE.md — for any project conventions already established

## Process

### Step 1: Read All Inputs

```bash
cat docs/architecture.md
cat docs/brd.md | grep -A5 "Non-Functional\|Performance\|Security\|Accessibility"
cat docs/data-model/DATA_MODEL.md | head -80
```

### Step 2: Generate Each Guideline File

Write all four files. Every item must be **prescriptive** — it tells agents exactly what to do, not just what category of concern exists.

---

#### File 1: `docs/guidelines/coding.md`

```markdown
# Coding Guidelines
*Stack: [from architecture.md] | Updated: [date]*

## Language and Framework Versions
- [e.g. TypeScript 5.x with strict mode — `"strict": true` in tsconfig]
- [e.g. Node.js 22 LTS / Python 3.12+]
- [framework version]

## File and Folder Naming
- Source files: `kebab-case.ts` (e.g. `order-service.ts`, `create-order.ts`)
- React components: `PascalCase.tsx` (e.g. `OrderForm.tsx`)
- Test files: `[source-file].test.ts` adjacent to the source file
- Directories: `kebab-case/`

## Import Ordering
1. Node/Python standard library
2. Third-party packages
3. Internal packages (`@/lib/...`, `@/components/...`)
4. Relative imports (only within the same feature directory)

Separate each group with a blank line. No mixing groups.

## Naming Conventions
- Variables and functions: `camelCase`
- Classes and components: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Database columns: `snake_case`
- Boolean variables: prefix with `is`, `has`, `should`, `can` (e.g. `isLoading`, `hasPermission`)
- Event handlers: prefix with `handle` (e.g. `handleSubmit`, `handleDelete`)

## TypeScript Rules
- No `any` type — ever. Use `unknown` and narrow, or define the type.
- No `as any` casts. Use type guards.
- No `@ts-ignore` without a comment explaining why
- All function parameters and return types must be explicitly typed
- Prefer `interface` for object shapes, `type` for unions and intersections
- Zod schemas for all external input validation (API request bodies, form data)

## Error Handling
- Never swallow errors silently (`catch {}` or `catch(e) {}` are forbidden)
- Every error must be either logged and re-thrown, or logged and returned as a typed error response
- Use only the error types defined in `docs/contracts/error-taxonomy.md`
- Error messages shown to users must not contain stack traces, internal IDs, or system paths
- Log the full error internally; return a sanitised message externally

## Logging
- Use structured JSON logging — no `console.log` in production code
- Library: [from architecture.md — e.g. pino, structlog, winston]
- Every log line must include: `trace_id`, `level`, `service`, `message`
- Authenticated requests additionally include: `user_id`
- Log levels: `debug` (development only), `info` (normal operations), `warn` (recoverable), `error` (exceptions requiring attention)
- Never log: passwords, tokens, full credit card numbers, PII fields listed in the Data Model

## Async Patterns
- async/await throughout — no `.then()` chains
- Every async operation must have explicit error handling (try/catch or .catch())
- Never use `Promise.all` without handling individual rejections
- Background operations that must not block the response: use job queue [from architecture.md]

## Comment and Documentation Standards
- Public functions and classes must have JSDoc / docstring comments
- Inline comments explain *why*, not *what* (the code shows what)
- No TODO/FIXME comments without an issue ID: `// TODO(ISSUE-123): description`
- No commented-out code — use git history

## Linting and Formatting
- ESLint with project config / Black + Ruff for Python
- Prettier with project config / Black formatting
- Pre-commit hooks enforce both — no CI bypass
- Zero lint errors in committed code (warnings are acceptable during development, not at commit)
```

---

#### File 2: `docs/guidelines/ui.md`

Adapt this to the chosen UI stack from `docs/architecture.md`:

```markdown
# UI Guidelines
*Stack: [e.g. Next.js + Tailwind + shadcn/ui] | Updated: [date]*

## Component Library
- Primary: [e.g. shadcn/ui — use components from `@/components/ui/`]
- Never re-create a component that exists in the library
- Never modify files in `components/ui/` directly — extend by wrapping

## Design Tokens
All colours, spacing, typography, and radius values via CSS variables.
Never hardcode hex values, px values for spacing, or font sizes.

### Colour Tokens
```css
/* Use these — never hardcode */
var(--background)     /* page background */
var(--foreground)     /* primary text */
var(--muted)          /* muted backgrounds */
var(--muted-foreground) /* muted text */
var(--card)           /* card backgrounds */
var(--border)         /* borders */
var(--primary)        /* primary action colour */
var(--destructive)    /* destructive actions */
```

### Spacing
Use Tailwind spacing scale only (no arbitrary values unless explicitly required):
`p-1` (4px), `p-2` (8px), `p-4` (16px), `p-6` (24px), `p-8` (32px)

## Layout Patterns
- Page wrapper: `<main className="container mx-auto px-4 py-8">`
- Card: use shadcn `<Card>` — never `<div className="rounded border">`
- Sidebar: [specific pattern from architecture]
- Full-height layouts: `100dvh` — never `100vh`

## Form Patterns
- Every input must have a visible `<label>` — never placeholder-only
- Required fields indicated with `*` and `aria-required="true"`
- Validation: inline, on blur for format errors, on submit for all
- Error messages: displayed below the field, `role="alert"` or `aria-live="polite"`
- Submit button: disabled during submission (`isSubmitting` state)
- Form element: native `<form onSubmit={...}>` so Enter key works

## Loading State Patterns
- List pages: skeleton (not spinner) while loading
- Mutations: button shows spinner + disabled state
- Optimistic updates: apply immediately, roll back on error with toast
- Never leave a UI in an indefinite loading state — always have a timeout + fallback

## Empty State Patterns
Every list/table must handle the empty state explicitly:
- Icon (use Lucide) + heading + description + CTA button
- Never render an empty `<tbody>` or empty container

## Error and Boundary Patterns
- `<ErrorBoundary>` wraps every page-level component
- API errors: show a toast (non-blocking) for mutations, inline error for queries
- 404: dedicated page with navigation back to home
- 500: dedicated page with retry button

## Accessibility Requirements
- WCAG 2.1 AA minimum
- All interactive elements reachable via keyboard (Tab, Enter, Space, Escape)
- Focus visible on all interactive elements (`:focus-visible` ring)
- All icons that convey meaning have `aria-label`; decorative icons have `aria-hidden="true"`
- All `<img>` have `alt` text
- Modal dialogs: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus trap, Escape closes
- Color contrast: 4.5:1 for normal text, 3:1 for large text
- `prefers-reduced-motion` respected — wrap animations in `@media (prefers-reduced-motion: no-preference)`

## Dark Mode
- Use CSS variables / Tailwind dark: prefix consistently — never `dark:` in some files and CSS vars in others
- Test every new component in both light and dark mode before marking it done

## Animation
- Use `transition` and `transform`/`opacity` only — never animate `width`, `height`, or layout properties
- Duration: 150ms for micro-interactions, 300ms for panel transitions

## i18n (if applicable from BRD)
- All user-visible strings via translation function `t('key')`
- Never hardcode English strings in JSX
- Boolean displays: `t('common.yes')` / `t('common.no')` — never literal "Yes"/"No"
```

---

#### File 3: `docs/guidelines/security.md`

```markdown
# Security Guidelines
*Updated: [date]*

These rules are non-negotiable. Every LLD must implement them. The review skill checks every FR against this list.

## Authentication (every API endpoint)
- Every endpoint is either explicitly public (listed in CLAUDE.md public routes) or protected by [auth middleware name from architecture.md]
- No endpoint is accidentally public — the default is protected
- Unauthenticated requests to protected endpoints return 401 (not 403, not 404)

## Authorisation (every resource operation)
- Check that the authenticated user has the right to perform the operation on the specific resource — not just that they are authenticated
- Use the Auth Matrix in `docs/contracts/auth-matrix.json` as the specification
- Multi-tenant: every query that returns user-owned data must include a `WHERE user_id = $current_user` or `WHERE org_id = $current_org` clause — no exceptions
- Return 403 (not 404) when a resource exists but the user lacks permission

## Input Validation
- Validate and sanitise all user-supplied input before use
- Use Zod schemas (TypeScript) or Pydantic models (Python) — never manual validation
- Validation happens at the API layer before the service layer sees the data
- File uploads: validate MIME type from content inspection (not filename extension), validate size

## Output Sanitisation
- Never include in API responses: internal database IDs beyond what the client needs, stack traces, system paths, raw error messages from the database
- HTML output (if any): sanitise with DOMPurify or equivalent before rendering

## Secrets and Configuration
- No secrets in source code, git history, Dockerfiles, or log output
- All secrets via environment variables listed in `docs/contracts/environment-contract.md`
- Tokens, passwords, and PII must never be logged — even at debug level
- These field names must never appear in log output: `password`, `token`, `secret`, `credit_card`, `ssn`, [add project-specific PII field names from data model]

## SQL Injection Prevention
- Parameterised queries only — never string interpolation in SQL
- Use `$1, $2` placeholders (PostgreSQL) / `?` placeholders (SQLite) / ORM query builders
- The following pattern is forbidden: `db.query(\`SELECT ... WHERE id = ${id}\`)`

## Rate Limiting
- Auth endpoints (login, password reset, OTP): 10 requests per minute per IP
- Mutation endpoints: 60 requests per minute per authenticated user
- Read endpoints: 300 requests per minute per authenticated user
- Implementation: [from architecture.md — e.g. express-rate-limit, slowapi]

## CORS
- Allowed origins specified via `ALLOWED_ORIGINS` environment variable
- Credentials: `true` only when using cookie-based auth
- Never use `origin: '*'` with credentials

## Dependencies
- Use only libraries in `docs/contracts/dependency-register.md`
- No direct calls to `eval()`, `exec()`, `spawn()` with user input
- No `dangerouslySetInnerHTML` without DOMPurify sanitisation

## What Must Never Be in a PR
- Hardcoded secrets or API keys
- Disabled authentication for "testing purposes"
- SQL string interpolation
- `console.log` of sensitive fields
- `origin: '*'` in CORS configuration
```

---

#### File 4: `docs/guidelines/performance.md`

Tailor thresholds to the NFRs in the BRD:

```markdown
# Performance Guidelines
*Updated: [date] | SLA: [from BRD NFRs]*

## API Response Time Targets
These are the thresholds that must be met. If a generated endpoint cannot meet them, flag it in the LLD for review.

| Endpoint Type | p95 Target |
|---------------|-----------|
| Read (single resource) | < 100ms |
| Read (list with pagination) | < 200ms |
| Write (create/update) | < 300ms |
| Complex report/aggregation | < 1000ms |

## Pagination (mandatory on all list endpoints)
- Every endpoint that returns a list MUST paginate
- Default page size: 20
- Maximum page size: 100
- Pagination envelope: `{ "data": [...], "meta": { "total": N, "page": N, "limit": N } }`
- Cursor-based pagination for real-time feeds; offset-based for admin tables

## Query Constraints (mandatory)
- Every database query MUST have a LIMIT clause or ORM equivalent
- No unbounded queries — `SELECT * FROM table` without a WHERE + LIMIT is forbidden
- Maximum rows returned without pagination: 100

## N+1 Prevention
- Never issue a database query inside a loop over user data
- Use batch queries: `WHERE id = ANY($1)` with an array, or ORM `include`/`eager_load`
- For list endpoints: fetch related data in one query, not one query per row

## Index Usage
- WHERE clause columns must be indexed — cross-reference `docs/data-model/schema.sql`
- Compound indexes for queries filtering on multiple columns
- Partial indexes for status-filtered queries (`WHERE deleted_at IS NULL`)
- If a query plan shows a sequential scan on a large table, add an index

## Caching Strategy
- [From architecture.md: what gets cached, at what layer, TTL]
- Cache invalidation: on mutation of the underlying data
- Never cache user-specific data in a shared cache without user-scoping the key

## Bundle Size (Frontend)
- Route-level code splitting required: `React.lazy()` + `Suspense` for all page-level components
- Maximum per-route bundle: 250KB gzipped
- No barrel re-exports that defeat tree-shaking (`export * from`)
- Images: `loading="lazy"`, use WebP format, `next/image` or equivalent

## Background Jobs
- Operations that may take > 500ms must not block the API response
- Use job queue [from architecture.md] for: email sending, file processing, report generation
- Maximum job runtime: 5 minutes (then timeout and retry)
- All jobs must be idempotent (safe to retry)
- Retry policy: exponential backoff, maximum 3 retries

## Database Connection Pooling
- Pool size: [from architecture.md — e.g. min: 2, max: 10]
- Connection timeout: 5000ms
- Never open a connection per request — always use the shared pool
```

### Step 3: Update CLAUDE.md

Append to CLAUDE.md:

```markdown
## Coding Standards
See docs/guidelines/ for the complete standards package:
- docs/guidelines/coding.md   — language, patterns, naming, error handling
- docs/guidelines/security.md — non-negotiable security rules (always enforced)
- docs/guidelines/ui.md       — component library, tokens, accessibility
- docs/guidelines/performance.md — pagination, query constraints, SLAs

These apply to every line of generated code. The review skill checks against them.
```

### Step 4: Verify

```bash
# Verify all four files were written
ls docs/guidelines/

# Check file sizes are substantial
wc -l docs/guidelines/*.md

# Check CLAUDE.md was updated
grep -c "docs/guidelines" CLAUDE.md
```

### Step 5: Report to User

Tell the user:
- The four files were created
- Any stack-specific assumptions made (e.g. "I used Tailwind + shadcn/ui for UI guidelines since your architecture.md specifies Next.js")
- Any items that need their input (e.g. "I used placeholder SLA thresholds — please update the response time targets in docs/guidelines/performance.md to match your BRD's NFR section")
- That these files are now referenced in CLAUDE.md

## Output

- `docs/guidelines/coding.md`
- `docs/guidelines/ui.md`
- `docs/guidelines/security.md`
- `docs/guidelines/performance.md`
- Updated `CLAUDE.md`

## Quality Checklist

- [ ] Every item in every file is prescriptive (tells agents what to do, not just what to consider)
- [ ] No placeholder text or TBD items
- [ ] Stack-specific details filled in from architecture.md (not generic)
- [ ] Security guidelines are explicit about what is forbidden (not just what is required)
- [ ] Performance thresholds are actual numbers (not "fast" or "reasonable")
- [ ] CLAUDE.md updated to reference guidelines
