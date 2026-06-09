# UI Guidelines
*Stack: React 18 + Vite + TypeScript · Tailwind CSS · shadcn/ui (Radix) · TanStack Query · React Hook Form + Zod · PWA | Updated: 2026-06-08*

Aligns with BRD §4.5 (shared UI conventions) and §7 (UI requirements). Mobile-first, consent-aware, WCAG 2.1 AA.

## Component library
- Primary: **shadcn/ui** in `apps/web/src/components/ui/`. **Never re-create** a component that exists; **never edit `ui/` files directly** — extend by wrapping in `components/<feature>/`.
- **Reuse the shared primitives** (BRD §4.5) — build once, use everywhere:
  `DataTable` (server pagination, column visibility, bulk-select), `EntityForm` (RHF+Zod), `Modal`, `Drawer`, `Toast`, `StatusChip`, `MaskedField`, `EmptyState`, `LoadingSkeleton`, `ErrorState`, `ConfirmDialog`.
- Icons: **Lucide**. Charts: a lightweight lib with a low-bandwidth fallback (render numbers/tables when `low-bandwidth` mode is on).

## Layout shell & navigation
- App shell: left nav **filtered by role** (capabilities from the session); top bar with **global masked search (cmd-k)**, quick-create (lead/task/upload/send-link), notifications bell, profile/MFA.
- **Mobile bottom navigation** for RM core actions (Inbox, Capture, Tasks, Search, More). Full-height layouts use `100dvh`, never `100vh`.
- Page wrapper: `<main className="container mx-auto px-4 py-6">`; cards via shadcn `<Card>` (never `<div className="rounded border">`).

## Design tokens
- Colours/spacing/typography/radius via Tailwind theme + CSS variables (`--background`, `--foreground`, `--muted`, `--card`, `--border`, `--primary`, `--destructive`). **Never hardcode hex or arbitrary px**; use the Tailwind scale (`p-2/p-4/p-6`).

## Sensitive data & status
- Render PII through **`MaskedField`** (PAN `ABCxxxx1F`, mobile `98xxxxxx10`); the UI never displays raw Aadhaar (ref only). Unmask only where the user's role permits and the action is audited.
- Use the consistent **`StatusChip`** set app-wide: consent, KYC, document, SLA, duplicate, hand-off — same colours/labels everywhere.
- Customer-facing surfaces (micro-site) never show internal notes, scores, RM performance, or other leads.

## Forms (RHF + Zod)
- Every input has a visible `<label>` — never placeholder-only. Required fields: `*` + `aria-required="true"`.
- Zod schema mirrors the §5 field validations; server `VALIDATION_ERROR.fields[]` maps to per-field inline errors (`role="alert"`/`aria-live="polite"`).
- Native `<form onSubmit>` (Enter works); submit button disabled while `isSubmitting`.
- Capture form is **mobile-usable in < 3 minutes** for minimum fields (BRD §7.4); image upload auto-compresses with retake.

## States (every data view)
- **Loading:** skeletons (`LoadingSkeleton`), not spinners, for lists/pages; buttons show spinner + disabled during mutations.
- **Empty:** `EmptyState` (icon + heading + description + CTA) — never an empty `<tbody>`/container.
- **Error:** queries → inline `ErrorState`; mutations → non-blocking `Toast`. Map §8.4 codes to the user-message templates (e.g. `CONFLICT`→"Refresh and retry", `RATE_LIMITED`→"Too many attempts").
- **Destructive actions** (merge, revoke link, deactivate user, config rollback) always use `ConfirmDialog` with reason capture where audited.
- Page-level `ErrorBoundary`; dedicated 404 and 500 pages (500 with retry).

## Accessibility (WCAG 2.1 AA)
- All interactive elements keyboard-reachable (Tab/Enter/Space/Escape); visible `:focus-visible` ring.
- Meaningful icons have `aria-label`; decorative `aria-hidden="true"`; all `<img>` have `alt`.
- Modals: Radix `Dialog` (`role="dialog"`, `aria-modal`, focus trap, Escape closes, labelled).
- Contrast ≥ 4.5:1 (normal) / 3:1 (large). Respect `prefers-reduced-motion`. Run an automated a11y check on core screens (architecture §8).

## Dark mode & animation
- Support light/dark via Tailwind `dark:` + CSS vars **consistently**; test every component in both.
- Animate only `transform`/`opacity` (never `width`/`height`/layout). 150 ms micro / 300 ms panels; gate behind reduced-motion.

## Mobile / PWA / low-bandwidth
- Installable PWA; service worker caches shell + reference data. Touch-friendly pipeline cards; share customer link via WhatsApp/SMS from mobile.
- **Low-bandwidth mode:** compressed images, deferred/disabled charts, reduced payloads. Offline draft capture is Phase 1.5 (local encrypted store → sync; conflicts to review).

## Localisation
- INR currency, `dd-MM-yyyy`, IST display, pin/branch hierarchy.
- All user-visible strings via `t('key')` — never hardcode literals (incl. Yes/No → `t('common.yes')`). English UI; regional-language **message templates** where configured (Hindi + top state languages for pilot).

## Data tables (lead lists, queues)
- Always `DataTable` with **server-side** pagination (limit ≤ 100), sortable/allow-listed columns, column visibility, sticky header, scope-aware **bulk-select** actions (bulk actions write audit), saved-view chips.
