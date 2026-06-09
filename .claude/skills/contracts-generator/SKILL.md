---
name: contracts-generator
description: "Generate the ten-item Contracts Package from the BRD, Data Model, Architecture Document, and Guidelines. Use this skill whenever the user wants to define the behavioural contracts before LLD generation, says 'create the contracts package', 'generate the API contract', 'build the auth matrix', 'define the error taxonomy', 'write the state machines', 'document the integration map', 'define the testing contract', 'list the environment variables', 'inventory the shared utilities', 'register the approved dependencies', or 'define the NFR thresholds'. Also trigger automatically after guidelines-generator completes — this is Stage 5 of the AI Dev Pipeline. The output is ten structured files in docs/contracts/ that serve as machine-readable specifications consumed by lld-generator and phase-executor."
allowed-tools: Read Write Bash Glob
---

# Contracts Generator

Produce the ten-item Contracts Package in `docs/contracts/`. Where Guidelines say "how to write code," Contracts say "what the code must do." Each item addresses a specific class of multi-agent incoherence.

## Reference Files

Read these before generating specific contract items:
- `references/contract-templates.md` — exact format specifications for each contract file

## Inputs

- `docs/brd.md` — FRs, roles, workflows, external services, NFRs
- `docs/data-model/schema.sql` + `DATA_MODEL.md` — tables, enums, relationships
- `docs/architecture.md` — API style, auth approach, deployment, framework
- `docs/guidelines/` — coding, security, performance standards

## Process

### Step 1: Read All Inputs

```bash
cat docs/brd.md
cat docs/data-model/schema.sql | grep "CREATE TABLE\|CREATE TYPE\|ENUM"
cat docs/architecture.md | grep -A5 "API Design\|Authentication\|External"
```

### Step 2: Generate Each Contract Item

Use `--item` argument to generate a specific item, or generate all ten in sequence.

---

#### 5a. API Contract (`docs/contracts/api-contract.yaml`)

Machine-readable OpenAPI-compatible endpoint catalog. Every FR must have at least one entry.

Format:
```yaml
# API Contract
# Every endpoint used by every FR. Machine-readable. LLD-generator references this.
# Format: OpenAPI 3.0 subset — paths, methods, request/response shapes.

openapi: "3.0.0"
info:
  title: "[Project Name] API"
  version: "1.0.0"

paths:
  /api/v1/[resource]:
    get:
      summary: "List [resources]"
      operationId: "list[Resources]"
      tags: ["[Resource]"]
      security: [{ bearerAuth: [] }]  # or [] for public
      parameters:
        - name: page
          in: query
          schema: { type: integer, default: 1 }
        - name: limit
          in: query
          schema: { type: integer, default: 20, maximum: 100 }
      responses:
        "200":
          description: "Paginated list"
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items: { $ref: '#/components/schemas/[Resource]' }
                  meta:
                    type: object
                    properties:
                      total: { type: integer }
                      page: { type: integer }
                      limit: { type: integer }
        "401": { $ref: '#/components/responses/Unauthorized' }
        "403": { $ref: '#/components/responses/Forbidden' }
    post:
      [...]

components:
  schemas:
    [Resource]:
      type: object
      required: [id, field1, field2, created_at]
      properties:
        id: { type: string, format: uuid }
        field1: { type: string }
        created_at: { type: string, format: date-time }
  responses:
    Unauthorized:
      description: "Authentication required"
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    Error:
      description: "Standard error format"
  schemas:
    Error:
      type: object
      properties:
        error:
          type: object
          properties:
            code: { type: string }
            message: { type: string }
            details:
              type: array
              items:
                type: object
                properties:
                  field: { type: string }
                  message: { type: string }
```

Extract endpoints from the BRD: every FR that describes a user action implies at least one endpoint. Derive from the LLD section or FR description.

---

#### 5b. Authorisation Matrix (`docs/contracts/auth-matrix.json`)

Machine-readable role × resource × operation table.

```json
{
  "_meta": {
    "roles": ["admin", "member", "viewer"],
    "resources": ["orders", "products", "users", "reports"],
    "operations": ["create", "read_own", "read_all", "update_own", "update_all", "delete"],
    "generated_from": "docs/brd.md",
    "version": 1
  },
  "matrix": {
    "admin": {
      "orders":   { "create": true,  "read_own": true,  "read_all": true,  "update_own": true,  "update_all": true,  "delete": true },
      "products": { "create": true,  "read_own": true,  "read_all": true,  "update_own": true,  "update_all": true,  "delete": true },
      "users":    { "create": true,  "read_own": true,  "read_all": true,  "update_own": true,  "update_all": true,  "delete": true }
    },
    "member": {
      "orders":   { "create": true,  "read_own": true,  "read_all": false, "update_own": true,  "update_all": false, "delete": false },
      "products": { "create": false, "read_own": true,  "read_all": true,  "update_own": false, "update_all": false, "delete": false }
    },
    "viewer": {
      "orders":   { "create": false, "read_own": true,  "read_all": false, "update_own": false, "update_all": false, "delete": false }
    }
  },
  "public_endpoints": [
    "GET /api/v1/public/products",
    "POST /api/v1/auth/login",
    "POST /api/v1/auth/register"
  ],
  "service_to_service_only": [],
  "http_status_rules": {
    "unauthenticated": 401,
    "unauthorised": 403
  }
}
```

Extract roles from BRD Section 3 (User Roles). Extract resources from the data model tables. Extract operations by reading each FR.

---

#### 5c. State Machine Definitions (`docs/contracts/state-machines.md`)

One section per entity with a status enum from the data model.

```markdown
# State Machine Definitions

## [Entity Name] — `[entity]_status` enum

### States
| State | Description |
|-------|-------------|
| `draft` | Created but not submitted |
| `submitted` | Submitted for review |
| `approved` | Approved by reviewer |
| `rejected` | Rejected with reason |
| `archived` | Soft-archived, no further transitions |

### Valid Transitions
| From | To | Trigger | Who Can Trigger | Side Effects |
|------|-----|---------|-----------------|--------------|
| `draft` | `submitted` | User submits form | `member`, `admin` | Notification to reviewers; audit log entry |
| `submitted` | `approved` | Reviewer approves | `admin` | Notification to submitter; `approved_at` timestamp set |
| `submitted` | `rejected` | Reviewer rejects | `admin` | Notification to submitter with reason; `rejected_at` timestamp set |
| `approved` | `archived` | Admin archives | `admin` | No notification |
| `rejected` | `draft` | User revises | `member`, `admin` | Audit log entry |

### Invalid Transitions (must return 409 CONFLICT)
- `approved` → `draft` (cannot revert an approval)
- `archived` → any state (archived is terminal)

### Compensating Actions on Failure
- If notification fails after transition: log the failure, retry up to 3 times; do not roll back the state transition
- If audit log fails: roll back the state transition (audit trail is mandatory)
```

Generate one section per enum type found in the data model. Extract side effects from BRD FR descriptions.

---

#### 5d. Integration Map (`docs/contracts/integration-map.md`)

```markdown
# Integration Map

## [Service Name] — [Provider]

**SDK**: `[npm package or pip package]` version `[version]`
**Abstraction layer**: `[import path]` → `[function name]()`
**Environment variables required**: `[VAR_NAME]`

### Failure Modes and Handling
| Failure | Detection | Response |
|---------|-----------|----------|
| API timeout (>5s) | Catch `TimeoutError` | Retry once after 1s; if still failing, return `ExternalServiceError` |
| Rate limit (429) | HTTP 429 response | Backoff 60s, retry; log `warn` |
| Authentication failure (401) | HTTP 401 response | Log `error`, alert on-call; do not retry |
| Service down (503) | HTTP 503 or connection refused | Return `ExternalServiceError`; queue for retry |

### Test Double Strategy
- **Development**: [mock / sandbox / real dev account]
- **Test**: `[jest.mock('provider-sdk') / pytest fixture / MSW handler]`
- **Staging**: [sandbox account / mock server at `TEST_[SERVICE]_URL`]

[One section per external service from the BRD]
```

---

#### 5e. Error Taxonomy (`docs/contracts/error-taxonomy.md`)

```markdown
# Error Taxonomy

All errors in the system use these named types. No FR may introduce a new error type without adding it here first.

## Error Types

| Code | HTTP Status | Meaning | User-Visible? | Triggers Alert? | Example |
|------|-------------|---------|---------------|-----------------|---------|
| `VALIDATION_ERROR` | 422 | Input fails validation | Yes — field-level details | No | Invalid email format |
| `NOT_FOUND` | 404 | Resource doesn't exist or isn't accessible | Yes — generic message | No | Order not found |
| `UNAUTHORISED` | 403 | Authenticated but lacks permission | Yes — generic message | No | Cannot delete others' orders |
| `AUTH_REQUIRED` | 401 | Not authenticated | Yes — generic message | No | Session expired |
| `CONFLICT` | 409 | State conflict (duplicate, wrong state) | Yes — specific reason | No | Order already submitted |
| `RATE_LIMITED` | 429 | Too many requests | Yes — retry-after header | No | |
| `EXTERNAL_SERVICE_ERROR` | 502 | Upstream dependency failed | Yes — generic message | Yes | Payment gateway timeout |
| `INTERNAL_ERROR` | 500 | Unexpected server error | Yes — generic message | Yes | Unhandled exception |

## Domain-Specific Codes
[Add project-specific codes derived from the BRD's business rules and state machines]

| Code | HTTP Status | Meaning | Triggering FRs |
|------|-------------|---------|----------------|
| `[DOMAIN_SPECIFIC]` | [status] | [description] | [FR-NNN] |

## User-Visible Message Templates
Error messages shown to users must not contain technical details.
- Default 422: "Please check the highlighted fields and try again."
- Default 403: "You don't have permission to perform this action."
- Default 404: "The requested item could not be found."
- Default 500: "Something went wrong. Please try again in a moment."
- Default 502: "This action couldn't be completed right now. Please try again shortly."
```

---

#### 5f. Testing Contract (`docs/contracts/testing-contract.md`)

```markdown
# Testing Contract

## Required Test Types by FR Tier

| FR Tier | Unit Tests | API Integration Tests | State Machine Tests | External Service Tests | E2E (Playwright) |
|---------|-----------|----------------------|--------------------|-----------------------|-----------------|
| Tier 1 (Simple) | Business logic functions | 1 happy path | N/A | N/A | Optional |
| Tier 2 (Moderate) | Business logic + validation | All endpoints, happy + error paths | If FR touches status | Mock with test double | Key user journey |
| Tier 3 (Complex) | All business logic | All endpoints, happy + error + boundary | All transitions | Mock + timeout + retry | Full workflow |

## Coverage Expectation
Every happy path AND every named error path in the Error Taxonomy must have a test.

## Test Data Strategy
**Strategy**: [factory functions / fixtures / seeded DB — from architecture.md]
**Location**: `src/test/factories/` or `tests/factories/`
**Convention**: Each factory produces a complete valid object with sensible defaults. Override specific fields per test.

## Mocking External Services
Use the test doubles specified in `docs/contracts/integration-map.md`.
Never call real external services in unit or integration tests.
Staging environment may use sandbox accounts.

## Test File Location
- Unit tests: adjacent to source file (`orders.test.ts` next to `orders.ts`)
- Integration tests: `tests/integration/[resource].test.ts`
- E2E tests: `e2e/[feature].spec.ts`

## Definition of "Passing"
A PR may not be merged unless:
- All tests pass
- No test was deleted to make other tests pass
- Test coverage on new code does not decrease below [threshold from BRD NFRs or 80%]

## Test Naming Convention
`[unit: describe what the function does] — [scenario]`
Example: `createOrder — throws ConflictError when order already exists`
```

---

#### 5g. Environment Contract (`docs/contracts/environment-contract.md`)

```markdown
# Environment Contract

All environment variables used by the application. Agents must not introduce new env vars not listed here. Add new vars to this file first.

## Required Variables (app will not start without these)

| Variable | Example Value | Description | Used By |
|----------|--------------|-------------|---------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db` | PostgreSQL connection string | All DB operations |
| `JWT_SECRET` | `<32-char random string>` | JWT signing secret | Auth middleware |
| `ALLOWED_ORIGINS` | `https://app.example.com` | Comma-separated CORS origins | CORS middleware |

## Optional Variables (defaults apply if unset)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP server port |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `NODE_ENV` | `development` | Environment name |

## Service-Specific Variables

| Variable | Required In | Description |
|----------|------------|-------------|
| `[SERVICE]_API_KEY` | Production | [Service] API key |

## Local Development Setup

```bash
cp .env.example .env.local
# Fill in values:
# DATABASE_URL: use Cloud SQL proxy or local postgres
# JWT_SECRET: generate with: openssl rand -base64 32
```

## Startup Validation

The application validates all required variables at startup. Missing variables cause:
```
Error: Missing required environment variable: DATABASE_URL
```
Not a silent failure at the first DB call.
```

---

#### 5h. Shared Utilities Inventory (`docs/contracts/shared-utilities.md`)

```markdown
# Shared Utilities Inventory

Functions, schemas, and components that multiple FRs share. Agents must use these rather than recreating them.

## Shared Utility Functions

| Function | Location | Purpose | Used By |
|----------|----------|---------|---------|
| `formatCurrency(amount, currency)` | `src/utils/format.ts` | Format money for display | FR-012, FR-018, FR-024 |
| `formatDate(date, format)` | `src/utils/format.ts` | Format dates consistently | FR-007, FR-012 |
| `slugify(text)` | `src/utils/strings.ts` | Generate URL slugs | FR-003, FR-005 |
| `paginateQuery(query, params)` | `src/utils/pagination.ts` | Standard pagination helper | All list FRs |

## Shared Validation Schemas (Zod/Pydantic)

| Schema | Location | Shape |
|--------|----------|-------|
| `PaginationParams` | `src/schemas/common.ts` | `{ page: number, limit: number }` |
| `UUIDParam` | `src/schemas/common.ts` | `{ id: UUID }` |
| `DateRangeParam` | `src/schemas/common.ts` | `{ from: Date, to: Date }` |

## Shared Middleware

| Middleware | Location | Purpose | Applied To |
|------------|----------|---------|-----------|
| `requireAuth` | `src/lib/auth.ts` | Validate session | All protected routes |
| `requestLogger` | `src/middleware/logger.ts` | Log all requests | All routes |
| `rateLimiter` | `src/middleware/rate-limit.ts` | Rate limiting | Auth + mutation routes |

## Shared UI Components (do not recreate)

| Component | Location | Purpose |
|-----------|----------|---------|
| `DataTable` | `src/components/DataTable.tsx` | Sortable, filterable table |
| `FormField` | `src/components/FormField.tsx` | Input with label, error, help text |
| `Modal` | `src/components/ui/dialog.tsx` | shadcn Dialog wrapper |
| `PageHeader` | `src/components/PageHeader.tsx` | Consistent page title + actions |
| `EmptyState` | `src/components/EmptyState.tsx` | Icon + heading + description + CTA |
| `LoadingSkeleton` | `src/components/LoadingSkeleton.tsx` | Skeleton loading state |
```

---

#### 5i. Dependency Register (`docs/contracts/dependency-register.md`)

```markdown
# Dependency Register

Approved libraries. Agents must not introduce libraries not on this list. To propose a new library, add it here with justification first.

## Approved Libraries

| Concern | Library | Version | Notes |
|---------|---------|---------|-------|
| Validation | `zod` | `^3.22` | TypeScript-first schema validation |
| HTTP client | `ky` OR built-in `fetch` | latest | No axios — native fetch preferred |
| Date handling | `date-fns` | `^3.x` | No moment.js |
| State management | React `useState`/`useReducer` + `zustand` for global | latest | No Redux |
| Form handling | `react-hook-form` | `^7.x` | |
| Testing | `vitest` + `@testing-library/react` | latest | |
| E2E testing | `@playwright/test` | latest | |
| UI components | `shadcn/ui` (Radix primitives) | latest | |
| Styling | Tailwind CSS | `^3.x` | |
| Icons | `lucide-react` | latest | |
| ORM/DB | `drizzle-orm` OR `prisma` | latest | As per architecture.md |

## Explicitly Prohibited Libraries

| Library | Reason | Use Instead |
|---------|--------|-------------|
| `moment.js` | Massive bundle, deprecated | `date-fns` |
| `lodash` | Tree-shaking issues | Native methods or `remeda` |
| `axios` | Unnecessary wrapper | Native `fetch` or `ky` |
| `jquery` | Modern React doesn't need it | React patterns |
| `redux` | Overkill for this scale | `zustand` |

## Adding New Dependencies

Before adding any library not on this list:
1. Add it to this file with justification
2. Verify no existing approved library covers the need
3. Check bundle size impact
4. Document in the PR why this library was added
```

---

#### 5j. NFR Thresholds (`docs/contracts/nfr-thresholds.md`)

Extract concrete numbers from the BRD's Non-Functional Requirements section:

```markdown
# NFR Thresholds

Concrete thresholds that every FR must meet. These are not guidelines — they are requirements.

## Performance
| Metric | Threshold | Measurement |
|--------|-----------|-------------|
| Read endpoint p95 | < 200ms | Production monitoring |
| Write endpoint p95 | < 500ms | Production monitoring |
| Report/aggregation p95 | < 2000ms | Production monitoring |
| Max rows per unpaginated query | 100 | Enforced in DB queries |
| Default page size | 20 | API default |
| Maximum page size | 100 | API maximum |
| Maximum file upload size | 10MB | Validated at upload |

## Availability
| Metric | Threshold |
|--------|-----------|
| Uptime SLA | 99.9% (8.7h downtime/year) |
| Recovery time objective (RTO) | 1 hour |
| Recovery point objective (RPO) | 24 hours |

## Security
| Requirement | Value |
|-------------|-------|
| Session timeout | 24 hours of inactivity |
| Password minimum length | 12 characters |
| Rate limit: auth endpoints | 10 requests/minute per IP |
| Rate limit: mutation endpoints | 60 requests/minute per user |

## Accessibility
| Standard | Level |
|----------|-------|
| WCAG compliance | 2.1 AA |
| Keyboard navigation | Required for all interactive elements |
| Screen reader | Tested with VoiceOver (macOS) and NVDA (Windows) |

## Browser and Device Support
| Category | Target |
|----------|--------|
| Desktop browsers | Chrome 120+, Firefox 120+, Safari 16+, Edge 120+ |
| Mobile browsers | iOS Safari 16+, Chrome Android 120+ |
| Minimum viewport | 375px (iPhone SE) |
| Mobile-first | Yes |

## Data Retention
| Data Type | Retention Period |
|-----------|----------------|
| User data | Until account deletion + 30 days |
| Audit logs | 7 years |
| Session tokens | 24 hours |
```

### Step 3: Validate Contracts Package

```bash
# Validate YAML syntax
python3 -c "import yaml; yaml.safe_load(open('docs/contracts/api-contract.yaml'))" && echo "API contract: valid YAML"

# Validate JSON syntax
python3 -c "import json; json.load(open('docs/contracts/auth-matrix.json'))" && echo "Auth matrix: valid JSON"

# Check all 10 files exist
for f in api-contract.yaml auth-matrix.json state-machines.md integration-map.md error-taxonomy.md testing-contract.md environment-contract.md shared-utilities.md dependency-register.md nfr-thresholds.md; do
  [ -f "docs/contracts/$f" ] && echo "✓ $f" || echo "✗ MISSING: $f"
done

# Check FR coverage: every FR in BRD should appear in api-contract.yaml
rg "^### FR-" docs/brd.md | grep -oP "FR-[0-9]+" | while read fr; do
  grep -q "$fr" docs/contracts/api-contract.yaml && echo "✓ $fr" || echo "⚠ $fr not in API contract"
done
```

### Step 4: Update CLAUDE.md

```markdown
## Contracts Package
Machine-readable behavioural contracts — all agents and reviewers use these:
- docs/contracts/api-contract.yaml        — every endpoint shape
- docs/contracts/auth-matrix.json         — role × resource permissions
- docs/contracts/state-machines.md        — entity state transitions
- docs/contracts/integration-map.md       — external service abstractions
- docs/contracts/error-taxonomy.md        — permitted error types (no others)
- docs/contracts/testing-contract.md      — test requirements per tier
- docs/contracts/environment-contract.md  — all env vars (no others)
- docs/contracts/shared-utilities.md      — shared code (don't recreate)
- docs/contracts/dependency-register.md   — approved libraries (no others)
- docs/contracts/nfr-thresholds.md        — concrete performance/security thresholds
```

## Output

Ten files in `docs/contracts/`:
- `api-contract.yaml` (machine-readable, validated YAML)
- `auth-matrix.json` (machine-readable, validated JSON)
- `state-machines.md`
- `integration-map.md`
- `error-taxonomy.md`
- `testing-contract.md`
- `environment-contract.md`
- `shared-utilities.md`
- `dependency-register.md`
- `nfr-thresholds.md`

Updated `CLAUDE.md`.

## Quality Checklist

- [ ] `api-contract.yaml` is valid YAML with at least one entry per FR
- [ ] `auth-matrix.json` is valid JSON covering all roles × all resources
- [ ] Every entity with a status enum has a state machine definition
- [ ] Every external service from the BRD has an integration map entry with a test double strategy
- [ ] Error taxonomy covers at least the 8 standard types plus project-specific ones
- [ ] NFR thresholds are concrete numbers — not adjectives
- [ ] All env vars the BRD implies are listed in the environment contract
- [ ] CLAUDE.md updated to reference contracts
- [ ] No placeholder text or TBD items in any file
