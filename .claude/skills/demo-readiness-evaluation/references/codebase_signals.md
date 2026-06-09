# Codebase Signals Checklist

Concrete things to look for in the codebase when evaluating each dimension. Use this as a discovery guide during Phase 1.

---

## 1. Value Proposition Clarity

- [ ] Login/landing page — does it have a tagline, logo, or value statement?
- [ ] Onboarding flow — is there a tour, wizard, or first-run experience?
- [ ] Dashboard — does the first screen after login communicate the core value?
- [ ] Empty states — do they guide the user ("Get started by...") or just say "No data"?
- [ ] Page titles and meta tags — do they describe the product?
- [ ] Help text, tooltips, contextual guidance
- [ ] Marketing copy in the codebase (landing page components, about page)

## 2. Core Functional Completeness

- [ ] Route definitions — how many routes exist vs. how many have real components?
- [ ] Stub/placeholder components — `TODO`, `Coming soon`, empty `div`s
- [ ] API endpoints — do they return real data or stubs?
- [ ] Form submissions — do they actually persist data?
- [ ] Navigation — are there menu items that lead to unfinished pages?
- [ ] Feature flags — are key features behind flags that might be off?
- [ ] Dead code — commented-out components, unused imports in demo-path files
- [ ] Console errors — `console.error`, `console.warn` in component renders

## 3. Demo Data Quality

- [ ] Seed scripts (`seed.ts`, `seed.sql`, `fixtures/`, `seeds/`)
- [ ] Hardcoded test data in components (`test@test.com`, `John Doe`, `123 Main St`)
- [ ] Database migration files — do they insert sample data?
- [ ] Mock data files (`mocks/`, `__mocks__/`, `*.mock.*`)
- [ ] API responses — are they using faker/factory data or hand-crafted narratives?
- [ ] Dashboard data — will charts/graphs show meaningful trends or flat lines?
- [ ] List views — will tables have 3 rows or 50?
- [ ] Date ranges — is demo data dated recently or from 2020?
- [ ] User personas in seed data — are they realistic names with varied attributes?
- [ ] Status variety — do records show different statuses or all the same?

## 4. UI/UX Polish

- [ ] Design system / component library (Tailwind, MUI, shadcn, custom CSS)
- [ ] Consistent spacing, typography, color usage
- [ ] Loading states — spinners, skeletons, progress bars
- [ ] Error states — error boundaries, user-friendly error messages
- [ ] Empty states — meaningful messages vs. blank screens
- [ ] Responsive design — media queries, mobile breakpoints
- [ ] Dark mode support (if relevant to the audience)
- [ ] Micro-interactions — transitions, animations, hover states
- [ ] Form UX — validation messages, disabled states, success feedback
- [ ] Accessibility — aria labels, keyboard navigation, focus management
- [ ] Favicon, app icon, og:image tags
- [ ] Console warnings/errors during normal usage

## 5. Performance & Responsiveness

- [ ] Bundle size — webpack/vite config, code splitting, lazy loading
- [ ] API query patterns — N+1 queries, missing pagination, unbounded SELECTs
- [ ] Database indexes — are query-heavy columns indexed?
- [ ] Caching — Redis, in-memory cache, HTTP cache headers
- [ ] Image optimization — compressed images, lazy loading, CDN usage
- [ ] SSR/SSG — server-side rendering for initial load speed
- [ ] Virtualization for long lists (react-virtualized, tanstack-virtual)
- [ ] Debouncing on search/filter inputs
- [ ] Prefetching — are linked pages prefetched?

## 6. Stability & Error Handling

- [ ] Error boundaries (React) or global error handlers
- [ ] API error handling — try/catch, .catch(), error middleware
- [ ] Form validation — client-side and server-side
- [ ] Network error handling — offline detection, retry logic
- [ ] Input sanitization — XSS prevention, SQL injection guards
- [ ] Concurrent operation handling — optimistic locking, conflict detection
- [ ] Null/undefined guards — optional chaining, nullish coalescing
- [ ] Test coverage — unit tests, integration tests, e2e tests
- [ ] CI pipeline — does it run tests before deploy?
- [ ] Health check endpoints

## 7. Wow Factor & Differentiation

- [ ] AI/ML features — model integrations, intelligent suggestions, NLP
- [ ] Real-time features — WebSockets, SSE, live updates
- [ ] Automation — workflow engines, scheduled jobs, triggers
- [ ] Data visualization — interactive charts, maps, graphs
- [ ] Unique UX patterns — drag-and-drop, inline editing, keyboard shortcuts
- [ ] Speed — is anything notably fast that competitors are slow at?
- [ ] Integration depth — does it do something with third-party data that's hard to replicate?
- [ ] Mobile experience — if competitors are desktop-only, a great mobile UX is a wow
- [ ] Bulk operations — can it handle scale that competitors can't?
- [ ] Customization — is there a configuration/settings system that shows flexibility?

## 8. Integration & Ecosystem Story

- [ ] Auth providers — OAuth, SAML, SSO configurations
- [ ] Payment integrations — Stripe, PayPal, billing code
- [ ] Email/SMS — SendGrid, Twilio, notification services
- [ ] Storage — S3, GCS, Azure Blob configurations
- [ ] Database — type, ORM, migration strategy
- [ ] Message queues — RabbitMQ, SQS, Redis pub/sub
- [ ] API documentation — Swagger/OpenAPI, Postman collections
- [ ] Webhooks — inbound and outbound
- [ ] Import/export — CSV, Excel, PDF generation
- [ ] Third-party data sources — CRM, ERP, external APIs

## 9. Security, Privacy & Compliance Signals

- [ ] Authentication implementation — JWT, sessions, cookie security
- [ ] Authorization — RBAC, ABAC, permission checks in routes
- [ ] Secrets management — env vars, secret manager, no hardcoded secrets
- [ ] HTTPS — TLS configuration, security headers (HSTS, CSP, etc.)
- [ ] CORS — configuration, allowed origins
- [ ] Audit logging — user actions, data changes, login events
- [ ] Data encryption — at rest, in transit
- [ ] Input validation — schema validation, sanitization
- [ ] Rate limiting — API rate limits, brute force protection
- [ ] Dependency vulnerabilities — `npm audit`, `pip audit`, Snyk
- [ ] Privacy controls — data export, deletion, consent management
- [ ] Compliance artifacts — SOC 2, GDPR, HIPAA mentions in code/docs
- [ ] `.env.example` vs actual `.env` — are sensitive values documented safely?

## 10. Deployment & Demo Environment Reliability

- [ ] Dockerfile / docker-compose — container configuration
- [ ] CI/CD pipeline — GitHub Actions, GitLab CI, Cloud Build
- [ ] Deployment scripts — `deploy.sh`, `Makefile`, infrastructure as code
- [ ] Environment configuration — `.env` files, secret management
- [ ] Staging/demo URL — is there a stable non-production environment?
- [ ] Database provisioning — can the demo DB be rebuilt quickly?
- [ ] Seed data loading — automated seed scripts for demo environment
- [ ] Health check endpoints — `/health`, `/ready`
- [ ] Monitoring — error tracking (Sentry), uptime monitoring
- [ ] Rollback capability — can you revert quickly if something breaks?
- [ ] DNS/domain — custom domain vs. cloud-provider URL

## 11. Narrative & Demo Flow Readiness

- [ ] Dashboard as story opener — does it set up the "before" state?
- [ ] Workflow completeness — can you walk through a full user journey?
- [ ] Data narrative — does seed data tell a coherent story?
- [ ] Before/after — can you show a problem state and then solve it live?
- [ ] Metrics endpoint — can you show quantified improvement?
- [ ] Role switching — can you show different persona views?
- [ ] Search/filter — can you find specific records that advance the narrative?
- [ ] Notifications — can you show real-time updates as part of the story?
- [ ] Export/report — can you end with a tangible output the prospect would value?

## 12. Business Outcome Proof

- [ ] Dashboard KPIs — are they business-relevant metrics?
- [ ] Reporting module — does it generate business reports?
- [ ] Analytics — time-saved, cost-reduced, efficiency calculations
- [ ] Comparison views — before/after, plan vs. actual
- [ ] Export functionality — can the prospect take data away?
- [ ] Audit trails — evidence of process compliance
- [ ] SLA tracking — are there deadline/performance indicators?
- [ ] Volume indicators — record counts that suggest scale
- [ ] Trend visualizations — charts showing improvement over time
- [ ] ROI calculator or TCO comparison (if present)

---

## Red Flags to Always Note

These are things that kill demos regardless of which dimension they fall under:

- `console.log` with sensitive data or debug messages
- Hardcoded `localhost` URLs that would fail in the demo environment
- `// TODO`, `// FIXME`, `// HACK` in demo-path code
- `alert()` calls used for debugging
- Commented-out code blocks in visible components
- `test` or `debug` in URL paths that are still active
- Default browser favicon (no custom icon)
- Mixed HTTP/HTTPS resources (mixed content warnings)
- Unhandled promise rejections in the console
- Visible API keys or tokens in client-side code
- "Powered by" or framework branding that looks unprofessional
- Lorem Ipsum anywhere in the UI
- Broken images or missing assets
- Stack traces visible in the UI on error
