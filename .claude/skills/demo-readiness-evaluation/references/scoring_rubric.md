# Demo Readiness Scoring Rubric

Each dimension is scored 1–10. Use the anchors below to assign scores consistently. Half-points (e.g., 6.5) are acceptable when evidence splits between two levels.

---

## 1. Value Proposition Clarity

| Score | Anchor |
|-------|--------|
| 1–2 | No visible branding, tagline, or onboarding. A stranger would have no idea what this app does. |
| 3–4 | Some clues (page titles, nav labels) but the "why should I care" is missing. Requires verbal explanation. |
| 5–6 | Landing/login screen communicates the domain. Core purpose is guessable within 2 minutes of clicking around. |
| 7–8 | Clear value proposition visible on first screen. Onboarding or dashboard immediately shows the core benefit. A prospect "gets it" in under 60 seconds. |
| 9–10 | First screen tells a compelling story. Metrics, social proof, or a guided tour make the value undeniable. Could be understood with no presenter narration. |

**Evidence to look for:** Login/landing page copy, dashboard layout, onboarding flows, help text, empty-state messages.

---

## 2. Core Functional Completeness

| Score | Anchor |
|-------|--------|
| 1–2 | Most routes/screens are stubs or throw errors. Fewer than 30% of the intended journeys work. |
| 3–4 | Happy path works for 1–2 journeys but others are incomplete. Dead-end screens visible. |
| 5–6 | Primary demo journey works end-to-end. Secondary journeys have gaps but can be avoided during the demo. |
| 7–8 | All planned demo journeys work. Minor edge cases may fail but nothing a structured demo would hit. |
| 9–10 | All journeys work, including edge cases. The presenter could go off-script and the app still holds up. Prospect can click around freely. |

**Evidence to look for:** Route definitions, screen components, API endpoints, TODO/FIXME in demo-path code, error boundaries.

---

## 3. Demo Data Quality

| Score | Anchor |
|-------|--------|
| 1–2 | Empty database or `test@test.com` / `Lorem ipsum` / `asdf` data. Three rows in every table. |
| 3–4 | Some realistic data but obviously fake (e.g., "John Doe" repeated, round numbers, no variety). |
| 5–6 | Data looks plausible at a glance. Enough rows to fill screens. But no narrative — it doesn't tell a story. |
| 7–8 | Story-driven data: named personas with realistic attributes, enough volume to look like a real system, variety in statuses/dates/amounts. Dashboards look populated. |
| 9–10 | Data is a curated narrative. Each persona has a journey that maps to the demo script. Charts show meaningful trends. The data itself is a selling point ("look how much insight you get"). |

**Evidence to look for:** Seed scripts, fixture files, migration data, hardcoded test values in code, screenshot-worthy dashboard state.

---

## 4. UI/UX Polish

| Score | Anchor |
|-------|--------|
| 1–2 | Unstyled or broken layout. Browser default styles visible. Overlapping elements, broken images. |
| 3–4 | Basic styling applied but inconsistent. Mixed font sizes, no design system, some elements misaligned. |
| 5–6 | Consistent design system. Looks professional. But missing polish: no loading states, empty states say "No data", no micro-interactions. |
| 7–8 | Polished and consistent. Loading spinners, meaningful empty states, smooth transitions, responsive on relevant devices. Minor rough edges only in non-demo paths. |
| 9–10 | Delightful. Thoughtful micro-interactions, beautiful data visualizations, contextual help, accessibility considered. Could be mistaken for a mature SaaS product. |

**Evidence to look for:** CSS/design-system files, component library usage, loading/error/empty state components, responsive breakpoints, animation/transition code.

---

## 5. Performance & Responsiveness

| Score | Anchor |
|-------|--------|
| 1–2 | Pages take 5+ seconds to load. Visible lag on every interaction. Spinners that never resolve. |
| 3–4 | Initial load is slow (3–5s). Some interactions feel laggy. API calls take 2+ seconds. |
| 5–6 | Acceptable performance. Pages load in 1–3s. Occasional lag on heavy operations but nothing embarrassing. |
| 7–8 | Fast. Pages load sub-second. API responses under 500ms. Optimistic UI updates where appropriate. |
| 9–10 | Snappy and impressive. Instant-feeling interactions. Pagination/virtualization for large lists. Performance itself is a wow moment. |

**Evidence to look for:** Bundle size, API query complexity, caching strategies, pagination implementation, lazy loading, CDN configuration.

---

## 6. Stability & Error Handling

| Score | Anchor |
|-------|--------|
| 1–2 | App crashes on common interactions. Unhandled exceptions visible in UI. White screens of death. |
| 3–4 | Happy path is stable but edge cases crash. Error messages are raw stack traces or generic "Something went wrong". |
| 5–6 | Demo path is stable. Errors are caught but messages aren't user-friendly. Some edge cases produce confusing states. |
| 7–8 | Robust error handling. User-friendly messages, graceful degradation, form validation prevents bad input. App recovers from network errors. |
| 9–10 | Battle-tested. Handles offline, timeouts, concurrent edits, malformed input. Error states are helpful and guide the user to recovery. |

**Evidence to look for:** Error boundary components, try/catch blocks, API error handling, form validation, offline detection, retry logic.

---

## 7. Wow Factor & Differentiation

| Score | Anchor |
|-------|--------|
| 1–2 | Generic CRUD app. Nothing memorable. "I've seen this before" feeling. |
| 3–4 | One mildly interesting feature but it doesn't land visually or isn't demo-ready. |
| 5–6 | A clear differentiator exists but it's buried or not highlighted. Needs verbal explanation to appreciate. |
| 7–8 | At least one "huh, that's clever" moment that's visually obvious and demo-ready. AI feature, automation, visualization, or speed that competitors don't have. |
| 9–10 | Multiple wow moments. The demo has a clear climax. Prospects would pull out their phones to take a photo of the screen. The differentiator is self-evident. |

**Evidence to look for:** AI/ML integrations, unique visualizations, automation workflows, real-time features, novel UX patterns, anything that couldn't be trivially replicated.

---

## 8. Integration & Ecosystem Story

| Score | Anchor |
|-------|--------|
| 1–2 | No integrations. Standalone app with no connection to the prospect's ecosystem. |
| 3–4 | Integrations exist in code but aren't configured or working in the demo environment. |
| 5–6 | Key integrations work (auth, maybe one data source) but aren't showcased. Export is CSV-only. |
| 7–8 | Integrations relevant to the prospect work and are demo-ready. API docs exist. Webhooks or real-time sync visible. |
| 9–10 | Rich ecosystem story. Multiple integrations, marketplace feel, API-first architecture visible. The prospect sees how this fits into their stack. |

**Evidence to look for:** Integration configuration, API documentation, webhook handlers, OAuth flows, import/export capabilities, SDK or plugin architecture.

---

## 9. Security, Privacy & Compliance Signals

| Score | Anchor |
|-------|--------|
| 1–2 | No auth, or auth is clearly mocked. Secrets in code. No HTTPS. Console logs expose sensitive data. |
| 3–4 | Basic auth works but no RBAC. Some secrets in environment but not managed. No audit trail. |
| 5–6 | Auth + basic RBAC. Secrets in env vars (not code). HTTPS configured. But no visible compliance artifacts. |
| 7–8 | Visible RBAC with meaningful roles. Audit log or activity feed. Environment hygiene is clean. Compliance-relevant features exist (data export, deletion, consent). |
| 9–10 | Compliance-ready. SOC 2 / GDPR / HIPAA signals visible (depending on domain). Audit logs, encryption indicators, data residency controls, security headers. A technical evaluator would be satisfied. |

**Evidence to look for:** Auth middleware, role definitions, audit log tables/routes, secret management, security headers, CORS configuration, data encryption, privacy policy links.

---

## 10. Deployment & Demo Environment Reliability

| Score | Anchor |
|-------|--------|
| 1–2 | Only runs on the developer's laptop with manual setup. No deployment pipeline. |
| 3–4 | Can be deployed but the process is manual and fragile. Demo environment may not match current code. |
| 5–6 | Deployed to a staging/cloud environment. Works most of the time but no monitoring or fast recovery. |
| 7–8 | Stable demo environment with CI/CD. Can be rebuilt in under 30 minutes. Has a monitoring dashboard. |
| 9–10 | Production-grade demo environment. Auto-scaling, monitoring, alerting. Backup environment ready. Can recover from failure in under 5 minutes. Pre-recorded fallback available. |

**Evidence to look for:** Dockerfile, CI/CD configs, deployment scripts, environment variables, monitoring setup, health check endpoints, staging URLs.

---

## 11. Narrative & Demo Flow Readiness

| Score | Anchor |
|-------|--------|
| 1–2 | No demo script. The app is a collection of features with no narrative thread. |
| 3–4 | Features exist but the presenter would have to improvise the story. No clear "before/after" moment. |
| 5–6 | A rough demo flow is possible (pain → feature → outcome) but transitions between features are awkward. |
| 7–8 | Clear narrative arc: prospect's problem → your solution → measurable result. Wow moment is well-placed. Transitions feel natural. |
| 9–10 | Compelling story. Opens with empathy for the prospect's pain, builds through increasingly impressive capabilities, climaxes with the wow moment, closes with quantified business impact. The app's UI naturally guides this flow. |

**Evidence to look for:** Dashboard as story opener, workflow completeness for the demo narrative, data that supports before/after comparison, in-app metrics or reporting that quantifies value.

---

## 12. Business Outcome Proof

| Score | Anchor |
|-------|--------|
| 1–2 | No metrics, dashboards, or evidence of business impact visible in the app. |
| 3–4 | Basic counts or statistics visible but they don't map to business outcomes. |
| 5–6 | Some outcome-relevant metrics (e.g., "applications processed") but not contextualized or compared to a baseline. |
| 7–8 | Dashboard or report screen shows business-relevant KPIs. Before/after comparison possible. ROI story is plausible. |
| 9–10 | Compelling business outcome visualization. Time-saved calculations, cost comparisons, efficiency gains clearly shown. The app makes its own business case. Case-study-worthy data visible. |

**Evidence to look for:** Dashboard components, report/analytics routes, KPI calculations, chart/graph components, export functionality for business reports.

---

## Weighted Scoring Formula

| Dimension | Weight |
|-----------|--------|
| 1. Value Proposition Clarity | 1.5x |
| 2. Core Functional Completeness | 1.5x |
| 3. Demo Data Quality | 1.5x |
| 4. UI/UX Polish | 1.0x |
| 5. Performance & Responsiveness | 1.0x |
| 6. Stability & Error Handling | 1.0x |
| 7. Wow Factor & Differentiation | 1.5x |
| 8. Integration & Ecosystem Story | 1.0x |
| 9. Security, Privacy & Compliance | 1.0x |
| 10. Deployment & Environment | 1.0x |
| 11. Narrative & Demo Flow | 1.5x |
| 12. Business Outcome Proof | 1.0x |

**Overall Score** = Sum(score × weight) / Sum(weights), rounded to 1 decimal.

**Traffic Light:**
- **Green (Go)**: Overall >= 7.5 and no deal-critical dimension below 6
- **Yellow (Go with caveats)**: Overall >= 5.5, or overall >= 7.5 but one deal-critical dimension below 6
- **Red (Fix first)**: Overall < 5.5, or two or more deal-critical dimensions below 5
