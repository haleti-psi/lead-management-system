---
name: ui-review
description: End-to-end UI/UX quality review covering login completeness, mobile-first navigation (collapsible sidebar, menu icons, hamburger toggle), accessibility, responsive design, empty/error/loading states, dark mode, Tailwind CSS & shadcn/ui component adoption, modern UI patterns (toasts, modals, forms, tables, search), i18n, design system integrity, and frontend performance. Produces a prioritized improvement plan with a release-readiness verdict.
argument-hint: "[target] [phase]"
---

# UI/UX Review Playbook

Perform an end-to-end UI/UX quality review and produce a prioritized, actionable improvement plan with a release-readiness verdict.

## Scoping

If the user specifies a target (example: `/ui-review apps/citizen`), review only that app. Otherwise review all UI apps.

If the user specifies a phase (example: `/ui-review accessibility only`), run only that section.
Valid phase keywords: `preflight`, `scan`, `login`, `design-system`, `tailwind-shadcn`, `navigation`, `responsive`, `accessibility`, `interaction`, `states`, `empty-error`, `i18n`, `performance`, `gates`, `compliance`, `backlog`, `quickwins`.

If target includes `/`, generate a safe output slug:

- Replace `/` with `-`
- Remove spaces
- Example: `apps/dopams-ui` -> `apps-dopams-ui`

## Project Context

This monorepo may contain one or more UI apps. Detect the actual apps present by scanning `apps/*/src` for React entry points.

**IntelliRAG** (primary app when present):

```text
apps/
  web/              - React (Vite + Tailwind) RAG platform UI
                      Pages: Login, Dashboard, Workspace, Documents, Query, Graph Explorer, Admin
                      Layout: Sidebar + Header shell (AppLayout)
                      Theming: 14 themes via CSS custom properties + data-theme attribute
packages/
  shared/           - Shared types, schemas, UI components
```

**Policing apps** (when present):

```text
apps/
  citizen/          - React (Vite) citizen-facing app (EN/HI/PA, mobile-first)
  officer/          - React (Vite) officer portal
  dopams-ui/        - React (Vite) DOPAMS intelligence dashboard (EN/HI/TE)
  forensic-ui/      - React (Vite) forensic platform UI (EN/HI/TE)
  social-media-ui/  - React (Vite) social media monitoring UI (EN/HI/TE)
packages/
  shared/           - Shared UI primitives and utilities
```

Primary requirements source: `docs/policing_apps_brd/` (policing) or `CLAUDE.md` (IntelliRAG).

### Locale Matrix

| App | Primary | Secondary | Tertiary |
|-----|---------|-----------|----------|
| citizen | EN | HI (Hindi) | PA (Punjabi) |
| officer | EN | HI (Hindi) | PA (Punjabi) |
| dopams-ui | EN | HI (Hindi) | TE (Telugu) |
| forensic-ui | EN | HI (Hindi) | TE (Telugu) |
| social-media-ui | EN | HI (Hindi) | TE (Telugu) |

## Established UI Patterns

The following patterns have been implemented across the three policing UIs (dopams-ui, forensic-ui, social-media-ui). Reviews MUST validate that each pattern is correctly and consistently applied.

### 1. Faceted Filter Counts on List Views

All entity list views fetch a dedicated `/api/v1/<entity>/facets` endpoint on mount to populate filter dropdowns with live record counts (e.g., `OPEN (5)`). The pattern:

- **API**: `GET /api/v1/<entity>/facets` returns `{ facets: { field: [{ value, label?, count }] } }`, sorted by count DESC, scoped by `unit_id` where applicable.
- **UI**: `FacetEntry` type + `facetOptions()` helper renders `<option>` elements with counts. Graceful fallback to original hardcoded values if the facet API fails.
- **Scope**: 9 list views across 3 apps.

| App | View | Facet Endpoint | Fields |
|-----|------|---------------|--------|
| social-media-ui | AlertList | `/api/v1/alerts/facets` | state_id, priority, alert_type |
| social-media-ui | CaseList | `/api/v1/cases/facets` | state_id, priority |
| social-media-ui | ContentList | `/api/v1/content/facets` | platform, category_id (with label from taxonomy JOIN) |
| dopams-ui | AlertList | `/api/v1/alerts/facets` | state_id, severity, alert_type |
| dopams-ui | CaseList | `/api/v1/cases/facets` | state_id, priority |
| dopams-ui | LeadList | `/api/v1/leads/facets` | state_id, priority, source_type |
| dopams-ui | SubjectList | `/api/v1/subjects/facets` | state_id, gender |
| forensic-ui | CaseList | `/api/v1/cases/facets` | state_id, priority, case_type |
| forensic-ui | ImportList | `/api/v1/imports/facets` | state_id |

**Review checks:**
- Every list view with filter dropdowns must use faceted counts (no plain hardcoded options without counts).
- Facet fetch must be a separate `useEffect` from the data fetch (different cache profile).
- Fallback to hardcoded values must work when the API is unreachable.
- Facet queries must respect `unit_id` scoping where the entity table has it.
- Previously empty dropdowns (DOPAMS alert_type, lead source_type, forensic case_type) must now be dynamically populated.

### 2. Enhanced Login Screen

All three policing UIs use a redesigned login screen with these features:

- **Centered card layout**: Full-viewport centered grid using `100dvh`, surface card with `border-radius: var(--radius-xl)` and `box-shadow: var(--shadow-md)`.
- **App-specific SVG logo**: Unique inline SVG icon per app (shield for DOPAMS, magnifying glass for Forensic, chat bubble for Social Media) rendered in a branded circle.
- **Remember Me**: Checkbox backed by `localStorage` (`dopams_remember` / `forensic_remember` / `sm_remember`). Username is persisted/restored across sessions.
- **Forgot Password flow**: In-page panel swap (not a separate route) with back-to-login button, email/username input, and success alert. Currently client-side only.
- **Expanded theme selector**: Shows all custom themes via `<optgroup>` with human-readable labels from `THEME_LABELS` map. Pill-shaped select (`border-radius: 999px`).
- **Branded footer**: App-specific footer text below the form.
- **Dedicated CSS**: Login styles in `login.css` (imported by `Login.tsx`), not in `app.css`.

**Review checks:**
- Login CSS must use design tokens (no hardcoded colors, spacing, or breakpoints).
- All interactive elements must have `:hover`, `:active`, and `:focus-visible` states.
- Mobile breakpoint at `max-width: 30rem` must adapt layout (column on small phones).
- All user-visible text must use `t()` i18n keys (including error messages, footer, forgot-password instructions).
- Login i18n keys must exist in all 3 locale files (en, hi, te).
- Remember Me must not store passwords — only the username.
- Theme selector must show all themes defined in the theme system.

### 2B. Full-Fledged Login Screen Checklist (Universal)

Every app MUST have a production-quality login screen. This checklist applies universally (not just policing apps). Score each item as PRESENT, PARTIAL, or MISSING.

#### Layout & Visual Design

| Check | Requirement | Severity |
|-------|-------------|----------|
| L-01 | Full-viewport centered layout (`min-h-[100dvh]` or `100dvh`, NOT `100vh`) | P1 |
| L-02 | Card/panel with consistent elevation (shadow + border-radius via design tokens) | P2 |
| L-03 | Branded header: app logo/icon + app name + optional tagline | P1 |
| L-04 | Visual hierarchy: logo → heading → form → secondary actions → footer | P2 |
| L-05 | Background treatment (gradient, pattern, or image) that works in light AND dark mode | P2 |
| L-06 | Max-width constraint on card (e.g., `max-w-md`) to prevent over-stretching on desktop | P2 |
| L-07 | Responsive padding: tighter on mobile (`p-6`), roomier on desktop (`sm:p-8` or larger) | P2 |
| L-08 | Footer with copyright/version/help link below the card | P3 |

#### Form & Input Quality

| Check | Requirement | Severity |
|-------|-------------|----------|
| F-01 | Username/email field with appropriate `type`, `autocomplete="username"`, leading icon | P1 |
| F-02 | Password field with `type="password"`, `autocomplete="current-password"`, leading icon | P1 |
| F-03 | Password visibility toggle (eye icon button with `aria-label`) | P1 |
| F-04 | Input font-size >= 16px (`text-base`) to prevent iOS Safari auto-zoom | P1 |
| F-05 | Auto-focus on first empty field on mount | P2 |
| F-06 | Enter key submits form (native `<form>` with `onSubmit`) | P1 |
| F-07 | Input validation with clear inline error messages | P1 |
| F-08 | `maxLength` on inputs to prevent abuse | P3 |
| F-09 | Labels associated with inputs (explicit `<label htmlFor>` or `aria-label`) | P1 |

#### Authentication UX Features

| Check | Requirement | Severity |
|-------|-------------|----------|
| A-01 | "Remember me" checkbox that persists username (NOT password) via localStorage | P2 |
| A-02 | "Forgot password" flow (in-page panel swap or modal, NOT a separate route) | P2 |
| A-03 | Loading state on submit button (spinner + disabled + text change) | P1 |
| A-04 | Double-submit prevention (button disabled during request) | P1 |
| A-05 | Error display: icon + message in alert banner with `role="alert"` or `aria-live="assertive"` | P1 |
| A-06 | Error dismissal on new input (clear error when user types) | P2 |
| A-07 | Info/success messages visually distinct from errors (different color/icon) | P2 |
| A-08 | Redirect to intended page after login (not always dashboard) | P2 |
| A-09 | Session expiry message when redirected to login from expired session | P2 |

#### Theme & Dark Mode

| Check | Requirement | Severity |
|-------|-------------|----------|
| T-01 | Theme selector accessible on login page (user can switch before logging in) | P2 |
| T-02 | All themes render correctly on login (no missing variables, no white-on-white) | P1 |
| T-03 | Dark mode: inputs, card, background, text all properly themed | P1 |
| T-04 | Theme persists across page reload (localStorage) | P2 |
| T-05 | No flash of unstyled/wrong theme on page load | P2 |

#### Accessibility (Login-Specific)

| Check | Requirement | Severity |
|-------|-------------|----------|
| X-01 | `<main>` landmark wrapping login content | P1 |
| X-02 | Heading hierarchy: single `<h1>` for app name or "Sign In" | P1 |
| X-03 | `aria-describedby` linking error messages to relevant inputs | P1 |
| X-04 | `aria-invalid` on fields with validation errors | P1 |
| X-05 | `focus-visible` rings on ALL interactive elements (inputs, buttons, links, checkbox) | P1 |
| X-06 | Touch targets >= 44px on all buttons and interactive elements | P1 |
| X-07 | Color contrast >= 4.5:1 for all text including placeholder, helper, and footer text | P1 |
| X-08 | Screen reader live region (`aria-live="assertive"`) for dynamic error/success messages | P1 |

#### Responsive Login

| Check | Requirement | Severity |
|-------|-------------|----------|
| R-01 | Renders correctly at 320px width (no horizontal overflow) | P1 |
| R-02 | Card fills viewport width on small screens with appropriate margins | P1 |
| R-03 | Comfortable at 360px, 768px, 1280px (the 3 key breakpoints) | P2 |
| R-04 | Virtual keyboard does not obscure the form on mobile (scroll into view) | P2 |

**Login screen verification commands:**
```bash
# Check login page exists and has key features
rg -n 'password|Password' apps/*/src --glob '*ogin*' -l
rg -n 'rememberMe|remember' apps/*/src --glob '*ogin*'
rg -n 'forgot|Forgot' apps/*/src --glob '*ogin*'
rg -n 'aria-live|role="alert"' apps/*/src --glob '*ogin*'
rg -n 'autocomplete=' apps/*/src --glob '*ogin*'
rg -n '100dvh|100vh' apps/*/src --glob '*ogin*'
rg -n 'focus-visible' apps/*/src --glob '*ogin*'
# Check for proper form element
rg -n '<form' apps/*/src --glob '*ogin*'
# Check for loading/disabled state on submit
rg -n 'disabled.*loading|loading.*disabled' apps/*/src --glob '*ogin*'
```

### 3. Dashboard Drill-Down (Clickable Stat Cards)

Dashboard stat cards are interactive buttons that navigate to the corresponding entity list view.

- **Semantic HTML**: Each stat card is a `<button type="button">` (not a clickable `<div>`).
- **`onNavigate` prop**: Dashboard accepts `onNavigate: (view: string) => void`. App.tsx passes its `navigate` function.
- **CSS class**: `.stat-card--clickable` with `cursor: pointer`, `:hover` (brand border + shadow), `:active` (scale 0.98), `:focus-visible` (3px outline with offset).

| App | Card 1 → | Card 2 → | Card 3 → | Card 4 → |
|-----|----------|----------|----------|----------|
| dopams-ui | alerts | leads | cases | subjects |
| forensic-ui | cases | cases | cases | cases |
| social-media-ui | alerts | cases | content | watchlists |

**Review checks:**
- All stat cards must be `<button>` elements (not `<div>` or `<a>`).
- Must have `:hover`, `:active`, and `:focus-visible` CSS states.
- Navigation target must map to a valid view in the App shell.
- Touch target must meet 44px minimum.
- Transitions must use design tokens (`transition: box-shadow 0.15s ease`).

### 4. Content List Category Display (Social Media)

ContentList in social-media-ui has been enhanced:

- Content queries JOIN `taxonomy_category` to return `category_name` alongside `category_id`.
- A new "Category" column displays `category_name` in a default badge.
- Category filter uses faceted counts with labels from the taxonomy JOIN.
- The separate `/api/v1/config/taxonomy` fetch has been replaced by the facets endpoint.
- Threat score thresholds corrected to 0-100 scale (`>= 70` critical, `>= 40` warning).

### 5. API Hardening (Supporting UI)

These API changes support the UI improvements and should be validated during review:

- **UUID type casting**: All `unit_id` filter parameters use `$N::uuid` (not `$N::text`). Prevents PostgreSQL type mismatch errors.
- **Token in auth response body**: Login endpoints return `{ user, token }` enabling Bearer-token auth alongside cookies.
- **Audit logger null safety**: `entityType || "unknown"` and `entityId || "N/A"` fallbacks prevent NOT NULL constraint violations.
- **Dashboard queries respect unit_id**: All dashboard aggregate queries scope by the authenticated user's unit.

## Operating Rules

- Use evidence-first review: cite exact files, components, CSS selectors, and line numbers.
- Separate `confirmed` evidence from `inferred` conclusions.
- Never state a check passed unless you ran it.
- If something cannot be verified (tool/env limitation), mark it explicitly.
- Every recommendation must include `what`, `where`, `how`, and `verify`.
- Prefer small, reversible fixes; propose phased migration for larger redesigns.
- Recommend one default path when options exist.
- Prioritize: Accessibility -> Mobile reliability -> Sensitive action safety -> Consistency -> Performance.
- Save final report to `docs/reviews/ui-review-{targetSlug}-{YYYY-MM-DD}.md`.

## Quality Bar (Definition of Done)

A UI review is complete only when all are present:

- Inventory of routes/views and shared-component usage.
- Findings for all requested categories.
- QA gate scorecard with `PASS` / `PARTIAL` / `FAIL`.
- Release verdict (`GO` or `NO-GO`) with blocking failures listed.
- BRD traceability matrix for UI obligations.
- Prioritized backlog and quick-win plan.

## Severity, Confidence, and Risk

Use these fields for each finding:

- `Severity`: `P0` (urgent), `P1` (this sprint), `P2` (next sprint), `P3` (hardening)
- `Confidence`: `High`, `Medium`, `Low`
- `Status`: `Confirmed`, `Partially Confirmed`, `Unverified`

Preferred scoring:

`Risk Score = Impact (1-5) x Frequency (1-5)`

Risk Score to severity mapping: `16-25 = P0`, `9-15 = P1`, `4-8 = P2`, `1-3 = P3`.

### Violation-to-Severity Quick Reference

| Violation | Severity | Rationale |
|-----------|----------|-----------|
| Missing `aria-label` on icon-only button | P1 | Screen reader users cannot identify the control |
| `:hover` without `:active` | P2 | Touch users see no feedback on tap |
| Hardcoded `px` breakpoint | P2 | Fragmented responsive behavior |
| `100vh` instead of `dvh` | P1 | Content hidden behind mobile browser chrome |
| Interactive element < 44px | P1 | WCAG 2.5.5 failure, mis-taps on mobile |
| Missing safe-area inset on sticky element | P1 | Content obscured on notched devices |
| Hardcoded color bypassing token | P2 | Theme/dark-mode breakage |
| `label={t(...)}` in citizen app | P1 | Bilingual compliance violation |
| Missing i18n key in locale file | P1 | Untranslated text shown to users |
| Form input font-size < 1rem on mobile | P2 | Triggers iOS Safari auto-zoom |
| Horizontal overflow at 320px | P1 | Content unreachable on small phones |
| Sidebar not collapsible on mobile | P0 | Sidebar covers entire screen, no way to access content |
| Menu items without icons | P1 | Poor visual scanning, inconsistent navigation UX |
| Missing hamburger/menu toggle on mobile | P0 | No way to open navigation on mobile devices |
| No empty state on list/table view | P1 | Users see blank screen, think app is broken |
| Missing React Error Boundary | P1 | Unhandled error crashes entire application to white screen |
| No 404 catch-all route | P1 | Users see blank page on invalid URLs |
| Login page missing loading state on submit | P1 | User clicks multiple times, no feedback |
| Login page missing password visibility toggle | P1 | Poor mobile UX, unable to verify typed password |
| Missing `prefers-reduced-motion` support | P1 | Accessibility violation for vestibular disorder users |
| No focus trap in modal/overlay | P1 | Focus escapes to background, unusable for keyboard users |
| `<div onClick>` instead of semantic `<button>` or `<a>` | P1 | Not keyboard accessible, missing from tab order |
| Missing `autocomplete` attribute on login inputs | P2 | Password managers and autofill broken |
| Toast/notification without `aria-live` | P1 | Screen reader users miss feedback messages |
| No skeleton/loading state on data fetch | P2 | Content jumps (CLS) and perceived slowness |
| Raw `<button>`/`<input>` when shadcn/ui available | P1 | Inconsistent styling, missing accessibility, no variant system |
| Custom modal instead of shadcn `<Dialog>` | P1 | Missing focus trap, keyboard handling, and accessibility |
| Inline `style={{}}` instead of Tailwind classes | P2 | Bypasses design system, breaks responsive/dark mode |
| No `components/ui/` directory (shadcn not set up) | P1 | No component library; high risk of inconsistent, inaccessible UI |
| Raw hex/rgb in Tailwind `className` | P2 | Bypasses theme tokens, breaks dark mode consistency |

## Mandatory Evidence Artifacts

Collect these artifacts unless blocked:

- Screenshot matrix for key screens at:
  - `360x800` (small phone)
  - `768x1024` (tablet)
  - `1280x800` (desktop)
- Light and dark theme snapshots for at least one critical flow.
- Keyboard-only traversal notes for at least one critical flow.
- Accessibility scan output summary (manual and/or automated).
- Command execution log (`Executed`, `Not Executed`, reason).

If screenshots/scans are not possible in the environment, mark as `Not Executed` and provide precise manual verification steps.

## Phase 0: Preflight

Capture before analysis:

- Scope and assumptions.
- Branch and commit hash.
- Available scripts and checks from `package.json`.
- Environment constraints (missing backend, auth data, browser runtime).

## Phase 1: UI Inventory Scan

Produce:

- Route/page inventory by app.
- Component ownership map (local vs `@puda/shared`).
- CSS map: core stylesheets and approximate size/hotspot files.
- i18n footprint and hardcoded string candidates.
- Theme coverage map and likely dark-mode gaps.
- Faceted filter coverage: which list views have facet endpoints wired up vs still using plain hardcoded options.
- Login screen feature completeness: score against Full-Fledged Login Screen Checklist (§2B).
- Dashboard drill-down coverage: which stat cards navigate and their targets.
- Navigation pattern: sidebar collapsibility, hamburger toggle presence, menu item icons.
- Empty state coverage: which views handle empty data with intentional UI vs blank screen.
- Error boundary coverage: which route segments are wrapped in error boundaries.
- Loading state coverage: which data-fetching views show skeleton/loading vs nothing.
- 404/catch-all route: whether unmatched routes show a proper not-found page.

Minimum table:

| App | Route | Screen Component | CSS Source | Shared Components | i18n Status | Theme Status |
|-----|-------|------------------|------------|-------------------|-------------|--------------|

Additional inventory table for navigation:

| App | Sidebar | Collapsible (Mobile) | Hamburger Toggle | Menu Icons (All Items) | Active State | Touch Target 44px |
|-----|---------|---------------------|-----------------|----------------------|-------------|------------------|

Additional inventory table for empty/error/loading states:

| App | View/Page | Empty State | Loading/Skeleton | Error Boundary | 404 Page |
|-----|-----------|-------------|-----------------|---------------|----------|

Additional inventory table for component substance (skeleton detection):

| App | Component | Purpose | Mutation/Query Hook | Form Inputs | Data Fields Rendered | Verdict |
|-----|-----------|---------|--------------------|-----------|--------------------|---------|

For each component that imports a mutation or query hook, count:
- **Form Inputs**: number of `<input>`, `<select>`, `<textarea>`, `FormField`, `FormSelect`, `FormCheckbox`, or equivalent elements
- **Data Fields Rendered**: number of distinct data fields referenced in JSX (e.g., `item.name`, `data.status`)
- **Verdict**: `FUNCTIONAL` (has inputs/rendering proportional to its purpose), `THIN` (fewer fields than expected), `SKELETON` (imports hooks but has zero or near-zero interactive content)

```bash
# Automated skeleton scan: find components with mutation hooks but no form inputs
for file in $(rg -l 'useApiMutation|useMutation|useFormState|useForm\b' <component-dirs> --glob '*.tsx'); do
  INPUTS=$(rg -c '<(input|select|textarea|FormField|FormSelect|FormCheckbox|FormDateInput|FormCurrencyInput|TextField|Input)\b' "$file" 2>/dev/null || echo 0)
  if [ "$INPUTS" -eq "0" ]; then
    echo "SKELETON: $file (mutation hook, 0 form inputs)"
  fi
done

# Find components with query hooks but no data rendering
for file in $(rg -l 'useApiQuery|useQuery|useSWR' <component-dirs> --glob '*.tsx'); do
  MAPS=$(rg -c '\.map\(' "$file" 2>/dev/null || echo 0)
  DATA=$(rg -c '\.\w+\}|\bdata\.' "$file" 2>/dev/null || echo 0)
  if [ "$MAPS" -eq "0" ] && [ "$DATA" -lt "3" ]; then
    echo "SKELETON: $file (query hook, minimal data rendering)"
  fi
done
```

Any component marked `SKELETON` is a **P0 finding** — it represents a feature that appears implemented but is not functional.

Additional inventory table for login completeness:

| App | Feature | Status | Notes |
|-----|---------|--------|-------|
| | Branded logo + app name | | |
| | Password visibility toggle | | |
| | Remember me (username only) | | |
| | Forgot password flow | | |
| | Loading state on submit | | |
| | Error display with aria-live | | |
| | Theme selector | | |
| | Dark mode support | | |
| | 100dvh viewport | | |
| | Touch targets >= 44px | | |
| | Responsive at 320px-1280px | | |
| | Autocomplete attributes | | |

Additional inventory table for faceted filters:

| App | List View | Facet Endpoint | Facet Fields | Fallback Values | Status |
|-----|-----------|---------------|-------------|-----------------|--------|

## Phase 2: Design System Integrity

### A) Token Compliance

Run the automated lint check first:
```bash
npm run lint:theme   # or: bash scripts/lint-theme-tokens.sh [target_dir]
```
This catches three violation categories mechanically:
1. **Hardcoded Tailwind colors** (e.g., `bg-red-50`, `text-gray-600`) — must use token-based classes (`bg-surface`, `text-skin-muted`, `bg-primary-*`).
2. **Tailwind `dark:` prefix** — non-functional in this project (uses `[data-theme]` attribute, not Tailwind dark mode). All `dark:` classes are dead code.
3. **Non-existent utility classes** (e.g., `text-text-secondary`, `border-border-primary`) — render as no-ops, causing invisible/missing styling.

Additional manual checks:
- Hardcoded hex/rgb in CSS files bypassing `var(--color-*)`.
- Hardcoded spacing/radius/shadow bypassing token vars.
- Breakpoints declared ad-hoc instead of tokenized values.

For each violation capture: file, line, current value, recommended token.

### B) Component Contract and State Completeness

Review shared components and high-use local components for:

- State coverage (`default`, `hover`, `active`, `focus-visible`, `disabled`, `loading`).
- Hover/active parity for touch users.
- Disabled semantics and visual distinction.
- Loading-state double-submit prevention.

### C) Visual Consistency

- Typography hierarchy consistency.
- Primary-action style consistency.
- Space rhythm and panel density consistency.
- Semantic color usage correctness (success/warn/error).

### D) Established Component Patterns

Verify these components follow design system rules:

- **`.stat-card--clickable`**: Must have `cursor: pointer`, `:hover` (brand border + shadow), `:active` (scale transform), `:focus-visible` (3px outline with offset). Transitions must use design tokens. Must be consistent across all 3 policing app `app.css` files.
- **Login card (`.login-container`)**: Must use `var(--radius-xl)`, `var(--shadow-md)`, `100dvh` (not `100vh`), fluid heading via `clamp()`, `accent-color: var(--color-brand)` for checkbox. Mobile breakpoint at `max-width: 30rem`. Must be in dedicated `login.css` (not `app.css`).
- **Facet option rendering**: `facetOptions()` helper must produce `<option>` elements with `VALUE (count)` format. Must gracefully fall back to plain values when facets are empty.

### E) Underline Tabs Pattern

The shared `<Tabs>` component (`@puda/shared` `ui.tsx`) renders `ui-tabs__*` class names. Every app that uses `<Tabs>` MUST have underline tab styles defined in its `app.css`. The canonical pattern:

```css
.ui-tabs__list {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--color-border);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.ui-tabs__list::-webkit-scrollbar { display: none; }

.ui-tabs__tab {
  position: relative;
  background: none;
  border: none;
  padding: var(--space-3) var(--space-4);
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-muted);
  cursor: pointer;
  white-space: nowrap;
  min-height: 2.75rem;
  transition: color 0.15s;
}
.ui-tabs__tab::after {
  content: "";
  position: absolute;
  left: var(--space-2); right: var(--space-2);
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: transparent;
  transition: background 0.2s;
}
.ui-tabs__tab:hover { color: var(--color-text); }
.ui-tabs__tab:active { opacity: 0.8; }
.ui-tabs__tab--active { color: var(--color-brand); font-weight: 600; }
.ui-tabs__tab--active::after { background: var(--color-brand); }
.ui-tabs__tab:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: -2px;
  border-radius: var(--radius-sm);
}
.ui-tabs__panel { padding-top: var(--space-5); }
```

**Review checks:**
- Every app using `<Tabs>` must have `ui-tabs__*` styles. Check with: `rg 'ui-tabs' apps/*/src --glob '*.css'`.
- Tab bar must be horizontally scrollable on mobile (no overflow).
- Active tab: brand-color text + 2px brand-color underline.
- Inactive tab: muted text, no underline.
- All tabs meet 44px min-height touch target.
- Must have `:hover`, `:active`, and `:focus-visible` states.
- Panel has top padding to separate content from tab bar.

### F) Keyboard-Navigable Table Rows

Clickable table rows (that navigate on click) MUST be keyboard-accessible. The pattern:

```tsx
<tr
  tabIndex={0}
  role="link"
  onClick={() => navigate(view)}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(view); }
  }}
>
```

**Review checks:**
- Every `<tr>` with an `onClick` handler must also have `tabIndex={0}`, `role="link"`, and `onKeyDown` for Enter/Space.
- Check with: `rg 'onClick.*navigate' apps/*/src/views --glob '*.tsx' -l` then verify each file has matching `onKeyDown`.
- Must NOT use `<tr role="button">` — use `role="link"` since the action is navigation.

### G) Mobile-Responsive Detail Grids

Detail views that display key-value grids (e.g., subject profile, alert details, lead details) must use auto-fit columns instead of fixed column counts:

```css
/* BAD: breaks on mobile */
grid-template-columns: 1fr 1fr;

/* GOOD: responsive reflow */
grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
```

**Review checks:**
- Search for `gridTemplateColumns.*1fr 1fr` in detail views — all should use `auto-fit`.
- Verify with: `rg 'gridTemplateColumns.*1fr 1fr' apps/*/src/views --glob '*.tsx'`.

### H) Boolean Badge i18n

Components that render boolean values as badges (e.g., "Yes"/"No") MUST use i18n keys, not hardcoded English strings:

```tsx
// BAD
{value ? "Yes" : "No"}

// GOOD
{value ? t("common.yes") : t("common.no")}
```

**Review checks:**
- Search for hardcoded `"Yes"` / `"No"` in views: `rg '"Yes"|"No"' apps/*/src/views --glob '*.tsx'`.
- Ensure `common.yes` and `common.no` keys exist in all locale files.

### I) Tailwind CSS & shadcn/ui Component Adoption

Projects SHOULD use Tailwind CSS for utility-first styling and shadcn/ui (or Radix-based) components for consistent, accessible, responsive UI primitives. This check audits whether the project leverages these tools effectively instead of rolling custom implementations.

#### Tailwind CSS Setup & Usage

| Check | Requirement | Severity |
|-------|-------------|----------|
| TW-01 | `tailwind.config.js` or `tailwind.config.ts` exists and is properly configured | P1 |
| TW-02 | `@tailwind base`, `@tailwind components`, `@tailwind utilities` directives present in root CSS | P1 |
| TW-03 | Responsive design uses Tailwind breakpoint prefixes (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`) instead of custom `@media` queries | P1 |
| TW-04 | Dark mode uses Tailwind's `dark:` prefix or CSS variable strategy (not ad-hoc `@media (prefers-color-scheme)` per component) | P2 |
| TW-05 | Spacing, sizing, and typography use Tailwind scale (`p-4`, `text-lg`, `gap-2`) instead of arbitrary values (`p-[17px]`) | P2 |
| TW-06 | Colors use Tailwind theme tokens (`bg-primary`, `text-muted-foreground`) or CSS variables (`bg-[var(--color-*)]`) — no raw hex/rgb in className | P1 |
| TW-07 | `cn()` or `clsx()` helper used for conditional class merging (no manual string concatenation) | P2 |
| TW-08 | Tailwind `content` paths in config cover all component directories (no missing purge paths causing missing styles in production) | P1 |
| TW-09 | Custom CSS files (`*.css`) are minimal — bulk of styling done via Tailwind utilities in JSX | P2 |
| TW-10 | `@apply` usage is minimal and limited to base/component layers — not used as a substitute for inline utilities | P3 |

#### shadcn/ui Component Adoption

shadcn/ui provides accessible, well-designed, Radix-based primitives. Projects SHOULD prefer these over custom implementations for common UI patterns.

| Check | Requirement | Severity |
|-------|-------------|----------|
| SC-01 | `components/ui/` directory exists with shadcn/ui components installed (Button, Input, Dialog, etc.) | P1 |
| SC-02 | Buttons use `<Button>` from `components/ui/button` — not raw `<button>` with manual Tailwind classes | P1 |
| SC-03 | Form inputs use `<Input>` from `components/ui/input` — not raw `<input>` with manual styling | P1 |
| SC-04 | Selects/dropdowns use `<Select>` from `components/ui/select` — not raw `<select>` | P2 |
| SC-05 | Modals/dialogs use `<Dialog>` from `components/ui/dialog` — not custom modal implementations | P1 |
| SC-06 | Sheets/drawers use `<Sheet>` from `components/ui/sheet` — not custom slide-over panels | P2 |
| SC-07 | Dropdown menus use `<DropdownMenu>` from `components/ui/dropdown-menu` — not custom popover menus | P2 |
| SC-08 | Toast notifications use `<Toaster>` + `useToast` from `components/ui/toast` or `sonner` — not custom toast implementations | P2 |
| SC-09 | Tables use `<Table>` components from `components/ui/table` for consistent header/row/cell styling | P2 |
| SC-10 | Cards use `<Card>` from `components/ui/card` — not raw `<div>` with manual border/shadow/padding | P2 |
| SC-11 | Badges/tags use `<Badge>` from `components/ui/badge` — not custom `<span>` with inline styles | P2 |
| SC-12 | Tabs use `<Tabs>` from `components/ui/tabs` (Radix-based) — not custom tab implementations | P2 |
| SC-13 | Form validation uses `<Form>` from `components/ui/form` with react-hook-form integration | P3 |
| SC-14 | Tooltips use `<Tooltip>` from `components/ui/tooltip` — not custom `title` attributes or CSS-only tooltips | P3 |
| SC-15 | Alert/info banners use `<Alert>` from `components/ui/alert` — not custom styled divs | P2 |
| SC-16 | `components.json` exists at project root (shadcn/ui configuration file) | P2 |

#### Anti-Patterns to Flag

| Anti-Pattern | What to Look For | Severity |
|--------------|------------------|----------|
| Raw HTML where shadcn exists | `<button className="...">` instead of `<Button>`, `<input className="...">` instead of `<Input>` | P1 |
| Reinvented modal | Custom modal with `useState` + portal + backdrop instead of `<Dialog>` | P1 |
| Reinvented dropdown | Custom `useRef` + `onClickOutside` popover instead of `<DropdownMenu>` | P2 |
| Reinvented toast | Custom notification system instead of `sonner` or `shadcn/toast` | P2 |
| Inline style objects | `style={{ padding: '16px', border: '1px solid #ccc' }}` instead of Tailwind classes | P2 |
| CSS modules for simple layout | `.module.css` files for what Tailwind utilities handle (flex, grid, spacing) | P3 |
| Manual dark mode per component | `if (isDark) classes += "..."` instead of Tailwind `dark:` or CSS variable approach | P2 |
| Inconsistent variant usage | Some buttons use `variant="destructive"`, others use manual red classes for same purpose | P1 |

#### shadcn/ui Coverage Score

Calculate adoption percentage:

```
Score = (shadcn components used / total applicable UI patterns) × 100
```

Categories to check:
- Buttons (Button)
- Inputs (Input, Textarea, Checkbox, Switch, RadioGroup)
- Layout (Card, Separator, ScrollArea)
- Navigation (Tabs, NavigationMenu, Breadcrumb)
- Feedback (Alert, Toast/Sonner, Progress, Skeleton)
- Overlay (Dialog, Sheet, Popover, Tooltip, DropdownMenu)
- Data Display (Table, Badge, Avatar)
- Forms (Form, Label, Select, Calendar, DatePicker)

Rating:
- `>= 80%`: PASS — project consistently uses shadcn/ui primitives
- `50-79%`: PARTIAL — mixed usage, some custom implementations remain
- `< 50%`: FAIL — project does not leverage shadcn/ui; significant UI inconsistency and accessibility risk

**Verification commands:**
```bash
# Check Tailwind setup
ls tailwind.config.* 2>/dev/null || ls */tailwind.config.* 2>/dev/null || ls apps/*/tailwind.config.* 2>/dev/null || ls packages/*/tailwind.config.* 2>/dev/null
rg -n '@tailwind' --glob '*.css' | head -10

# Check shadcn/ui setup
ls components.json 2>/dev/null || ls */components.json 2>/dev/null || ls apps/*/components.json 2>/dev/null || ls packages/*/components.json 2>/dev/null
rg -l 'components/ui' --glob '*.tsx' | head -20

# Count shadcn component usage vs raw HTML
rg -c 'from.*components/ui/button|from.*@/components/ui/button' --glob '*.tsx' | head -10
rg -c '<button ' --glob '*.tsx' | head -10
rg -c 'from.*components/ui/input|from.*@/components/ui/input' --glob '*.tsx' | head -10
rg -c '<input ' --glob '*.tsx' | head -10
rg -c 'from.*components/ui/dialog|from.*@/components/ui/dialog' --glob '*.tsx' | head -10

# Check for custom modal/dialog implementations (anti-pattern)
rg -n 'createPortal|ReactDOM.createPortal' --glob '*.tsx' | head -10
rg -n 'useClickOutside|onClickOutside|clickOutside' --glob '*.tsx' | head -10

# Check for inline styles (anti-pattern)
rg -c 'style={{' --glob '*.tsx' | sort -t: -k2 -rn | head -10

# Check for CSS modules (potential anti-pattern if Tailwind is available)
rg -l '\.module\.css' --glob '*.tsx' | head -10

# Check cn/clsx helper usage
rg -n 'import.*\bcn\b|import.*clsx|import.*classnames' --glob '*.tsx' | head -10

# Check Tailwind responsive prefixes vs custom media queries
rg -c 'sm:|md:|lg:|xl:' --glob '*.tsx' | sort -t: -k2 -rn | head -10
rg -n '@media' --glob '*.css' | head -20

# Check for raw hex/rgb in className (anti-pattern)
rg -n 'className=.*#[0-9a-fA-F]' --glob '*.tsx' | head -10
rg -n 'bg-\[#|text-\[#|border-\[#' --glob '*.tsx' | head -10

# Check @apply usage (should be minimal)
rg -c '@apply' --glob '*.css' | sort -t: -k2 -rn | head -10
```

## Phase 3: Mobile-First Navigation & Layout

### A) Collapsible Sidebar Pattern

Every app with a sidebar MUST implement a mobile-responsive navigation pattern. Score each item:

| Check | Requirement | Severity |
|-------|-------------|----------|
| NAV-01 | Sidebar collapses on mobile (hidden by default, toggled by hamburger button) | P0 |
| NAV-02 | Hamburger/menu toggle button visible on mobile (`md:hidden` or equivalent breakpoint) | P0 |
| NAV-03 | Hamburger button has `aria-label="Open menu"` / `"Close menu"` (dynamic) | P1 |
| NAV-04 | Hamburger button has `aria-expanded` reflecting sidebar state | P1 |
| NAV-05 | Sidebar opens as overlay on mobile with backdrop (click backdrop to close) | P1 |
| NAV-06 | Sidebar closes on route navigation (mobile) | P2 |
| NAV-07 | Sidebar closeable via Escape key | P1 |
| NAV-08 | Sidebar slides in with smooth transition (`transform` + `transition`, not display toggle) | P2 |
| NAV-09 | Body scroll locked when sidebar overlay is open (prevent background scroll) | P2 |
| NAV-10 | Focus trapped inside sidebar when open as overlay (return focus to hamburger on close) | P1 |
| NAV-11 | Sidebar has `<nav>` landmark with `aria-label="Main navigation"` | P1 |
| NAV-12 | On desktop, sidebar can optionally collapse to icon-only rail (nice-to-have) | P3 |

**Sidebar collapse pattern (React + Tailwind):**
```tsx
// Mobile: hidden by default, shown via state
// Desktop: always visible
<aside className={cn(
  "fixed inset-y-0 left-0 z-40 w-64 transform transition-transform duration-200",
  "md:relative md:translate-x-0",  // always visible on desktop
  isOpen ? "translate-x-0" : "-translate-x-full"  // toggle on mobile
)}>
  <nav aria-label="Main navigation">...</nav>
</aside>
{isOpen && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={close} />}
```

### B) Menu Item Design

Every navigation menu item MUST follow these patterns:

| Check | Requirement | Severity |
|-------|-------------|----------|
| MI-01 | Every menu item has a leading icon (consistent icon library, e.g., lucide-react) | P1 |
| MI-02 | Icon + label aligned horizontally with consistent spacing (`gap-3` or similar) | P2 |
| MI-03 | Active/current route highlighted with distinct background AND text color | P1 |
| MI-04 | Hover state on all menu items (background color change) | P1 |
| MI-05 | Focus-visible ring on all menu items for keyboard navigation | P1 |
| MI-06 | Touch targets >= 44px height on all menu items | P1 |
| MI-07 | Menu items use semantic `<a>` or `<NavLink>` elements (not `<div onClick>`) | P1 |
| MI-08 | Icon size consistent (e.g., all 20px or all 24px) and `aria-hidden="true"` | P2 |
| MI-09 | Menu sections grouped with headings or visual separators | P2 |
| MI-10 | Tooltips on menu items when sidebar is in collapsed/icon-only mode | P2 |
| MI-11 | Active menu item visible without scrolling (scroll-into-view if needed) | P3 |
| MI-12 | Nested/sub-menu items indented or visually grouped under parent | P3 |

**Verification commands:**
```bash
# Check sidebar components exist and have mobile toggle
rg -n 'hamburger|menu-toggle|isOpen|isSidebarOpen|sidebarOpen' apps/*/src --glob '*.tsx'
rg -n 'md:hidden.*button|lg:hidden.*button' apps/*/src --glob '*.tsx'
# Check menu items have icons
rg -n 'NavLink|nav.*item' apps/*/src/components --glob '*.tsx' -A 2
# Check for aria attributes on nav
rg -n 'aria-label.*navigation|aria-expanded' apps/*/src --glob '*.tsx'
# Check touch targets on nav items
rg -n 'min-h-\[44px\]|min-h-\[2.75rem\]|h-11|py-3' apps/*/src/components --glob '*idebar*'
```

### C) Responsive Header Pattern

| Check | Requirement | Severity |
|-------|-------------|----------|
| HD-01 | Fixed/sticky header that persists on scroll | P2 |
| HD-02 | Header height consistent and not overlapping content (proper padding/margin below) | P1 |
| HD-03 | Mobile: hamburger left, app title center, user/actions right | P2 |
| HD-04 | Desktop: breadcrumb/title left, user/actions right | P2 |
| HD-05 | User avatar/info with dropdown for settings/logout | P2 |
| HD-06 | Header adapts on mobile (hides non-essential elements, shows hamburger) | P1 |
| HD-07 | Header `z-index` above content but below modals/overlays | P2 |

### D) Mobile-First CSS Architecture

| Check | Requirement | Severity |
|-------|-------------|----------|
| MF-01 | Base styles target mobile (no media query = mobile layout) | P1 |
| MF-02 | Desktop enhancements use `min-width` queries (NOT `max-width` for mobile) | P1 |
| MF-03 | Tailwind responsive prefixes used correctly: `sm:`, `md:`, `lg:` (mobile-first by default) | P2 |
| MF-04 | No `max-width` media queries unless for mobile-specific overrides | P2 |
| MF-05 | `<meta name="viewport" content="width=device-width, initial-scale=1">` present in HTML | P0 |
| MF-06 | `100dvh` used instead of `100vh` for full-height layouts | P1 |
| MF-07 | `env(safe-area-inset-*)` used on fixed/sticky elements for notched devices | P2 |
| MF-08 | Touch-action CSS set appropriately (no accidental zoom on interactive areas) | P3 |

```bash
# Verify viewport meta tag
rg -n 'viewport' apps/*/index.html
# Check for max-width anti-pattern (should use min-width for mobile-first)
rg -n 'max-width' apps/*/src --glob '*.css' | grep '@media'
# Check for 100vh (should be 100dvh)
rg -n '100vh' apps/*/src --glob '*.css' --glob '*.tsx'
# Check safe-area-inset usage
rg -n 'safe-area' apps/*/src --glob '*.css'
```

### E) Breakpoint Discipline

- Ensure breakpoints align with design tokens.
- Flag ad-hoc breakpoints that fragment behavior.

```bash
# Find ad-hoc breakpoints not using design tokens
rg -n '@media[^{]*[0-9]+px' --glob '*.css'

# Find !important overrides (potential specificity wars)
rg -n '!important' --glob '*.css' --glob '!design-system.css' | head -20

# Find inline styles that bypass the design system
rg -n 'style={{' --glob '*.tsx' | grep -v 'var(--' | head -20
```

### F) Layout Adaptation

- Grid collapse and content order on small screens.
- Table-to-card behavior for narrow widths.
- Modal-to-bottom-sheet adaptation for mobile.
- Sticky/footer action bars with safe-area handling.
- Sidebar content area takes full width on mobile when sidebar is hidden.

### G) Overflow and Readability

- Horizontal scroll risks at narrow widths (test at 320px).
- Missing `min-width: 0` in flex layouts.
- Long-token handling for IDs/hashes/ARN-like values.
- Text truncation with `text-overflow: ellipsis` where appropriate.
- No content cut off at any standard viewport size.

## Phase 4: Accessibility (WCAG 2.1 AA)

### A) Color and Contrast

- Text/background contrast: WCAG 2.1 AA requires 4.5:1 for normal text, 3:1 for large text (18px+ or 14px+ bold).
- Contrast in muted, placeholder, disabled, and badge states.
- Non-color fallback for status-only cues (icon, text label, or pattern in addition to color).

### B) Keyboard and Focus

- Logical tab order and no focus traps.
- Visible focus for all interactive elements.
- Escape behavior for modal/drawer/popover.

### C) Screen Reader Semantics

- Accessible names for controls.
- Label/input/error relationships.
- Landmark usage (`main`, `nav`, `header`, `footer`).
- Live-region behavior for async status and toast notifications.

### D) Semantic Markup

- Buttons and links use semantic elements.
- Heading hierarchy is valid.
- Table semantics complete where tabular data exists.

### E) Touch Target Standards

- Interactive targets meet 44px minimum.
- Adjacent controls have adequate spacing.

### F) Accessibility Verification Commands

Run these checks and record results:

```bash
# Missing aria-label on icon-only buttons
rg -n '<button[^>]*>' --glob '*.tsx' -A 1 | grep -v 'aria-label'

# Interactive elements missing accessible names
rg -n 'role="button"|role="link"' --glob '*.tsx' | grep -v 'aria-label\|aria-labelledby'

# Images missing alt text
rg -n '<img ' --glob '*.tsx' | grep -v 'alt='

# Contrast — extract color pairs for manual verification
rg -n 'color:.*var\(--color-' --glob '*.css' | head -30

# Focus visibility — ensure :focus-visible is defined for interactive elements
rg -n ':focus-visible' --glob '*.css' | wc -l
rg -n 'button\|\.btn\|a\[href\]' --glob '*.css' -l | head -10
```

## Phase 5: Interaction, States, and UX Safety

### A) System Status and Feedback

- Loading, empty, error, and offline states for every critical screen.
- Mutation feedback (success/failure) consistency.
- No indefinite loading without timeout/error fallback.

### B) Error Prevention and Recovery

- Inline validation and clear recovery paths.
- Unsaved-change protection for form-heavy screens.
- Invalid actions disabled or blocked with explicit reason.

### C) Sensitive Action Safeguards (Domain Critical)

- Confirmations for irreversible actions (delete/finalize/export/merge).
- Explicit, contextual confirmation labels.
- PII reveal controls require explicit action and permission checks.
- High-risk actions display clear audit implications in UI.

### D) Trust and Explainability Signals

- Data freshness indicators.
- Source/context labels for high-impact data.
- Explainability hooks for risk scores or automated decisions.

### E) Established Interaction Patterns

Validate these recently implemented flows:

- **Dashboard drill-down**: Clicking a stat card must navigate to the correct entity list. Verify all navigation targets are valid views in the App shell router.
- **Faceted filter fallback**: When `/facets` endpoint fails (network error, 500), filter dropdowns must show original hardcoded values (no empty or broken dropdowns). Test by checking the `catch(() => {})` pattern and that fallback arrays are provided.
- **Remember Me persistence**: On login page mount, saved username must be restored from `localStorage`. On submit with checkbox checked, username must be saved. On submit with checkbox unchecked, saved value must be cleared.
- **Forgot Password flow**: Panel must swap in-place (not navigate). Back button must return to login form. Email field must be required. Success message must show after "send". No actual API call is made yet (client-side only) — flag if this is still the case.
- **Theme selector completeness**: All themes from `CUSTOM_THEMES` must appear in the login theme dropdown. Verify count matches the theme definitions in `design-system.css`.

## Phase 5B: UI State Completeness & Modern Design Patterns

This phase covers universal UI patterns that every production SPA must implement. Missing these patterns results in an unpolished, amateurish user experience.

### A) Empty States

Every data-driven view MUST have an intentional empty state. No blank white screens.

| Check | Requirement | Severity |
|-------|-------------|----------|
| ES-01 | Each list/table view has an empty state when no data exists | P1 |
| ES-02 | Empty state includes: illustration/icon + heading + descriptive text + CTA button | P1 |
| ES-03 | First-run empty state (new workspace, no documents) is welcoming and guides user | P2 |
| ES-04 | Search/filter empty state ("No results match your criteria") is distinct from data empty state | P2 |
| ES-05 | Empty state CTA is actionable (e.g., "Upload your first document" button) | P2 |

```bash
# Check for empty state handling
rg -n 'empty|no.*data|no.*results|no.*items|nothing.*found' apps/*/src --glob '*.tsx' -i
rg -n 'length === 0|\.length === 0' apps/*/src --glob '*.tsx'
```

### B) Error Pages & Boundaries

| Check | Requirement | Severity |
|-------|-------------|----------|
| EP-01 | 404 Not Found page exists for unmatched routes (catch-all route) | P1 |
| EP-02 | React Error Boundary wraps main content area (prevents full-app crash) | P1 |
| EP-03 | Error boundary shows: error icon + message + "Try Again" / "Go Home" buttons | P1 |
| EP-04 | Network error state (API unreachable) shows meaningful feedback, not raw error | P1 |
| EP-05 | Retry mechanism on transient errors (with exponential backoff if auto-retry) | P2 |
| EP-06 | Session expired state redirects to login with message | P2 |

```bash
# Check for error boundary
rg -n 'ErrorBoundary|componentDidCatch|getDerivedStateFromError' apps/*/src --glob '*.tsx'
# Check for 404/catch-all route
rg -n 'path="\*"|path="*"' apps/*/src --glob '*.tsx'
# Check for network error handling
rg -n 'catch|onError|isError|error.*state' apps/*/src --glob '*.tsx' | head -20
```

### C) Loading & Skeleton Patterns

| Check | Requirement | Severity |
|-------|-------------|----------|
| LD-01 | Page transitions show loading indicator (Suspense fallback or route-level loader) | P1 |
| LD-02 | Data-fetching components show skeleton/shimmer during loading (not just spinner) | P2 |
| LD-03 | Skeleton shape matches content layout (prevents layout shift CLS) | P2 |
| LD-04 | Loading states use animation (pulse or shimmer) to indicate activity | P3 |
| LD-05 | Long operations (>3s) show progress bar or step indicator | P2 |
| LD-06 | Page-level loader for React.lazy routes (Suspense fallback) | P1 |
| LD-07 | No indefinite spinners — all loading states have timeout with error fallback | P2 |

```bash
# Check for Suspense/lazy loading
rg -n 'Suspense|React\.lazy' apps/*/src --glob '*.tsx'
# Check for skeleton/loading components
rg -n 'skeleton|Skeleton|shimmer|Shimmer|isLoading|isPending' apps/*/src --glob '*.tsx'
# Check for loading spinners
rg -n 'Loader|spinner|Spinner|Loading' apps/*/src --glob '*.tsx'
```

### D) Toast & Notification Patterns

| Check | Requirement | Severity |
|-------|-------------|----------|
| TN-01 | Success/error feedback for mutations (create, update, delete) uses toast or inline message | P1 |
| TN-02 | Toasts are positioned consistently (top-right or bottom-right) | P2 |
| TN-03 | Toasts auto-dismiss after timeout (3-5 seconds) with manual dismiss option | P2 |
| TN-04 | Toasts use semantic colors (green=success, red=error, yellow=warning, blue=info) | P2 |
| TN-05 | Toast container has `role="status"` or `aria-live="polite"` for screen readers | P1 |
| TN-06 | No more than 3 toasts visible simultaneously (queue excess) | P3 |

### E) Modal & Dialog Patterns

| Check | Requirement | Severity |
|-------|-------------|----------|
| MD-01 | Modals use `<dialog>` element or have `role="dialog"` + `aria-modal="true"` | P1 |
| MD-02 | Focus trapped inside open modal (Tab cycles within modal) | P1 |
| MD-03 | Escape key closes modal | P1 |
| MD-04 | Click outside modal (on backdrop) closes it | P2 |
| MD-05 | Focus returns to trigger element when modal closes | P1 |
| MD-06 | Modal has accessible title (`aria-labelledby` pointing to heading) | P1 |
| MD-07 | Confirmation dialogs for destructive actions have explicit action labels (not just "OK") | P1 |
| MD-08 | Body scroll locked when modal is open | P2 |

### F) Form Design Patterns

| Check | Requirement | Severity |
|-------|-------------|----------|
| FM-01 | All form inputs have visible labels (not just placeholder text) | P1 |
| FM-02 | Required fields clearly indicated (asterisk or "(required)" text) | P2 |
| FM-03 | Validation errors appear inline next to the field, not just at top of form | P1 |
| FM-04 | Validation timing: on blur for first visit, on change after first error | P2 |
| FM-05 | Submit button disabled or shows loading during submission | P1 |
| FM-06 | Form-level error summary for complex forms (list of errors at top) | P3 |
| FM-07 | Appropriate input types (`email`, `url`, `tel`, `number`) for mobile keyboard optimization | P2 |
| FM-08 | Autocomplete attributes set correctly for autofill support | P2 |
| FM-09 | Multi-step forms show progress indicator | P3 |
| FM-10 | Form has inputs for all user-editable fields in its schema (no missing fields) | P0 |
| FM-11 | Form `onSubmit` calls a mutation/fetch to the backend (not empty or console.log) | P0 |
| FM-12 | Mutation payload includes all form field values (no hardcoded/dummy data) | P0 |
| FM-13 | Multi-step wizard: every step renders substantive form fields (not just title + Next button) | P0 |

**FM-10 through FM-13 are anti-skeleton checks.** They catch the #1 failure mode in AI-assisted codebases: components with correct structure but no functional content.

```bash
# FM-10: Compare schema fields vs form inputs for each form component
# Example: if createPersonSchema has 8 fields, PersonForm should have ~8 inputs
rg 'Schema|schema' shared/schemas.ts -A 20 | rg '\w+:' | wc -l     # schema fields
rg '<FormField|<FormSelect|<input|<select' <form-component> | wc -l  # form inputs

# FM-11: Verify submit handlers call API
rg 'onSubmit|handleSubmit' <component-dirs> --glob '*.tsx' -A 10 | rg 'mutate|fetch|api\.'

# FM-12: Verify mutation payloads aren't empty
rg 'mutate\(' <component-dirs> --glob '*.tsx' -A 3

# FM-13: For wizard/stepper components, verify each step has content
rg 'step.*===|activeStep|currentStep' <component-dirs> --glob '*.tsx' -A 20
```

### G) Card & Container Patterns

| Check | Requirement | Severity |
|-------|-------------|----------|
| CD-01 | Cards use consistent border-radius from design tokens | P2 |
| CD-02 | Cards use consistent shadow/elevation from design tokens | P2 |
| CD-03 | Card padding consistent across views | P2 |
| CD-04 | Interactive cards have hover state (shadow increase or border change) | P2 |
| CD-05 | Interactive cards have cursor pointer and focus-visible ring | P1 |
| CD-06 | Card grids responsive: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` or `auto-fit` | P1 |

### H) Animation & Motion Guidelines

| Check | Requirement | Severity |
|-------|-------------|----------|
| AN-01 | `prefers-reduced-motion` media query respected (disable animations for accessibility) | P1 |
| AN-02 | Transitions use consistent duration (150-300ms for micro, 300-500ms for page) | P2 |
| AN-03 | Transitions use appropriate easing (ease-out for enter, ease-in for exit) | P3 |
| AN-04 | No layout-triggering animations (use `transform` and `opacity`, not `width`/`height`) | P2 |
| AN-05 | Page transitions smooth (no jarring content jumps) | P2 |

```bash
# Check for reduced motion support
rg -n 'prefers-reduced-motion' apps/*/src --glob '*.css' --glob '*.tsx'
# Check transition durations for consistency
rg -n 'transition.*duration|duration-' apps/*/src --glob '*.css' --glob '*.tsx' | head -20
```

### I) Dark Mode Completeness Audit

Every app with a dark mode/theme system MUST pass these checks:

| Check | Requirement | Severity |
|-------|-------------|----------|
| DM-01 | All text colors use design tokens (`var(--color-text-*)`) — no hardcoded `#333`, `black`, `gray-900` | P1 |
| DM-02 | All background colors use design tokens — no hardcoded `white`, `#fff`, `gray-50` | P1 |
| DM-03 | All border colors use tokens — no hardcoded `gray-200`, `#e5e7eb` | P2 |
| DM-04 | Shadows adapt for dark mode (lighter shadows or glow instead of drop shadow) | P3 |
| DM-05 | Form inputs readable in dark mode (proper background + text contrast) | P1 |
| DM-06 | Images/illustrations don't clash with dark backgrounds (consider `mix-blend-mode` or dark variants) | P2 |
| DM-07 | Status badges (success/error/warning) visible and readable in both modes | P1 |
| DM-08 | Scrollbar styling adapts or uses `color-scheme: dark` | P3 |
| DM-09 | No flash of wrong theme on page load (theme applied before first paint) | P2 |
| DM-10 | All modal/overlay backdrops render correctly in dark mode | P2 |

```bash
# Find hardcoded colors that bypass design tokens
rg -n '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' apps/*/src --glob '*.css' --glob '*.tsx' | head -30
rg -n 'text-black|text-white|bg-white|bg-black|text-gray-[0-9]|bg-gray-[0-9]' apps/*/src --glob '*.tsx' | head -20
# Verify theme is applied before React renders
rg -n 'applyStoredTheme|data-theme' apps/*/src --glob '*.tsx' --glob '*.html'
```

### J) Data Table Patterns

Data tables are a core UI element. Every table-based view MUST follow these patterns:

| Check | Requirement | Severity |
|-------|-------------|----------|
| DT-01 | Tables use semantic `<table>`, `<thead>`, `<tbody>`, `<th>`, `<td>` elements | P1 |
| DT-02 | Column headers have `scope="col"` for screen readers | P1 |
| DT-03 | Sortable columns have `aria-sort` attribute and visual indicator (arrow icon) | P2 |
| DT-04 | Tables responsive on mobile: data-dense record tables reflow into stacked cards below breakpoint; horizontal scroll is reserved for true matrix content only | P1 |
| DT-05 | Table rows have adequate height (min 44px) for touch | P1 |
| DT-06 | Pagination controls present for large datasets (not rendering 500+ rows) | P2 |
| DT-07 | Table empty state shown when no rows match (not just empty `<tbody>`) | P1 |
| DT-08 | Loading state: skeleton rows or spinner overlay during data fetch | P2 |
| DT-09 | Sticky table header on scroll for long tables | P3 |
| DT-10 | Row selection/actions use checkboxes (not just click-to-select) | P3 |

### K) Search & Filter UX

| Check | Requirement | Severity |
|-------|-------------|----------|
| SF-01 | Search input has debounce (300-500ms) to avoid excessive API calls | P2 |
| SF-02 | Search input has clear button (×) when non-empty | P2 |
| SF-03 | "No results" state when search/filter returns empty (not blank screen) | P1 |
| SF-04 | Active filter count or badges showing applied filters | P2 |
| SF-05 | "Clear all filters" action available when filters are applied | P2 |
| SF-06 | Search input has appropriate `type="search"` and `role="searchbox"` | P2 |
| SF-07 | Filter state persisted in URL params (allows sharing/bookmarking filtered views) | P3 |

### L) Scroll & Content Behavior

| Check | Requirement | Severity |
|-------|-------------|----------|
| SC-01 | Long lists virtualized or paginated (not rendering 1000+ DOM nodes) | P2 |
| SC-02 | Scroll position restored on back navigation | P2 |
| SC-03 | Sticky headers/toolbars don't overlap scrollable content | P1 |
| SC-04 | Infinite scroll has "loading more" indicator at bottom | P3 |
| SC-05 | Page does not have competing scroll containers (nested scroll confusion) | P2 |

### M) Image & Media Handling

| Check | Requirement | Severity |
|-------|-------------|----------|
| IM-01 | Images use `loading="lazy"` for below-fold content | P2 |
| IM-02 | Images have `alt` text (empty `alt=""` for decorative images) | P1 |
| IM-03 | Image containers have fixed aspect-ratio to prevent layout shift (CLS) | P2 |
| IM-04 | Broken image fallback (placeholder or error state) | P2 |
| IM-05 | SVG icons have `aria-hidden="true"` when decorative | P1 |

## Phase 6: Internationalization and Content Quality

### A) Citizen App Bilingual Compliance

- Use `<Bilingual tKey="..."/>` for bilingual labels/headings where required.
- Use `t("...")` for non-bilingual action text and messages.
- Ensure keys exist across `en.ts`, `hi.ts`, `pa.ts`.
- Flag hardcoded strings in JSX.

### B) Policing App Trilingual Compliance (dopams-ui, forensic-ui, social-media-ui)

- All user-visible text must use `t()` i18n keys.
- Ensure keys exist across all 4 locale files: `en.ts`, `hi.ts`, `te.ts`, `pa.ts`.
- Login screen keys: `login.remember_me`, `login.forgot_password`, `login.back_to_login`, `login.forgot_instructions`, `login.email_or_username`, `login.email_or_username_placeholder`, `login.send_reset_link`, `login.reset_link_sent`, `login.failed`, `login.footer_text`.
- Verify that Hindi locale files have actual Hindi translations (not English copies).
- Verify that Telugu locale files have actual Telugu translations.
- Verify that Punjabi locale files (`pa.ts`) have actual Punjabi translations.

### C) Layout Resilience for Longer Strings

- Hindi/Telugu/Punjabi expansion does not break layouts.
- Proper wrapping/truncation strategies in constrained UI.
- Login screen must accommodate longer translated text without overflow (especially footer and forgot-password instructions).

### D) Non-citizen App Content Hygiene

- Avoid accidental hardcoded copy where i18n is expected.
- Consistent error phrasing and tone across modules.

## Phase 7: Frontend Performance and Perceived Speed

### A) Build and Bundle

- Bundle sizes and growth hotspots (flag bundles > 250KB gzipped).
- Route-level splitting and lazy loading coverage.
- Tree-shaking risks from broad shared exports.

Performance verification:
```bash
# Build and check output sizes
npm run build --workspace=<app-dir> 2>&1 | tail -20
# Check for lazy loading / code splitting
rg -n "React\.lazy|import\(" <app-dir>/src --glob '*.tsx' | head -10
# Check for barrel re-exports defeating tree-shaking
rg -n "export \* from" <app-dir>/src --glob '*.ts' --glob '*.tsx'
```

### B) Render Efficiency

- Re-render hotspots in large lists/forms.
- Expensive computations in render path.
- Oversized files that indicate poor component boundaries.

### C) Perceived Performance

- Skeleton strategy quality on data-heavy screens: skeleton should match content height, use pulse animation, and disappear on data load.
- Layout stability and visible feedback responsiveness (target CLS < 0.1).
- Progress communication for long-running operations.
- Web Vitals targets: LCP < 2.5s, FID < 100ms, CLS < 0.1.

## Phase 8: QA Gates and Release Verdict

Assess each gate as `PASS`, `PARTIAL`, `FAIL`.

Blocking gates:

1. Accessibility (WCAG 2.1 AA)
2. Mobile responsiveness
3. Mobile navigation (collapsible sidebar, hamburger menu, menu icons)
4. Login screen completeness (full-fledged login with all required features)
5. Interaction predictability
6. Sensitive action safety
7. System status visibility (loading, error, empty states)
8. Error prevention and recovery
9. Progressive disclosure
10. State resilience
11. Graceful degradation/offline handling
12. Empty state coverage (no blank screens)
13. Error boundary coverage (no white-screen crashes)
14. UI determinism (same input always produces same visible output)
15. Behavioral trust (user can predict what an action will do before performing it)
16. Component substance (no skeleton/stub components: every form has fields, every wizard step has content, every data view renders data — see FM-10 through FM-13 and Phase 1 substance audit)

Non-blocking gates:

1. Perceived performance
2. Temporal awareness
3. Input efficiency
4. UX observability
5. Animation/motion quality
6. Dark mode completeness
7. Tailwind/shadcn component adoption

Release policy:

- Any blocking gate = `FAIL` => `NO-GO`.
- Blocking gates all `PASS` or `PARTIAL` with no `FAIL` => eligible `GO` with conditions.

Use verdict block:

```text
WCAG Status:            [PASS | PARTIAL | FAIL]
Mobile Readiness:       [PASS | FAIL]
Mobile Navigation:      [PASS | PARTIAL | FAIL]
Login Completeness:     [PASS | PARTIAL | FAIL]
Empty/Error States:     [PASS | PARTIAL | FAIL]
Component Substance:    [PASS | PARTIAL | FAIL]  (skeleton/stub detection)
Blocking Gates:         X/16 PASS, Y/16 PARTIAL, Z/16 FAIL
Tailwind/shadcn:        [PASS | PARTIAL | FAIL]
Non-Blocking Gates:     X/7 PASS, Y/7 PARTIAL, Z/7 FAIL
Release Decision:       [GO | NO-GO]
```

## Phase 9: Bugs and Foot-Guns

### Common Fix Patterns

| Violation | Fix |
|-----------|-----|
| `label={t("key")}` | Replace with `label={<Bilingual tKey="key" />}` |
| `100vh` in CSS | Replace with `100dvh` |
| Hardcoded `#fff` color | Replace with `var(--color-surface)` or appropriate token |
| `@media (max-width: 768px)` | Replace with `@media (max-width: 48rem)` |
| `<div onClick={...}>` | Replace with `<button type="button" onClick={...}>` |
| Missing `aria-label` on icon button | Add `aria-label={t("common.action_name")}` |
| Interactive element < 44px | Add `min-height: 2.75rem` (or `3rem` on mobile for primary actions) |
| `:hover` without `:active` | Add matching `:active` state (e.g., `opacity: 0.8` or `transform: scale(0.98)`) |
| Hardcoded `"Yes"/"No"` | Replace with `t("common.yes")/t("common.no")` |
| Non-collapsible sidebar on mobile | Add hamburger toggle + `translate-x` transform with `md:translate-x-0` |
| Menu item without icon | Add consistent icon (lucide-react or similar) with `aria-hidden="true"` |
| Missing hamburger button on mobile | Add `<button aria-label="Open menu" className="md:hidden">` with menu icon |
| No empty state on list view | Add conditional render when `data.length === 0` with icon + message + CTA |
| Missing Error Boundary | Wrap route content in `<ErrorBoundary>` component |
| No 404 page | Add `<Route path="*" element={<NotFoundPage />} />` |
| Blank screen on data load | Add skeleton/loading component matching content layout |
| Modal without focus trap | Add `onKeyDown` Tab handler or use `<dialog>` element |
| Missing `autocomplete` on form inputs | Add `autocomplete="username"` / `autocomplete="current-password"` etc. |
| No `prefers-reduced-motion` handling | Add `@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }` |
| Login without theme support | Ensure all login CSS uses `var(--color-*)` tokens, test in dark mode |
| Raw `<button>` when shadcn exists | Replace with `<Button>` from `components/ui/button` with appropriate `variant` and `size` props |
| Raw `<input>` when shadcn exists | Replace with `<Input>` from `components/ui/input` |
| Custom modal implementation | Replace with `<Dialog>` from `components/ui/dialog` (built-in focus trap, backdrop, Escape handling) |
| Custom dropdown/popover | Replace with `<DropdownMenu>` from `components/ui/dropdown-menu` |
| Custom toast/notification | Replace with `sonner` or `components/ui/toast` with `useToast` hook |
| Inline `style={{}}` for layout | Replace with Tailwind utility classes (`flex`, `grid`, `p-4`, `gap-2`, etc.) |
| Raw hex in `className` (`bg-[#ff0000]`) | Use Tailwind theme color (`bg-destructive`) or CSS variable (`bg-[var(--color-error)]`) |
| Manual string concat for classes | Use `cn()` helper from `lib/utils` for conditional class merging |
| Custom `@media` queries | Use Tailwind responsive prefixes (`sm:`, `md:`, `lg:`, `xl:`) |

Minimum counts:

- Full-repo UI review: `10+` high-impact and `10+` medium-impact findings.
- Scoped UI review: `5+` high-impact and `5+` medium-impact findings.

Each finding must include:

- Severity, confidence, and status
- Exact file:line evidence
- UX/user-impact statement
- Specific fix
- Verification steps

## Phase 10: BRD UI Compliance Matrix

Create traceability matrix:

| BRD ID | UI Requirement | Evidence (File:Line or Artifact) | Status | Gap | Next Step |
|--------|----------------|-----------------------------------|--------|-----|-----------|

Focus on:

- Mobile-first obligations
- Language/bilingual obligations
- PII masking and reveal controls
- Evidence chain display and governance cues
- Timeout/session UX requirements
- SLA/progress visibility obligations

## Phase 11: Architect Backlog (UI/UX)

Backlog size:

- Full-repo: `25-50` items
- Scoped: `10-25` items

Use table:

| ID | Title | Priority | Risk Score | Effort | Area | Where | Why | Change | Verify | Dependencies |
|----|-------|----------|------------|--------|------|-------|-----|--------|--------|--------------|

Priority:

- `P0`: immediate
- `P1`: this sprint
- `P2`: next sprint
- `P3`: hardening

Effort:

- `S`: under 2 hours
- `M`: 2 hours to 2 days
- `L`: more than 2 days

## Phase 12: Quick Wins and Stabilization

- Quick wins (2 hours): `5-10` fixes.
- 2-day stabilization: `8-15` fixes with meaningful risk reduction.

Each task must include exact file targets and exact verification steps.

## Phase 13: Verification Commands

Prefer `rg` for audits.
Record each command as `Executed` or `Not Executed`.

```bash
# Anti-pattern checks
rg -n 'label=\{t\(' apps/citizen/src --glob '*.tsx'
rg -n '\b100vh\b' apps/*/src --glob '*.css'
rg -n '@media[^{]*[0-9]+px' apps/*/src --glob '*.css'
rg -n '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' apps/*/src --glob '*.css'
rg -n '\bpadding:\s*[0-9.]+(px|rem)|\bmargin:\s*[0-9.]+(px|rem)' apps/*/src --glob '*.css'

# Faceted filter pattern checks
# Verify all list views use facetOptions helper (no plain hardcoded <option> without counts)
rg -n 'facetOptions' apps/dopams-ui/src/views apps/forensic-ui/src/views apps/social-media-ui/src/views --glob '*.tsx'
# Verify facet fetch endpoints exist in all list views
rg -n '/facets' apps/dopams-ui/src/views apps/forensic-ui/src/views apps/social-media-ui/src/views --glob '*.tsx'
# Verify API facet routes are registered before /:id routes
rg -n 'facets' apps/dopams-api/src/routes apps/forensic-api/src/routes apps/social-media-api/src/routes --glob '*.ts'

# Login screen pattern checks
# Verify all 3 login screens have remember-me, forgot-password, theme picker, footer
rg -n 'rememberMe|remember_me' apps/dopams-ui/src/Login.tsx apps/forensic-ui/src/Login.tsx apps/social-media-ui/src/Login.tsx
rg -n 'forgotMode|forgot_password' apps/dopams-ui/src/Login.tsx apps/forensic-ui/src/Login.tsx apps/social-media-ui/src/Login.tsx
rg -n 'THEME_LABELS|CUSTOM_THEMES' apps/dopams-ui/src/Login.tsx apps/forensic-ui/src/Login.tsx apps/social-media-ui/src/Login.tsx
rg -n 'footer_text' apps/dopams-ui/src/Login.tsx apps/forensic-ui/src/Login.tsx apps/social-media-ui/src/Login.tsx
# Verify dedicated login.css exists and is imported
rg -n 'login\.css' apps/dopams-ui/src/Login.tsx apps/forensic-ui/src/Login.tsx apps/social-media-ui/src/Login.tsx

# Dashboard drill-down checks
# Verify stat cards use <button> not <div>
rg -n 'stat-card--clickable' apps/dopams-ui/src/views/Dashboard.tsx apps/forensic-ui/src/views/Dashboard.tsx apps/social-media-ui/src/views/Dashboard.tsx
rg -n 'onNavigate' apps/dopams-ui/src/views/Dashboard.tsx apps/forensic-ui/src/views/Dashboard.tsx apps/social-media-ui/src/views/Dashboard.tsx
# Verify clickable stat card CSS has hover + active + focus-visible
rg -n 'stat-card--clickable' apps/dopams-ui/src/app.css apps/forensic-ui/src/app.css apps/social-media-ui/src/app.css

# Underline tabs pattern checks
# Verify tab styles exist in every app that uses <Tabs>
rg -l 'Tabs' apps/dopams-ui/src/views apps/forensic-ui/src/views apps/social-media-ui/src/views --glob '*.tsx'
rg -n 'ui-tabs' apps/dopams-ui/src/app.css apps/forensic-ui/src/app.css apps/social-media-ui/src/app.css

# Keyboard-navigable table row checks
# Find clickable <tr> rows without keyboard handlers
rg -n 'onClick.*navigate' apps/*/src/views --glob '*.tsx' -l
rg -n 'onKeyDown' apps/*/src/views --glob '*.tsx' -l
# These two lists should match — any file in the first but not the second is a violation

# Mobile-responsive grid checks
# Find hardcoded 2-column grids in detail views
rg -n 'gridTemplateColumns.*1fr 1fr' apps/*/src/views --glob '*.tsx'
# All should use repeat(auto-fit, minmax(16rem, 1fr)) instead

# Boolean badge i18n checks
rg -n '"Yes"|"No"' apps/*/src/views --glob '*.tsx'

# i18n completeness checks
# Verify all 4 locale files exist per app
ls apps/dopams-ui/src/locales/{en,hi,te,pa}.ts
ls apps/forensic-ui/src/locales/{en,hi,te,pa}.ts
ls apps/social-media-ui/src/locales/{en,hi,te,pa}.ts
# Verify login keys exist in all locales
rg -n 'login\.remember_me|login\.forgot_password|login\.footer_text' apps/dopams-ui/src/locales apps/forensic-ui/src/locales apps/social-media-ui/src/locales --glob '*.ts'

# API hardening checks
# Verify unit_id uses ::uuid not ::text
rg -n 'unit_id = \$[0-9]+::text' apps/dopams-api/src apps/forensic-api/src apps/social-media-api/src --glob '*.ts'
# Verify auth returns token in body
rg -n 'token' apps/dopams-api/src/routes/auth.routes.ts apps/forensic-api/src/routes/auth.routes.ts apps/social-media-api/src/routes/auth.routes.ts

# --- Mobile-First Navigation Checks ---

# Sidebar collapsibility
rg -n 'translate-x|isOpen|isSidebarOpen|sidebarOpen|menuOpen' apps/*/src --glob '*.tsx'
# Hamburger button presence
rg -n 'hamburger|menu-toggle|Menu.*icon|MenuIcon' apps/*/src --glob '*.tsx'
rg -n 'md:hidden.*button|lg:hidden.*button' apps/*/src --glob '*.tsx'
# Menu item icons (every NavLink/nav item should have an icon)
rg -n 'NavLink' apps/*/src --glob '*.tsx' -A 2
# Sidebar aria attributes
rg -n 'aria-expanded|aria-label.*nav|aria-label.*menu' apps/*/src --glob '*.tsx'
# Backdrop/overlay when sidebar open on mobile
rg -n 'backdrop|overlay|bg-black/50|bg-black.*opacity' apps/*/src --glob '*.tsx'

# --- Login Screen Completeness Checks ---

# Full-fledged login features
rg -n 'autocomplete=' apps/*/src --glob '*ogin*'
rg -n 'aria-live|role="alert"' apps/*/src --glob '*ogin*'
rg -n 'focus-visible' apps/*/src --glob '*ogin*'
rg -n '<form' apps/*/src --glob '*ogin*'
rg -n 'disabled.*loading|loading.*disabled' apps/*/src --glob '*ogin*'
rg -n 'remember|Remember' apps/*/src --glob '*ogin*'
rg -n 'forgot|Forgot' apps/*/src --glob '*ogin*'
rg -n 'showPassword|togglePassword|eye' apps/*/src --glob '*ogin*'
rg -n '100dvh' apps/*/src --glob '*ogin*'

# --- Empty State & Error Boundary Checks ---

# Empty states
rg -n 'empty|no.*data|no.*results|nothing.*here' apps/*/src --glob '*.tsx' -i | head -20
rg -n 'length === 0|\.length === 0' apps/*/src --glob '*.tsx' | head -20
# Error boundary
rg -n 'ErrorBoundary|componentDidCatch|getDerivedStateFromError' apps/*/src --glob '*.tsx'
# 404 catch-all
rg -n 'path="\*"' apps/*/src --glob '*.tsx'
# Loading/skeleton
rg -n 'Skeleton|skeleton|shimmer|isLoading|isPending' apps/*/src --glob '*.tsx' | head -20
rg -n 'Suspense|React\.lazy' apps/*/src --glob '*.tsx'

# --- Accessibility & Motion Checks ---

# prefers-reduced-motion
rg -n 'prefers-reduced-motion' apps/*/src --glob '*.css' --glob '*.tsx'
# Focus trap in modals
rg -n 'dialog|Dialog|modal|Modal' apps/*/src --glob '*.tsx' -l
rg -n 'aria-modal|role="dialog"' apps/*/src --glob '*.tsx'
# Viewport meta tag
rg -n 'viewport' apps/*/index.html

# Build checks for UI apps (run whichever apps are present)
npm run build:web 2>&1 | tail -20
npm run build:all 2>&1 | tail -20

# Repo-level checks helpful for UI quality
npm run test:e2e 2>&1 | tail -20
```

If a command fails, include failure summary and likely root cause.

## Output

Ensure the final review document contains these sections in order:

1. Scope and Preflight
2. UI Inventory (routes, components, CSS, navigation, empty/error/loading coverage)
3. Login Screen Completeness Audit (scored against §2B checklist)
4. Mobile Navigation Audit (scored against Phase 3 §A-§B checklists)
5. Design System Findings
6. Tailwind/shadcn Component Adoption Findings
7. Responsive & Mobile-First Findings
7. Accessibility Findings
8. Interaction & State Findings
9. Empty State / Error Boundary / Loading Pattern Findings
10. Modern UI Pattern Findings (toasts, modals, forms, cards, animation)
11. QA Gates and Verdict (15 blocking + 7 non-blocking)
12. Bugs and Foot-Guns
13. BRD UI Compliance Matrix (if BRD exists)
14. UI Architect Backlog
15. Quick Wins and Stabilization
16. Top 5 Priorities

If `docs/reviews/` does not exist, create it before writing the report.
