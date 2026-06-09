# Error Taxonomy
*Authoritative. Derived from BRD §8.4. No FR or agent may introduce a code not listed here.*

All errors use the uniform envelope (architecture §4): `{ "data": null, "meta": { "correlation_id": "…" }, "error": { "code", "message", "retryable", "fields"?, "detail"? } }`.
**This catalog supersedes the generator's generic defaults** — `VALIDATION_ERROR` is **400** (not 422); 403 is **FORBIDDEN** (not UNAUTHORISED); upstream failures are **UPSTREAM_UNAVAILABLE** (503, not EXTERNAL_SERVICE_ERROR 502).

## Primary codes (BRD §8.4)

| Code | HTTP | Meaning | User-visible? | Alert? | retryable | User-message template |
|---|---|---|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Field/payload invalid (carries `fields[]`) | Yes (field-level) | No | false | "Please correct the highlighted fields." |
| `AUTH_REQUIRED` | 401 | Missing/invalid/expired auth | Yes (generic) | No | false | "Please sign in to continue." |
| `FORBIDDEN` | 403 | Authenticated but not permitted / out of scope | Yes (generic) | No | false | "You don't have access to this." |
| `NOT_FOUND` | 404 | Resource absent or existence hidden | Yes (generic) | No | false | "We couldn't find that item." |
| `CONFLICT` | 409 | Duplicate / optimistic-lock / illegal state | Yes (specific) | No | false | "This action conflicts with the current state. Refresh and retry." |
| `PAYLOAD_TOO_LARGE` | 413 | File/import exceeds limit | Yes | No | false | "File is too large." |
| `UNSUPPORTED_MEDIA` | 415 | Disallowed file type | Yes | No | false | "Unsupported file type." |
| `RATE_LIMITED` | 429 | Too many requests (sets `Retry-After`) | Yes | No | false | "Too many attempts. Please wait and try again." |
| `INTERNAL_ERROR` | 500 | Unhandled server error (no stack leaked) | Yes (generic) | **Yes** | false | "Something went wrong. We're on it." |
| `UPSTREAM_UNAVAILABLE` | 503 | External provider/LOS down or timed out | Yes (generic) | **Yes** | true | "A service is temporarily unavailable. We'll retry." |

## Domain sub-reasons
Carried in `error.detail.reason` with the **parent HTTP status** above; do not create new top-level codes for these.

| Sub-reason | HTTP (parent) | Meaning | Triggering FRs |
|---|---|---|---|
| `DUPLICATE_BLOCKED` | 409 (`CONFLICT`) | Strong duplicate blocks creation/hand-off | FR-010, FR-020, FR-081 |
| `STAGE_GUARD_FAILED` | 400 (`VALIDATION_ERROR`) | §10.3 transition guard not satisfied (lists `failed_guards`) | FR-052, FR-081 |
| `CONSENT_MISSING` | 403 (`FORBIDDEN`) | Required `consent_purpose` not granted | FR-101, FR-110, FR-080/081 |
| `KYC_EXCEPTION_OPEN` | 409 (`CONFLICT`) | Open KYC exception blocks hand-off | FR-072, FR-081 |
| `IDEMPOTENT_REPLAY` | 200 (original result) | Replayed `Idempotency-Key` returns the original response (no duplicate) | FR-010, FR-081, FR-140 |
| `EXPORT_APPROVAL_REQUIRED` | 409 (`CONFLICT`) | Export exceeds threshold / unmasked PII — needs approval | FR-122 |
| `LEGAL_HOLD` | 409 (`CONFLICT`) | Retention/erasure blocked by legal hold or open request | FR-112, FR-115 |

## Handling rules
- **Unhandled errors** → global Nest exception filter → `INTERNAL_ERROR` (500), full error logged with `correlation_id`, **no stack/SQL/path in the response**.
- **External/provider** failures (LOS/KYC/comms via IntegrationGateway) → `UPSTREAM_UNAVAILABLE` (503), queued for retry (Cloud Tasks), circuit-breaker on repeated failure.
- **Optimistic-lock** stale write (`leads.version`) → `CONFLICT` (409) → UX refresh-and-retry.
- `INTERNAL_ERROR` and `UPSTREAM_UNAVAILABLE` raise Cloud Monitoring alerts; the rest do not.
- Every code above must have a test (see `testing-contract.md`).
