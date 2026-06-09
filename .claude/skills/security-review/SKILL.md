---
name: security-review
description: End-to-end security and compliance review covering authentication, authorization, injection prevention, data privacy, secrets management, audit trails, dependency vulnerabilities, and OWASP compliance. Produces a prioritized remediation plan with a security-readiness verdict.
argument-hint: "[target] [phase]"
---

# Security & Compliance Review

Perform an end-to-end security and compliance review and produce a prioritized, actionable remediation plan with a security-readiness verdict.

## Scoping

If the user specifies a target (example: `/security-review apps/api`), review only that app or package. Otherwise review the full codebase.

If the user specifies a phase (example: `/security-review authn only`), run only that section.
Valid phase keywords: `preflight`, `discover`, `authn`, `authz`, `input`, `data`, `secrets`, `audit`, `deps`, `network`, `container`, `compliance`, `gates`, `bugs`, `backlog`, `quickwins`.

If target includes `/`, generate a safe output slug: replace `/` with `-`, remove spaces.

## Operating Rules

- Evidence-first: cite exact files and line numbers.
- Separate `confirmed` evidence from `inferred` conclusions.
- Never claim a check passed unless you ran or inspected it.
- If evidence is missing, state the gap and how to obtain it.
- Every recommendation must include: `what`, `where`, `how`, and `verify`.
- Prefer small, reversible fixes; propose phased migration for larger remediations.
- Recommend one default path when options exist; give short rationale.
- Prioritize: Authentication bypass -> Authorization bypass -> Data exposure -> Injection -> Configuration -> Hardening.
- Save final report to `docs/reviews/security-review-{targetSlug}-{YYYY-MM-DD}.md`.

## Quality Bar (Definition of Done)

The review is complete only when all are present:

- Attack surface map with entry points and trust boundaries.
- Findings for all requested categories with evidence.
- Every finding has severity, confidence, and verification steps.
- Compliance checklist against applicable standards.
- QA gate scorecard with `PASS` / `PARTIAL` / `FAIL`.
- Security verdict (`SECURE` / `AT-RISK` / `CRITICAL`) with blocking issues listed.
- Prioritized remediation backlog and quick-win plan.

## Severity, Confidence, and Risk

Use these fields for every finding:

- `Severity`: `P0` (critical — active exploit risk), `P1` (high — fix this sprint), `P2` (medium — next sprint), `P3` (low — hardening)
- `Confidence`: `High` (direct evidence), `Medium` (strong inference), `Low` (hypothesis)
- `Status`: `Confirmed`, `Partially Confirmed`, `Unverified`

Risk scoring:

`Risk Score = Impact (1-5) x Likelihood (1-5)`

Risk Score to severity mapping: `16-25 = P0`, `9-15 = P1`, `4-8 = P2`, `1-3 = P3`.

---

### False-Positive Triage

When a search pattern matches a non-vulnerable usage, mark it `FP` with a one-line justification. Common false positives:

- `password` in schema/type definitions (not hardcoded secrets)
- `eval(` in comments or documentation
- `exec(` in ORM/DB driver internals inside `node_modules`
- Template literal SQL that is actually parameterized via tagged template (e.g., `sql\`SELECT ... WHERE id = ${id}\``)
- Token validation code (reading tokens, not hardcoding them)

When a finding requires tracing through multiple files (e.g., user input → handler → service → query), document the **call stack** showing data flow: `file1.ts:line → file2.ts:line → file3.ts:line (sink)`.

### Phase Ordering

Phases MUST run in numerical order (0 → 16). Earlier phases establish context that later phases depend on (e.g., Phase 1 attack surface informs Phase 4 injection analysis). Skipping phases is only permitted when the user explicitly requests a single phase via the `phase` argument.

## Phase 0: Preflight

Before deep analysis, capture:

- Scope, assumptions, and explicit exclusions.
- Current commit hash and branch.
- Tech stack discovery: frameworks, languages, databases, auth libraries, ORM/query layer.
- Available security-related scripts (audit, lint, SAST, DAST).
- Environment constraints (missing secrets, unavailable services, tooling limits).
- Applicable compliance frameworks (identify from project docs, domain, or user input).

Output a preflight block so readers understand confidence boundaries.

## Phase 1: Attack Surface Discovery

Scan and document:

- All entry points: HTTP routes, WebSocket handlers, GraphQL resolvers, CLI commands, cron jobs, queue consumers.
- Authentication boundaries: which endpoints are public vs protected.
- Trust boundaries: user input, inter-service calls, third-party integrations, file uploads.
- Data stores: databases, caches, file storage, external APIs.
- Privileged operations: admin routes, bulk operations, data exports, deletion endpoints.
- Deployment surface: exposed ports, public URLs, cloud service endpoints.

Include a trust-boundary diagram (Mermaid or text) showing data flow and trust transitions.

## Phase 2: Authentication (AuthN)

### A) Authentication Mechanism

- Identify auth strategy (JWT, session, OAuth, API key, mTLS, etc.).
- Token generation: sufficient entropy, secure signing algorithm (RS256/ES256 preferred over HS256 for multi-service).
- Token storage: httpOnly + secure + sameSite cookies preferred; no localStorage for auth tokens.
- Token lifetime: access token short-lived (15-60 min), refresh token with rotation.
- Session invalidation: logout actually invalidates server-side (not just client-side token deletion).

### B) Credential Handling

- Password hashing: bcrypt/scrypt/argon2 with appropriate cost factor (not MD5/SHA).
- No plaintext passwords in logs, error messages, or API responses.
- Brute-force protection: rate limiting on login, account lockout or exponential backoff.
- Password reset flow: time-limited tokens, single-use, no password in URL/email body.

### C) Multi-factor and Elevated Auth

- MFA support where required by compliance or risk profile.
- Step-up authentication for sensitive operations (password change, role escalation, data export).
- Session binding: tokens tied to device/IP where appropriate.

### D) Auth Middleware Consistency

- Every protected route passes through auth middleware (no gaps).
- Auth middleware is applied at the router/framework level, not per-handler.
- Failed auth returns consistent error format (no information leakage about user existence).

## Phase 3: Authorization (AuthZ)

### A) Access Control Model

- Identify model: RBAC, ABAC, ACL, or hybrid.
- Roles/permissions are server-defined (not trusting client-supplied roles).
- Role hierarchy and permission inheritance is explicit and documented.

### B) Route-Level Enforcement

- Every mutation endpoint has authorization checks.
- Read endpoints filter data by user scope (tenant, org, jurisdiction, ownership).
- No endpoints that return all records without scope filtering.
- Admin/superuser routes have explicit role gates.

### C) Resource-Level Authorization

- Object-level access checks: user can only access resources they own or are authorized for.
- No IDOR (Insecure Direct Object Reference): sequential IDs with authorization, or use UUIDs.
- Bulk operations enforce per-item authorization (not just top-level check).
- File/attachment access respects the same auth rules as the parent resource.

### D) Privilege Escalation Prevention

- Role assignment/modification requires admin authorization.
- Users cannot modify their own role or permissions.
- API does not expose role-change endpoints without proper gates.
- Token refresh does not silently escalate privileges.

## Phase 4: Input Validation and Injection Prevention

### A) SQL Injection

- All database queries use parameterized queries or ORM methods (no string concatenation).
- Raw SQL usage is audited: search for raw query patterns and verify parameterization.
- Dynamic table/column names are validated against allowlists (not user-supplied).

### B) Cross-Site Scripting (XSS)

- Framework auto-escaping is enabled and not bypassed (no `dangerouslySetInnerHTML`, `v-html`, `|safe` without sanitization).
- User-generated content rendered in HTML is sanitized (DOMPurify or equivalent).
- Content-Security-Policy header is set and restrictive.
- JSON responses use `application/json` content type (not `text/html`).

### C) Command Injection

- No `exec()`, `spawn()`, `system()`, `eval()` with user-supplied input.
- If shell commands are necessary, use allowlisted commands with parameterized arguments.
- File paths constructed from user input are validated and sandboxed.

### D) Server-Side Request Forgery (SSRF)

- URLs from user input are validated against allowlists.
- Internal/private IP ranges are blocked for outbound requests.
- Redirect following is disabled or limited for server-side HTTP calls.

### E) Schema Validation

- All API inputs validated against schemas (Zod, Joi, JSON Schema, etc.) before processing.
- Validation happens server-side (client-side validation is UX only, not security).
- File uploads validated: type, size, content inspection (not just extension).
- Reject unexpected fields (strict schemas, no `additionalProperties: true` by default).

### F) Path Traversal

- File paths sanitized: no `../` traversal.
- Upload destinations use generated filenames (not user-supplied).
- Static file serving restricted to intended directories.

### G) Business Logic and Race Conditions

- State machine transitions enforce guards (no skipping states via direct API calls).
- Time-of-check/time-of-use (TOCTOU) vulnerabilities: check and action must be atomic (e.g., use DB transactions for check-then-update).
- Workflow state transitions protected by optimistic concurrency (row version / etag).
- Payment or approval flows cannot be bypassed by replaying or reordering API calls.
- Concurrent operations on the same resource are handled safely (e.g., two officers approving the same task simultaneously).

## Phase 5: Data Protection and Privacy

### A) Sensitive Data Identification

- Inventory PII fields: names, emails, phone numbers, addresses, government IDs, biometrics, financial data.
- Classify data sensitivity levels across the schema.
- Identify regulated data subject to specific compliance requirements.

### B) Encryption

- Data in transit: TLS enforced (HSTS, no mixed content, certificate validation).
- Data at rest: database-level or field-level encryption for sensitive columns.
- Encryption keys managed properly (not hardcoded, rotatable, separate from data).

### C) Data Minimization and Access

- API responses return only necessary fields (no over-fetching of sensitive data).
- PII is masked/redacted in logs, error messages, and non-privileged API responses.
- Sensitive fields (SSN, passwords, tokens) are never included in GET query parameters.
- Audit-relevant data (who accessed what PII) is logged.

### D) Data Retention and Deletion

- Retention policies defined and enforced (soft-delete vs hard-delete).
- Deletion cascades correctly (no orphaned PII in related tables).
- Backup/archive data subject to same retention rules.
- Right-to-erasure capability if applicable.

### E) Data Integrity

- Critical records (audit logs, evidence, transactions) are append-only or immutable.
- Hash/checksum verification for evidence files or integrity-critical data.
- Chain-of-custody tracking for items that change hands (evidence, case files, assets).
- Tampering detection: audit logs cannot be silently modified or deleted.

## Phase 6: Secrets Management

### A) Secret Detection

Search entire codebase for:

- Hardcoded API keys, tokens, passwords, connection strings.
- Secrets in environment files committed to git.
- Secrets in Dockerfiles, CI configs, or infrastructure-as-code.
- Private keys or certificates in the repository.
- Base64-encoded secrets (decode and verify).

### B) Secret Storage

- Production secrets stored in a secrets manager (not environment files or config files).
- Development secrets in `.env` files excluded from git (`.gitignore`).
- `.env.example` files contain placeholder values only (not real secrets).
- No secrets passed as build arguments that persist in image layers.

### C) Secret Rotation

- Secrets are rotatable without code deployment.
- Database credentials, API keys, and signing keys have rotation procedures.
- No hardcoded references that would break on rotation.

## Phase 7: Audit Trail and Logging

### A) Audit Completeness

- All authentication events logged (login, logout, failed attempts, token refresh).
- All authorization decisions logged (access granted/denied, with context).
- All data mutations logged (create, update, delete — who, what, when).
- All sensitive data access logged (PII views, exports, downloads).
- All administrative actions logged (role changes, config changes, user management).

### B) Audit Integrity

- Audit logs are append-only (no update/delete capability through the application).
- Log entries include: timestamp, actor ID, action, resource, outcome, IP/session context.
- Structured logging format (JSON) for machine parsability.
- Correlation IDs link related events across services.

### C) Log Safety

- No sensitive data in logs: passwords, tokens, PII, full credit card numbers.
- Log levels appropriate: security events at WARN/ERROR, not DEBUG-only.
- Log retention sufficient for compliance and incident investigation.
- Logs shipped to centralized, tamper-resistant storage in production.

### D) Monitoring and Alerting

- Failed authentication spike detection.
- Authorization violation alerting.
- Anomalous data access pattern detection (bulk exports, unusual hours).
- Health and availability monitoring for auth services.

## Phase 8: Dependency Security

### A) Known Vulnerabilities

Run and analyze:

```bash
# Node.js
npm audit --production
npm audit --production --audit-level=high

# Python
pip-audit || safety check

# General
# Check for CVE databases against manifest files
```

- Flag: critical and high severity CVEs in production dependencies.
- Identify: dependencies with no recent maintenance (abandoned packages).
- Verify: lockfile is committed and `npm ci` (or equivalent) is used in CI/builds.

### B) Supply Chain Risks

- Dependencies pinned to exact versions or lockfile (no floating ranges for critical packages).
- CI/CD actions pinned to SHA (not floating tags like `@latest` or `@v3`).
- No `postinstall` scripts that download or execute remote code.
- Package source is verified (official registry, no typosquatting risk).

### C) Transitive Dependencies

- Audit transitive dependency tree for known vulnerabilities.
- Identify deeply nested dependencies with security implications.
- Flag deprecated packages that may stop receiving security patches.

## Phase 9: Network and Transport Security

### A) TLS and Encryption in Transit

- All external communication over HTTPS/TLS.
- TLS version 1.2+ enforced (no SSLv3, TLS 1.0/1.1).
- Certificate validation not disabled in production code.
- HSTS header set with appropriate max-age.

### B) CORS Configuration

- Allowed origins are specific (not `*` in production).
- Credentials mode is restrictive.
- Preflight caching is configured.
- CORS is applied to all endpoints (not just some).
- **ALLOWED_ORIGINS env var validation** (P0):
  - CORS middleware MUST read allowed origins from an environment variable (e.g., `ALLOWED_ORIGINS`), not hardcoded values.
  - Verify the env var is listed in `.env.example` and deployment configs (Cloud Run, docker-compose, Kubernetes).
  - If the app has multiple frontend consumers (e.g., RM, Ops, Portal), verify ALL consumer origins are included.
  - Check for startup validation: the app should fail fast with a clear error if `ALLOWED_ORIGINS` is empty/unset in production (`NODE_ENV=production`).
  ```bash
  # Verify CORS reads from env var
  rg -n "ALLOWED_ORIGINS|allowedOrigins|corsOrigins" --glob '*.{ts,js}' server/ src/
  # Verify startup validation exists
  rg -n "ALLOWED_ORIGINS.*must|ALLOWED_ORIGINS.*required|throw.*ALLOWED_ORIGINS" --glob '*.{ts,js}' server/ src/
  # Check all frontend URLs are documented for deployment
  rg -n "ALLOWED_ORIGINS" .env.example docker-compose*.yml cloudbuild*.yaml 2>/dev/null
  ```
- **Cross-origin cookie attributes**: If auth uses cookies across origins, verify `SameSite`, `Secure`, and `Domain` attributes are correct. Prefer same-origin via reverse proxy over `SameSite=None`.

### C) API Security Headers

Verify presence of:

- `Content-Security-Policy` (restrictive).
- `X-Content-Type-Options: nosniff`.
- `X-Frame-Options: DENY` or `SAMEORIGIN`.
- `Referrer-Policy: strict-origin-when-cross-origin` or stricter.
- `Permissions-Policy` (restrict camera, microphone, geolocation).
- `Cache-Control: no-store` for sensitive responses.

### D) Rate Limiting and Abuse Prevention

- Rate limiting on authentication endpoints.
- Rate limiting on API endpoints (per-user or per-IP).
- Request size limits configured.
- Slowloris/connection exhaustion protection (timeouts configured).

## Phase 10: Container and Runtime Security

### A) Container Hardening

- Non-root user in Dockerfiles (numeric UID, not root).
- Minimal base images (alpine or distroless).
- No unnecessary tools (curl, wget, shell) in production images.
- Read-only filesystem where possible.
- No privileged mode or elevated capabilities.

### B) Runtime Configuration

- Debug mode disabled in production.
- Stack traces not exposed to clients in production error responses.
- Admin/debug endpoints disabled or auth-gated in production.
- Unnecessary services/ports not exposed.

### C) Supply Chain (Build Pipeline)

- Build pipeline uses trusted base images (pinned versions, not `latest`).
- No secrets in image layers (multi-stage builds, no `ENV SECRET=...`).
- Image scanning in CI (Trivy, Snyk, etc.) if available.
- Signed images or content trust if applicable.

## Phase 11: Compliance Assessment

### A) Standards Checklist

Based on discovered domain and applicable frameworks, assess against relevant standards. Common frameworks:

**OWASP Top 10:**

| # | Risk | Status | Evidence | Gap |
|---|------|--------|----------|-----|
| A01 | Broken Access Control | | | |
| A02 | Cryptographic Failures | | | |
| A03 | Injection | | | |
| A04 | Insecure Design | | | |
| A05 | Security Misconfiguration | | | |
| A06 | Vulnerable Components | | | |
| A07 | Auth Failures | | | |
| A08 | Software/Data Integrity | | | |
| A09 | Logging/Monitoring Failures | | | |
| A10 | SSRF | | | |

**Data Protection (if PII is handled):**

- Data classification scheme exists.
- Consent/legal basis for data processing documented.
- Data subject rights supported (access, rectification, erasure).
- Data breach notification procedures defined.
- Cross-border data transfer controls if applicable.

**Domain-Specific Compliance:**

- If requirements documents exist (BRD, SRS, etc.), map security controls to requirements.
- Identify regulatory requirements from project context (healthcare, financial, law enforcement, etc.).
- Flag unmet compliance obligations.

### B) Requirements Traceability

If requirements documents are available, produce a mapping:

| Requirement ID | Security Requirement | Evidence | Status | Gap | Next Step |
|----------------|---------------------|----------|--------|-----|-----------|

## Phase 12: QA Gates and Security Verdict

Assess each gate as `PASS`, `PARTIAL`, `FAIL`.

Blocking gates:

1. **Authentication integrity** — All protected routes behind auth; no bypass paths.
2. **Authorization enforcement** — RBAC/scope checks on every mutation and data read.
3. **Injection prevention** — Parameterized queries; input validation on all endpoints.
4. **Secret safety** — No secrets in code, config, or image layers.
5. **Data protection** — PII encrypted/masked; sensitive data not in logs or URLs.
6. **Audit trail** — Security-relevant events logged with actor, action, outcome.
7. **Dependency safety** — No critical/high CVEs in production dependencies.
8. **Transport security** — TLS enforced; security headers present.

Non-blocking gates:

1. **Container hardening** — Non-root, minimal image, read-only FS.
2. **Rate limiting** — Abuse prevention on auth and API endpoints.
3. **Monitoring and alerting** — Security event detection and notification.
4. **Compliance coverage** — Applicable standards assessed and mapped.

Verdict policy:

- Any blocking gate `FAIL` => `CRITICAL`.
- Blocking gates all `PASS` or `PARTIAL` with no `FAIL` and 2+ `PARTIAL` => `AT-RISK`.
- Blocking gates all `PASS` with at most 1 `PARTIAL` => `SECURE`.

Verdict block:

```text
AuthN Status:         [PASS | PARTIAL | FAIL]
AuthZ Status:         [PASS | PARTIAL | FAIL]
Injection Status:     [PASS | PARTIAL | FAIL]
Data Protection:      [PASS | PARTIAL | FAIL]
Blocking Gates:       X/8 PASS, Y/8 PARTIAL, Z/8 FAIL
Non-Blocking Gates:   X/4 PASS, Y/4 PARTIAL, Z/4 FAIL
Security Verdict:     [SECURE | AT-RISK | CRITICAL]
```

## Phase 13: Bugs and Foot-Guns

Minimum counts:

- Full-repo review: `10+` P0/P1 and `10+` P2 findings.
- Scoped review: `5+` P0/P1 and `5+` P2 findings.

Each finding must include:

- Severity, confidence, and status.
- Exact file:line evidence.
- Security impact statement (what an attacker could exploit).
- Specific fix with code-level guidance.
- Verification steps.

## Phase 14: Remediation Backlog

Backlog size:

- Full-repo: `25-50` items.
- Scoped: `10-25` items.

| ID | Title | Priority | Risk Score | Effort | Category | Where | Threat | Fix | Verify | Dependencies |
|----|-------|----------|------------|--------|----------|-------|--------|-----|--------|--------------|

Priority:

- `P0`: critical — active exploit risk, fix immediately.
- `P1`: high — fix this sprint.
- `P2`: medium — next sprint.
- `P3`: low — hardening.

Effort:

- `S`: under 2 hours.
- `M`: 2 hours to 2 days.
- `L`: more than 2 days.

## Phase 15: Quick Wins and Stabilization

- Quick wins (2 hours): `5-10` fixes with immediate security improvement.
- 2-day stabilization: `8-15` fixes that materially reduce attack surface.

Each task must include exact file targets and verification steps.

### Common Security Fix Patterns

| Finding | Fix Pattern |
|---------|-------------|
| SQL injection (`query("... " + input)`) | Use parameterized query: `query("... $1", [input])` |
| Missing auth on route | Add auth middleware: `{ preHandler: [requireAuth] }` |
| Secret in source code | Move to `.env`, add to `.gitignore`, rotate the exposed secret |
| `dangerouslySetInnerHTML` | Use DOMPurify: `dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}` |
| Missing CORS origin restriction | Set specific origins: `origin: ["https://app.example.com"]` |
| Password in logs | Redact: `logger.info({ ...req.body, password: "[REDACTED]" })` |
| Missing rate limiting | Add `@fastify/rate-limit` with `max: 100, timeWindow: "1 minute"` |
| JWT in localStorage | Move to httpOnly cookie with `secure: true, sameSite: "strict"` |

## Phase 15.1: Impact/Likelihood Calibration

When scoring Risk = Impact x Likelihood, use these calibration examples:

| Impact | Score | Example |
|--------|-------|---------|
| Catastrophic | 5 | Full database dump, admin account takeover, PII mass exposure |
| Major | 4 | Single user account takeover, unauthorized data modification |
| Moderate | 3 | Information disclosure (non-PII), privilege escalation to read-only |
| Minor | 2 | Denial of service on non-critical endpoint, verbose error messages |
| Negligible | 1 | Security header missing, cosmetic cookie attribute |

| Likelihood | Score | Example |
|------------|-------|---------|
| Almost certain | 5 | Public endpoint, no authentication, trivial exploit |
| Likely | 4 | Authenticated endpoint, but common attack pattern (SQLi in search) |
| Possible | 3 | Requires specific conditions (race condition, unusual input format) |
| Unlikely | 2 | Requires insider access or chained exploits |
| Rare | 1 | Requires physical access or highly specific timing |

## Phase 16: Verification Commands

Adapt commands to the discovered tech stack. Examples:

```bash
# Secret scanning (targeted patterns to reduce noise)
rg -n "(password|secret|api[_-]?key|private[_-]?key)\s*[:=]" --glob '!*.lock' --glob '!node_modules' -i
# Broader sweep for hardcoded credentials
rg -n "password\s*[:=]\s*['\"][^'\"]+['\"]" --glob '*.{ts,js,py,json}' --glob '!*.lock'
rg -n "BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY" .
rg -n "AKIA[A-Z0-9]{16}" .  # AWS access keys

# Auth middleware gaps
rg -n "app\.(get|post|put|patch|delete)\(" --glob '*.ts' --glob '*.js' -C 2
rg -n "router\.(get|post|put|patch|delete)\(" --glob '*.ts' --glob '*.js' -C 2

# Injection risks
rg -n "\.query\(.*\$\{|\.query\(.*\+" --glob '*.ts' --glob '*.js'
rg -n "exec\(|spawn\(|eval\(" --glob '*.ts' --glob '*.js' --glob '*.py'
rg -n "dangerouslySetInnerHTML|v-html|\|safe" --glob '*.tsx' --glob '*.jsx' --glob '*.vue'

# CORS and headers
rg -n "cors|Access-Control-Allow-Origin" --glob '*.ts' --glob '*.js' --glob '*.conf' -C 3
rg -n "helmet|security.*header" --glob '*.ts' --glob '*.js'

# Sensitive data in logs
rg -n "console\.log|logger\.(info|debug|warn|error)" --glob '*.ts' --glob '*.js' -C 2

# Dependency audit
npm audit --production 2>/dev/null || pip-audit 2>/dev/null || echo "No supported package manager audit found"

# Docker security
rg -n "^USER|^EXPOSE|ENV.*SECRET|ENV.*PASSWORD|ENV.*KEY" Dockerfile*
rg -n "privileged|cap_add" docker-compose*.yml
```

Record each command as `Executed` or `Not Executed` with reason.

## Output

Final report sections in order:

1. Scope and Preflight
2. Attack Surface Map
3. Authentication Findings
4. Authorization Findings
5. Input Validation Findings
6. Data Protection Findings
7. Secrets Management Findings
8. Audit Trail Findings
9. Dependency Security Findings
10. Network and Transport Findings
11. Container and Runtime Findings
12. Compliance Assessment
13. QA Gates and Verdict
14. Bugs and Foot-Guns
15. Remediation Backlog
16. Quick Wins and Stabilization
17. Top 5 Priorities

If `docs/reviews/` does not exist, create it before writing the report.
