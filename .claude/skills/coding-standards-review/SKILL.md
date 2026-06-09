---
name: coding-standards-review
description: Comprehensive coding standards compliance review covering security, code quality, UI/UX accessibility, dark mode, data tables, forms, modals, navigation, performance, and infrastructure. Scans codebase against 200+ rules and produces a prioritized violation report with a compliance verdict.
argument-hint: "[target]"
user_invocable: true
---

# Coding Standards Review Playbook

Scan the codebase against the project's coding standards (200+ rules across security, quality, UI/UX, and infrastructure) and produce a prioritized violation report with a compliance verdict.

## Scoping

If the user specifies a target (example: `/coding-standards-review apps/api`), review only that directory. Otherwise review the full project.

Generate a safe output slug from the target: replace `/` with `-`, remove spaces. Example: `apps/web` becomes `apps-web`. If no target, use `full-repo`.

## Severity Levels

| Level | Definition | Action |
|-------|-----------|--------|
| P0 / CRITICAL | Security breach, data loss, crashes | Fix immediately |
| P1 / HIGH | Accessibility failure, broken UX, bad practice | Fix this sprint |
| P2 / MEDIUM | Inconsistency, minor UX gap, maintainability | Fix next sprint |
| P3 / LOW | Polish, nice-to-have, hardening | Backlog |

## Operating Rules

- Evidence-first: cite exact `file:line` for every finding.
- Run verification commands; never assume compliance without checking.
- Mark each check as `PASS`, `VIOLATION`, or `NOT APPLICABLE`.
- Group findings by domain, then sort by severity within each domain.
- Save final report to `docs/reviews/coding-standards-review-{targetSlug}-{YYYY-MM-DD}.md`.

---

## Phase 1: Security Standards

### 1A. Injection Prevention

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| SEC-01 | All SQL uses parameterized queries (`$1`, `$2`) — no string concatenation/interpolation | P0 | `rg -n '\$\{.*\}.*SELECT\|SELECT.*\+\|query\(.*\`' {target} --glob '*.ts' --glob '*.py'` |
| SEC-02 | Dynamic table/column names validated against allowlists | P0 | `rg -n 'ORDER BY.*\$\|FROM.*\$' {target} --glob '*.ts'` |
| SEC-03 | No `eval()`, `exec()`, `spawn()`, `system()` with user input | P0 | `rg -n 'eval\(\|exec\(\|spawn\(\|system\(' {target} --glob '*.ts' --glob '*.py'` |
| SEC-04 | No `dangerouslySetInnerHTML` without DOMPurify | P0 | `rg -n 'dangerouslySetInnerHTML' {target} --glob '*.tsx'` |
| SEC-05 | File paths from user input validated — no `../` traversal | P0 | `rg -n 'path\.join\|path\.resolve' {target} --glob '*.ts' -A 2` |
| SEC-06 | Upload filenames are generated, not user-supplied | P1 | `rg -n 'filename\|fileName\|file_name' {target} --glob '*.ts' -A 3` |

### 1B. Authentication

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| SEC-07 | Auth tokens in httpOnly+secure+sameSite cookies (not localStorage) | P0 | `rg -n 'localStorage.*token\|sessionStorage.*token' {target} --glob '*.ts' --glob '*.tsx'` |
| SEC-08 | Password hashing uses bcrypt/scrypt/argon2 | P0 | `rg -n 'createHash\|md5\|sha1\|sha256' {target} --glob '*.ts' -B 2` (flag if used for passwords) |
| SEC-09 | No plaintext passwords in logs/responses | P0 | `rg -n 'password\|passwd' {target} --glob '*.ts' -A 2` (check for logging) |
| SEC-10 | Rate limiting on login endpoints | P1 | `rg -n 'rateLimit\|rate-limit\|throttle' {target} --glob '*.ts'` |
| SEC-11 | Protected routes pass through auth middleware | P0 | Verify all route files register behind auth middleware |

### 1C. Authorization

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| SEC-12 | Every mutation endpoint has authorization checks | P0 | `rg -n 'app\.post\|app\.put\|app\.patch\|app\.delete' {target} --glob '*.ts' -A 5` (check for auth) |
| SEC-13 | Read endpoints filter by user scope (workspace, tenant) | P1 | `rg -n 'app\.get' {target}/src/routes --glob '*.ts' -A 5` |
| SEC-14 | No IDOR — object access verified against user scope | P0 | Check that resource queries include workspace/user filtering |

### 1D. Secrets & Data Protection

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| SEC-15 | No hardcoded secrets in source | P0 | `rg -n 'password\s*=\s*["\x27]\|api.key\s*=\s*["\x27]\|secret\s*=\s*["\x27]' {target} --glob '*.ts' -i` |
| SEC-16 | `.env` in `.gitignore` | P0 | `rg '^\.env$' .gitignore` |
| SEC-17 | No secrets in Dockerfiles | P0 | `rg -n 'ENV.*SECRET\|ENV.*PASSWORD\|ENV.*TOKEN\|ENV.*KEY=' {target} --glob 'Dockerfile*'` |
| SEC-18 | No `console.log` in production code | P1 | `rg -n 'console\.(log\|debug\|info)' {target}/src --glob '*.ts' --glob '*.tsx' --glob '!*.test.*'` |
| SEC-19 | CORS not set to `*` | P1 | `rg -n "origin.*['\"]\\*['\"]" {target} --glob '*.ts'` |

---

## Phase 2: Code Quality Standards

### 2A. Type Safety

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| QUA-01 | No `any` type annotations | P1 | `rg -n ': any\b\|: any;\|: any,\|: any)' {target}/src --glob '*.ts' --glob '*.tsx' --glob '!*.test.*'` |
| QUA-02 | No `as any` casts | P1 | `rg -n 'as any' {target}/src --glob '*.ts' --glob '*.tsx' --glob '!*.test.*'` |
| QUA-03 | No `@ts-ignore` without comment | P2 | `rg -n '@ts-ignore\|@ts-expect-error' {target}/src --glob '*.ts'` |
| QUA-04 | API inputs validated with Zod schemas | P1 | Check route handlers for schema validation before processing |

### 2B. Error Handling

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| QUA-05 | Async operations have error handling | P1 | `rg -n 'await ' {target}/src --glob '*.ts' --glob '!*.test.*' -A 3` (check for try/catch) |
| QUA-06 | No silently swallowed errors (`catch {}` or `catch(e) {}`) | P1 | `rg -n 'catch\s*\(\s*\w*\s*\)\s*\{\s*\}' {target}/src --glob '*.ts'` |
| QUA-07 | Error responses use project helpers (`send400`, `send404`) | P2 | `rg -n 'reply\.send.*error\|reply\.code\(4\|reply\.code\(5' {target}/src --glob '*.ts'` |
| QUA-08 | No stack traces in API responses | P1 | `rg -n 'stack\|stackTrace\|\.stack' {target}/src/routes --glob '*.ts'` |

### 2C. Database

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| QUA-09 | No N+1 queries (queries inside loops) | P1 | `rg -n 'for.*await.*query\|forEach.*query\|map.*query' {target}/src --glob '*.ts' --glob '*.py'` |
| QUA-10 | List endpoints have LIMIT/pagination | P1 | `rg -n 'SELECT.*FROM' {target}/src/routes --glob '*.ts'` (check for LIMIT) |
| QUA-11 | Multi-step mutations use transactions | P1 | Check endpoints with multiple INSERT/UPDATE for transaction wrapping |
| QUA-12 | Migrations are idempotent (`IF NOT EXISTS`) | P2 | `rg -n 'CREATE TABLE\|CREATE INDEX' {target}/src/migrations --glob '*.sql'` (check for IF NOT EXISTS) |
| QUA-13 | Audit fields present (`created_at`, `updated_at`) | P2 | `rg -n 'CREATE TABLE' {target}/src/migrations --glob '*.sql' -A 20` |

### 2D. Code Maintainability

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| QUA-14 | No files > 500 lines | P2 | `wc -l {target}/src/**/*.ts {target}/src/**/*.tsx 2>/dev/null \| awk '$1 > 500' \| head -10` |
| QUA-15 | No functions > 50 lines | P2 | Manual review of largest files |
| QUA-16 | No commented-out code blocks | P2 | `rg -n '^\s*//.*\w.*\(.*\)\|^\s*//.*=.*\|^\s*//.*return' {target}/src --glob '*.ts' --glob '*.tsx'` |
| QUA-17 | No dead/unused imports | P2 | TypeScript compiler warnings or `rg -n '^import ' {target}/src --glob '*.ts'` cross-referenced with usage |
| QUA-18 | Workspace alias imports (not relative into packages/) | P2 | `rg -n "from ['\"]\\.\\..*packages/" {target}/src --glob '*.ts'` |

---

## Phase 3: UI/UX & Accessibility Standards

Skip this phase if target has no `.tsx` files. Check: `ls {target}/src/**/*.tsx 2>/dev/null | head -1`.

### 3A. Semantic HTML & Accessibility

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| UIA-01 | No `<div onClick>` or `<span onClick>` — use `<button>` or `<a>` | P1 | `rg -n '<div.*onClick\|<span.*onClick' {target}/src --glob '*.tsx'` |
| UIA-02 | Icon-only buttons have `aria-label` | P1 | `rg -n '<button' {target}/src --glob '*.tsx' -A 2 \| grep -v 'aria-label'` |
| UIA-03 | Buttons specify `type="button"` or `type="submit"` | P1 | `rg -n '<button' {target}/src --glob '*.tsx' \| grep -v 'type='` |
| UIA-04 | Decorative SVGs have `aria-hidden="true"` | P1 | `rg -n '<svg\|<Icon\|Icon ' {target}/src --glob '*.tsx' \| grep -v 'aria-hidden'` |
| UIA-05 | All `<img>` have `alt` attribute | P1 | `rg -n '<img ' {target}/src --glob '*.tsx' \| grep -v 'alt='` |
| UIA-06 | Single `<h1>` per page; valid heading hierarchy | P1 | `rg -n '<h1\|<h2\|<h3' {target}/src/pages --glob '*.tsx'` |
| UIA-07 | Color contrast >= 4.5:1 normal text, 3:1 large text | P1 | Manual or automated check |
| UIA-08 | Visible `:focus-visible` on interactive elements | P1 | `rg -n 'focus-visible' {target}/src --glob '*.css' \| wc -l` |
| UIA-09 | `prefers-reduced-motion` respected | P1 | `rg -n 'prefers-reduced-motion' {target}/src --glob '*.css'` |
| UIA-10 | Clickable `<tr>` has `tabIndex={0}`, `role="link"`, `onKeyDown` | P1 | `rg -n '<tr.*onClick' {target}/src --glob '*.tsx' -A 2` |

### 3B. Data Tables

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| UIT-01 | Semantic `<table>/<thead>/<th>/<td>` elements | P1 | `rg -n '<table\|<thead\|<th\|<td' {target}/src --glob '*.tsx'` |
| UIT-02 | Column headers have `scope="col"` | P1 | `rg -n '<th' {target}/src --glob '*.tsx' \| grep -v 'scope='` |
| UIT-03 | Sortable columns have `aria-sort` | P2 | `rg -n 'sort\|Sort' {target}/src --glob '*.tsx' -A 2` (check for aria-sort) |
| UIT-04 | Tables wrapped in `overflow-x-auto` for mobile | P1 | `rg -n 'overflow-x-auto\|overflow-auto\|table-container' {target}/src --glob '*.tsx' --glob '*.css'` |
| UIT-05 | Table empty state (not just empty `<tbody>`) | P1 | `rg -n 'length === 0\|no.*data\|empty' {target}/src --glob '*.tsx'` near table components |
| UIT-06 | Pagination for large datasets | P2 | `rg -n 'pagination\|Pagination\|page.*limit\|nextPage' {target}/src --glob '*.tsx'` |

### 3C. Forms

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| UIF-01 | All inputs have visible labels (not placeholder-only) | P1 | `rg -n '<input\|<textarea\|<select' {target}/src --glob '*.tsx' -B 2` (check for `<label>`) |
| UIF-02 | Required fields indicated (asterisk or text) | P2 | `rg -n 'required' {target}/src --glob '*.tsx'` |
| UIF-03 | Inline validation errors next to field | P1 | `rg -n 'error.*message\|validation\|invalid' {target}/src --glob '*.tsx'` |
| UIF-04 | Submit button disabled during submission | P1 | `rg -n 'disabled.*loading\|isSubmitting\|isPending' {target}/src --glob '*.tsx'` |
| UIF-05 | `autocomplete` attributes on form inputs | P2 | `rg -n 'autocomplete=' {target}/src --glob '*.tsx'` |
| UIF-06 | Correct input types (`email`, `url`, `tel`, `number`) | P2 | `rg -n 'type="text"' {target}/src --glob '*.tsx'` (flag where specific type is better) |

### 3D. Modals & Dialogs

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| UIM-01 | Modals use `<dialog>` or `role="dialog"` + `aria-modal="true"` | P1 | `rg -n 'modal\|Modal\|dialog\|Dialog' {target}/src --glob '*.tsx' -l` then check semantics |
| UIM-02 | Focus trapped inside open modal | P1 | `rg -n 'focusTrap\|focus-trap\|onKeyDown.*Tab' {target}/src --glob '*.tsx'` |
| UIM-03 | Focus returns to trigger on close | P1 | Check modal close handlers for focus restoration |
| UIM-04 | Escape closes modal | P1 | `rg -n "Escape\|keydown" {target}/src --glob '*.tsx'` |
| UIM-05 | `aria-labelledby` on modal heading | P1 | `rg -n 'aria-labelledby' {target}/src --glob '*.tsx'` |
| UIM-06 | Destructive confirmations use explicit labels (not "OK") | P1 | `rg -n 'OK\|Cancel\|confirm' {target}/src --glob '*.tsx'` |

### 3E. Search & Filter

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| UIS-01 | Search debounced (300-500ms) | P2 | `rg -n 'debounce\|setTimeout.*search\|useDebounce' {target}/src --glob '*.tsx'` |
| UIS-02 | Search has clear button | P2 | `rg -n 'clear\|reset.*search\|×' {target}/src --glob '*.tsx'` near search inputs |
| UIS-03 | "No results" state distinct from data-empty | P1 | Check for separate empty/no-results messaging |
| UIS-04 | `type="search"` on search inputs | P2 | `rg -n 'type="search"\|role="searchbox"' {target}/src --glob '*.tsx'` |

### 3F. Toast & Notifications

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| UIN-01 | Mutation feedback via toast or inline message | P1 | `rg -n 'toast\|Toast\|notify\|Notify\|snackbar' {target}/src --glob '*.tsx'` |
| UIN-02 | Toast container has `role="status"` or `aria-live` | P1 | `rg -n 'aria-live\|role="status"' {target}/src --glob '*.tsx'` |
| UIN-03 | Toasts auto-dismiss (3-5s) | P2 | Check toast configuration for timeout |

### 3G. Navigation

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| UIN-04 | Sidebar collapses on mobile (hamburger toggle) | P0 | `rg -n 'hamburger\|isOpen\|menuOpen\|translate-x' {target}/src --glob '*.tsx'` |
| UIN-05 | Hamburger has dynamic `aria-label` + `aria-expanded` | P1 | `rg -n 'aria-expanded\|aria-label.*menu' {target}/src --glob '*.tsx'` |
| UIN-06 | Mobile sidebar: overlay + backdrop + Escape to close | P1 | `rg -n 'backdrop\|overlay\|bg-black/50' {target}/src --glob '*.tsx'` |
| UIN-07 | Menu items use `<a>`/`<NavLink>` (not `<div onClick>`) | P1 | `rg -n 'NavLink\|<a ' {target}/src/components --glob '*idebar*' --glob '*av*'` |
| UIN-08 | Menu icons consistent + `aria-hidden="true"` | P2 | `rg -n 'aria-hidden' {target}/src/components --glob '*idebar*'` |

### 3H. State Management

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| UIS-05 | Every data component has loading + empty + error states | P1 | `rg -n 'isLoading\|isPending\|isError\|error' {target}/src --glob '*.tsx'` |
| UIS-06 | Empty states: icon + heading + description + CTA | P1 | `rg -n 'length === 0' {target}/src --glob '*.tsx' -A 5` |
| UIS-07 | React Error Boundary wraps main content | P1 | `rg -n 'ErrorBoundary' {target}/src --glob '*.tsx'` |
| UIS-08 | 404 catch-all route exists | P1 | `rg -n 'path="\*"' {target}/src --glob '*.tsx'` |
| UIS-09 | Skeleton loading (not just spinner) | P2 | `rg -n 'Skeleton\|skeleton\|shimmer' {target}/src --glob '*.tsx'` |
| UIS-10 | No indefinite spinners (timeout + fallback) | P2 | Check loading components for timeout logic |

### 3I. Dark Mode

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| UID-01 | Text colors via tokens — no hardcoded `#333`, `black`, `gray-900` | P1 | `rg -n 'text-black\|text-white\|text-gray-[0-9]' {target}/src --glob '*.tsx' \| head -20` |
| UID-02 | Background colors via tokens — no hardcoded `white`, `#fff` | P1 | `rg -n 'bg-white\|bg-black\|bg-gray-[0-9]' {target}/src --glob '*.tsx' \| head -20` |
| UID-03 | No hardcoded hex/rgb in CSS | P2 | `rg -n '#[0-9a-fA-F]{3,8}\b\|rgb\(\|hsl\(' {target}/src --glob '*.css' \| head -20` |
| UID-04 | No flash of wrong theme on load | P2 | `rg -n 'data-theme\|applyStoredTheme' {target}/src --glob '*.tsx' --glob '*.html'` |
| UID-05 | No hardcoded Tailwind semantic colors (red/amber/green/blue/gray etc.) | P1 | `bash scripts/lint-theme-tokens.sh {target}/src` (automated: catches hardcoded colors, dead `dark:` prefixes, non-existent utility classes) |
| UID-06 | No Tailwind `dark:` prefix (project uses `[data-theme]`, not Tailwind dark mode) | P1 | `grep -rn 'dark:' {target}/src --include='*.tsx'` |
| UID-07 | No non-existent utility classes (e.g., `text-text-secondary`, `border-border-primary`) | P1 | `grep -rn 'text-text-\|bg-surface-secondary\|border-border-' {target}/src --include='*.tsx'` |

### 3J. Responsive Design

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| UIR-01 | `100dvh` not `100vh` for full-height layouts | P1 | `rg -n '100vh' {target}/src --glob '*.css' --glob '*.tsx'` |
| UIR-02 | Breakpoints in `rem` (not `px`) | P2 | `rg -n '@media[^{]*[0-9]+px' {target}/src --glob '*.css'` |
| UIR-03 | No fixed pixel widths >= 100px | P2 | `rg -n 'width:\s*[0-9]{3,}px' {target}/src --glob '*.css' --glob '*.tsx'` |
| UIR-04 | Mobile-first: `min-width` queries (not `max-width` for mobile) | P2 | `rg -n 'max-width' {target}/src --glob '*.css' \| grep '@media'` |
| UIR-05 | Viewport meta tag present | P0 | `rg -n 'viewport' {target}/index.html` |
| UIR-06 | Detail grids use `auto-fit` (not fixed `1fr 1fr`) | P2 | `rg -n 'gridTemplateColumns.*1fr 1fr' {target}/src --glob '*.tsx'` |

### 3K. Design System

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| UIK-01 | No hardcoded hex/rgb — use `var(--color-*)` | P2 | `rg -n '#[0-9a-fA-F]{3,8}' {target}/src --glob '*.css' --glob '!design-system*'` |
| UIK-02 | No hardcoded spacing — use design tokens | P2 | `rg -n 'padding:\s*[0-9]+(px\|rem)\|margin:\s*[0-9]+(px\|rem)' {target}/src --glob '*.css'` |
| UIK-03 | No inline styles with hardcoded values | P2 | `rg -n 'style={{' {target}/src --glob '*.tsx' \| grep -v 'var(--'` |

### 3L. Animation & Motion

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| UIA-11 | `prefers-reduced-motion` supported | P1 | `rg -n 'prefers-reduced-motion' {target}/src --glob '*.css'` |
| UIA-12 | Animations use `transform`/`opacity` only | P2 | `rg -n 'transition.*width\|transition.*height\|animation.*width' {target}/src --glob '*.css'` |

### 3M. Frontend Performance

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| UIP-01 | Route-level code splitting (`React.lazy` + `Suspense`) | P1 | `rg -n 'React\.lazy\|Suspense' {target}/src --glob '*.tsx'` |
| UIP-02 | No barrel re-exports defeating tree-shaking | P2 | `rg -n 'export \* from' {target}/src --glob '*.ts' --glob '*.tsx'` |
| UIP-03 | Images use `loading="lazy"` | P2 | `rg -n '<img ' {target}/src --glob '*.tsx' \| grep -v 'loading='` |
| UIP-04 | `credentials: "include"` on fetch to own API | P1 | `rg -n 'fetch\(' {target}/src --glob '*.ts' --glob '*.tsx' -A 3` |

### 3N. Login Screen

Skip if target has no login component. Check: `ls {target}/src/*ogin* 2>/dev/null | head -1`.

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| UIL-01 | Full-viewport centered (`100dvh`) | P1 | `rg -n '100dvh' {target}/src --glob '*ogin*'` |
| UIL-02 | Password visibility toggle | P1 | `rg -n 'showPassword\|togglePassword\|eye' {target}/src --glob '*ogin*'` |
| UIL-03 | `autocomplete` on username/password inputs | P2 | `rg -n 'autocomplete=' {target}/src --glob '*ogin*'` |
| UIL-04 | Loading state on submit button | P1 | `rg -n 'disabled.*loading\|isLoading' {target}/src --glob '*ogin*'` |
| UIL-05 | Error display with `role="alert"` or `aria-live` | P1 | `rg -n 'aria-live\|role="alert"' {target}/src --glob '*ogin*'` |
| UIL-06 | Native `<form>` with `onSubmit` (Enter key works) | P1 | `rg -n '<form' {target}/src --glob '*ogin*'` |
| UIL-07 | Input font-size >= 16px (`text-base` or `1rem`) | P2 | Check login CSS for font sizes |

### 3O. Internationalization

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| UII-01 | No hardcoded user-visible strings | P1 | `rg -n '>[A-Z][a-z]+ [a-z]' {target}/src --glob '*.tsx' \| head -20` (flag English text in JSX) |
| UII-02 | Boolean displays use i18n (`t("common.yes")` not `"Yes"`) | P1 | `rg -n '"Yes"\|"No"' {target}/src --glob '*.tsx'` |
| UII-03 | i18n keys exist in all locale files | P1 | Compare key counts across locale files |

---

## Phase 4: Infrastructure Standards

Skip UI-specific checks for Python worker targets. Apply Docker/CI/reliability checks to all targets.

### 4A. Docker

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| INF-01 | Non-root user in Dockerfile (`USER` directive) | P1 | `rg -n 'USER ' {target}/Dockerfile Dockerfile* --glob 'Dockerfile*'` |
| INF-02 | Base images pinned (not `:latest`) | P1 | `rg -n 'FROM ' {target}/Dockerfile Dockerfile* --glob 'Dockerfile*'` |
| INF-03 | Multi-stage build (build tools not in prod image) | P2 | `rg -n 'FROM.*AS\|FROM.*as' {target}/Dockerfile Dockerfile*` |
| INF-04 | `npm ci` used (not `npm install`) | P2 | `rg -n 'npm install' {target}/Dockerfile Dockerfile*` (should be `npm ci`) |
| INF-05 | `.dockerignore` excludes `node_modules`, `.git`, `.env` | P2 | `cat .dockerignore` |

### 4B. Reliability

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| INF-06 | Graceful shutdown (SIGTERM/SIGINT handlers) | P1 | `rg -n 'SIGTERM\|SIGINT\|graceful' {target}/src --glob '*.ts' --glob '*.py'` |
| INF-07 | Health check endpoints exist | P1 | `rg -n '/health\|/ready\|/healthz' {target}/src --glob '*.ts' --glob '*.py'` |
| INF-08 | DB connections closed on shutdown | P1 | `rg -n 'pool\.end\|pool\.close\|connection\.close' {target}/src --glob '*.ts' --glob '*.py'` |
| INF-09 | Request timeouts configured | P2 | `rg -n 'timeout' {target}/src --glob '*.ts'` |

### 4C. Configuration

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| INF-10 | No hardcoded `localhost` in production paths | P2 | `rg -n 'localhost\|127\.0\.0\.1' {target}/src --glob '*.ts' --glob '*.py' --glob '!*.test.*'` |
| INF-11 | Env vars documented in `.env.example` | P2 | `cat .env.example` |
| INF-12 | Env var validation at startup | P2 | `rg -n 'process\.env\.\|os\.environ' {target}/src --glob '*.ts' --glob '*.py' \| head -10` |

### 4D. Observability

| ID | Check | Severity | Verification |
|----|-------|----------|--------------|
| INF-13 | Structured JSON logs (not `console.log`) | P1 | `rg -n 'console\.(log\|debug\|info\|warn\|error)' {target}/src --glob '*.ts' --glob '!*.test.*' \| wc -l` |
| INF-14 | All auth events logged | P2 | Check login/logout routes for logging |
| INF-15 | All data mutations logged | P2 | Check POST/PUT/PATCH/DELETE routes for audit logging |

---

## Phase 5: Build Verification

```bash
# Build packages + target
npm run build:packages 2>&1 | tail -5
npm run build 2>&1 | tail -10

# TypeScript strict check
npx tsc --noEmit 2>&1 | head -20

# Run tests
npm test 2>&1 | tail -20
```

Record results as PASS/FAIL with error count.

---

## Output

### Report Path

Save to: `docs/reviews/coding-standards-review-{targetSlug}-{YYYY-MM-DD}.md`

Create `docs/reviews/` if it does not exist.

### Finding Table

```markdown
| ID | Domain | Check | Severity | File:Line | Status | Fix |
|----|--------|-------|----------|-----------|--------|-----|
```

Status values: `PASS`, `VIOLATION`, `NOT APPLICABLE`, `SKIPPED`.

### Compliance Scorecard

```text
=== CODING STANDARDS COMPLIANCE ===

Security:        X/19 PASS, Y VIOLATION, Z N/A
Code Quality:    X/18 PASS, Y VIOLATION, Z N/A
UI/UX:           X/55 PASS, Y VIOLATION, Z N/A (or SKIPPED)
Infrastructure:  X/15 PASS, Y VIOLATION, Z N/A

Total:           X/107 PASS, Y VIOLATION, Z N/A
P0 Violations:   N
P1 Violations:   N
P2 Violations:   N
P3 Violations:   N

Verdict:         [COMPLIANT | NEEDS-WORK | NON-COMPLIANT]
```

### Verdict Rules

- **COMPLIANT**: Zero P0/P1 violations.
- **NEEDS-WORK**: Zero P0, fewer than 5 P1 violations.
- **NON-COMPLIANT**: Any P0, or 5+ P1 violations.

### Report Sections

1. **Scope** — target, date, commit hash
2. **Executive Summary** — verdict, top 3 findings
3. **Finding Table** — all checks with status, sorted by severity
4. **Verification Log** — commands executed and results
5. **Recommendations** — prioritized fix list
6. **Compliance Scorecard** — gate results
