# Security Guidelines
*Updated: 2026-06-08 · App-level RBAC/ABAC (no Postgres RLS) · India data residency*

Non-negotiable. Every LLD must implement these; `full-review`/`security-review` check every FR against them. Aligns with BRD §4.6/§7 and `docs/architecture.md`.

## Authentication (every endpoint)
- Every endpoint is **protected by default** via the global **`JwtAuthGuard`**, OR explicitly public via **`@Public()`** (only the BRD §8.6 list: `/auth/login|mfa|reset`, `/public/leads`, `/c/{token}/*`, `/los/webhooks/status`). No endpoint is accidentally public.
- Unauthenticated → `AUTH_REQUIRED` (401), generic message (no user enumeration).
- Tokens: short JWT access (15 min) + rotating refresh in **`httpOnly; Secure; SameSite=Strict` cookies — never `localStorage`**. MFA (TOTP/OTP) mandatory for ADMIN/DPO/HEAD/PARTNER. Lockout: 5 fails → 15-min lock.
- Customer micro-site uses opaque token + OTP step-up (`CustomerLinkGuard`), never a JWT.

## Authorisation (every resource operation — ABAC)
- Use **`AbacGuard` + `@Requires(capability, scopeResolver)` → `EntitlementService.can(user, action, resource)`** — the single decision point. Authorisation = role permission ∩ data scope ∩ attributes (branch/team/region/product/source/partner/classification), per `docs/contracts/auth-matrix.json`.
- **Scope every data query**: lead-data reads/writes are filtered by `org_id` **and** the caller's scope (RM=own `owner_id`, SM=team, BM=branch, HEAD=all, PARTNER=own `partner_id`, DPO=masked). Never return rows outside the caller's scope — no exceptions.
- Existence-hiding: out-of-scope resource → `FORBIDDEN` (403) for resources the user could know exist; `NOT_FOUND` (404) where the BRD §8.4 hides existence (e.g. cross-partner). Follow the §8.4 mapping.
- **Break-glass** (FR-003) is the *only* way ADMIN/DPO reach lead content: time-bound, four-eyes-approved, reason-bound, every access audited.

## Input validation
- **Zod** schema on every API DTO / webhook / form / env var. Validation runs at the controller boundary before the service sees data.
- Mobile `^[6-9]\d{9}$`, PAN/GSTIN/pin formats, enum membership (from `@shared/enums`). Reject unknown fields.
- File uploads: validate **MIME by content inspection** (not extension), enforce max size (configurable, default 10 MB), allowed types PDF/JPG/PNG/HEIC.

## Output & data protection
- **Masking interceptor** applies role-based masking on serialization: PAN→`ABCxxxx1F`, mobile→`98xxxxxx10`, Aadhaar→last-4-of-token only. Exports apply the **strictest** masking for the actor's scope.
- Never return stack traces, internal IDs beyond what the client needs, SQL, or raw DB errors.
- **Raw Aadhaar number and biometrics are never stored** (only tokenised refs). LMS never requests phone contacts, call logs, SMS inbox, or unrelated device resources (FR-111).

## Secrets & logging
- Secrets only from **Secret Manager** (env at deploy). Never in source, git, Dockerfiles, or logs.
- **Never log** `password`, `token`, `refresh_token`, `otp`, `secret`, or PII fields: `name`, `mobile`, `email`, `pan_token`, `pan_masked`, `aadhaar_ref_token`, `ckyc_id`, `gstin`, `dob`, `address`, `ip_device`, document contents — even at debug.
- `audit_logs.detail` and `event_outbox.payload` are **masked** — no raw PII values in the audit chain or event stream.

## SQL injection prevention
- **Parameterised queries only** (Kysely). String-interpolated SQL is forbidden: `db.executeQuery(`… ${id}`)` ✗. Use Kysely builders / parameter bindings.
- No `eval`, `Function()`, or shell exec with user input. No `dangerouslySetInnerHTML` without DOMPurify.

## Consent & compliance gates
- No customer-facing message (SMS/WhatsApp/email) is sent without a valid `consent_basis` and an opted-in `NotificationPreference` (FR-101/103/110). Marketing requires separate opt-in from transactional.
- A lead cannot advance past a stage whose required `consent_purpose` is not `granted` (§10.3, §5.6.8).

## Rate limiting (Redis-backed)
- Auth/OTP/password-reset: **10/min per IP**. Public capture (`/public/leads`) & customer-link endpoints: tightened + **captcha** + per-IP. Mutations: **60/min per user**. Reads: **300/min per user**. Over limit → `RATE_LIMITED` (429).

## CORS & transport
- Origins from `ALLOWED_ORIGINS` (comma-separated); `credentials: true` (cookie auth). **Never `origin: '*'` with credentials.** TLS everywhere; encryption at rest; field-level tokenisation for sensitive identifiers.

## Audit integrity
- `audit_logs`, `consent_records`, `stage_history` are **append-only** (REVOKE UPDATE/DELETE from the app role). The hash chain (`prev_audit_hash`) is written by the **single-writer `AuditChainConsumer`** only — app instances never append to the chain concurrently.

## Dependencies
- Use only libraries in `docs/contracts/dependency-register.md` (Stage 5). No new runtime dependency without registering it.

## What must never be in a PR
Hardcoded secrets/keys · disabled auth "for testing" · raw/interpolated SQL · `origin:'*'` with credentials · `console.log` of PII/tokens · raw Aadhaar storage · an endpoint without `JwtAuthGuard` or an explicit `@Public()` · a lead-data query without scope filtering · Postgres RLS policies (auth is app-level by design).
