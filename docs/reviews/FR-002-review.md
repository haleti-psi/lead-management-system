# FR-002 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-002 ABAC implementation is architecturally sound and correct on the critical dimensions: deny-by-default evaluation, correct error taxonomy codes, parameterised Kysely queries with LIMITS, no `any` types, no console.*, audit failures handled via structured logger without swallowing, and all required unit test groups (A–D) present with full spec coverage. Three minor spec deviations are found in the MaskedField UI component: (1) a plain `<button>` is used instead of the shadcn `Button` primitive specified by the LLD, (2) `aria-label` format differs from the LLD spec, and (3) error feedback uses an inline alert instead of the Toast specified by the LLD. Additionally, the `catch` block in MaskedField discards the underlying error message, so the LLD's "Toast with error.message" behaviour is not achievable even if the toast mechanism were wired in. These require fixes before the shared component is consumed by display FRs.

## Findings

### MINOR — `apps/web/src/components/ui/MaskedField.tsx:77`

The aria-label on the masked value span is `masked ${label}` (e.g. 'masked PAN') but the LLD §UI Component Tree specifies `aria-label={fieldType}` (i.e. the raw type string 'pan'/'mobile'/'aadhaar'). The test D-01 was written to match the implementation, not the spec. This divergence from the LLD will cause breakage if consuming FRs or Playwright tests query by the spec-defined label.

**Fix:** Align aria-label to the LLD: use `aria-label={fieldType}` (e.g. 'pan', 'mobile', 'aadhaar') or update the LLD to canonicalize the `masked <LABEL>` form and propagate to all affected test assertions.

### MINOR — `apps/web/src/components/ui/MaskedField.tsx:79-95`

LLD §UI Component Tree specifies shadcn/ui `Button` (variant='ghost') for the Reveal control. The implementation uses a plain `<button>` element with a className string, not the shadcn primitive. This is inconsistent with the LLD's stated UI contract and `docs/guidelines/ui.md` which mandates shadcn primitives.

**Fix:** Replace the `<button>` element with shadcn's `Button` component (`import { Button } from '@/components/ui/button'`) with `variant='ghost'`, preserving the existing `aria-label`, `disabled`, and `onClick` props.

### MINOR — `apps/web/src/components/ui/MaskedField.tsx:67-70`

The `catch {}` block discards the thrown error entirely, then shows a hardcoded generic string. The LLD specifies 'Toast with error.message', implying the actual error message from the API (e.g. the taxonomy `error.message` field) should surface. The current implementation can never show the server error message, and using inline `<span role=alert>` rather than a Toast diverges from the spec.

**Fix:** Change the catch to `catch (err) { setError(err instanceof Error ? err.message : "Couldn't reveal this value."); }` to honour the LLD's 'error.message' intent. Separately, wire the error display through the project's Toast component (shadcn `useToast` or equivalent) rather than an inline alert span, matching the spec's prescribed affordance.


## Test coverage

All required test groups are present and cover the spec scenarios. Group A (EntitlementService unit tests, A-01..A-15): all 15 scenarios implemented in entitlement.service.spec.ts, including happy paths for scopes O/B/T/M/P, all deny reasons (SUSPENDED_USER/NO_CAPABILITY/OUT_OF_SCOPE/ADMIN_LEAD_BLOCKED/PARTNER_CROSS_ACCESS), and extra edge-case tests for branch-scoped break-glass and ADMIN's legitimate org-wide capabilities. A-14 (unknown capability) is correctly placed in abac.guard.spec.ts. Group B (AbacGuard unit tests, B-01..B-05): all 5 scenarios in abac.guard.spec.ts plus additional tests for masking level, scope resolver invocation, and audit failure resilience. Group C (MaskingService unit tests, C-01..C-07): all 7 scenarios in masking.service.spec.ts, plus outbox masking tests for FR-141. Group D (MaskedField component tests, D-01..D-05): all 5 scenarios in MaskedField.test.tsx. Group E (API integration tests, E-01..E-14) and UI Playwright tests are deferred project-wide per the test spec file and the STAGE7-CONTINUATION.md note. SQL invariants INV-1..INV-6 are documented in the test spec for execution against the Testcontainers database.
