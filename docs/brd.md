# Lead Management System for NBFCs in India — Business Requirements Document

**Version:** 5.2
**Document type:** Business Requirements Document (BRD) / AI-buildable build contract
**Product/System:** Lead Management System (LMS) for NBFC originations and pre-origination sales
**Market focus:** Indian NBFCs across asset finance, mortgage-backed lending, secured business lending, and branch/DSA/dealer-led distribution
**Status:** Version 5 — restructured to a 16-section, AI-buildable specification with a holistic data model, per-FR low-level design, shared build contract, and final reconciliation gate. v5.1 closes the Gate-A blocker by defining the StageHistory, Note, and ImportJob entities.
**Date:** 05 June 2026 (amended 08 June 2026)
**Classification:** Confidential — for client review and sign-off
**Supersedes:** Version 4.0 (04 June 2026)

> **Important note:** This document is a product and business requirements baseline **and** a shared build contract for parallel AI coding agents. Regulatory references are included for product-design context; final compliance wording and operational interpretation must be validated by the NBFC's legal, compliance, information security, and risk teams before release.

---

## Document Map

| # | Section | Audience |
|---|---|---|
| — | Version 5 Change Log | All |
| 1 | Executive Summary | Business |
| 2 | Scope & Boundaries | Business + Build |
| 3 | User Roles & Permissions | Business + Build |
| 4 | Shared Application Foundation & Cross-Agent Build Instructions | Build |
| 5 | Holistic Data Model | Build |
| 6 | Functional Requirements with Low-Level Design | Build |
| 7 | User Interface Requirements | Build |
| 8 | API & Integration Requirements | Build |
| 9 | Non-Functional Requirements | Build |
| 10 | Workflow & State Diagrams | Build |
| 11 | Notification & Communication Requirements | Build |
| 12 | Reporting & Analytics | Build |
| 13 | Migration & Launch Plan | Business + Build |
| 14 | Traceability, Dependency & Parallel Agent Plan | Build |
| 15 | Glossary | All |
| 16 | Appendices (Compliance anchors, Open decisions, Regulatory references) | All |

---

## Version 5 Change Log

Version 4.0 was a strong, market-aware product baseline. Version 5 keeps **all** of V4's product positioning and adds the implementation-grade depth required for an AI builder (or a fleet of parallel agents) to build the system without further clarification, and improves the requirement set.

### A. Structural upgrades (buildability)

| Area | V4 state | V5 change |
|---|---|---|
| Document structure | 20 ad-hoc sections | Re-cast into the canonical 16-section AI-buildable BRD structure |
| Data model | High-level "canonical entities" list (names + key fields) | **Holistic field-level data model** (§5): every entity with field name, type, nullability, validation, defaults, keys, indexes, relationships, enum catalog, ownership/reuse matrix, integrity rules, and **2–3 sample rows per entity** |
| Functional requirements | User story + acceptance criteria + business rules | Every FR now carries a **Low-Level Design** table (components, backend flow, data operations, validation, authorization, state changes, failure handling, dependencies, test guidance) |
| Shared conventions | Scattered across NFR/integration text | Consolidated **Shared Application Foundation** (§4): architecture defaults, ID/timestamp/money conventions, response envelope, pagination, masking, parallel-agent rules |
| API contract | Endpoint list + one error example | Full **HTTP status + error-code catalog** and request/response **JSON examples** for the most complex endpoints (§8) |
| Traceability | Group-level matrix | **FR-level traceability** plus a **Final Contract Reconciliation Table** (§14) with 0 unresolved gaps, dependency map, agent assignment, and conflict-resolution protocol |

### B. New functional requirements added in V5

These formalize behavior that V4 implied (in its screens, permissions matrix, or NFRs) but did not specify as requirements:

| New FR | Title | Why added |
|---|---|---|
| FR-003 | Break-glass privileged access | V4 permissions matrix had a "break-glass" row but no governing requirement |
| FR-053 | Role-based dashboard & home | V4 listed a Dashboard screen but no FR defining its widgets/data |
| FR-054 | Global search | V4 UX standards reference global masked search; now specified |
| FR-062 | Customer status tracking & callback self-service | Split customer "status/callback" out of the upload link for clarity |
| FR-103 | Notification preference & opt-out centre | V4 referenced opt-out but had no managed preference store |
| FR-104 | SLA configuration & escalation engine | SLAs are referenced everywhere; now a first-class configurable engine |
| FR-115 | Data retention, purge & anonymisation engine | NFR-10/FR-112 imply scheduled retention jobs; now specified |
| FR-123 | Audit explorer & evidence export | Audit is pervasive; now has a dedicated query/export requirement |
| FR-140 | Integration framework (idempotency, retry, webhooks, monitor) | V4 §10 principles promoted to a buildable requirement |
| FR-141 | Event outbox & analytics/AI-readiness stream | Supports BO-10 (safe AI readiness) with a concrete event store |

### C. Requirement improvements (clarifications/tightening)

- **FR-010 (capture):** Added explicit idempotency-key contract and bulk-import row-error file format; clarified progressive-PAN rule precedence.
- **FR-020 (duplicate):** Default match-rule table now references the `DuplicateMatch` entity and confidence scoring fields explicitly.
- **FR-030 (allocation):** Allocation now reads the `AllocationRule` entity with an explicit rule-evaluation order and tie-break.
- **FR-060 (customer link):** Step-up OTP, token lifecycle, and virus-scan now reference the `CustomerLink` and `Document` entities and the OTP rate-limit code.
- **FR-081 (hand-off):** Idempotency and "no duplicate LOS application" now tied to `IntegrationLog` correlation/idempotency keys and the outbox (FR-141).
- **FR-110 (consent):** Consent purposes enumerated in the §5 enum catalog so no FR redefines them locally.
- **NFR list:** Added concrete API P95 targets, pagination LIMIT enforcement, and document-storage controls.

### D. Carried forward unchanged in intent

LOS boundary, omnichannel/partner positioning, consent-first design, configurable products without BRE, mobile/field readiness, rules-based explainable scoring (no automated credit decisioning), and the regulatory design anchors are all retained from V4.

> **Amendments log:** Any future change to a shared contract (entity, enum, API, error code, shared component) must bump this document's version, add a dated row here describing the change and affected FRs, and be re-pulled by dependent agents before they resume. See §14.6 Conflict-Resolution Protocol.
>
> **v5.1 (2026-06-08) — Gate-A remediation.** Added three previously-referenced-but-undefined entities to §5: `StageHistory` (§5.2.43, a first-class stage-transition read-model now backing §12 funnel/TAT and FR-052/053/120/121, and supplying `from_stage` for the `rejected → prior active` reopen), `Note` (§5.2.44, FR-051), and `ImportJob` (§5.2.45, FR-010). Wired `StageHistory` into the §10.3 transition (written in the same transaction as `AuditLog` + `EventOutbox`) and §12.5/§12.6 reporting. Added glossary terms and open decision OD-17 (India messaging registration). FRs affected: FR-010, FR-051, FR-052, FR-053, FR-120, FR-121. No enum, API, or error-code changes. Also (post Gate-A re-run) added a §3.1 role-alias note (Product Ops / Sales Ops / IT → ADMIN; approver/checker, management, internal, system) and six glossary terms (UTM, QR lead form, geotag, missed-call capture, circuit breaker, round-robin) to close the remaining Gate-A WARNs.
>
> **v5.2 (2026-06-08) — Stage-3 architecture follow-up.** Added the `BusinessCalendar` entity (§5.2.46) as the single business-hours/holiday source for SLA/TAT timers — resolves the council "no business-calendar" blind spot and architecture ADR-6. Owner M14, consumed by the M11 SLA engine (FR-104). Folded into the initial data-model schema (pre-deployment) and re-validated by DB load; Gate B remains satisfied. FRs affected: FR-104 (and §12 business-hours metrics). No enum, API, or error-code changes.

---

## 1. Executive Summary

### 1.1 Project name and description

**Project name:** Lead Management System (LMS) for Indian NBFCs — "Origination Front Office".

The LMS is the NBFC's front-office origination platform for **lead capture, pre-qualification, consent management, document collection, KYC coordination, partner attribution, task discipline, and clean hand-off to the Loan Origination System (LOS)**. It serves both high-volume distributed sales teams (branch, field, DSA, dealer, digital) and compliance-sensitive lending operations, and it is built mobile-first for field acquisition.

The LMS is **not** a credit underwriting engine. It does not approve loans, sanction limits, calculate final APR/pricing, generate the Key Fact Statement (KFS), perform disbursement, or own collections. Those functions remain in the LOS / core lending systems. The LMS may display LOS-owned eligibility, application status, and downstream outcomes **read-only** where integrated feeds exist.

### 1.2 Business objectives

| Objective ID | Objective | Success metric (measurable target) |
|---|---|---|
| BO-01 | Centralise lead capture across all NBFC channels | 100% of leads carry source, sub-source, owner, product, consent status, and creation channel |
| BO-02 | Reduce lead leakage and duplicates | Duplicate action recorded for 100% of matched leads; every merge/override audited; duplicate rate trend down quarter-on-quarter |
| BO-03 | Improve first-contact speed | ≥ 90% of hot leads contacted within configured SLA; first-contact breach visible by RM/team/source |
| BO-04 | Improve conversion to LOS hand-off | Measurable lift in Pre-qualified→KYC and KYC→hand-off conversion by product/source/team |
| BO-05 | Reduce KYC/document TAT | Product-wise document ageing and pending customer actions visible in real time; median doc TAT reduced |
| BO-06 | Increase partner accountability | DSA/dealer/source quality scores with conversion, rejection, duplicate, and SLA metrics for 100% of active partners |
| BO-07 | Strengthen compliance evidence | Purpose-wise consent ledger, immutable audit trail, data-sharing log, export logs, and grievance trail with exportable evidence |
| BO-08 | Improve management visibility | Role-scoped dashboards, MIS, cohorts, heatmaps, and exception queues with reconciled metrics |
| BO-09 | Improve field adoption | Mobile-first PWA: minimum-field lead capture in < 3 minutes; geotagged visit logging; low-bandwidth mode |
| BO-10 | Prepare for safe AI | Event outbox + explainable rule scores + human override + model-governance hooks; no automated underwriting in LMS |

### 1.3 Target users and pain points

| Persona | Primary goal | Pain point today | V5 response |
|---|---|---|---|
| Relationship Manager (RM) | Convert assigned leads quickly | WhatsApp sheets, repeated data entry, manual follow-up | Guided capture, smart tasks, customer upload links, mobile-first workflow |
| Branch Manager (BM) | Control branch funnel, KYC quality, hand-off | No real-time queue; approval bottlenecks | Branch dashboard, exception queues, delegation, SLA alerts |
| Sales Manager (SM) | Allocate fairly, raise team productivity | Manual allocation; no capacity/SLA view | Rule-based allocation, capacity dashboard, team performance |
| Sales/Business Head | Grow volume and quality | Slow MIS; weak attribution | Executive dashboard, funnel, source ROI, partner quality, product heatmap |
| DSA / Dealer / Connector | Submit and track leads | No transparency; repeated RM follow-up | Lightweight submission/status, duplicate feedback, quality score |
| KYC / Operations | Complete KYC and documents correctly | Fragmented collection, unclear exceptions | Product checklist, verification queue, exception workflow |
| Compliance / DPO | Evidence consent, sharing, audit, grievance | Consent captured as a checkbox only | Consent ledger, rights requests, grievance workflow, masked audit exports |
| System Admin / IT | Secure user/access/integration ops | Role drift, audit gaps, integration failures | RBAC/ABAC, integration monitor, configuration governance |
| Customer / Prospect | Share documents, know the next step | Repeated requests, unclear status | Secure tokenised self-service: consent, docs, callback, status, grievance |

### 1.4 Differentiating design principles

1. **NBFC-first, not CRM-first** — capture understands asset finance, secured business, mortgage-backed loans, and branch/DSA/dealer distribution.
2. **Consent-first** — every customer-data action maps to a purpose, channel, consent state, expiry/retention rule, and audit event.
3. **LOS-owned credit** — LMS may pre-screen and prioritise with transparent rules but must never underwrite.
4. **Partner-aware** — every lead carries source lineage, sub-source, DSA/dealer/connector, campaign/UTM, and attribution.
5. **Mobile-field-ready** — core RM actions work on low-bandwidth mobile browsers.
6. **Configurable, not hard-coded** — products, checklists, SLAs, sources, templates, rejection reasons, and allocation rules are configurable by authorised roles.
7. **Explainability over black box** — allocation, scoring, alerts, and nudges show rule reasons and allow human override.
8. **Audit everything that matters** — data access, exports, consent, KYC, hand-off, transitions, overrides, merges, and external calls are traceable.

### 1.5 Key success metrics (KPIs)

| KPI | Definition | Target |
|---|---|---|
| First-contact SLA adherence (hot) | Hot leads contacted within SLA / hot leads | ≥ 90% |
| Overall conversion | Handed-off / Captured (same scope & period) | Establish baseline; +5 pts within 2 quarters |
| Duplicate leakage rate | Duplicate or linked leads / captured | < 8% and trending down |
| Median document TAT | Median time from doc request to all-mandatory-verified | < 5 business days |
| Consent coverage | Active leads with required consent for next stage / active leads | 100% before stage gate |
| Hand-off failure rate | Failed hand-offs / attempted hand-offs | < 2% |
| Partner quality coverage | Active partners with a current quality score | 100% |

---

## 2. Scope & Boundaries

### 2.1 In scope — Phase 1 / MVP

1. **Authentication, RBAC & ABAC** — login, session management, MFA for privileged/external roles, password reset, role-based navigation, server-side entitlement enforcement, attribute constraints by branch/team/product/source/partner/data-classification, break-glass access (FR-003).
2. **Omnichannel lead capture** — manual, bulk CSV/Excel import, API/webhook intake (website, landing pages, telecalling, marketing, dealer/OEM, DSA, QR forms), missed-call/callback where telephony exists.
3. **Lead identity, duplicate detection & merge** — multi-key matching, strong/medium/weak scoring, block/warn/queue/link/merge/override with audit.
4. **Source, campaign, partner & attribution management** — mandatory source/sub-source, optional campaign/UTM, partner master, attribution history.
5. **Product-specific capture & configuration** — seven launch products, admin-configurable fields/checklists/SLAs/eligibility-mapping/rejection-reasons/templates; **no credit policy/BRE in LMS**.
6. **Lead workspace & pipeline** — lead list, saved queues, filters, bulk actions, Lead 360, notes, activity, tasks, communication history, stage tracker, pipeline board, role-based dashboard (FR-053), global search (FR-054).
7. **Rules-based allocation & prioritisation** — allocation by branch/pin/product/capacity/source/partner/language/SLA/hot rules; explainable lead score; manual override with reason/audit.
8. **Tasks, follow-ups & communication** — calls, visits, document requests, KYC appointments, callbacks, reminders; in-app/email/SMS/WhatsApp; purpose-specific consent and opt-out (FR-103).
9. **Customer self-service** — tokenised link for document upload, consent confirmation, callback scheduling, status tracking (FR-062), and grievance initiation (FR-061).
10. **KYC & document orchestration** — checklist, uploads, verification status, mismatch handling, manual exceptions, PAN verification, CKYC capture/search, DigiLocker/e-document readiness, Aadhaar OTP/offline token support (no raw Aadhaar), V-CIP readiness (config / Phase 1.5).
11. **LOS hand-off, eligibility & status mirror** — eligibility request, read-only snapshot, idempotent hand-off with retries/queue/reconciliation, read-only status via webhook/poll.
12. **Reports & analytics** — funnel, source performance, RM/team performance, rejection summary; plus first-contact SLA, KYC/document ageing, DSA/dealer quality, duplicate leakage, source ROI, contactability, hand-off failure, consent operations, product/branch heatmap, RM capacity.
13. **Compliance, consent, privacy & audit** — purpose-wise consent ledger, data-sharing ledger, data-rights workflow, DLA/LSP registry, grievance workflow, retention/purge engine (FR-115), tamper-evident audit and audit explorer (FR-123).
14. **Administration & configuration** — users, roles, teams, branches, products, documents, sources, partners, SLAs, rejection reasons, templates, allocation rules, notification rules, retention rules; configuration governance with maker-checker and rollback.
15. **Integration & event layer** — API gateway, webhooks, standard error contract, idempotency, integration audit, retry queues (FR-140), event outbox for analytics/AI (FR-141).

### 2.2 Phase 1.5 scope

- Offline field capture and sync; full V-CIP workflow (recording, liveness/spoof, trained-official assignment); Account Aggregator consent + bank-statement retrieval; GSTIN verification + GST data ingestion; expanded DSA/dealer portal (login, status, upload, SLA dashboard, dispute workflow); telephony/CTI (click-to-call, disposition, recording where permitted); field route planning and branch catchment heatmaps.

### 2.3 Phase 2 / advanced scope

- AI/ML lead scoring, next-best-action, churn/revival, cross-sell propensity, document intelligence; GenAI RM assistant; full campaign/marketing automation; native mobile apps; full DSA/connector payout module; advanced BI/custom report builder and data lake; bureau report display (if separately approved); post-disbursement lifecycle, collections, servicing.

### 2.4 Out of scope for V5 MVP (change-control required)

- Credit underwriting, sanction, APR/final pricing, KFS generation, disbursement, collections.
- Credit policy / BRE configuration.
- Automated adverse decisioning or automated rejection solely by LMS.
- Raw bureau report storage/display in LMS.
- Raw Aadhaar number or biometric storage (unless expressly permitted by law and NBFC policy).
- Access to a customer's contact list, call logs, SMS inbox, media files, or device resources not required for an explicit onboarding/KYC purpose.
- Full campaign automation; native Android/iOS apps; partner payout/commission accounting.

### 2.5 Assumptions

1. LOS exposes (or will expose) APIs/webhooks for eligibility, hand-off, application status, and downstream outcome mirror.
2. The NBFC provides master data for branches, users, teams, products, sources, DSAs/dealers, SLAs, document lists, rejection reasons, and communication templates.
3. Vendor accounts and sandboxes are available for PAN, CKYC/DigiLocker, Aadhaar/offline verification, communication providers, and any AA/GST/asset providers.
4. NBFC legal/compliance approve consent text, privacy notices, retention rules, DLA/LSP disclosures, grievance workflow, and customer communications.
5. India data residency is mandatory unless compliance approves otherwise under applicable law and RBI directions.
6. Historic data migration is a separate workstream unless explicitly added to Phase 1.
7. The system is deployed for a **single NBFC organisation** (multi-branch, multi-region). Multi-tenant SaaS isolation is out of MVP scope; an `org_id` seam is reserved for future use (see §4).

### 2.6 Constraints

- LMS is a responsive web/PWA application (no native app in MVP).
- LMS must not become a shadow LOS or credit BRE.
- All external data pulls must be consented, logged, and mapped to a purpose.
- All data access must be role-, scope-, and classification-controlled.
- Rules that affect eligibility or credit decisioning reside in LOS/BRE, not LMS.

### 2.7 Feature module map

| Module | Responsibility | FRs |
|---|---|---|
| M1 Identity & Access | Auth, RBAC/ABAC, MFA, break-glass | FR-001, FR-002, FR-003 |
| M2 Lead Capture & Attribution | Omnichannel capture, enrichment, source/campaign/partner attribution | FR-010, FR-011 |
| M3 Identity Resolution | Duplicate detection, merge, attribution preservation | FR-020, FR-021 |
| M4 Allocation & Prioritisation | Rule allocation, hot-lead/score | FR-030, FR-031 |
| M5 Product Configuration | Product config, launch products, schemes | FR-040, FR-041, FR-042 |
| M6 Workspace & Pipeline | Lead list/queues, Lead 360, board, dashboard, global search | FR-050, FR-051, FR-052, FR-053, FR-054 |
| M7 Customer Self-Service | Action link, grievance, status/callback | FR-060, FR-061, FR-062 |
| M8 KYC & Documents | Checklist/upload, KYC orchestration, exceptions | FR-070, FR-071, FR-072 |
| M9 LOS Integration | Eligibility, hand-off, status mirror | FR-080, FR-081, FR-082 |
| M10 Partner Management | Partner master, submission, quality | FR-090, FR-091, FR-092 |
| M11 Tasks & Communication | Tasks, templates/audit, telephony/visit, notification prefs | FR-100, FR-101, FR-102, FR-103, FR-104 |
| M12 Compliance & Privacy | Consent ledger, minimisation, rights/retention, DLA/LSP, grievance, retention engine | FR-110, FR-111, FR-112, FR-113, FR-114, FR-115 |
| M13 Reporting & MIS | Core pack, differentiator reports, export governance, audit explorer | FR-120, FR-121, FR-122, FR-123 |
| M14 Administration | User/role/team/branch admin, master config, config governance | FR-130, FR-131, FR-132 |
| M15 Integration & Events | Integration framework, event outbox | FR-140, FR-141 |

### 2.8 Common capabilities (implement once, reuse everywhere)

Authentication & session; RBAC/ABAC entitlement check; field-level masking; audit logging; validation framework; global search/filter/sort/pagination; notification dispatch; file upload/scan/storage; configuration store with versioning; SLA timer/escalation engine; idempotency & retry framework; event outbox. These are owned by M1/M14/M15/M11 and **consumed by all modules** — no module re-implements them. See §4.

## 3. User Roles & Permissions

### 3.1 Role definitions

| Role code | Role | Description |
|---|---|---|
| RM | Relationship Manager | Front-line sales user. Captures, works, follows up, and updates own assigned leads. |
| BM | Branch Manager | Branch owner. Oversees branch leads, KYC exceptions, allocation, hand-off, and branch MIS. |
| SM | Sales Manager | Team owner. Allocates/reassigns team leads, monitors performance, resolves SLA exceptions. |
| HEAD | Sales / Business Head | National/regional leadership. Cross-branch dashboards, source ROI, product performance, executive MIS. |
| KYC | KYC / Operations User | Verifies documents/KYC, handles mismatch queues, marks KYC completion within entitlement. |
| DPO | Compliance / DPO User | Read-only masked compliance view, consent ledger, audit, data-rights, DLA/LSP registry, grievance reports. |
| PARTNER | DSA / Dealer / Connector User | External/semi-external partner. Creates/views own submitted leads and pending document requirements only. |
| ADMIN | System Administrator | Manages users, roles, master data, configuration, integrations, notifications. No lead-content access unless granted under break-glass audit. |
| CUSTOMER | Customer / Prospect | External tokenised access to own consent, documents, status, callback, grievance. No login unless customer portal enabled. |

> **Role aliases (not separate RBAC roles).** Some FRs name functional designations that map to the nine role codes above, not to additional entitlements: `Product Ops` and `Sales Ops` are functions performed under the **ADMIN** role; `IT` / `IT/ADMIN` is the **ADMIN** role acting on integrations/infrastructure; `approver` / `checker` are maker-checker functions performed by any user holding the relevant `configuration` capability (FR-132); `management` = BM/SM/HEAD; `internal` = all non-PARTNER, non-CUSTOMER roles; `system` is the reserved system actor (§4.3). Downstream auth-matrix/LLD agents must treat these as the backing role codes per the §3.3 permissions matrix.

### 3.2 Data-scope notation

| Code | Scope |
|---|---|
| O | Own assigned leads only |
| T | Team |
| B | Branch |
| R | Region |
| A | All organisational data |
| P | Partner's own submitted leads |
| C | Customer's own lead/application only |
| M | Masked compliance view |
| X | No lead data access |

### 3.3 Permissions matrix

Each cell is the **maximum** scope a role may exercise for the capability; ABAC attributes (§4.7) may narrow it further. `-` = not permitted.

| Capability | RM | BM | SM | HEAD | KYC | DPO | PARTNER | ADMIN | CUSTOMER |
|---|---|---|---|---|---|---|---|---|---|
| Create lead | O | B | T | A | - | - | P | - | C (self-link) |
| View lead | O | B | T | A | B/queue | M/A | P | X | C |
| Edit lead profile | O | B | T (limited) | - | KYC fields only | - | P (limited) | - | C (limited) |
| Upload documents | O | B | - | - | B/queue | - | P | - | C |
| Verify documents | O (preliminary) | B | - | - | B/queue | - | - | - | - |
| KYC sign-off | - | B | - | - | B/queue | Oversight | - | - | - |
| Move stage | O | B | T | - | KYC stages | - | P (limited) | - | - |
| Hand-off to LOS | Configurable | B | - | - | Configurable | Oversight | - | - | - |
| Allocate / reassign | - | B | T | A | - | - | - | - | - |
| Bulk actions | - | B | T | A | Queue actions | - | - | - | - |
| Customer communication | O | B | T | - | KYC templates | - | Own lead | Template config | Own link |
| Reports / MIS | O | B | T | A | KYC ops | Compliance | P | System only | - |
| Export | O (masked/limited) | B | T | A | Queue export | Compliance export | P (limited) | Config logs only | Own docs/status |
| Consent ledger | O (view) | B (view) | T (view) | A (aggregate) | KYC purpose view | A/M (full) | Own submissions | Config only | Own |
| Audit trail | Own activity | B | T | A (summary) | KYC activity | A/M (full) | Own actions | System config | Own actions |
| User / role management | - | - | - | - | - | - | - | A | - |
| Configuration | - | B (limited) | - | A (request) | KYC templates (request) | Compliance rules | - | A | - |
| Break-glass access | - | - | - | - | - | A/M (with approval) | - | Time-bound only | - |

### 3.4 Explicit denials (no exceptions)

- **ADMIN** must not automatically receive lead-content access; lead data requires break-glass (FR-003).
- **DPO** views masked data unless explicit, approved, audited unmasking occurs.
- **PARTNER** must never view leads they did not submit unless the NBFC explicitly assigns them.
- **CUSTOMER** links are tokenised, expiring, and scoped to a single lead/application; a customer can never see internal notes, scores, RM performance, or other leads.
- No role may move a lead stage without satisfying the transition guards in §10.3.

### 3.5 Segregation of duties

1. KYC sign-off and LOS hand-off are configurable but governed by approval rules; the same user may be barred from doing both on the same lead where the NBFC requires four-eyes.
2. Configuration changes that are high-impact require maker-checker (FR-132).
3. Break-glass access is always time-bound, reason-bound, approved, and fully audited (FR-003).

## 4. Shared Application Foundation & Cross-Agent Build Instructions

Every agent reads this section before implementing any FR. These contracts are global; an FR's LLD references them and must not invent local substitutes.

### 4.1 Architecture defaults

V4 did not fix a stack; V5 sets these defaults (override only via the Amendments log):

| Concern | Default |
|---|---|
| Frontend | React 18 + TypeScript, Vite, Tailwind CSS, shadcn/ui (Radix primitives), TanStack Query for server state, React Hook Form + Zod for forms |
| PWA | Installable, service-worker cache for shell + reference data; offline draft capture (Phase 1.5) |
| Backend | Node.js 20 + TypeScript, NestJS (modular, DI), REST under `/api/v1` |
| Database | PostgreSQL 15 (Cloud SQL); migrations versioned; parameterised queries only |
| Object storage | Google Cloud Storage (GCS) bucket per environment; signed URLs; documents never served from app tier |
| Cache / queue | Redis (cache, rate-limit counters, idempotency keys); a durable queue (Cloud Tasks / Pub/Sub) for retries and the event outbox |
| AuthN | JWT access token (15 min) + refresh token (rotating); optional enterprise SSO (OIDC); MFA via TOTP/OTP |
| Deployment | Containerised on Google Cloud Run; secrets via Secret Manager; India region |
| Logging | Structured JSON logs with correlation IDs; never log PII values, passwords, tokens, or raw documents |

### 4.2 Module boundaries and ownership

Modules M1–M15 (see §2.7) each own a set of entities (§5 ownership matrix) and consume shared ones. Owning module is the only writer of an entity's core lifecycle; consumers read or write via the owner's service. Cross-module writes go through service interfaces, never direct table writes.

### 4.3 Shared data conventions

| Convention | Rule |
|---|---|
| Surrogate key | `*_id` is `UUID` (v4), server-generated, immutable |
| Human code | Business codes are generated, unique, human-readable: `lead_code` = `LD-{YYYY}-{seq6}` (e.g., `LD-2026-000123`); `partner_code` = `PRT-{seq5}`; `grievance_no` = `GRV-{YYYY}-{seq5}` |
| Timestamps | `TIMESTAMPTZ`, stored in UTC, displayed in IST (Asia/Kolkata). Every table has `created_at`, `updated_at` |
| Audit columns | Every business table has `created_by`, `updated_by` (FK → `User.user_id`); system actor = reserved UUID `00000000-0000-0000-0000-000000000000` |
| Soft delete | Master/config entities use `is_active boolean default true`; lead/customer data is never hard-deleted while under retention — see retention engine (FR-115). A `deleted_at TIMESTAMPTZ NULL` marks logical deletion where applicable |
| Money | `NUMERIC(15,2)`, currency INR implied; never floats |
| Phone | `mobile VARCHAR(10)` (validated `^[6-9]\d{9}$`) + optional `country_code VARCHAR(4) default '+91'` |
| Enums | Stored as `VARCHAR` constrained by CHECK or FK to a lookup table; **all enum values live in the §5.5 catalog** |
| Sensitive identifiers | PAN/Aadhaar/CKYC stored **tokenised/masked**; raw Aadhaar never stored. Masked display formats in §4.6 |
| JSON attributes | Product-specific answers use `JSONB` (`LeadProductDetail.attributes`) validated against the active `ProductConfig.field_schema` |
| Optimistic locking | Mutable lead/config rows carry `version INTEGER`; updates use `WHERE version = :v` and bump it |
| Org seam | An `org_id UUID` column is reserved (single value in MVP) to allow future multi-entity isolation without redesign |

### 4.4 Shared API conventions

- **Base URL / versioning:** `/api/v1`. Breaking changes bump the path version.
- **Auth header:** `Authorization: Bearer <jwt>`. All endpoints require auth unless listed public in §8.6.
- **Correlation:** every request/response carries `X-Correlation-Id`; generated if absent.
- **Idempotency:** every state-creating POST accepts `Idempotency-Key` header; replays return the original result (see FR-140).
- **Success envelope:**
  ```json
  { "data": { /* resource or list */ }, "meta": { "correlation_id": "corr_...", "pagination": { "page": 1, "limit": 25, "total": 134 } }, "error": null }
  ```
- **Error envelope:** see §8.3; codes from the §8.4 catalog only.
- **Pagination:** list endpoints accept `page` (default 1) and `limit` (default 25, **max 100**). The server **always** applies a LIMIT — unbounded list queries are forbidden.
- **Filtering/sorting:** `?filter[field]=value&sort=-created_at` (`-` = descending). Allowed filter/sort fields are per-endpoint.
- **Transactions:** any multi-entity write is a single DB transaction; partial state must not persist.

### 4.5 Shared UI conventions

- **Design system:** Tailwind + shadcn/ui. Reusable primitives: `DataTable` (server pagination, column visibility, bulk-select), `EntityForm` (RHF+Zod), `Modal`, `Drawer`, `Toast`, `StatusChip`, `MaskedField`, `EmptyState`, `LoadingSkeleton`, `ErrorState`, `ConfirmDialog`.
- **Layout shell:** left nav filtered by role; mobile bottom nav for RM core actions; top bar with global search and quick-create.
- **States:** every data view implements loading, empty, error, and success states; every destructive action uses `ConfirmDialog`.
- **Status chips:** consent, KYC, document, SLA, duplicate, hand-off — consistent colours/labels app-wide.
- **Localisation:** INR, Indian date/time (`dd-MM-yyyy`, IST), pin-code/branch hierarchy; English UI with regional-language message templates where configured.
- **Accessibility:** WCAG 2.1 AA for core flows; keyboard navigable; labelled inputs; sufficient contrast; dark mode supported.
- **Low-bandwidth mode:** compressed images, deferred charts, reduced payloads on mobile.

### 4.6 Shared security conventions

| Area | Rule |
|---|---|
| Passwords | ≥ 10 chars, upper/lower/digit/symbol, history + expiry per NBFC IT policy; bcrypt/argon2 hashed |
| Sessions | 30-min idle timeout (configurable); logout invalidates immediately; refresh-token rotation |
| MFA | Mandatory for ADMIN, DPO, HEAD, PARTNER; configurable for others |
| Lockout | 5 failed attempts → 15-min lock (configurable); audited |
| Authorization | Server-side on every endpoint; direct URL to unauthorised resource → `FORBIDDEN` (403) + audit |
| Masking | PAN shown as `ABCxxxx1F`; mobile as `98xxxxxx10`; Aadhaar reference only (last 4 of token); export applies the strictest masking rule |
| Files | Allowed types PDF/JPG/PNG/HEIC; max size configurable (default 10 MB); virus-scanned; classified; stored in GCS with signed-URL access; never executed/inlined |
| Rate limits | Per-IP and per-user limits on auth, OTP, public capture, and customer-link endpoints (`RATE_LIMITED` 429) |
| Secrets | Environment/Secret Manager only; never hardcoded; never logged |
| Audit | Append-only, tamper-evident (hash chain) audit for all sensitive actions (§5.5 audit action enum) |

### 4.7 ABAC attribute model

Every entitlement decision = `role permission` ∩ `data scope` ∩ `attribute constraints`. Attributes: `branch_id`, `team_id`, `region_id`, `product_id`, `source_id`, `partner_id`, and `data_classification`. The shared `EntitlementService.can(user, action, resource)` is the single decision point; no module writes ad-hoc checks.

### 4.8 Parallel-agent build instructions

1. **Single source of truth:** use only entities/fields in §5, enums in §5.5, error codes in §8.4, endpoints in §8, and components in §4.5. Do not create feature-local tables, enums, codes, or duplicate components.
2. **Need a new field/enum/code?** Update the relevant top-level section (and bump the version + Amendments log) **before** writing code; then update the affected FR LLDs.
3. **Owner-writes rule:** write an entity only from its owning module's service; consume others via their service interface.
4. **Contract version pinning:** an FR may not be merged if its LLD references a contract version older than this document's current version.
5. **Conflict:** if two agents propose incompatible changes to a shared contract, pause and route to the arbiter (§14.6).

### 4.9 Testing expectations (apply to every FR)

- **Unit:** validation, authorization, and pure business logic (e.g., score/allocation/duplicate rules).
- **Integration/API:** at least one valid path + the key invalid paths (auth, forbidden, validation, conflict/idempotency, not-found) per endpoint; transaction rollback on failure.
- **UI/E2E:** primary happy path + one error path per screen; masking and role-scope assertions; mobile viewport for RM flows.
- **Accessibility:** automated a11y check on core screens.
- **Security:** authz negative tests (cross-scope/cross-partner access denied), masking on export, rate-limit on public/OTP endpoints.
- **Coverage gate:** every FR ships with the unit + API tests named in its LLD "Test Guidance" row.

## 5. Holistic Data Model

This is the single canonical source of truth for every table. FR LLDs (§6) reference these entities and fields **exactly**; no FR may invent a local table, conflicting field, or duplicate enum.

**Standard columns (implicit on every business table, not repeated below):** `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`, `created_by UUID NOT NULL → User.user_id`, `updated_by UUID NOT NULL → User.user_id`, and the reserved `org_id UUID NOT NULL` (single value in MVP). Mutable lead/config rows also carry `version INTEGER NOT NULL DEFAULT 1` (optimistic lock). All enum-typed columns draw values from the §5.5 catalog.

### 5.1 Entity inventory

| # | Entity | Purpose | Owning module | Key consumers |
|---|---|---|---|---|
| 1 | User | Internal/external system user | M1 | All |
| 2 | Role | Named role with scope defaults | M1 | M1, M14 |
| 3 | RolePermission | Role→capability→max-scope mapping | M1 | M1 |
| 4 | Branch | Branch master + pin mapping | M1 | M2, M4, M6, M13 |
| 5 | Team | Sales team within branch | M1 | M4, M6 |
| 6 | Region | Region grouping branches | M1 | M6, M13 |
| 7 | BreakGlassGrant | Time-bound privileged access grant | M1 | M12, M13 |
| 8 | Lead | Central lead record | M2 | All |
| 9 | LeadIdentity | Customer identity attributes (tokenised) | M2 | M3, M8, M9, M12 |
| 10 | CustomerProfile | Reusable customer shell | M2 | M2, M7, M12 |
| 11 | SourceAttribution | Source/campaign/partner lineage | M2 | M3, M10, M13 |
| 12 | DuplicateMatch | Detected duplicate pairings | M3 | M2, M13 |
| 13 | AllocationRule | Configurable allocation rule | M4 | M4 |
| 14 | ProductConfig | Product form/checklist/SLA config (versioned) | M5 | M2, M6, M8, M9 |
| 15 | LeadProductDetail | Product-specific answers (JSONB) | M5 | M6, M9 |
| 16 | Scheme | Non-credit scheme/offer metadata | M5 | M2, M9 |
| 17 | Partner | DSA/dealer/connector/OEM master | M10 | M2, M4, M13 |
| 18 | CustomerLink | Tokenised self-service link | M7 | M7, M8, M13 |
| 19 | Document | Uploaded/retrieved document | M8 | M7, M9, M12 |
| 20 | KYCVerification | KYC check + provider result | M8 | M9, M12 |
| 21 | Task | Follow-up / operations task | M11 | M6, M13 |
| 22 | CommunicationTemplate | Versioned message template | M11 | M11 |
| 23 | CommunicationLog | Sent message/call record | M11 | M12, M13 |
| 24 | Notification | In-app notification | M11 | All |
| 25 | NotificationPreference | Per-recipient/purpose opt-in/out | M11 | M11, M12 |
| 26 | ConsentRecord | Purpose-wise consent (append-only) | M12 | All |
| 27 | DataSharingLog | Third-party data-sharing event | M12 | M9, M13 |
| 28 | Grievance | Complaint / service request | M12 | M7, M11, M13 |
| 29 | DataRightsRequest | DPDPA data-principal request | M12 | M13 |
| 30 | DLARegistry | DLA/LSP/partner compliance registry | M12 | M13 |
| 31 | RetentionPolicy | Retention rule by category/outcome | M12 | M15 |
| 32 | EligibilitySnapshot | Read-only LOS eligibility response | M9 | M6 |
| 33 | LOSApplicationMirror | Read-only LOS application status | M9 | M6, M13 |
| 34 | SavedView | Saved lead queue/filter | M6 | M6 |
| 35 | AuditLog | Tamper-evident audit (hash-chained) | M13 | M12, M13 |
| 36 | ExportJob | Governed export request + artefact | M13 | M12, M13 |
| 37 | RejectionReason | Rejection reason/sub-reason master | M14 | M6 |
| 38 | SLAPolicy | SLA threshold + escalation config | M14 | M4, M11 |
| 39 | ConfigurationVersion | Config change governance record | M14 | All config |
| 40 | IntegrationLog | Provider/API call observability | M15 | M9, M8, M11 |
| 41 | WebhookSubscription | Outbound webhook endpoint config | M15 | M9, M15 |
| 42 | EventOutbox | Durable domain-event store | M15 | M13, analytics/AI |
| 43 | StageHistory | Append-only lead stage-transition log (reporting read-model) | M2 | M6, M13 |
| 44 | Note | Free-text internal note on a lead | M6 | M6 |
| 45 | ImportJob | Bulk lead-import job summary | M2 | M2, M13 |
| 46 | BusinessCalendar | Working-hours + holiday calendar for SLA/TAT timers | M14 | M11 |

### 5.2 Entity definitions

> Legend: **Null** = nullable? (N/Y). Standard columns omitted per §5.1.

#### 5.2.1 User (M1)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| user_id | UUID | N | PK | |
| username | VARCHAR(150) | N | unique, email format | login id |
| email | VARCHAR(255) | N | unique, email | |
| full_name | VARCHAR(150) | N | | |
| mobile | VARCHAR(10) | Y | `^[6-9]\d{9}$` | |
| password_hash | VARCHAR(255) | Y | argon2/bcrypt; null for SSO/PARTNER-OTP | never logged |
| role_id | UUID | N | FK → Role | primary role |
| branch_id | UUID | Y | FK → Branch | scope attr |
| team_id | UUID | Y | FK → Team | |
| region_id | UUID | Y | FK → Region | |
| partner_id | UUID | Y | FK → Partner | set for PARTNER users |
| product_skills | JSONB | Y | array of product_id | for product-specialist allocation |
| mfa_enabled | BOOLEAN | N | default false | forced true for privileged/external |
| status | VARCHAR(20) | N | enum user_status; default 'active' | active/inactive/locked |
| reporting_manager_id | UUID | Y | FK → User | |
| last_login_at | TIMESTAMPTZ | Y | | |

Relationships: belongs to Role, Branch/Team/Region, optional Partner; self-ref reporting manager. Indexes: `username`, `email` (unique), `(role_id, branch_id, team_id)`, `partner_id`.

Sample: `(u1, rmeena@nbfc.in, "R. Meena", RM, BR-Pune-01, status active)`; `(u2, bm.pune@nbfc.in, "S. Kulkarni", BM, BR-Pune-01)`; `(u3, dsa.apex@partner.in, "Apex Motors", PARTNER, partner=PRT-00045, mfa true)`.

#### 5.2.2 Role (M1)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| role_id | UUID | N | PK | |
| code | VARCHAR(20) | N | unique; enum role_code | RM/BM/SM/HEAD/KYC/DPO/PARTNER/ADMIN/CUSTOMER |
| name | VARCHAR(80) | N | | |
| default_scope | VARCHAR(2) | N | enum data_scope | O/T/B/R/A/P/C/M/X |
| is_external | BOOLEAN | N | default false | true for PARTNER/CUSTOMER |

Relationships: has many RolePermission, has many User. Index: `code` unique.

Sample: `(RM, "Relationship Manager", scope O)`; `(BM, "Branch Manager", scope B)`; `(DPO, "Compliance/DPO", scope M)`.

#### 5.2.3 RolePermission (M1)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| role_permission_id | UUID | N | PK | |
| role_id | UUID | N | FK → Role | |
| capability | VARCHAR(50) | N | enum capability | matches §3.3 rows |
| max_scope | VARCHAR(2) | N | enum data_scope | |
| conditions | JSONB | Y | | extra ABAC predicates |

Relationships: belongs to Role. Unique: `(role_id, capability)`.

Sample: `(RM, create_lead, O)`; `(BM, hand_off, B)`; `(DPO, audit_trail, M)`.

#### 5.2.4 Branch (M1)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| branch_id | UUID | N | PK | |
| code | VARCHAR(20) | N | unique | |
| name | VARCHAR(120) | N | | |
| region_id | UUID | N | FK → Region | |
| pin_codes | JSONB | Y | array of 6-digit pins | catchment for routing |
| address | VARCHAR(255) | Y | | |
| is_active | BOOLEAN | N | default true | |

Relationships: belongs to Region; has many Team/User/Lead. Index: `code` unique, GIN on `pin_codes`.

Sample: `(BR-Pune-01, "Pune Camp", region West, pins [411001,411002])`; `(BR-Nashik-01, "Nashik Road", region West, pins [422101])`.

#### 5.2.5 Team (M1)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| team_id | UUID | N | PK | |
| name | VARCHAR(120) | N | | |
| branch_id | UUID | N | FK → Branch | |
| manager_id | UUID | Y | FK → User (SM/BM) | |
| is_active | BOOLEAN | N | default true | |

Sample: `("Pune CV Team", BR-Pune-01, mgr u2)`; `("Pune Mortgage Team", BR-Pune-01)`.

#### 5.2.6 Region (M1)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| region_id | UUID | N | PK | |
| code | VARCHAR(20) | N | unique | |
| name | VARCHAR(80) | N | | |

Sample: `(WEST, "West")`; `(SOUTH, "South")`.

#### 5.2.7 BreakGlassGrant (M1) — FR-003

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| grant_id | UUID | N | PK | |
| grantee_id | UUID | N | FK → User (ADMIN/DPO) | |
| approver_id | UUID | N | FK → User | four-eyes |
| scope_type | VARCHAR(20) | N | enum (lead/branch/all) | |
| scope_ref | UUID | Y | target lead/branch | |
| reason | VARCHAR(500) | N | | mandatory |
| status | VARCHAR(20) | N | enum grant_status; default 'active' | active/expired/revoked |
| valid_from | TIMESTAMPTZ | N | | |
| valid_until | TIMESTAMPTZ | N | > valid_from; max window configurable | |

Relationships: references granter/approver Users. Every use writes AuditLog (action `break_glass_access`). Index: `(grantee_id, status, valid_until)`.

Sample: `(g1, grantee u_admin, approver u_dpo, scope lead LD-2026-000123, reason "incident #4471", active, 2h window)`.

#### 5.2.8 Lead (M2) — central entity

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| lead_id | UUID | N | PK | |
| lead_code | VARCHAR(20) | N | unique; `LD-{YYYY}-{seq6}` | immutable |
| stage | VARCHAR(30) | N | enum lead_stage; default 'captured' | see §10 |
| product_id | UUID | N | FK → ProductConfig (product) | |
| product_config_version | INTEGER | N | version pinned at creation | FR-040 |
| branch_id | UUID | Y | FK → Branch | routing |
| pin_code | VARCHAR(6) | Y | 6-digit | |
| owner_id | UUID | Y | FK → User | allocated RM |
| team_id | UUID | Y | FK → Team | |
| source_attribution_id | UUID | N | FK → SourceAttribution | |
| customer_profile_id | UUID | Y | FK → CustomerProfile | |
| lead_identity_id | UUID | N | FK → LeadIdentity | |
| priority | VARCHAR(10) | N | enum priority; default 'normal' | low/normal/high |
| is_hot | BOOLEAN | N | default false | FR-031 |
| score | INTEGER | Y | 0–100 | explainable |
| score_reasons | JSONB | Y | array of reason codes | FR-011/031 |
| requested_amount | NUMERIC(15,2) | Y | ≥ 0 | |
| channel_created_by | VARCHAR(30) | N | enum creation_channel | manual/bulk/api/qr/partner/website/missed_call |
| consent_status | VARCHAR(20) | N | enum consent_status; default 'pending' | derived summary |
| kyc_status | VARCHAR(20) | N | enum kyc_status; default 'not_started' | derived summary |
| duplicate_status | VARCHAR(20) | N | enum dup_status; default 'none' | none/flagged/linked/merged |
| master_lead_id | UUID | Y | FK → Lead (self) | set when merged |
| sla_first_contact_due_at | TIMESTAMPTZ | Y | | FR-104 |
| rejection_reason_id | UUID | Y | FK → RejectionReason | when rejected |
| reopened_count | INTEGER | N | default 0 | |
| nurture_next_at | TIMESTAMPTZ | Y | | dormant/nurture |
| los_application_id | VARCHAR(64) | Y | from LOS | set on hand-off |

Relationships: belongs to ProductConfig, Branch, Team, User(owner), SourceAttribution, LeadIdentity, CustomerProfile; has many Document/Task/ConsentRecord/StageHistory/CommunicationLog/Note; self-ref master_lead. Indexes: `lead_code` unique, `(stage, branch_id)`, `(owner_id, stage)`, `(product_id, stage)`, `source_attribution_id`, `master_lead_id`, `sla_first_contact_due_at`, GIN `score_reasons`.

Sample:
- `(LD-2026-000123, stage contacted, product CV, owner u1, branch BR-Pune-01, source DSA/Apex, priority high, is_hot true, score 78, req 1,800,000, consent captured, kyc in_progress)`
- `(LD-2026-000124, stage captured, product Two Wheeler, channel qr, branch BR-Nashik-01, priority normal, score 41, consent pending)`
- `(LD-2026-000125, stage handed_off, product Secured Business, owner u4, score 83, los_application_id "LOSAPP-99812")`

#### 5.2.9 LeadIdentity (M2)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| lead_identity_id | UUID | N | PK | |
| name | VARCHAR(150) | N | | |
| mobile | VARCHAR(10) | N | `^[6-9]\d{9}$` | match key |
| email | VARCHAR(255) | Y | email | |
| pan_token | VARCHAR(64) | Y | tokenised; masked display | never raw |
| pan_masked | VARCHAR(12) | Y | `ABCxxxx1F` | |
| ckyc_id | VARCHAR(20) | Y | 14-digit CKYC | |
| gstin | VARCHAR(15) | Y | GSTIN format | business leads |
| dob | DATE | Y | past date | |
| aadhaar_ref_token | VARCHAR(64) | Y | tokenised reference only | raw never stored |
| address | JSONB | Y | line, city, state, pin | |
| preferred_language | VARCHAR(20) | Y | enum language | |

Relationships: one-to-one with Lead (1 active identity per lead). Indexes: `mobile`, `pan_token`, `ckyc_id`, `gstin` (all non-unique; used by duplicate detection).

Sample: `(name "Ramesh T", mobile 98xxxxxx10, pan ABCxxxx1F, lang Marathi)`; `(name "Apex Logistics LLP", mobile 99xxxxxx21, gstin 27ABCDE1234F1Z5)`.

#### 5.2.10 CustomerProfile (M2)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| customer_profile_id | UUID | N | PK | |
| primary_mobile | VARCHAR(10) | N | unique per org | reusable shell |
| display_name | VARCHAR(150) | N | | |
| customer_type | VARCHAR(20) | N | enum customer_type | individual/business |
| is_existing_customer | BOOLEAN | N | default false | returning-customer flag |
| address | JSONB | Y | | |
| preferred_language | VARCHAR(20) | Y | enum language | |

Relationships: has many Lead. Index: `primary_mobile` unique.

Sample: `(mobile 98xxxxxx10, "Ramesh T", individual, existing true)`; `(mobile 99xxxxxx21, "Apex Logistics LLP", business)`.

#### 5.2.11 SourceAttribution (M2)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| source_attribution_id | UUID | N | PK | |
| source | VARCHAR(40) | N | enum source | DSA/Dealer/Branch/Website/Referral/Telecalling/Field |
| sub_source | VARCHAR(80) | Y | | |
| partner_id | UUID | Y | FK → Partner | mandatory if source∈{DSA,Dealer} |
| campaign_code | VARCHAR(40) | Y | | |
| utm | JSONB | Y | source/medium/campaign/term/content | |
| creator_channel | VARCHAR(30) | N | enum creation_channel | |
| attribution_status | VARCHAR(20) | N | enum attribution_status; default 'original' | original/reassigned/merged_into |

Relationships: belongs to Partner; one per Lead. Index: `(source, partner_id)`, `campaign_code`.

Sample: `(DSA, sub "Apex-walkin", partner PRT-00045, channel partner, original)`; `(Website, utm{campaign:divali}, channel api, original)`.

#### 5.2.12 DuplicateMatch (M3)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| duplicate_match_id | UUID | N | PK | |
| lead_id | UUID | N | FK → Lead | the new/candidate lead |
| matched_lead_id | UUID | N | FK → Lead | existing match |
| confidence | VARCHAR(10) | N | enum match_confidence | strong/medium/weak |
| matched_on | JSONB | N | array of match keys + reasons | e.g. ["pan","mobile"] |
| action | VARCHAR(20) | N | enum dup_action; default 'flagged' | blocked/warned/queued/linked/merged/overridden |
| action_by | UUID | Y | FK → User | |
| action_reason | VARCHAR(500) | Y | mandatory for override/merge | |
| status | VARCHAR(20) | N | enum dup_record_status; default 'open' | open/resolved |

Relationships: connects two Leads. Index: `(lead_id, status)`, `matched_lead_id`. Every action writes AuditLog.

Sample: `(lead LD-..124, matched LD-..101, strong, matched_on[pan,mobile], action blocked)`; `(lead LD-..130, matched LD-..077, weak, matched_on[name,pin], action warned)`.

#### 5.2.13 AllocationRule (M4)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| allocation_rule_id | UUID | N | PK | |
| name | VARCHAR(120) | N | | |
| priority_order | INTEGER | N | unique within active set | lower = evaluated first |
| method | VARCHAR(30) | N | enum allocation_method | round_robin/capacity/specialist/branch/partner/escalation |
| criteria | JSONB | N | predicate (branch/pin/product/source/partner/language/score) | |
| target | JSONB | N | resolves to RM pool/team | |
| capacity_limit | INTEGER | Y | max open hot leads per RM | |
| is_active | BOOLEAN | N | default true | |

Relationships: produces `owner_id` + reason codes on Lead. Index: `(is_active, priority_order)`.

Sample: `(10, "CV→specialist", specialist, criteria{product:CV}, target CV-RM pool)`; `(20, "Pin→branch", branch, criteria{pin:411001}, target BR-Pune-01)`; `(99, "SLA escalation", escalation, criteria{sla_breach:true})`.

#### 5.2.14 ProductConfig (M5)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| product_config_id | UUID | N | PK | per product+version |
| product_code | VARCHAR(40) | N | enum product | CV/CAR/TRACTOR/CE/TW/SBL/HRM |
| name | VARCHAR(120) | N | | |
| version | INTEGER | N | increments on change | leads pin a version |
| status | VARCHAR(20) | N | enum config_status; default 'draft' | draft/active/retired |
| field_schema | JSONB | N | field groups, labels, types, mandatory, validation | drives capture form |
| document_checklist | JSONB | N | doc types + mandatory + applicant scope | drives FR-070 |
| sla_config | JSONB | Y | references SLAPolicy ids | |
| eligibility_mapping | JSONB | Y | LMS field → LOS payload field | FR-080; IT-approved |
| pan_required_at | VARCHAR(20) | N | enum pan_timing; default 'before_kyc' | at_capture/before_kyc/before_handoff |

Relationships: has many LeadProductDetail; referenced by Lead. Unique: `(product_code, version)`. Index: `(product_code, status)`.

Sample: `(CV, v3, active, pan before_handoff)`; `(SBL, v2, active, pan before_kyc)`; `(TW, v1, active, pan at_capture optional)`.

#### 5.2.15 LeadProductDetail (M5)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| lead_product_detail_id | UUID | N | PK | |
| lead_id | UUID | N | FK → Lead | |
| product_config_id | UUID | N | FK → ProductConfig (pinned version) | |
| attributes | JSONB | N | validated against field_schema | product-specific answers |
| validation_status | VARCHAR(20) | N | enum validation_status; default 'incomplete' | incomplete/valid/invalid |

Relationships: one per Lead (active). Index: `lead_id` unique. GIN on `attributes`.

Sample: `(LD-..123, CV v3, {vehicle_type:"truck", new_used:"used", invoice:1800000, route:"intercity"}, valid)`; `(LD-..125, SBL v2, {turnover:25000000, gstin_present:true}, valid)`.

#### 5.2.16 Scheme (M5)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| scheme_id | UUID | N | PK | |
| code | VARCHAR(40) | N | unique | |
| name | VARCHAR(120) | N | | |
| product_code | VARCHAR(40) | Y | enum product | null = all |
| subvention_flag | BOOLEAN | N | default false | non-credit metadata |
| valid_from | DATE | N | | |
| valid_to | DATE | N | ≥ valid_from | |
| is_active | BOOLEAN | N | default true | |

Sample: `(DIVALI-CV-26, "Divali CV", CV, valid 2026-10-01..2026-11-15)`; `(DEALER-TW-Q3, "Dealer TW Scheme", TW, subvention true)`.

#### 5.2.17 Partner (M10)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| partner_id | UUID | N | PK | |
| partner_code | VARCHAR(20) | N | unique; `PRT-{seq5}` | |
| type | VARCHAR(20) | N | enum partner_type | DSA/Dealer/Connector/OEM/Aggregator/Referral |
| legal_name | VARCHAR(150) | N | | |
| branch_id | UUID | Y | FK → Branch | territory |
| products | JSONB | Y | array of product_code | |
| contact_person | VARCHAR(150) | Y | | |
| contact_mobile | VARCHAR(10) | Y | | |
| status | VARCHAR(20) | N | enum partner_status; default 'active' | active/suspended/expired |
| agreement_ref | VARCHAR(80) | Y | | |
| commission_flag | BOOLEAN | N | default false | metadata only (no payout) |
| mapped_rm_id | UUID | Y | FK → User | |
| risk_category | VARCHAR(20) | Y | enum risk_band | low/medium/high |
| quality_score | INTEGER | Y | 0–100 | from FR-092 |
| valid_until | DATE | Y | | |

Relationships: has many SourceAttribution/Lead; maps to RM. Index: `partner_code` unique, `(type, status)`.

Sample: `(PRT-00045, Dealer, "Apex Motors", products[CV,CAR], status active, mapped u1, quality 72)`; `(PRT-00088, DSA, "Sunrise Associates", status active, quality 55)`.

#### 5.2.18 CustomerLink (M7) — FR-060/062

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| customer_link_id | UUID | N | PK | |
| lead_id | UUID | N | FK → Lead | scoped to one lead |
| token_hash | VARCHAR(255) | N | hash of opaque token | raw token only in URL |
| purpose | JSONB | N | allowed actions (upload/consent/callback/status/grievance) | |
| status | VARCHAR(20) | N | enum link_status; default 'active' | active/expired/revoked/used |
| otp_verified_at | TIMESTAMPTZ | Y | | step-up gate |
| expires_at | TIMESTAMPTZ | N | default now + 7d | configurable |
| opened_at | TIMESTAMPTZ | Y | | |
| revoked_by | UUID | Y | FK → User | |

Relationships: belongs to Lead; gates Document uploads. Index: `token_hash` unique, `(lead_id, status)`. Every open/action audited.

Sample: `(link for LD-..123, purpose[upload,consent,status], active, expires +7d)`; `(link for LD-..124, purpose[status], used)`.

#### 5.2.19 Document (M8)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| document_id | UUID | N | PK | |
| lead_id | UUID | N | FK → Lead | |
| doc_type | VARCHAR(40) | N | enum doc_type | id/pan/address/income/bank/quotation/rc/property/etc |
| applicant_scope | VARCHAR(20) | N | enum applicant_scope | applicant/co_applicant/guarantor/business |
| status | VARCHAR(20) | N | enum doc_status; default 'pending' | not_required/pending/uploaded/under_review/verified/mismatch/waived/expired |
| storage_ref | VARCHAR(255) | Y | GCS object path | signed-URL access |
| file_type | VARCHAR(10) | Y | pdf/jpg/png/heic | |
| file_size_kb | INTEGER | Y | ≤ configured max | |
| version | INTEGER | N | default 1 | re-upload increments |
| uploaded_via | VARCHAR(20) | Y | enum upload_channel | rm/customer_link/partner/digilocker |
| verified_by | UUID | Y | FK → User | |
| waiver_reason | VARCHAR(500) | Y | mandatory if waived | |
| classification | VARCHAR(20) | N | enum data_classification; default 'pii' | |
| virus_scan_status | VARCHAR(20) | N | enum scan_status; default 'pending' | pending/clean/infected |
| expires_at | TIMESTAMPTZ | Y | | doc validity |

Relationships: belongs to Lead; produced by CustomerLink/RM/partner; feeds KYCVerification. Index: `(lead_id, doc_type, applicant_scope)`, `(status)`.

Sample: `(LD-..123, doc_type rc, applicant, verified, pdf, via customer_link, clean)`; `(LD-..123, doc_type income, uploaded, under_review)`; `(LD-..125, doc_type property, mismatch, "title chain unclear")`.

#### 5.2.20 KYCVerification (M8)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| kyc_verification_id | UUID | N | PK | |
| lead_id | UUID | N | FK → Lead | |
| kyc_type | VARCHAR(20) | N | enum kyc_type | pan/ckyc/digilocker/aadhaar_otp/vcip/manual |
| provider | VARCHAR(60) | Y | provider name | |
| status | VARCHAR(20) | N | enum kyc_check_status; default 'initiated' | initiated/success/failed/exception/waived |
| reference | VARCHAR(120) | Y | provider ref | |
| masked_response | JSONB | Y | masked result only | no raw Aadhaar/biometric |
| exception_type | VARCHAR(40) | Y | enum kyc_exception | pan_mismatch/name_mismatch/expired/unreadable/ckyc_unavailable/vcip_failed/provider_down |
| exception_owner_id | UUID | Y | FK → User | |
| exception_sla_due_at | TIMESTAMPTZ | Y | | |
| resolution_code | VARCHAR(40) | Y | | |
| integration_log_id | UUID | Y | FK → IntegrationLog | |

Relationships: belongs to Lead; links IntegrationLog. Index: `(lead_id, kyc_type)`, `(status)`, `(exception_type, status)`.

Sample: `(LD-..123, pan, provider NSDL, success, masked ABCxxxx1F)`; `(LD-..125, ckyc, exception ckyc_unavailable, owner u_kyc, sla +1d)`.

#### 5.2.21 Task (M11)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| task_id | UUID | N | PK | |
| lead_id | UUID | Y | FK → Lead | null for non-lead tasks |
| type | VARCHAR(30) | N | enum task_type | call/visit/doc_request/kyc_appt/dealer_followup/callback/approval/handoff_retry/nurture |
| owner_id | UUID | N | FK → User | |
| due_at | TIMESTAMPTZ | N | | |
| priority | VARCHAR(10) | N | enum priority; default 'normal' | |
| sla_policy_id | UUID | Y | FK → SLAPolicy | |
| status | VARCHAR(20) | N | enum task_status; default 'open' | open/in_progress/done/overdue/cancelled |
| disposition | VARCHAR(40) | Y | enum disposition | connected/no_answer/wrong_number/visited/rescheduled/etc |
| result_note | VARCHAR(1000) | Y | | |
| geo | JSONB | Y | lat/lng/accuracy (visits) | consent-bound |
| next_action_at | TIMESTAMPTZ | Y | | |

Relationships: belongs to Lead + owner User; uses SLAPolicy. Index: `(owner_id, status, due_at)`, `(lead_id)`, `(status, due_at)` for overdue sweep.

Sample: `(LD-..123, call, owner u1, due today 16:00, open)`; `(LD-..123, visit, geo set, done, disposition visited)`; `(LD-..124, callback, due tomorrow, open)`.

#### 5.2.22 CommunicationTemplate (M11)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| template_id | UUID | N | PK | |
| code | VARCHAR(60) | N | | event/template key |
| version | INTEGER | N | | |
| channel | VARCHAR(20) | N | enum channel | in_app/email/sms/whatsapp |
| language | VARCHAR(20) | N | enum language | |
| category | VARCHAR(20) | N | enum comm_category | transactional/marketing |
| product_code | VARCHAR(40) | Y | enum product | null = all |
| body | TEXT | N | placeholder tokens | |
| status | VARCHAR(20) | N | enum config_status; default 'draft' | |

Relationships: used by CommunicationLog. Unique: `(code, channel, language, version)`.

Sample: `(DOC_REQUEST, v2, whatsapp, Marathi, transactional)`; `(HANDOFF_READY, v1, email, English, transactional)`.

#### 5.2.23 CommunicationLog (M11)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| communication_log_id | UUID | N | PK | |
| lead_id | UUID | Y | FK → Lead | |
| template_id | UUID | Y | FK → CommunicationTemplate | null for ad-hoc/call |
| channel | VARCHAR(20) | N | enum channel | |
| recipient | VARCHAR(255) | N | masked at rest in logs | |
| consent_basis | VARCHAR(40) | Y | enum consent_purpose | required for customer msgs |
| status | VARCHAR(20) | N | enum delivery_status; default 'queued' | queued/sent/delivered/failed |
| provider_ref | VARCHAR(120) | Y | | |
| failure_reason | VARCHAR(255) | Y | | |
| sent_at | TIMESTAMPTZ | Y | | |

Relationships: belongs to Lead; references Template. Index: `(lead_id)`, `(status)`, `(channel, sent_at)`.

Sample: `(LD-..123, DOC_REQUEST, whatsapp, 98xxxxxx10, basis document_processing, delivered)`; `(LD-..124, channel sms, basis lead_contact, failed "invalid number")`.

#### 5.2.24 Notification (M11)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| notification_id | UUID | N | PK | |
| recipient_user_id | UUID | N | FK → User | |
| event_code | VARCHAR(40) | N | enum event_code | §11 matrix |
| lead_id | UUID | Y | FK → Lead | |
| title | VARCHAR(150) | N | | |
| body | VARCHAR(500) | N | | |
| is_read | BOOLEAN | N | default false | |
| created_at | TIMESTAMPTZ | N | | (standard) |

Index: `(recipient_user_id, is_read, created_at)`.

Sample: `(u1, HOT_LEAD, LD-..123, "New hot lead assigned", unread)`; `(u2, FIRST_CONTACT_BREACH, LD-..124, "SLA breached", read)`.

#### 5.2.25 NotificationPreference (M11) — FR-103

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| notification_preference_id | UUID | N | PK | |
| subject_type | VARCHAR(20) | N | enum subject_type | user/customer |
| subject_ref | UUID | N | user_id or customer_profile_id | |
| channel | VARCHAR(20) | N | enum channel | |
| purpose | VARCHAR(40) | N | enum consent_purpose | |
| opted_in | BOOLEAN | N | default true (transactional) / false (marketing) | |
| updated_at | TIMESTAMPTZ | N | | (standard) |

Unique: `(subject_type, subject_ref, channel, purpose)`.

Sample: `(customer, cust1, whatsapp, marketing, opted_in false)`; `(customer, cust1, whatsapp, document_processing, opted_in true)`.

#### 5.2.26 ConsentRecord (M12) — append-only

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| consent_id | UUID | N | PK | |
| lead_id | UUID | N | FK → Lead | |
| customer_profile_id | UUID | Y | FK → CustomerProfile | |
| purpose | VARCHAR(40) | N | enum consent_purpose | |
| data_category | VARCHAR(40) | Y | enum data_category | |
| state | VARCHAR(20) | N | enum consent_state | granted/denied/withdrawn/expired/superseded |
| channel | VARCHAR(30) | N | enum creation_channel | |
| language | VARCHAR(20) | Y | enum language | |
| notice_version | VARCHAR(40) | N | privacy notice version | |
| consent_text_version | VARCHAR(40) | N | | |
| actor | VARCHAR(20) | N | enum consent_actor | customer/rm/partner/system |
| ip_device | JSONB | Y | ip/device/channel evidence | |
| expires_at | TIMESTAMPTZ | Y | | |
| superseded_by | UUID | Y | FK → ConsentRecord | |

Relationships: belongs to Lead/Customer; append-only (no update/delete). Index: `(lead_id, purpose, state)`, `(customer_profile_id, purpose)`.

Sample: `(LD-..123, lead_contact, granted, channel partner, actor customer, notice v3)`; `(LD-..123, marketing, withdrawn, actor customer)`; `(LD-..125, aa_bank_data, granted, actor customer)`.

#### 5.2.27 DataSharingLog (M12)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| data_sharing_log_id | UUID | N | PK | |
| lead_id | UUID | N | FK → Lead | |
| recipient | VARCHAR(120) | N | LOS/provider name | |
| purpose | VARCHAR(40) | N | enum consent_purpose | |
| data_category | VARCHAR(40) | N | enum data_category | |
| consent_id | UUID | Y | FK → ConsentRecord | legal basis |
| status | VARCHAR(20) | N | enum share_status; default 'shared' | shared/failed |
| shared_at | TIMESTAMPTZ | N | | |

Index: `(lead_id)`, `(recipient, shared_at)`.

Sample: `(LD-..123, recipient "LOS", purpose los_handoff, consent ref, shared)`; `(LD-..125, recipient "AA/FIU", purpose aa_bank_data, shared)`.

#### 5.2.28 Grievance (M12) — FR-061/114

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| grievance_id | UUID | N | PK | |
| grievance_no | VARCHAR(20) | N | unique; `GRV-{YYYY}-{seq5}` | |
| lead_id | UUID | Y | FK → Lead | |
| source | VARCHAR(30) | N | enum grievance_source | customer_link/rm/branch/call_centre/partner/admin |
| category | VARCHAR(40) | N | enum grievance_category | |
| description | VARCHAR(2000) | N | | |
| owner_id | UUID | Y | FK → User | grievance officer |
| sla_due_at | TIMESTAMPTZ | Y | | |
| status | VARCHAR(20) | N | enum grievance_status; default 'open' | open/in_progress/escalated/resolved/closed |
| response | VARCHAR(2000) | Y | | |
| closure_proof_ref | VARCHAR(255) | Y | | |

Index: `grievance_no` unique, `(status, sla_due_at)`.

Sample: `(GRV-2026-00031, lead LD-..123, source customer_link, category "delay", open, sla +3d)`.

#### 5.2.29 DataRightsRequest (M12) — FR-112

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| data_rights_request_id | UUID | N | PK | |
| customer_profile_id | UUID | N | FK → CustomerProfile | |
| lead_id | UUID | Y | FK → Lead | |
| request_type | VARCHAR(30) | N | enum rights_type | access/correction/update/erasure/withdrawal/grievance |
| status | VARCHAR(20) | N | enum rights_status; default 'open' | open/in_review/fulfilled/rejected_retained |
| owner_id | UUID | Y | FK → User (DPO) | |
| due_at | TIMESTAMPTZ | Y | | |
| disposition | VARCHAR(500) | Y | retain-vs-erase decision + basis | |

Index: `(status, due_at)`, `customer_profile_id`.

Sample: `(cust1, erasure, in_review, owner u_dpo, disposition "retain — KYC legal hold")`; `(cust2, access, fulfilled)`.

#### 5.2.30 DLARegistry (M12) — FR-113

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| dla_registry_id | UUID | N | PK | |
| name | VARCHAR(150) | N | | DLA/LSP/partner interface |
| type | VARCHAR(20) | N | enum dla_type | dla/lsp/partner |
| owner | VARCHAR(120) | Y | | |
| url | VARCHAR(255) | Y | | app/website link |
| grievance_officer | JSONB | Y | name/email/phone | |
| enabled_products | JSONB | Y | array product_code | |
| data_collected | JSONB | Y | categories | |
| storage_location | VARCHAR(120) | Y | | |
| status | VARCHAR(20) | N | enum config_status; default 'active' | |

Sample: `("Apex Dealer Portal", lsp, products[CV,CAR], status active)`; `("NBFC Website Lead Form", dla, status active)`.

#### 5.2.31 RetentionPolicy (M12) — FR-115

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| retention_policy_id | UUID | N | PK | |
| data_category | VARCHAR(40) | N | enum data_category | |
| lead_outcome | VARCHAR(20) | Y | enum lead_outcome | rejected/handed_off/dormant/any |
| retain_days | INTEGER | N | ≥ 0 | |
| action | VARCHAR(20) | N | enum retention_action | purge/anonymise |
| legal_hold | BOOLEAN | N | default false | blocks purge |
| is_active | BOOLEAN | N | default true | |

Sample: `(pii, rejected, 365, anonymise)`; `(kyc_doc, handed_off, 2555, purge, legal_hold true)`.

#### 5.2.32 EligibilitySnapshot (M9)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| eligibility_snapshot_id | UUID | N | PK | |
| lead_id | UUID | N | FK → Lead | |
| request_ref | VARCHAR(120) | N | idempotency/correlation | |
| indicative_amount | NUMERIC(15,2) | Y | | LOS-owned, read-only |
| tenure_months | INTEGER | Y | | |
| rate_range | VARCHAR(40) | Y | | |
| conditions | JSONB | Y | | |
| validity_until | TIMESTAMPTZ | Y | | |
| status | VARCHAR(20) | N | enum eligibility_status; default 'pending' | pending/received/failed |
| response_basis | VARCHAR(40) | Y | "indicative"/"final" as returned | |

Index: `(lead_id)`, `(status)`. Read-only mirror; never edited by LMS users.

Sample: `(LD-..123, indicative 1,500,000, tenure 48, rate "12–14%", received, indicative)`; `(LD-..124, pending)`.

#### 5.2.33 LOSApplicationMirror (M9)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| los_mirror_id | UUID | N | PK | |
| lead_id | UUID | N | FK → Lead | |
| los_application_id | VARCHAR(64) | N | unique | |
| status | VARCHAR(40) | N | LOS status string (read-only) | |
| status_date | TIMESTAMPTZ | N | | |
| correlation_id | VARCHAR(120) | Y | | |
| received_via | VARCHAR(20) | N | enum mirror_source | webhook/poll |

Index: `los_application_id` unique, `(lead_id, status_date)`.

Sample: `(LD-..125, LOSAPP-99812, "Under Review", via webhook)`; `(LD-..125, LOSAPP-99812, "Sanctioned", via poll)`.

#### 5.2.34 SavedView (M6)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| saved_view_id | UUID | N | PK | |
| owner_id | UUID | N | FK → User | |
| name | VARCHAR(120) | N | | |
| filter_json | JSONB | N | stored filter/sort | |
| is_shared | BOOLEAN | N | default false | team-visible |
| scope | VARCHAR(2) | N | enum data_scope | constrains shared views |

Index: `(owner_id)`, `(is_shared)`.

Sample: `(u1, "My Hot CV", {product:CV,is_hot:true}, private)`; `(u2, "Branch SLA Breached", shared)`.

#### 5.2.35 AuditLog (M13) — tamper-evident

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| audit_id | UUID | N | PK | |
| actor_id | UUID | N | FK → User (or system UUID) | |
| action | VARCHAR(50) | N | enum audit_action | §5.5 |
| entity_type | VARCHAR(50) | N | | |
| entity_id | UUID | Y | | |
| lead_id | UUID | Y | FK → Lead | for lead-scoped search |
| before_hash | VARCHAR(64) | Y | sha-256 | |
| after_hash | VARCHAR(64) | Y | sha-256 | |
| prev_audit_hash | VARCHAR(64) | Y | hash chain link | tamper-evidence |
| detail | JSONB | Y | masked diff/context | no PII values |
| ip_device | JSONB | Y | | |
| created_at | TIMESTAMPTZ | N | | (standard) append-only |

Index: `(lead_id, created_at)`, `(actor_id, created_at)`, `(action, created_at)`. **Append-only**: no UPDATE/DELETE permitted.

Sample: `(actor u1, action lead_create, entity Lead LD-..123)`; `(actor u_admin, action break_glass_access, entity Lead LD-..123)`; `(actor u1, action export_generate, entity ExportJob)`.

#### 5.2.36 ExportJob (M13) — FR-122

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| export_job_id | UUID | N | PK | |
| requested_by | UUID | N | FK → User | |
| report_code | VARCHAR(60) | N | | |
| filters | JSONB | N | | recorded for audit |
| scope | VARCHAR(2) | N | enum data_scope | |
| masking_level | VARCHAR(20) | N | enum masking_level | full/partial/unmasked |
| row_count | INTEGER | Y | | |
| status | VARCHAR(20) | N | enum job_status; default 'queued' | queued/running/completed/failed/awaiting_approval |
| approver_id | UUID | Y | FK → User | if threshold exceeded |
| artefact_ref | VARCHAR(255) | Y | GCS path; watermarked | |

Index: `(requested_by, status)`. Large/sensitive exports require approval (config threshold).

Sample: `(u2, "first_contact_sla", scope B, partial, completed, 1240 rows)`; `(u_dpo, "consent_ops", unmasked, awaiting_approval)`.

#### 5.2.37 RejectionReason (M14)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| rejection_reason_id | UUID | N | PK | |
| primary_reason | VARCHAR(60) | N | enum rejection_primary | |
| sub_reason | VARCHAR(80) | Y | | |
| requires_remarks | BOOLEAN | N | default false | true for "other" |
| is_active | BOOLEAN | N | default true | |

Sample: `(no_response, "3 attempts failed", remarks false)`; `(kyc_mismatch, "PAN-name mismatch")`; `(other, requires_remarks true)`.

#### 5.2.38 SLAPolicy (M14) — FR-104

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| sla_policy_id | UUID | N | PK | |
| name | VARCHAR(120) | N | | |
| applies_to | VARCHAR(30) | N | enum sla_target | first_contact/document/kyc_exception/grievance/handoff_retry |
| condition | JSONB | Y | e.g. {priority:high} | |
| threshold_minutes | INTEGER | N | business-hours aware | |
| escalation_chain | JSONB | N | ordered roles/users | |
| is_active | BOOLEAN | N | default true | |

Sample: `("Hot first contact", first_contact, {priority:high}, 120, [BM,SM])`; `("Doc TAT", document, 4320, [BM])`.

#### 5.2.39 ConfigurationVersion (M14) — FR-132

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| configuration_version_id | UUID | N | PK | |
| config_type | VARCHAR(40) | N | product/checklist/sla/allocation/template/consent/retention/etc | |
| config_ref | UUID | Y | target config row | |
| version | INTEGER | N | | |
| maker_id | UUID | N | FK → User | |
| checker_id | UUID | Y | FK → User | maker-checker |
| status | VARCHAR(20) | N | enum config_change_status; default 'pending' | pending/approved/rejected/active/rolled_back |
| effective_at | TIMESTAMPTZ | Y | | |
| rollback_ref | UUID | Y | FK → ConfigurationVersion | |
| diff | JSONB | Y | change summary | |

Index: `(config_type, status)`. High-impact changes need checker ≠ maker.

Sample: `(product, CV config, v3, maker u_prodops, checker u_admin, active)`; `(sla, "Hot first contact", pending)`.

#### 5.2.40 IntegrationLog (M15) — FR-140

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| integration_log_id | UUID | N | PK | |
| integration | VARCHAR(40) | N | enum integration | los_eligibility/los_handoff/pan/ckyc/digilocker/aadhaar/vcip/comm/cti/aa/gst/asset |
| direction | VARCHAR(10) | N | enum direction | outbound/inbound |
| lead_id | UUID | Y | FK → Lead | |
| correlation_id | VARCHAR(120) | N | | |
| idempotency_key | VARCHAR(120) | Y | | dedupe |
| request_ref | VARCHAR(255) | Y | payload store ref (masked) | |
| status | VARCHAR(20) | N | enum integration_status; default 'pending' | pending/success/failed/retrying |
| http_status | INTEGER | Y | | |
| retry_count | INTEGER | N | default 0 | |
| error_code | VARCHAR(60) | Y | | |
| completed_at | TIMESTAMPTZ | Y | | |

Index: `(integration, status)`, `idempotency_key` unique-where-present, `(lead_id)`.

Sample: `(los_handoff, outbound, LD-..125, idem k1, success, http 201, retries 0)`; `(pan, outbound, LD-..123, retrying, retries 2)`.

#### 5.2.41 WebhookSubscription (M15)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| webhook_subscription_id | UUID | N | PK | |
| event_code | VARCHAR(40) | N | enum event_code | |
| target_url | VARCHAR(255) | N | https only | |
| secret_ref | VARCHAR(120) | N | Secret Manager ref | HMAC signing |
| is_active | BOOLEAN | N | default true | |
| last_status | VARCHAR(20) | Y | enum delivery_status | |

Sample: `(LEAD_HANDED_OFF → LOS callback URL, active)`; `(DATA_RIGHT_REQUEST → compliance webhook, active)`.

#### 5.2.42 EventOutbox (M15) — FR-141

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| event_id | UUID | N | PK | |
| event_code | VARCHAR(40) | N | enum event_code | domain event |
| aggregate_type | VARCHAR(40) | N | e.g. Lead/Task/Consent | |
| aggregate_id | UUID | N | | |
| payload | JSONB | N | masked, schema-versioned | analytics/AI feed |
| schema_version | INTEGER | N | default 1 | |
| status | VARCHAR(20) | N | enum outbox_status; default 'pending' | pending/published/failed |
| published_at | TIMESTAMPTZ | Y | | |

Written in the **same transaction** as the state change (transactional outbox). Index: `(status, created_at)`, `(aggregate_type, aggregate_id)`.

Sample: `(LEAD_STAGE_CHANGED, Lead, LD-..123, {from:contacted,to:qualified}, pending)`; `(CONSENT_WITHDRAWN, Consent, c2, published)`.

#### 5.2.43 StageHistory (M2) — append-only stage-transition read-model

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| stage_history_id | UUID | N | PK | |
| lead_id | UUID | N | FK → Lead | |
| from_stage | VARCHAR(30) | Y | enum lead_stage | null for the initial `captured` row; supplies prior stage for `rejected → prior active` reopen |
| to_stage | VARCHAR(30) | N | enum lead_stage | |
| actor_id | UUID | N | FK → User (or system UUID) | who triggered the transition |
| reason | VARCHAR(500) | Y | | rejection/nurture/reopen reason where applicable |
| occurred_at | TIMESTAMPTZ | N | | also the standard `created_at` |

Relationships: belongs to Lead; **append-only** (INSERT only, no UPDATE/DELETE). Written in the **same transaction** as the §10.3 stage transition, alongside `AuditLog(stage_transition)` and the `EventOutbox(LEAD_STAGE_CHANGED)` row. This is the **single source** for §12 stage-reached funnel, dwell-time, and first-contact/TAT metrics, consumed by FR-052/053/120/121 so dashboards and reports cannot diverge. Index: `(lead_id, occurred_at)`, `(to_stage, occurred_at)`.

Sample: `(LD-..123, from null, to captured, actor system)`; `(LD-..123, from contacted, to qualified, actor u1)`; `(LD-..125, from ready_for_handoff, to handed_off, actor u4)`.

#### 5.2.44 Note (M6)

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| note_id | UUID | N | PK | |
| lead_id | UUID | N | FK → Lead | |
| author_id | UUID | N | FK → User | |
| body | VARCHAR(2000) | N | | free-text |
| is_internal | BOOLEAN | N | default true | internal-only; never shown to customer/partner |

Relationships: belongs to Lead + author; shown in the Lead 360 activity log (FR-051). Index: `(lead_id, created_at)`.

Sample: `(LD-..123, author u1, "Customer prefers evening calls", internal)`; `(LD-..123, author u2, "BM approved hot-lead capacity override", internal)`.

#### 5.2.45 ImportJob (M2) — FR-010 bulk import

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| import_job_id | UUID | N | PK | |
| file_ref | VARCHAR(255) | N | GCS object path | uploaded CSV/Excel |
| status | VARCHAR(20) | N | enum job_status; default 'queued' | queued/running/completed/failed |
| total_rows | INTEGER | Y | | |
| success_rows | INTEGER | Y | | |
| failed_rows | INTEGER | Y | | partial outcome when `> 0` with status `completed` |
| error_file_ref | VARCHAR(255) | Y | GCS path | row-error CSV (row, col, code, message) |
| created_by | UUID | N | FK → User | |

Relationships: produces many `Lead` (FR-010 bulk import); reuses the `job_status` enum (no new enum). Index: `(status, created_at)`, `(created_by)`.

Sample: `(imports/leads_2026-06.csv, completed, total 500, success 488, failed 12, error_file imports/errors_..csv)`; `(imports/dsa_batch.csv, running, total 1200)`.

#### 5.2.46 BusinessCalendar (M14) — SLA/TAT business-time source

| Field | Type | Null | Validation / Default | Notes |
|---|---|---|---|---|
| business_calendar_id | UUID | N | PK | |
| code | VARCHAR(40) | N | unique per org | e.g. DEFAULT, WEST-6DAY |
| name | VARCHAR(120) | N | | |
| timezone | VARCHAR(40) | N | default 'Asia/Kolkata' | IANA tz |
| branch_id | UUID | Y | FK → Branch | branch-specific calendar |
| region_id | UUID | Y | FK → Region | region-specific calendar |
| is_default | BOOLEAN | N | default false | org-wide fallback (one per org) |
| working_hours | JSONB | N | per-weekday {start,end} or null | e.g. `{"mon":{"start":"09:30","end":"18:30"},…,"sun":null}` — supports 6-day weeks |
| holidays | JSONB | Y | array of {date,name} | annual non-working dates |
| is_active | BOOLEAN | N | default true | |

Relationships: optionally scoped to Branch/Region; consumed by the SLA engine (FR-104). **Resolution order:** branch-specific active calendar → region-specific → org `is_default`. This is the single clock for all SLA/TAT computations (first-contact, document, KYC-exception, grievance, handoff-retry) so no timer invents its own. Index: unique `(org_id, code)`; one default per org (partial unique on `is_default`); `branch_id`, `region_id`.

Sample: `(DEFAULT, "Mon–Sat 09:30–18:30 IST", is_default true, working_hours Mon–Sat 09:30–18:30 / Sun null, holidays [{2026-10-21, Diwali}])`; `(WEST-6DAY, region West, working_hours incl. Saturday)`.

### 5.3 Relationship map

```
Region 1───* Branch 1───* Team 1───* User
User *───1 Role 1───* RolePermission
User 1───* Lead (owner)        User 0..1───* Partner (partner users)
Partner 1───* SourceAttribution 1───1 Lead
ProductConfig 1───* Lead        ProductConfig 1───* LeadProductDetail
Lead 1───1 LeadIdentity         Lead *───0..1 CustomerProfile (CustomerProfile 1───* Lead)
Lead 1───* Document             Lead 1───* KYCVerification
Lead 1───* Task                 Lead 1───* ConsentRecord (append-only)
Lead 1───* CommunicationLog     Lead 1───* DataSharingLog
Lead 1───* DuplicateMatch *───1 Lead (matched)   Lead 0..1───* Lead (master_lead self-ref on merge)
Lead 1───* EligibilitySnapshot  Lead 1───* LOSApplicationMirror
Lead 1───* StageHistory (append-only)   Lead 1───* Note   ImportJob 1───* Lead (bulk-created)
Lead 1───* CustomerLink 1───* Document (uploaded via link)
Lead 1───* Grievance            CustomerProfile 1───* DataRightsRequest
CustomerLink/Lead actions ───* AuditLog (every sensitive action)   Lead 1───* EventOutbox
SLAPolicy 1───* Task            AllocationRule ──produces──> Lead.owner_id
Branch/Region 1───* BusinessCalendar (scoped)   BusinessCalendar ──feeds──> SLA/TAT timers (FR-104)
CommunicationTemplate 1───* CommunicationLog   NotificationPreference gates CommunicationLog (customer msgs)
ConfigurationVersion governs ProductConfig/SLAPolicy/AllocationRule/CommunicationTemplate/RetentionPolicy/DLARegistry
IntegrationLog 1───0..1 KYCVerification / EligibilitySnapshot / LOSApplicationMirror
```

Many-to-many resolved via join/lineage entities: Lead↔Lead duplicates via **DuplicateMatch**; Role↔capability via **RolePermission**; recipient↔purpose↔channel via **NotificationPreference**.

### 5.4 Entity ownership & reuse matrix

| Entity | Owning module | Create/Write FRs | Read FRs | Delete/Archive/Retention FRs |
|---|---|---|---|---|
| User/Role/RolePermission | M1 | FR-130 | FR-001/002/003 + all (authz) | FR-130 (deactivate), FR-115 |
| Branch/Team/Region | M1 | FR-130/131 | FR-002, FR-030, FR-053, reports | FR-131 |
| BreakGlassGrant | M1 | FR-003 | FR-123 | FR-115 |
| Lead | M2 | FR-010/011/020/021/030/031/040/050/052/072/080/081/082/112 | nearly all | FR-115 (retention) |
| LeadIdentity | M2 | FR-010, FR-071 | FR-020, FR-051, FR-080 | FR-115 |
| CustomerProfile | M2 | FR-010 | FR-051, FR-062, FR-112 | FR-115 |
| SourceAttribution | M2 | FR-010, FR-021 | FR-092, FR-121 | FR-115 |
| DuplicateMatch | M3 | FR-020, FR-021 | FR-121 (leakage) | FR-115 |
| AllocationRule | M4 | FR-131 | FR-030 | FR-131 |
| ProductConfig | M5 | FR-040, FR-132 | FR-010/041/070/080 | FR-040 (retire) |
| LeadProductDetail | M5 | FR-040, FR-051 | FR-080 | FR-115 |
| Scheme | M5 | FR-042, FR-131 | FR-042 | FR-131 |
| Partner | M10 | FR-090, FR-131 | FR-091/092/030 | FR-090 (suspend) |
| CustomerLink | M7 | FR-060 | FR-062 | FR-060 (revoke), FR-115 |
| Document | M8 | FR-070, FR-060 | FR-071/081, FR-062 | FR-070 (waive), FR-115 |
| KYCVerification | M8 | FR-071, FR-072 | FR-081 | FR-115 |
| Task | M11 | FR-100 | FR-050/053 | FR-115 |
| CommunicationTemplate | M11 | FR-101, FR-131 | FR-101 | FR-131 |
| CommunicationLog | M11 | FR-101 | FR-121 (contactability) | FR-115 |
| Notification | M11 | all (dispatch) | FR-053 | FR-115 |
| NotificationPreference | M11 | FR-103 | FR-101/111 | FR-115 |
| ConsentRecord | M12 | FR-110 | all gated stages | retention exempt (legal) / FR-115 |
| DataSharingLog | M12 | FR-080/081/111 | FR-121 | FR-115 |
| Grievance | M12 | FR-061, FR-114 | FR-121 | FR-115 |
| DataRightsRequest | M12 | FR-112 | FR-121 | FR-115 |
| DLARegistry | M12 | FR-113 | FR-113 | FR-131 |
| RetentionPolicy | M12 | FR-115, FR-131 | FR-115 | FR-131 |
| EligibilitySnapshot | M9 | FR-080 | FR-051 | FR-115 |
| LOSApplicationMirror | M9 | FR-082 | FR-051, FR-121 | FR-115 |
| SavedView | M6 | FR-050 | FR-050 | FR-050 |
| AuditLog | M13 | all (append) | FR-123 | retention per policy (never edit) |
| ExportJob | M13 | FR-122 | FR-123 | FR-115 |
| RejectionReason | M14 | FR-131 | FR-050, rejection flow | FR-131 |
| SLAPolicy | M14 | FR-104, FR-131 | FR-030/100/114 | FR-131 |
| ConfigurationVersion | M14 | FR-132 | FR-123 | n/a |
| IntegrationLog | M15 | FR-140 | FR-121 (handoff failure) | FR-115 |
| WebhookSubscription | M15 | FR-140 | FR-082/140 | FR-140 |
| EventOutbox | M15 | FR-141 (+all writers) | analytics/AI | FR-115 |
| StageHistory | M2 | FR-052 + all §10.3 transitions | FR-051/053/120/121 | FR-115 |
| Note | M6 | FR-051 | FR-051 | FR-115 |
| ImportJob | M2 | FR-010 | FR-050/123 | FR-115 |
| BusinessCalendar | M14 | FR-104, FR-131 | FR-104 (SLA), §12 (TAT) | FR-131 |

### 5.5 Enum & reference-data catalog

The single source of truth for controlled values. No FR may define enum values locally.

| Enum | Values |
|---|---|
| role_code | RM, BM, SM, HEAD, KYC, DPO, PARTNER, ADMIN, CUSTOMER |
| data_scope | O, T, B, R, A, P, C, M, X |
| capability | create_lead, view_lead, edit_lead, upload_doc, verify_doc, kyc_signoff, move_stage, hand_off, allocate, bulk_action, customer_comm, reports, export, consent_ledger, audit_trail, user_mgmt, configuration, break_glass |
| user_status | active, inactive, locked |
| grant_status | active, expired, revoked |
| lead_stage | captured, consent_pending, assigned, first_contact_pending, contacted, qualified, documents_pending, kyc_in_progress, eligibility_requested, ready_for_handoff, handed_off, rejected, dormant |
| priority | low, normal, high |
| creation_channel | manual, bulk, api, qr, partner, website, telecalling, missed_call |
| consent_status (lead summary) | pending, partial, captured, withdrawn |
| kyc_status (lead summary) | not_started, in_progress, verified, exception, waived |
| dup_status (lead) | none, flagged, linked, merged |
| match_confidence | strong, medium, weak |
| dup_action | blocked, warned, queued, linked, merged, overridden |
| dup_record_status | open, resolved |
| product | CV, CAR, TRACTOR, CE, TW, SBL, HRM |
| pan_timing | at_capture, before_kyc, before_handoff |
| config_status | draft, active, retired |
| validation_status | incomplete, valid, invalid |
| allocation_method | round_robin, capacity, specialist, branch, partner, escalation |
| partner_type | DSA, Dealer, Connector, OEM, Aggregator, Referral |
| partner_status | active, suspended, expired |
| risk_band | low, medium, high |
| source | DSA, Dealer, Branch, Website, Referral, Telecalling, Field |
| attribution_status | original, reassigned, merged_into |
| link_status | active, expired, revoked, used |
| doc_type | id, pan, address, income, bank, quotation, rc, permit, insurance, land_record, property, valuation, title, work_order, gst, itr, photo, other |
| applicant_scope | applicant, co_applicant, guarantor, business |
| doc_status | not_required, pending, uploaded, under_review, verified, mismatch, waived, expired |
| upload_channel | rm, customer_link, partner, digilocker |
| scan_status | pending, clean, infected |
| kyc_type | pan, ckyc, digilocker, aadhaar_otp, vcip, manual |
| kyc_check_status | initiated, success, failed, exception, waived |
| kyc_exception | pan_mismatch, name_mismatch, expired, unreadable, address_mismatch, ckyc_unavailable, duplicate_ckyc, vcip_failed, provider_down |
| task_type | call, visit, doc_request, kyc_appt, dealer_followup, callback, approval, handoff_retry, nurture |
| task_status | open, in_progress, done, overdue, cancelled |
| disposition | connected, no_answer, wrong_number, not_interested, visited, rescheduled, callback_requested, docs_promised |
| channel | in_app, email, sms, whatsapp |
| comm_category | transactional, marketing |
| delivery_status | queued, sent, delivered, failed |
| consent_purpose | lead_contact, product_eligibility, kyc, document_processing, los_handoff, communication, partner_sharing, aa_bank_data, gst_business_data, marketing, grievance |
| consent_state | granted, denied, withdrawn, expired, superseded |
| consent_actor | customer, rm, partner, system |
| data_category | identity, contact, financial, kyc_doc, asset, consent, behavioural |
| data_classification | public, internal, confidential, pii, sensitive, restricted |
| share_status | shared, failed |
| grievance_source | customer_link, rm, branch, call_centre, partner, admin |
| grievance_category | service_delay, mis_selling, data_privacy, document_issue, staff_conduct, other |
| grievance_status | open, in_progress, escalated, resolved, closed |
| rights_type | access, correction, update, erasure, withdrawal, grievance |
| rights_status | open, in_review, fulfilled, rejected_retained |
| dla_type | dla, lsp, partner |
| lead_outcome | rejected, handed_off, dormant, any |
| retention_action | purge, anonymise |
| eligibility_status | pending, received, failed |
| mirror_source | webhook, poll |
| masking_level | full, partial, unmasked |
| job_status | queued, running, completed, failed, awaiting_approval |
| rejection_primary | no_response, not_interested, duplicate, product_unsuitable, low_income, out_of_area, document_incomplete, kyc_mismatch, asset_unacceptable, partner_withdrawal, consent_withdrawn, other |
| sla_target | first_contact, document, kyc_exception, grievance, handoff_retry |
| config_change_status | pending, approved, rejected, active, rolled_back |
| integration | los_eligibility, los_handoff, los_status, pan, ckyc, digilocker, aadhaar, vcip, comm, cti, aa, gst, asset, bureau_via_los, campaign |
| direction | outbound, inbound |
| integration_status | pending, success, failed, retrying |
| outbox_status | pending, published, failed |
| subject_type | user, customer |
| customer_type | individual, business |
| language | English, Hindi, Marathi, Tamil, Telugu, Kannada, Gujarati, Bengali |
| event_code | LEAD_CREATED, LEAD_ASSIGNED, HOT_LEAD, FIRST_CONTACT_DUE, FIRST_CONTACT_BREACH, DOC_REQUEST, DOC_UPLOADED, DOC_MISMATCH, CONSENT_PENDING, CONSENT_WITHDRAWN, KYC_EXCEPTION, ELIGIBILITY_RECEIVED, HANDOFF_READY, HANDOFF_FAILED, LEAD_HANDED_OFF, LEAD_STAGE_CHANGED, GRIEVANCE_CREATED, DATA_RIGHT_REQUEST, EXPORT_COMPLETED, CONFIG_CHANGED |
| audit_action | login, logout, login_failed, mfa_failed, lead_create, lead_update, lead_merge, lead_override, attribution_change, consent_grant, consent_withdraw, consent_expire, doc_upload, doc_view, doc_download, doc_verify, doc_waive, doc_delete, kyc_request, kyc_response, kyc_exception, stage_transition, rejection, reopen, nurture, allocate, reassign, link_create, link_open, link_revoke, comm_send, eligibility_request, handoff_attempt, handoff_success, handoff_failure, export_generate, export_download, config_change, user_change, role_change, break_glass_access |

### 5.6 Data-integrity rules

1. **Referential integrity:** all FKs enforced; no orphaned Lead, Document, Consent, or Task. Deleting a referenced master row is blocked (use `is_active = false`).
2. **Lead uniqueness:** `lead_code` globally unique; a merged lead sets `master_lead_id` and `duplicate_status = merged` — its history, consents, and documents are preserved, never deleted (FR-021).
3. **Append-only entities:** `ConsentRecord` and `AuditLog` accept INSERT only; no UPDATE/DELETE (DB-level revoke). Consent changes are new rows with `superseded_by`.
4. **Transactions:** multi-entity writes are atomic — e.g., merge (update master + relink sources + audit), hand-off (lead update + DataSharingLog + IntegrationLog + outbox), config approve (version + activate). The `EventOutbox` row is written in the same transaction as its state change; every lead stage transition additionally writes a `StageHistory` row in that same transaction.
5. **List queries:** every list query carries a server-enforced LIMIT (§4.4); no unbounded scans.
6. **Idempotency:** `IntegrationLog.idempotency_key` and the `Idempotency-Key` header prevent duplicate LOS applications and duplicate customer messages.
7. **Optimistic locking:** updates to `Lead`/config rows use `version` guards; a stale write returns `CONFLICT` (409).
8. **Consent gates:** a lead cannot advance past a stage whose required `consent_purpose` is not in `granted` state (§10.3, §11).
9. **Masking invariant:** sensitive identifiers are stored tokenised/masked; raw Aadhaar/biometrics are never persisted; exports apply the strictest masking for the actor's scope.
10. **Retention vs legal hold:** the retention engine (FR-115) never purges/anonymises rows under an active `legal_hold` RetentionPolicy or with an open `DataRightsRequest`/`Grievance`.

## 6. Functional Requirements with Low-Level Design

Priority labels: **MVP-Must**, **MVP-Should**, **Phase 1.5**, **Phase 2**. Every FR's LLD references §5 entities/fields and §8.4 error codes exactly. Standard authz = `EntitlementService.can()` (§4.7); standard envelope/pagination/idempotency per §4.4.

### M1 — Identity & Access

#### FR-001: Secure login, sessions & MFA
**Module:** M1 · **Priority:** MVP-Must · **Roles:** all
**User story:** As an authorised user, I want secure access so that customer and lead data is protected.
**Acceptance criteria**
1. Authenticate via username/password or enterprise SSO (OIDC) where enabled.
2. MFA mandatory for ADMIN, DPO, HEAD, PARTNER; configurable for others.
3. Idle timeout 30 min (configurable); logout invalidates session immediately; refresh-token rotation.
4. Lockout after 5 failed attempts for 15 min; all auth events audited.
5. Server-side authorization enforced on every endpoint.
**Business rules:** password policy per §4.6; direct URL to unauthorised resource → `FORBIDDEN` (403) + audit; role changes apply immediately or next token refresh (configured).
**Edge cases:** SSO user without local password (no password path); expired refresh token → re-login; concurrent sessions per policy.

| LLD area | Guidance |
|---|---|
| Components | Login screen, MFA challenge, password-reset flow, session banner; `AuthGuard` route wrapper |
| Backend flow | `POST /auth/login` → validate creds (argon2) → if MFA required issue challenge → `POST /auth/mfa` verify TOTP/OTP → issue JWT access(15m)+refresh → write AuditLog(login) |
| Data ops | Read `User`(by username); update `last_login_at`, `status` (lock on threshold); insert AuditLog |
| Validation | Credentials present; OTP 6-digit, time-boxed; lockout counter in Redis |
| Authorization | Public endpoints: login/mfa/reset only (§8.6) |
| State/side effects | Lockout on 5 fails; AuditLog login/login_failed/mfa_failed; session token rotation |
| Failure handling | Bad creds → `AUTH_REQUIRED`(401) generic message (no user enumeration); locked → 423-style mapped to `FORBIDDEN`+reason; rate-limit → `RATE_LIMITED`(429) |
| Dependencies | EntitlementService, AuditLog, Redis rate-limit, Secret Manager |
| Test guidance | Unit: lockout counter, MFA verify. API: valid login, wrong password, locked, MFA-required path. E2E: login→dashboard; idle timeout |

#### FR-002: Attribute-based access control (ABAC)
**Module:** M1 · **Priority:** MVP-Must · **Roles:** all
**User story:** As IT/Compliance, I want access evaluated by role + attributes so that users see only data within their branch/team/product/partner scope.
**Acceptance criteria**
1. Decisions combine role permission ∩ data scope ∩ attributes (branch/team/region/product/source/partner/classification).
2. PII/SPII masking rules configurable by role.
3. Bulk export applies the strictest applicable masking.
4. Privileged unmasking requires reason, approval (where configured), and audit.
**Business rules:** single decision point `EntitlementService.can(user, action, resource)`; deny by default.
**Edge cases:** user with multiple attributes; resource crossing two branches (use owning branch); partner cross-access denied.

| LLD area | Guidance |
|---|---|
| Components | `MaskedField` component; no dedicated screen (cross-cutting middleware) |
| Backend flow | Guard middleware loads user attrs → evaluates RolePermission(max_scope)+conditions → filters query by scope → applies masking projection |
| Data ops | Read `RolePermission`, `User` attrs; scope predicates injected into every list/detail query |
| Validation | Action/resource recognised; unknown → deny |
| Authorization | This FR *is* the authorization layer |
| State/side effects | Unmask action → AuditLog; export → strictest masking |
| Failure handling | Out-of-scope → `FORBIDDEN`(403)+audit; never leak existence (use 404 vs 403 per policy) |
| Dependencies | All read/list endpoints; ExportJob; AuditLog |
| Test guidance | Unit: scope/mask matrix. API: RM cannot read other RM's lead; partner cross-access denied; export masking |

#### FR-003: Break-glass privileged access
**Module:** M1 · **Priority:** MVP-Must · **Roles:** ADMIN, DPO (grantee), approver
**User story:** As Compliance, I want time-bound, approved, audited emergency access to lead data so that incidents can be handled without standing privileges.
**Acceptance criteria**
1. Grant requires grantee, approver (≠ grantee), reason, scope, and a bounded window (≤ configurable max).
2. Access works only while grant is `active` and within `valid_from..valid_until`.
3. Every access under a grant is audited with the grant reference.
4. Grants auto-expire; can be revoked early.
**Business rules:** ADMIN/DPO have no standing lead-content access (§3.4); four-eyes mandatory.
**Edge cases:** expired grant mid-session → access revoked at next check; revoked grant; overlapping grants.

| LLD area | Guidance |
|---|---|
| Components | Break-glass request modal, approval queue, active-grants list (Compliance Console) |
| Backend flow | `POST /admin/break-glass` → create `BreakGlassGrant`(pending) → approver `POST /approve` → active; EntitlementService consults active grants for ADMIN/DPO lead reads |
| Data ops | Insert/Update `BreakGlassGrant`; AuditLog(break_glass_access) on every use |
| Validation | approver ≠ grantee; window ≤ max; reason mandatory |
| Authorization | Only DPO/ADMIN may request; only authorised approver may approve |
| State/side effects | Status active/expired/revoked; scheduled expiry job; audit each access |
| Failure handling | Self-approval → `FORBIDDEN`; window too long → `VALIDATION_ERROR` |
| Dependencies | EntitlementService, AuditLog, scheduler |
| Test guidance | Unit: window/approver checks. API: grant→access→expiry; revoke mid-window denies |

### M2 — Lead Capture & Attribution

#### FR-010: Omnichannel lead capture
**Module:** M2 · **Priority:** MVP-Must · **Roles:** RM, BM, SM, PARTNER, system (API)
**User story:** As sales operations, I want every lead to enter one LMS regardless of source so that no lead is lost and attribution is clean.
**Acceptance criteria**
1. Create via manual form, bulk import, API/webhook, customer QR, partner portal, website, telecalling import, or missed-call.
2. Minimum fields: mobile, name (or placeholder), source, sub-source/detail, product interest, branch/pin, consent status, creator/channel.
3. PAN not mandatory at first capture unless `ProductConfig.pan_required_at = at_capture`; becomes mandatory per product before KYC/hand-off.
4. Every lead gets immutable `lead_code` and `channel_created_by`.
5. Source mandatory and from the configured source master; if source ∈ {DSA, Dealer}, `partner_id` mandatory.
**Business rules:** source hierarchy Source→Sub-source→Partner→Campaign/UTM→Creator; customer-created leads auto-route branch by pin/product rules; duplicate check (FR-020) runs on every intake.
**Edge cases:** API lead missing mandatory field → field-level `VALIDATION_ERROR`; bulk partial failure → valid rows created + row-error file; repeated `Idempotency-Key` → original lead returned, no duplicate.

| LLD area | Guidance |
|---|---|
| Components | Quick-create + full capture form (`EntityForm`), bulk-import wizard (upload→map→validate→commit), QR/public capture page |
| Backend flow | `POST /leads` → validate vs active `ProductConfig.field_schema` → run duplicate check → create `Lead`+`LeadIdentity`+`SourceAttribution`(+`CustomerProfile` link) in one tx → emit `LEAD_CREATED` outbox → audit |
| Data ops | Insert Lead, LeadIdentity, SourceAttribution, optional CustomerProfile, LeadProductDetail(stub); read ProductConfig(active) |
| Validation | Mobile regex; source ∈ master; partner required for DSA/Dealer; PAN timing per product; bulk row schema |
| Authorization | create_lead scope (RM=O, BM=B, SM=T, PARTNER=P) |
| State/side effects | stage=captured; consent_status derived; outbox LEAD_CREATED; bulk creates IntegrationLog/ImportJob summary |
| Failure handling | Validation → 400 field errors; duplicate strong block → `CONFLICT`(409)+match; idempotent replay → original; bulk → row-error CSV (row,col,code,message) |
| Dependencies | FR-020 (duplicate), FR-110 (consent), ProductConfig, EventOutbox |
| Test guidance | Unit: field/PAN-timing validation. API: manual create, partner create scope, idempotent replay, bulk partial-failure file. E2E: QR capture |

#### FR-011: Lead quality enrichment & score at capture
**Module:** M2 · **Priority:** MVP-Should · **Roles:** RM, system
**User story:** As sales ops, I want a transparent quality score so that high-intent leads are prioritised — without making any credit decision.
**Acceptance criteria**
1. Capture optional context: language, best-time-to-call, employment/business type, requested amount, customer type, pin, asset details, dealer, referral code.
2. Compute a rules-based `score` (0–100) with `score_reasons` codes.
3. Score is used only for prioritisation/routing — never credit approval/rejection.
**Business rules:** factors and weights are configurable; score recomputed on relevant field change; reasons human-readable.
**Edge cases:** missing PAN lowers score with reason; historically-high-rejection source penalised.

| LLD area | Guidance |
|---|---|
| Components | Score chip + reasons popover on Lead 360 |
| Backend flow | On create/update of relevant fields → `ScoringService.evaluate(lead)` → set `Lead.score`, `score_reasons` |
| Data ops | Update Lead.score, score_reasons; read SourceAttribution/Partner history |
| Validation | Score ∈ 0–100; reasons non-empty |
| Authorization | Internal roles only (not customer/partner view of internal score) |
| State/side effects | May set `is_hot` via FR-031 rules; outbox LEAD_STAGE_CHANGED unaffected |
| Failure handling | Scoring error → score null + log; never blocks capture |
| Dependencies | FR-031, configurable rules (ConfigurationVersion) |
| Test guidance | Unit: deterministic score for fixtures; reason codes. API: score present on create |

### M3 — Identity Resolution

#### FR-020: Duplicate & near-duplicate detection
**Module:** M3 · **Priority:** MVP-Must · **Roles:** RM, BM, SM, system
**User story:** As sales management, I want duplicates detected early so that attribution and RM effort stay clean.
**Acceptance criteria**
1. Runs at create, edit, import, API intake, and before hand-off.
2. Match keys: mobile, PAN, email, CKYC ID, GSTIN, vehicle/engine/chassis (where present), name+DOB, branch/product/pin proximity.
3. Confidence Strong/Medium/Weak with reasons.
4. Configured action: block / warn / queue / link / merge / override — all audited.
**Business rules (default match table):**

| Match type | Default treatment |
|---|---|
| Same PAN + mobile | Block unless BM/SM override with reason |
| Same PAN, diff mobile | Warn → identity review queue |
| Same mobile, no PAN | Warn; allow with duplicate flag |
| Same vehicle/asset ID | Block / asset-review queue |
| Same GSTIN + product | Warn; link to business profile |
| Fuzzy name + same pin + source | Weak; warning only |

**Edge cases:** multiple matches (highest confidence wins); merged-master match; override needs reason.

| LLD area | Guidance |
|---|---|
| Components | Duplicate warning modal (match list + confidence + reasons + actions), Duplicate Review queue |
| Backend flow | `POST /leads/{id}/duplicate-check` (also internal on intake) → `DuplicateService.match()` → create `DuplicateMatch` rows → return action per config |
| Data ops | Read LeadIdentity (indexed keys); insert DuplicateMatch; update Lead.duplicate_status; AuditLog |
| Validation | Override/merge reason mandatory; only allowed roles act |
| Authorization | Block-override = BM/SM; queue actions = BM/SM/KYC |
| State/side effects | duplicate_status none/flagged/linked/merged; outbox; audit each action |
| Failure handling | Strong block on create → `CONFLICT`(409) with matches; service error → warn (fail-safe), never silently allow strong dup |
| Dependencies | FR-021 (merge), FR-010, FR-081 (pre-handoff check) |
| Test guidance | Unit: each match-rule row; confidence scoring. API: strong block, weak warn, override path |

#### FR-021: Merge & source-attribution preservation
**Module:** M3 · **Priority:** MVP-Must · **Roles:** BM, SM (authorised)
**User story:** As sales management, I want to merge duplicates without losing attribution, consent, or documents.
**Acceptance criteria**
1. Merge keeps one master `Lead`; duplicate source records linked via `master_lead_id` + `SourceAttribution`.
2. Original attribution history preserved; final attribution rule configurable.
3. Merge never deletes audit, consent, or documents.
4. Unmerge allowed only for authorised users within a configurable window, audited.
**Business rules:** consents/documents from both records re-parent to master; conflicting fields follow configured precedence.
**Edge cases:** merge across branches (owning branch precedence); unmerge after window → blocked.

| LLD area | Guidance |
|---|---|
| Components | Merge confirm dialog (field-precedence preview), unmerge action (windowed) |
| Backend flow | `POST /leads/{id}/merge` {into} → in one tx: set master, relink SourceAttribution/Document/ConsentRecord/Task, set duplicate_status=merged, attribution_status=merged_into → outbox → audit |
| Data ops | Update Lead(master_lead_id), SourceAttribution, Document.lead_id, ConsentRecord.lead_id; insert AuditLog(lead_merge) |
| Validation | Both leads exist/active; not already merged; reason captured |
| Authorization | BM/SM only; unmerge within window |
| State/side effects | DuplicateMatch.status=resolved; outbox LEAD_STAGE_CHANGED |
| Failure handling | Partial failure → full rollback (atomic); window exceeded → `FORBIDDEN`/`VALIDATION_ERROR` |
| Dependencies | FR-020, AuditLog, retention (never purge merged history) |
| Test guidance | Unit: re-parent logic, precedence. API: merge atomicity, unmerge window, audit preserved |

### M4 — Allocation & Prioritisation

#### FR-030: Rules-based allocation
**Module:** M4 · **Priority:** MVP-Must · **Roles:** BM, SM, system
**User story:** As a BM/SM, I want leads allocated by transparent rules so that high-intent leads are contacted quickly and fairly.
**Acceptance criteria**
1. Rules use branch, pin, product, source, partner, RM capacity/availability, language, conversion band, priority, existing-relationship ownership.
2. Allocation produces an `owner_id` + reason codes.
3. Manual reassignment requires reason and is audited.
4. Methods: round-robin, capacity-weighted, product-specialist, branch-routing, partner-dedicated, escalation.
5. Hot leads route to priority queues.
**Business rules:** rules evaluated in `priority_order`; first matching rule wins; capacity limit blocks over-allocation unless BM override; SLA breach triggers escalation reassignment.
**Edge cases:** no matching rule → branch unassigned pool + alert; all RMs at capacity → BM queue.

| LLD area | Guidance |
|---|---|
| Components | Allocation rules admin, reassign modal (reason), unassigned queue |
| Backend flow | On create/assign trigger → `AllocationService.allocate(lead)` iterates active `AllocationRule` by priority_order → resolves RM pool → applies capacity → sets owner + reasons; `POST /leads/{id}/reassign` for manual |
| Data ops | Read AllocationRule, User(capacity/skills/availability); update Lead.owner_id/team_id; insert AuditLog(allocate/reassign) |
| Validation | Owner in scope; capacity not exceeded (unless override); reason on manual |
| Authorization | allocate scope (BM=B, SM=T, HEAD=A) |
| State/side effects | stage→assigned; SLA first-contact timer starts (FR-104); outbox LEAD_ASSIGNED; notification |
| Failure handling | No rule match → unassigned + alert; stale lead version → `CONFLICT` |
| Dependencies | FR-104 (SLA), FR-031, SLAPolicy, AllocationRule |
| Test guidance | Unit: rule order/tie-break, capacity. API: auto-allocate, reassign audit, escalation |

#### FR-031: Hot-lead flag & lead score
**Module:** M4 · **Priority:** MVP-Must · **Roles:** system, RM, BM
**User story:** As sales, I want explainable hot-lead prioritisation so that effort goes where intent is highest.
**Acceptance criteria**
1. Hot flag is rules-based and explainable.
2. Default hot rules: priority=High OR amount>product threshold OR returning customer OR partner-verified OR customer-submitted docs OR positive LOS indicative OR high-intent event (callback).
3. Score shown with factors; never used for automated credit decisioning.
**Business rules:** thresholds configurable per product; hot leads surface in dashboards/queues.
**Edge cases:** lead cools (rule no longer met) → hot cleared with reason.

| LLD area | Guidance |
|---|---|
| Components | Hot badge, score chip + factor breakdown |
| Backend flow | `ScoringService` evaluates hot rules on relevant changes → set Lead.is_hot, score, score_reasons |
| Data ops | Update Lead.is_hot/score/score_reasons |
| Validation | Reasons present when hot |
| Authorization | Internal only |
| State/side effects | HOT_LEAD notification/outbox; priority allocation |
| Failure handling | Rule eval error → leave prior flag + log |
| Dependencies | FR-030, FR-011, ProductConfig thresholds |
| Test guidance | Unit: each hot rule; cool-down. API: hot set on callback event |

### M5 — Product Configuration

#### FR-040: Product configuration without credit BRE
**Module:** M5 · **Priority:** MVP-Must · **Roles:** ADMIN, Product Ops
**User story:** As product operations, I want configurable capture fields and checklists so that the LMS adapts to products without code changes.
**Acceptance criteria**
1. Configure status, field groups/labels/mandatory/validation, document checklist, SLA thresholds, eligibility payload mapping, rejection reasons, templates, `pan_required_at`.
2. Credit policy/pricing/LTV/FOIR/sanction remain in LOS/BRE.
3. Product changes are versioned; existing leads keep their pinned `product_config_version`.
4. Eligibility-mapping changes require IT approval + sandbox validation (maker-checker via FR-132).
**Business rules:** only `active` configs usable for new leads; retiring a config does not affect in-flight leads.
**Edge cases:** editing an active config creates a new draft version; activating requires checker.

| LLD area | Guidance |
|---|---|
| Components | Product config builder (field-schema editor, checklist editor, SLA/mapping tabs), version history |
| Backend flow | `POST/PATCH /admin/products` writes `ProductConfig`(draft) → `ConfigurationVersion`(maker) → checker approve → activate |
| Data ops | Insert/Update ProductConfig; ConfigurationVersion; never mutate pinned versions referenced by leads |
| Validation | field_schema valid JSON-schema; checklist doc_types ∈ enum; mapping fields exist |
| Authorization | ADMIN/Product Ops; eligibility mapping needs IT checker |
| State/side effects | CONFIG_CHANGED outbox/notification; version increment |
| Failure handling | Invalid schema → `VALIDATION_ERROR`; activate without checker → `FORBIDDEN` |
| Dependencies | FR-132, FR-041, FR-070, FR-080 |
| Test guidance | Unit: schema validation, version pinning. API: draft→approve→activate; in-flight lead keeps old version |

#### FR-041: Initial supported products
**Module:** M5 · **Priority:** MVP-Must · **Roles:** Product Ops
**User story:** As product ops, I want the seven launch products pre-configured so that capture and checklists work on day one.
**Acceptance criteria:** seven products configured (CV, CAR, TRACTOR, CE, TW, SBL, HRM) each with capture fields, document checklist, and eligibility payload mapping.

| Product | Key capture fields | Documents/checks | Eligibility payload to LOS |
|---|---|---|---|
| Commercial Vehicle (CV) | vehicle type, make/model, new/used, invoice/valuation, route/permit, fleet size, operator profile, dealer, down payment | ID, PAN, address, income/banking, quotation/invoice, RC (used), permit, insurance, field visit | asset value, LTV inputs, income/cash-flow, vintage, fleet, route/usage |
| Car (CAR) | make/model, new/used, dealer, quotation, down payment, employment/business, co-applicant | ID, PAN, address, income, bank statement, quotation, RC (used) | vehicle cost, down payment, income, FOIR, LTV |
| Tractor (TRACTOR) | make/model, implement, land holding, crop pattern, dealer, village/pin, seasonality | ID, PAN, land records, income/agri proof, quotation, field-visit photo | asset value, land/income, LTV, seasonality |
| Construction Equipment (CE) | equipment type, make/model, contractor/project, new/used, usage hours, work order, dealer | ID, PAN, financials, bank statement, quotation, RC (used), work order | asset value, business cash-flow, utilisation, LTV |
| Two Wheeler (TW) | make/model, dealer, down payment, employment, residence stability, preferred EMI | ID, PAN (where available), address, income/self-declaration, quotation | vehicle cost, down payment, income, LTV, stability |
| Secured Business (SBL) | constitution, vintage, turnover, GSTIN, bank statement, collateral property, ownership, purpose | KYC (applicant/business/BO), GST/ITR/bank, property docs, valuation, title chain | turnover, banking, GST, property value, LTV, vintage |
| Home Renovation – Mortgage (HRM) | property details, ownership, title status, renovation purpose, estimate, co-applicant, income | KYC, property docs, valuation, title chain, renovation estimate, income | property value, renovation estimate, income, FOIR, LTV |

| LLD area | Guidance |
|---|---|
| Components | Seeded product configs (data migration/seed) surfaced via FR-040 builder |
| Backend flow | Seed seven `ProductConfig`(active, v1) with field_schema/checklist/mapping per table |
| Data ops | Insert ProductConfig × 7; referenced by Lead.product_id |
| Validation | Each config passes FR-040 schema validation |
| Authorization | Product Ops/ADMIN |
| State/side effects | Available in capture form product picker |
| Failure handling | Seed idempotent (re-run safe) |
| Dependencies | FR-040, FR-070 |
| Test guidance | API: each product capture form renders correct mandatory fields + checklist |

#### FR-042: Scheme & offer capture
**Module:** M5 · **Priority:** MVP-Should · **Roles:** Product Ops, RM
**User story:** As product ops, I want to attach non-credit scheme metadata so that campaigns/dealer schemes are tracked and passed to LOS.
**Acceptance criteria**
1. Capture festival/dealer scheme, subvention flag, campaign code, offer validity.
2. Scheme metadata passed to LOS if mapping exists.
3. LMS never computes final pricing/sanction.
**Edge cases:** expired scheme cannot be attached to new leads.

| LLD area | Guidance |
|---|---|
| Components | Scheme picker on capture/Lead 360; scheme admin |
| Backend flow | Attach `Scheme` to lead (LeadProductDetail.attributes.scheme_code); include in eligibility payload mapping |
| Data ops | Read Scheme(active); update LeadProductDetail |
| Validation | Scheme active & product-matched |
| Authorization | Product Ops manage; RM attach |
| State/side effects | Passed to LOS eligibility (FR-080) |
| Failure handling | Expired/invalid scheme → `VALIDATION_ERROR` |
| Dependencies | FR-040, FR-080 |
| Test guidance | Unit: validity window. API: attach scheme, reject expired |

### M6 — Workspace & Pipeline

#### FR-050: Lead list & saved work queues
**Module:** M6 · **Priority:** MVP-Must · **Roles:** RM, BM, SM, HEAD, KYC
**User story:** As an RM/BM, I want filterable lead lists and saved queues so that I can work the right leads first.
**Acceptance criteria**
1. Search by name, mobile, lead code, masked-PAN, partner, vehicle/asset ID, GSTIN, LOS app ID.
2. Saved queues: My Leads, Hot, New Today, First Contact Pending, Docs Pending, KYC Pending, Duplicate Review, SLA Breached, Handoff Failed, Rejected, Reopened, Partner Leads, Customer Upload Received.
3. Filters: product, stage, branch, team, RM, source, partner, priority, consent, KYC status, date range, SLA state, score band.
4. Bulk actions respect role/scope and write audit.
**Business rules:** every list is scope-filtered (FR-002) and paginated (max 100); saved views shareable per scope.
**Edge cases:** empty queue → EmptyState; large result → server pagination only.

| LLD area | Guidance |
|---|---|
| Components | `DataTable` (server pagination/sort/column-visibility/bulk-select), saved-view chips, filter drawer |
| Backend flow | `GET /leads?filter[...]&sort=&page=&limit=` → scope-filtered query; `POST /saved-views` persists filter |
| Data ops | Read Lead (+joins); CRUD SavedView |
| Validation | Filter/sort fields allow-listed; limit ≤ 100 |
| Authorization | view_lead scope; bulk_action scope |
| State/side effects | Bulk actions audited; masked columns |
| Failure handling | Invalid filter → `VALIDATION_ERROR`; over-limit clamped |
| Dependencies | FR-002, FR-054 |
| Test guidance | API: scope filter, pagination cap, saved view CRUD. E2E: queue switch, bulk reassign |

#### FR-051: Lead 360 view
**Module:** M6 · **Priority:** MVP-Must · **Roles:** RM, BM, KYC, DPO (masked)
**User story:** As an RM, I want a complete masked lead view so that I have everything needed to act.
**Acceptance criteria:** shows profile (masked), product/source card, stage tracker, consent coverage, score/reasons, LOS eligibility snapshot, document checklist, KYC status, tasks + next-best-action, communication timeline, notes/activity, related/duplicate leads, partner details, LOS hand-off/status panel.
**Edge cases:** partial data → section-level empty states; DPO sees masked.

| LLD area | Guidance |
|---|---|
| Components | Tabbed Lead 360 (Overview, Documents, KYC, Tasks, Comms, Consent, LOS, Audit); StatusChips |
| Backend flow | `GET /leads/{id}` aggregates Lead+LeadIdentity+LeadProductDetail+EligibilitySnapshot+LOSApplicationMirror+counts |
| Data ops | Read across §5 lead-scoped entities incl. `Note` (notes/activity) and `StageHistory` (stage tracker), each scope-checked |
| Validation | id exists & in scope |
| Authorization | view_lead; masking by role |
| State/side effects | View audited for sensitive roles (DPO) |
| Failure handling | Not found/out-of-scope → `NOT_FOUND`/`FORBIDDEN` |
| Dependencies | FR-002, most read FRs |
| Test guidance | API: aggregate shape, masking. E2E: tab navigation, empty sections |

#### FR-052: Pipeline board
**Module:** M6 · **Priority:** MVP-Must · **Roles:** RM, BM, SM
**User story:** As an RM/BM, I want a stage board so that I can see and move leads through the pipeline.
**Acceptance criteria**
1. Drag/drop where allowed; mobile fallback stage selector.
2. Columns configurable but map to canonical stages (§10).
3. Cards show ageing, product, amount, source, owner, hot flag, consent/KYC status, next action.
4. Invalid moves blocked with reason (§10.3 guards).
**Edge cases:** guard fails → snap back + toast; concurrent move → `CONFLICT`.

| LLD area | Guidance |
|---|---|
| Components | Kanban board, stage selector (mobile), card component |
| Backend flow | `PATCH /leads/{id}/stage` {to} → validate guard (§10.3) → update stage → insert `StageHistory` + `AuditLog(stage_transition)` (one tx) → outbox LEAD_STAGE_CHANGED |
| Data ops | Update Lead.stage(+version); insert StageHistory; AuditLog(stage_transition) |
| Validation | Transition allowed for role; guards satisfied; version match |
| Authorization | move_stage scope |
| State/side effects | Side effects per §10.3 (SLA, notifications) |
| Failure handling | Guard fail → `VALIDATION_ERROR`(stage_guard); stale → `CONFLICT` |
| Dependencies | §10 state model, FR-104 |
| Test guidance | Unit: guard matrix. API: valid/invalid transition, optimistic lock. E2E: drag move |

#### FR-053: Role-based dashboard & home
**Module:** M6 · **Priority:** MVP-Must · **Roles:** RM, BM, SM, HEAD
**User story:** As any internal user, I want a role-scoped home dashboard so that I see my priorities and exceptions immediately.
**Acceptance criteria**
1. Widgets by role: KPI cards, SLA alerts, hot leads, my tasks, source summary, hand-off failures, exception queues.
2. All widget data is scope-filtered and reconciles with reports (§12).
3. Drill-through from widget to filtered lead list.
**Edge cases:** new user with no data → onboarding empty state.

| LLD area | Guidance |
|---|---|
| Components | Dashboard grid, KPICard, AlertList, MiniChart (low-bandwidth fallback) |
| Backend flow | `GET /dashboard?role-context` → aggregate scope-filtered metrics (cached short TTL) |
| Data ops | Aggregate reads on Lead/Task/IntegrationLog; no writes |
| Validation | n/a |
| Authorization | reports scope; widgets per role |
| State/side effects | None (read-only) |
| Failure handling | Widget error isolated (one widget fails, others render) |
| Dependencies | §12 metric definitions, FR-002 |
| Test guidance | API: scope-correct counts == report counts. E2E: drill-through |

#### FR-054: Global search
**Module:** M6 · **Priority:** MVP-Must · **Roles:** internal
**User story:** As an internal user, I want global masked search so that I can jump to a lead/partner/task fast.
**Acceptance criteria**
1. Search leads (code/name/mobile/PAN-masked/asset/GSTIN/LOS id), partners, tasks within scope.
2. Results masked and scope-filtered; keyboard accessible.
3. Bounded results (top-N per type) with "see all" → list.
**Edge cases:** ambiguous query → grouped results; no match → empty state.

| LLD area | Guidance |
|---|---|
| Components | Top-bar search palette (cmd-k), grouped results |
| Backend flow | `GET /search?q=` → multi-entity indexed lookup, scope-filtered, top-N each |
| Data ops | Read Lead/Partner/Task indexed columns |
| Validation | q min length; rate-limited |
| Authorization | scope filter on every result |
| State/side effects | None |
| Failure handling | Over-broad → top-N + "refine"; injection-safe (parameterised) |
| Dependencies | FR-002, FR-050 |
| Test guidance | API: scope filter, masking, top-N cap. E2E: cmd-k navigate |

### M7 — Customer Self-Service

#### FR-060: Secure customer action link
**Module:** M7 · **Priority:** MVP-Must · **Roles:** RM/BM/KYC (send), CUSTOMER (use)
**User story:** As a prospect, I want a simple secure link to submit documents and confirm consent without installing an app.
**Acceptance criteria**
1. Send tokenised, lead-specific, expiring, revocable link by SMS/WhatsApp/email.
2. Customer can view required docs, upload files/photos, give/confirm consent, pick callback slot, view high-level status.
3. Customer cannot see internal notes, scoring, RM performance, or other leads.
4. Link access and actions audited.
**Security rules:** OTP step-up before viewing sensitive details or uploading; uploads virus-scanned + classified; default expiry 7 days; resend issues a new token (old invalidated).
**Edge cases:** expired/used link → friendly re-request page; OTP rate-limited.

| LLD area | Guidance |
|---|---|
| Components | Public customer micro-site (consent, upload, callback, status), OTP screen |
| Backend flow | `POST /leads/{id}/customer-link` create `CustomerLink`(token hashed) → send via FR-101; public `GET /c/{token}` → OTP `POST /c/{token}/otp` → actions gated |
| Data ops | Insert CustomerLink; on upload insert Document(via=customer_link); insert ConsentRecord; AuditLog(link_create/open) |
| Validation | Token valid+active+unexpired; OTP correct; file type/size/scan |
| Authorization | Public but token-scoped to one lead; no auth header |
| State/side effects | link_status active→used; DOC_UPLOADED outbox; status updates |
| Failure handling | Invalid/expired token → `NOT_FOUND`; OTP fail rate-limit → `RATE_LIMITED`; infected file → rejected `VALIDATION_ERROR` |
| Dependencies | FR-070 (docs), FR-110 (consent), FR-101 (send), FR-062 (status) |
| Test guidance | API: token lifecycle, OTP rate-limit, upload scan. E2E: customer upload happy path |

#### FR-061: Customer grievance & service request
**Module:** M7 · **Priority:** MVP-Should · **Roles:** CUSTOMER, then grievance owner
**User story:** As a customer, I want to raise a complaint from the link so that issues are tracked and resolved.
**Acceptance criteria**
1. Raise complaint with category, description, optional attachment, source, timestamp.
2. Routed to configured owner with SLA.
3. Grievance officer/escalation info shown where required.
**Edge cases:** duplicate complaint → linked to existing open grievance.

| LLD area | Guidance |
|---|---|
| Components | Grievance form on customer link; grievance officer info block |
| Backend flow | `POST /c/{token}/grievance` → create `Grievance`(grievance_no, SLA from SLAPolicy) → GRIEVANCE_CREATED outbox → assign owner |
| Data ops | Insert Grievance; optional Document; AuditLog |
| Validation | Category ∈ enum; description present |
| Authorization | Token-scoped |
| State/side effects | SLA timer; notification to owner |
| Failure handling | Token invalid → `NOT_FOUND` |
| Dependencies | FR-114, FR-104, FR-060 |
| Test guidance | API: create grievance, SLA set. E2E: customer complaint flow |

#### FR-062: Customer status tracking & callback self-service
**Module:** M7 · **Priority:** MVP-Should · **Roles:** CUSTOMER
**User story:** As a customer, I want to see high-level status and request a callback so that I'm not chasing the RM.
**Acceptance criteria**
1. Show stage-level status (not internal detail) + pending actions.
2. Request/select callback slot → creates RM task.
3. All views/actions audited; masked.
**Edge cases:** lead handed off → show "with lending team" status only.

| LLD area | Guidance |
|---|---|
| Components | Status timeline (customer-friendly), callback slot picker |
| Backend flow | `GET /c/{token}/status` → mapped customer-safe status; `POST /c/{token}/callback` → create `Task`(callback) |
| Data ops | Read Lead.stage (mapped); insert Task(callback) |
| Validation | Token valid; slot within allowed window |
| Authorization | Token-scoped, single lead |
| State/side effects | Task created; HOT signal (callback = high-intent, FR-031) |
| Failure handling | Token invalid/expired → re-request page |
| Dependencies | FR-060, FR-100, FR-031 |
| Test guidance | API: status mapping hides internals; callback creates task |

### M8 — KYC & Documents

#### FR-070: Document checklist & upload
**Module:** M8 · **Priority:** MVP-Must · **Roles:** RM, KYC, BM, CUSTOMER, PARTNER
**User story:** As KYC/Ops, I want a product-driven checklist so that the right documents are collected and tracked.
**Acceptance criteria**
1. Checklist derived from product, applicant type, entity type, co-applicant/guarantor, collateral/asset.
2. Each item carries a `doc_status` (Not Required…Expired).
3. Waiver requires authorised role, reason, expiry/review date, audit.
4. File types PDF/JPG/PNG/HEIC; max size configurable; mobile image compression; versioning preserved.
**Edge cases:** re-upload increments version; expired doc auto-flagged.

| LLD area | Guidance |
|---|---|
| Components | Checklist panel (status chips), uploader (drag/camera/compress), waiver modal |
| Backend flow | Checklist generated from `ProductConfig.document_checklist`; `POST /leads/{id}/documents` upload → GCS signed URL → virus scan → status uploaded→under_review |
| Data ops | Insert/Update Document; read ProductConfig; AuditLog(doc_upload/waive) |
| Validation | doc_type ∈ checklist; type/size; waiver reason+role |
| Authorization | upload_doc scope; waive = KYC/BM |
| State/side effects | DOC_UPLOADED outbox/notification; KYC queue entry |
| Failure handling | Bad type/size → `VALIDATION_ERROR`; infected → rejected; scan pending → status pending |
| Dependencies | FR-071, FR-060, ProductConfig, GCS |
| Test guidance | Unit: checklist derivation, waiver rule. API: upload/scan/version; waive audit |

#### FR-071: KYC verification orchestration
**Module:** M8 · **Priority:** MVP-Must (PAN) / Phase 1.5 (some providers) · **Roles:** KYC, BM
**User story:** As KYC/Ops, I want orchestrated verification so that identity is confirmed within policy without storing raw Aadhaar.
**Acceptance criteria**
1. PAN verification stores provider ref, status, timestamp, masked PAN.
2. CKYC ID captured/retrieved where integrated; DigiLocker/e-document retrieval where integrated.
3. Aadhaar OTP/offline stores only masked/tokenised reference; raw Aadhaar/biometrics never stored.
4. V-CIP readiness: appointment, agent assignment, liveness/spoof result, recording ref, audit (where integrated).
5. KYC failures create exception queue and block hand-off unless authorised exception/waiver.
**Edge cases:** provider downtime → exception(provider_down) + manual fallback if enabled.

| LLD area | Guidance |
|---|---|
| Components | KYC Workbench (per-check status, provider responses), V-CIP scheduler (P1.5) |
| Backend flow | `POST /leads/{id}/kyc/pan` (and per type) → call provider via IntegrationLog (idempotent) → store `KYCVerification`(masked_response) → on fail create exception |
| Data ops | Insert/Update KYCVerification; insert IntegrationLog; DataSharingLog(if external); update Lead.kyc_status |
| Validation | Required consent (kyc purpose) present; PAN format; no raw Aadhaar persisted |
| Authorization | KYC/BM; consent gate enforced |
| State/side effects | kyc_status transitions; KYC_EXCEPTION outbox; blocks hand-off guard |
| Failure handling | Provider error → `UPSTREAM_UNAVAILABLE`(503)+exception+retry; missing consent → `FORBIDDEN` |
| Dependencies | FR-072, FR-110, FR-140, FR-081 |
| Test guidance | Unit: masking, consent gate. API: PAN success/fail→exception; provider-down retry |

#### FR-072: KYC exception handling
**Module:** M8 · **Priority:** MVP-Must · **Roles:** KYC, BM
**User story:** As KYC/Ops, I want a managed exception queue so that mismatches are resolved with evidence and SLA.
**Acceptance criteria**
1. Exception types: PAN/name/address mismatch, expired/unreadable doc, CKYC unavailable/duplicate, V-CIP failed, provider downtime.
2. Each exception has owner, SLA, remarks, evidence, resolution code.
3. Provider-downtime manual fallback only if enabled by compliance + audited.
**Edge cases:** repeated exception → escalation; resolved exception unblocks hand-off.

| LLD area | Guidance |
|---|---|
| Components | Exception queue, resolution modal (evidence + code) |
| Backend flow | Exceptions are `KYCVerification` rows with exception_type; `PATCH .../kyc/{id}/resolve` sets resolution_code |
| Data ops | Update KYCVerification(exception fields); AuditLog(kyc_exception) |
| Validation | Resolution code ∈ allowed; evidence for waiver/fallback |
| Authorization | KYC/BM; fallback needs compliance flag |
| State/side effects | SLA via SLAPolicy(kyc_exception); resolution updates kyc_status |
| Failure handling | Unauthorised fallback → `FORBIDDEN`; SLA breach → escalation |
| Dependencies | FR-071, FR-104 |
| Test guidance | Unit: resolution rules. API: create→resolve→unblock; fallback gating |

### M9 — LOS Integration

#### FR-080: Eligibility request & read-only snapshot
**Module:** M9 · **Priority:** MVP-Must (where LOS API exists) · **Roles:** RM, BM, system
**User story:** As an RM, I want an indicative LOS eligibility view so that I can prioritise without underwriting in LMS.
**Acceptance criteria**
1. Send product-specific payload (lead_code, product, attributes, source, consent ref, docs/KYC status, idempotency key).
2. Display read-only response: indicative amount, tenure, rate/range, conditions, validity, basis.
3. Label indicative/preliminary unless LOS returns final.
4. Failure shows Pending/Retry; never crashes the lead workflow.
**Edge cases:** LOS timeout → pending + retry; mapping missing → blocked with config error.

| LLD area | Guidance |
|---|---|
| Components | Eligibility card (read-only) on Lead 360 |
| Backend flow | `POST /leads/{id}/eligibility` → build payload via `ProductConfig.eligibility_mapping` → call LOS via IntegrationLog(idempotent) → store `EligibilitySnapshot`; DataSharingLog |
| Data ops | Insert EligibilitySnapshot; IntegrationLog; DataSharingLog; read LeadProductDetail/ProductConfig |
| Validation | Consent(product_eligibility) present; mapping complete |
| Authorization | RM/BM; consent gate |
| State/side effects | stage→eligibility_requested; ELIGIBILITY_RECEIVED outbox on response |
| Failure handling | Timeout → status pending + retry; mapping missing → `VALIDATION_ERROR`; LOS down → `UPSTREAM_UNAVAILABLE` |
| Dependencies | FR-040 mapping, FR-110, FR-140 |
| Test guidance | Unit: payload mapping. API: success snapshot, timeout pending, missing-consent block |

#### FR-081: LOS hand-off
**Module:** M9 · **Priority:** MVP-Must · **Roles:** BM/KYC/RM (delegated)
**User story:** As a BM, I want a guarded, idempotent hand-off so that a clean record reaches LOS exactly once.
**Acceptance criteria**
1. Guards: consent present, mandatory data complete, duplicate clear/overridden, mandatory docs verified/waived, KYC sign-off, valid product payload.
2. Payload idempotent; retried with exponential backoff.
3. Success stores `los_application_id`; lead → handed_off.
4. Failure → Handoff Failed queue with error category + retry.
5. Manual retry cannot create a duplicate LOS application.
**Edge cases:** success but webhook delayed → reconciled by poll (FR-082); partial network failure → idempotent retry.

| LLD area | Guidance |
|---|---|
| Components | Hand-off action (guard checklist), Handoff Failed queue |
| Backend flow | `POST /leads/{id}/handoff` (Idempotency-Key) → evaluate guards → in tx: send to LOS via IntegrationLog → on success update Lead.los_application_id+stage, DataSharingLog, outbox LEAD_HANDED_OFF |
| Data ops | Update Lead; insert IntegrationLog(idempotency_key), DataSharingLog, LOSApplicationMirror(initial); AuditLog(handoff_*) |
| Validation | All guards pass; duplicate pre-check (FR-020) |
| Authorization | hand_off scope (configurable owner) |
| State/side effects | stage→handed_off (terminal); HANDOFF_READY/HANDOFF_FAILED events |
| Failure handling | Guard fail → `VALIDATION_ERROR`(which guard); LOS error → `UPSTREAM_UNAVAILABLE`+queue+retry; replay key → original result (no dup) |
| Dependencies | FR-020, FR-070, FR-071, FR-110, FR-140, FR-082 |
| Test guidance | Unit: guard set, idempotency. API: success, each guard fail, retry no-dup, LOS-down queue |

#### FR-082: LOS application status mirror
**Module:** M9 · **Priority:** MVP-Must (where LOS supports) · **Roles:** RM, BM (read)
**User story:** As an RM, I want read-only LOS status so that I can inform the customer without owning the application.
**Acceptance criteria**
1. Receive status via webhook and/or polling.
2. Status read-only, clearly LOS-owned.
3. Timeline includes timestamps, source, correlation ID.
4. Missed webhooks reconciled by scheduled polling.
**Edge cases:** out-of-order updates → keep latest by status_date; duplicate webhook → idempotent.

| LLD area | Guidance |
|---|---|
| Components | LOS status panel + timeline (read-only) on Lead 360 |
| Backend flow | `POST /los/webhooks/status` (HMAC-verified) → upsert `LOSApplicationMirror`; scheduled poll reconciles gaps |
| Data ops | Insert/Update LOSApplicationMirror; IntegrationLog(inbound) |
| Validation | HMAC signature; los_application_id known; idempotent |
| Authorization | Webhook authenticated by signature (public path, signed); read scope for users |
| State/side effects | Outbox status update; optional customer notification |
| Failure handling | Bad signature → `FORBIDDEN`; unknown app id → log + ignore; missed → poll |
| Dependencies | FR-081, FR-140, WebhookSubscription |
| Test guidance | API: webhook upsert, signature reject, out-of-order, poll reconcile |

### M10 — Partner Management

#### FR-090: Partner master & onboarding metadata
**Module:** M10 · **Priority:** MVP-Must · **Roles:** BM, SM, ADMIN
**User story:** As channel management, I want a partner master so that every partner lead is attributable and governed.
**Acceptance criteria**
1. Support DSA, dealer, connector, OEM, aggregator, referral types.
2. Capture code, legal name, branch/territory, products, contact, status, validity, agreement ref, commission flag, mapped RM/team, risk category, documents.
3. Partner status controls whether new leads can be submitted.
**Edge cases:** suspended/expired partner cannot submit; status change audited.

| LLD area | Guidance |
|---|---|
| Components | Partner Management screen (master CRUD, status, mapping, quality metrics) |
| Backend flow | `POST/PATCH /partners` CRUD with `ConfigurationVersion` governance |
| Data ops | Insert/Update Partner; AuditLog |
| Validation | Unique partner_code; type ∈ enum; valid_until future |
| Authorization | BM/SM/ADMIN |
| State/side effects | Suspension blocks FR-091 submission |
| Failure handling | Duplicate code → `CONFLICT`; invalid → `VALIDATION_ERROR` |
| Dependencies | FR-091, FR-092, FR-131 |
| Test guidance | API: CRUD, status gating, audit |

#### FR-091: Partner lead submission
**Module:** M10 · **Priority:** MVP-Must · **Roles:** PARTNER
**User story:** As a DSA/dealer, I want to submit and track my own leads so that I get transparency without seeing other data.
**Acceptance criteria**
1. Partner creates lead via limited portal or API.
2. Partner sees only own leads and limited status.
3. Partner warned on duplicate/invalid leads without exposing other customer details.
4. Partner-submitted documents go to KYC/document queue.
**Edge cases:** duplicate partner lead → generic "already exists" (no PII leak).

| LLD area | Guidance |
|---|---|
| Components | Partner Console (submit, my leads, limited status, duplicate feedback) |
| Backend flow | `POST /partners/leads` (partner-scoped) → FR-010 create with source=partner; duplicate feedback masked |
| Data ops | Insert Lead/SourceAttribution(partner_id); Documents to queue |
| Validation | Partner active; mandatory partner fields |
| Authorization | PARTNER scope P only |
| State/side effects | Lead enters standard pipeline; LEAD_CREATED outbox |
| Failure handling | Suspended partner → `FORBIDDEN`; duplicate → masked `CONFLICT` |
| Dependencies | FR-010, FR-020, FR-090 |
| Test guidance | API: partner-scope isolation, masked duplicate, suspended block |

#### FR-092: Partner quality score & dashboard
**Module:** M10 · **Priority:** MVP-Should · **Roles:** BM, SM, HEAD, PARTNER (own)
**User story:** As channel management, I want transparent partner quality so that I can coach and prioritise partners.
**Acceptance criteria**
1. Dashboard: leads submitted, contactable %, duplicate %, rejected %, KYC mismatch %, hand-off %, TAT, conversion value.
2. Quality score transparent (factor breakdown); not a payout engine.
3. Supports coaching and prioritisation.
**Business rules:** score formula per §12.4 (configurable weights).
**Edge cases:** low-volume partner → "insufficient data".

| LLD area | Guidance |
|---|---|
| Components | Partner quality dashboard (score + factor breakdown) |
| Backend flow | `GET /partners/{id}/quality` → aggregate metrics → compute score per §12.4 |
| Data ops | Aggregate read Lead/SourceAttribution/DuplicateMatch/KYCVerification |
| Validation | Min volume for score |
| Authorization | BM/SM/HEAD all; PARTNER own only |
| State/side effects | Writes Partner.quality_score (cached) |
| Failure handling | Zero denominator → "–" not 0% |
| Dependencies | §12.4 formula, FR-090 |
| Test guidance | Unit: formula, zero-denominator. API: partner-own scope |

### M11 — Tasks & Communication

#### FR-100: Task management
**Module:** M11 · **Priority:** MVP-Must · **Roles:** RM, BM, SM, KYC
**User story:** As an RM, I want tasks with SLAs and dispositions so that follow-ups are disciplined and visible.
**Acceptance criteria**
1. Types: call, visit, doc_request, kyc_appt, dealer_followup, callback, approval, handoff_retry, nurture.
2. Tasks have owner, due date/time, priority, SLA, status, result/disposition, next action.
3. Overdue tasks appear in dashboard + escalation queue.
4. Completing a task records timestamp, result, next action.
**Edge cases:** task on reassigned lead → reassign or reassign-prompt; overdue → escalation per SLAPolicy.

| LLD area | Guidance |
|---|---|
| Components | Task list/board, task modal, overdue queue, visit logger (geo/photo) |
| Backend flow | `POST/PATCH /tasks` CRUD; overdue sweep job sets status=overdue + escalation |
| Data ops | Insert/Update Task; AuditLog |
| Validation | Owner in scope; due in future for new; disposition on complete |
| Authorization | Owner or BM/SM in scope |
| State/side effects | Overdue notification; nurture task sets Lead.nurture_next_at |
| Failure handling | Stale update → `CONFLICT`; out-of-scope owner → `FORBIDDEN` |
| Dependencies | FR-104 (SLA), FR-102 (visit) |
| Test guidance | Unit: overdue logic. API: CRUD, complete with disposition, escalation |

#### FR-101: Communication templates & audit
**Module:** M11 · **Priority:** MVP-Must · **Roles:** ADMIN/Product Ops (config), RM/BM (send)
**User story:** As ops, I want templated, consent-aware, audited messaging so that every customer message is compliant and traceable.
**Acceptance criteria**
1. Templates configurable by event, product, language, channel, recipient type.
2. Every communication stores channel, template version, recipient, consent basis, delivery status, provider ref, failure reason.
3. Customer messages respect opt-out and purpose-specific consent.
4. Transactional KYC/document reminders separated from marketing.
**Edge cases:** missing consent for marketing → blocked; provider failure → retry/failover.

| LLD area | Guidance |
|---|---|
| Components | Template manager (versioned), send action, comms timeline |
| Backend flow | `NotificationDispatchService.send(lead, template, channel)` → check NotificationPreference + ConsentRecord → call provider via IntegrationLog → write CommunicationLog |
| Data ops | Read CommunicationTemplate, NotificationPreference, ConsentRecord; insert CommunicationLog |
| Validation | Consent basis present for customer msgs; template active |
| Authorization | customer_comm scope; config = ADMIN |
| State/side effects | Delivery status updates; DOC_REQUEST etc events |
| Failure handling | No consent → `FORBIDDEN`(consent); provider fail → retry/failover, log failure |
| Dependencies | FR-103, FR-110, FR-140 |
| Test guidance | Unit: consent/opt-out gate. API: send transactional vs blocked marketing; delivery status |

#### FR-102: Telephony & visit logging
**Module:** M11 · **Priority:** MVP-Should / Phase 1.5 (CTI) · **Roles:** RM, BM
**User story:** As an RM, I want to log calls and geotagged visits so that field activity is captured and auditable.
**Acceptance criteria**
1. Manual call disposition logging in MVP.
2. CTI (P1.5) adds click-to-call + disposition sync.
3. Visit logs capture time, notes, geotag, photo evidence, availability.
4. Any recording/location capture is consent- and policy-compliant.
**Edge cases:** location denied → log without geo; recording only where permitted.

| LLD area | Guidance |
|---|---|
| Components | Call disposition control, visit logger (map pin + photo) |
| Backend flow | Visit/call = `Task`(call/visit) with disposition+geo; CTI via IntegrationLog(cti) P1.5 |
| Data ops | Update Task(disposition, geo); CommunicationLog(call) |
| Validation | Geo only with permission; disposition ∈ enum |
| Authorization | Owner/BM scope |
| State/side effects | Contactability metrics; high-intent signals |
| Failure handling | No geo permission → proceed without; CTI down → manual |
| Dependencies | FR-100, FR-121 (contactability) |
| Test guidance | API: disposition log, visit geo optional. E2E: mobile visit log |

#### FR-103: Notification preference & opt-out centre
**Module:** M11 · **Priority:** MVP-Must · **Roles:** RM/BM (manage on behalf), CUSTOMER (self via link)
**User story:** As a customer, I want to control which messages I receive so that my preferences and consent are respected.
**Acceptance criteria**
1. Per-recipient, per-channel, per-purpose opt-in/out store.
2. Transactional default in, marketing default out.
3. Dispatch (FR-101) honours preferences and consent before sending.
4. Changes audited and reflected immediately.
**Edge cases:** opt-out of transactional KYC reminders → warn that it may delay processing (policy-dependent).

| LLD area | Guidance |
|---|---|
| Components | Preference centre (customer link + internal view) |
| Backend flow | `PUT /preferences` upsert `NotificationPreference`; consulted by dispatch |
| Data ops | Upsert NotificationPreference; AuditLog |
| Validation | Unique (subject, channel, purpose) |
| Authorization | Customer self (token) or RM/BM on behalf |
| State/side effects | Immediate effect on FR-101 |
| Failure handling | Conflict upsert resolved by last-write |
| Dependencies | FR-101, FR-110 |
| Test guidance | Unit: default in/out. API: opt-out blocks marketing send |

#### FR-104: SLA configuration & escalation engine
**Module:** M11 · **Priority:** MVP-Must · **Roles:** ADMIN/Sales Ops (config), system (run)
**User story:** As sales ops, I want configurable SLAs and escalations so that breaches are caught and routed automatically.
**Acceptance criteria**
1. Configure SLA thresholds (business-hours aware) and escalation chains for first-contact, document, KYC-exception, grievance, handoff-retry.
2. Timers start/stop on the relevant state transitions.
3. Approaching/breached SLAs notify per chain and feed reports.
4. Escalation can reassign (e.g., first-contact breach → BM/SM).
**Edge cases:** business-hours/holidays respected; paused stages stop timers.

| LLD area | Guidance |
|---|---|
| Components | SLA policy admin, escalation chain editor |
| Backend flow | `SLAEngine`: on transition set `*_due_at`; scheduler scans due/breached → notify/escalate via outbox |
| Data ops | Read SLAPolicy + BusinessCalendar (resolve by branch→region→default); update Lead.sla_*; emit FIRST_CONTACT_DUE/BREACH etc |
| Validation | Threshold > 0; chain non-empty |
| Authorization | ADMIN/Sales Ops config |
| State/side effects | Notifications, reassignment (FR-030), report metrics |
| Failure handling | Misconfig → validation; scheduler idempotent |
| Dependencies | FR-030, FR-100, FR-114, §12, BusinessCalendar (§5.2.46) |
| Test guidance | Unit: business-hours calc, breach detection. API: due→notify→escalate |

### M12 — Compliance, Consent & Privacy

#### FR-110: Purpose-wise consent ledger
**Module:** M12 · **Priority:** MVP-Must · **Roles:** RM/partner/customer (capture), DPO (oversight)
**User story:** As Compliance/DPO, I want purpose-wise consent records so that the NBFC can evidence lawful processing and customer choice.
**Acceptance criteria**
1. Consent record stores customer, lead, purpose, data category, channel, language, notice version, consent-text version, timestamp, IP/device/channel, expiry/retention, source, actor.
2. Purposes from the §5.5 `consent_purpose` enum (lead_contact … grievance).
3. Consent states: granted, denied, withdrawn, expired, superseded.
4. Withdrawal affects only the relevant purpose unless legal retention applies.
5. Consent history is append-only.
**Edge cases:** withdraw los_handoff consent before hand-off → hand-off guard fails; superseded consent chained.

| LLD area | Guidance |
|---|---|
| Components | Consent panel (Lead 360), Compliance Console ledger view |
| Backend flow | `POST /leads/{id}/consents` insert `ConsentRecord`(append-only); `GET` returns history; derive Lead.consent_status |
| Data ops | Insert ConsentRecord; update Lead.consent_status (derived); AuditLog(consent_*) |
| Validation | purpose ∈ enum; notice/text version present; no update/delete |
| Authorization | capture per role; DPO full/masked view |
| State/side effects | Gates stage transitions (§10.3); CONSENT_WITHDRAWN outbox |
| Failure handling | Attempted edit/delete → blocked (append-only); missing version → `VALIDATION_ERROR` |
| Dependencies | All gated stages, FR-081, FR-101 |
| Test guidance | Unit: state machine, derive summary. API: grant/withdraw, append-only enforcement |

#### FR-111: Data minimisation & resource-access controls
**Module:** M12 · **Priority:** MVP-Must · **Roles:** system, DPO
**User story:** As Compliance, I want enforced data minimisation so that only need-based data is collected and no device over-reach occurs.
**Acceptance criteria**
1. Store only data necessary for configured purposes.
2. Raw Aadhaar and biometrics never stored.
3. Camera/mic/location access one-time, purpose-bound, logged.
4. LMS never requests contacts, call logs, SMS inbox, general media, or unrelated device resources.
5. Third-party sharing requires purpose, recipient, legal basis/consent, audit.
**Edge cases:** field requesting unmapped data → blocked by config.

| LLD area | Guidance |
|---|---|
| Components | Permission prompts (one-time), data-sharing log view |
| Backend flow | Field-schema enforces allowed fields; sharing goes through `DataSharingLog` with consent ref |
| Data ops | Insert DataSharingLog; reject persistence of disallowed categories |
| Validation | No raw Aadhaar column exists; sharing needs consent_id |
| Authorization | DPO oversight |
| State/side effects | Sharing audited |
| Failure handling | Unconsented share → `FORBIDDEN` |
| Dependencies | FR-110, FR-080/081 |
| Test guidance | Unit: no-raw-Aadhaar invariant. API: unconsented share blocked |

#### FR-112: Data-principal rights & retention workflow
**Module:** M12 · **Priority:** MVP-Should · **Roles:** CUSTOMER (raise), DPO (process)
**User story:** As a customer, I want to exercise my data rights so that I can access/correct/erase data subject to lawful retention.
**Acceptance criteria**
1. Capture access/correction/update/erasure/withdrawal/grievance requests; route to DPO with SLA.
2. Show whether data can be erased or must be retained (legal/regulatory/business) with basis.
3. Retention rules configurable by category and outcome.
4. Purge/anonymisation jobs logged and reviewable.
**Edge cases:** erasure under legal hold → rejected_retained with reason.

| LLD area | Guidance |
|---|---|
| Components | Rights-request intake (customer link + Compliance Console), disposition view |
| Backend flow | `POST /data-rights` create `DataRightsRequest`; DPO processes; erasure consults RetentionPolicy/legal hold |
| Data ops | Insert/Update DataRightsRequest; trigger FR-115 on approved erasure |
| Validation | request_type ∈ enum; SLA set |
| Authorization | Customer raise; DPO process |
| State/side effects | DATA_RIGHT_REQUEST outbox; may schedule purge/anonymise |
| Failure handling | Legal hold → rejected_retained; SLA breach → escalation |
| Dependencies | FR-115, FR-114, RetentionPolicy |
| Test guidance | API: erasure vs legal hold; SLA |

#### FR-113: DLA/LSP registry support
**Module:** M12 · **Priority:** MVP-Should · **Roles:** DPO, ADMIN
**User story:** As Compliance, I want a DLA/LSP registry so that the NBFC can evidence and disclose digital lending interfaces.
**Acceptance criteria**
1. Store DLA/LSP/partner metadata: name, owner, URL, grievance officer, customer care, RE reference, enabled products, data collected, storage location, status.
2. Export for compliance reporting and internal review.
3. Display customer-facing lender/LSP/grievance info where required by config.
**Edge cases:** inactive DLA hidden from customer-facing display.

| LLD area | Guidance |
|---|---|
| Components | DLA/LSP registry screen (Compliance Console), customer-facing disclosure block |
| Backend flow | CRUD `DLARegistry`; export via ExportJob |
| Data ops | Insert/Update DLARegistry |
| Validation | Required disclosure fields for active entries |
| Authorization | DPO/ADMIN |
| State/side effects | Drives customer-facing disclosures |
| Failure handling | Missing disclosure on active → `VALIDATION_ERROR` |
| Dependencies | FR-122 (export), FR-060 (disclosure) |
| Test guidance | API: CRUD, export; disclosure rendering |

#### FR-114: Grievance workflow
**Module:** M12 · **Priority:** MVP-Should · **Roles:** all intake, grievance owner
**User story:** As Compliance, I want end-to-end grievance tracking so that complaints are resolved within SLA with evidence.
**Acceptance criteria**
1. Capture grievances from customer link, RM, branch, call centre, partner, admin.
2. Track category, owner, SLA, status, response, escalation, closure proof.
3. No/dissatisfied response within configured days → escalation prompts.
**Edge cases:** reopened grievance; multi-channel duplicate linked.

| LLD area | Guidance |
|---|---|
| Components | Grievance queue, detail/resolution view, escalation banner |
| Backend flow | CRUD `Grievance`; SLA via SLAPolicy(grievance); escalation via scheduler |
| Data ops | Insert/Update Grievance; AuditLog |
| Validation | Category/owner/SLA; closure proof to close |
| Authorization | Intake any; resolve = owner/DPO |
| State/side effects | GRIEVANCE_CREATED outbox; escalation notifications |
| Failure handling | Close without proof → `VALIDATION_ERROR`; SLA breach → escalate |
| Dependencies | FR-061, FR-104 |
| Test guidance | API: lifecycle open→resolve→close; escalation |

#### FR-115: Data retention, purge & anonymisation engine
**Module:** M12 · **Priority:** MVP-Should · **Roles:** system, DPO (review)
**User story:** As Compliance, I want scheduled retention enforcement so that data is purged/anonymised per policy with full logging and legal-hold safety.
**Acceptance criteria**
1. Scheduled job applies `RetentionPolicy` by data category + lead outcome.
2. Never purge/anonymise rows under active legal hold or with open rights-request/grievance.
3. Every action logged and reviewable by DPO.
4. Anonymisation preserves analytics aggregates without PII.
**Edge cases:** policy change → next run; dry-run mode for DPO review.

| LLD area | Guidance |
|---|---|
| Components | Retention policy admin, purge/anonymise review log (Compliance Console) |
| Backend flow | Scheduled `RetentionEngine` selects eligible rows (respecting holds) → purge/anonymise in tx → AuditLog |
| Data ops | Update/anonymise Lead/LeadIdentity/Document/etc per policy; never touch ConsentRecord/AuditLog except per legal policy |
| Validation | Legal hold + open request/grievance exclusion |
| Authorization | system; DPO review/dry-run |
| State/side effects | Anonymised rows flagged; outbox optional |
| Failure handling | Partial failure rollback per batch; never delete audit trail |
| Dependencies | FR-112, RetentionPolicy, AuditLog |
| Test guidance | Unit: eligibility + hold exclusion. Integration: dry-run vs apply; audit written |

### M13 — Reporting & MIS

#### FR-120: Core report pack
**Module:** M13 · **Priority:** MVP-Must · **Roles:** RM, BM, SM, HEAD
**User story:** As management, I want the core funnel/source/RM/rejection reports so that I can run the sales operation.
**Acceptance criteria:** Funnel/Conversion, Source Performance, RM/Team Performance, Rejection Summary — all scope-filtered and reconciled (§12.5).
**Edge cases:** zero denominator → "–".

| LLD area | Guidance |
|---|---|
| Components | Reports screen, report viewer, filter bar |
| Backend flow | `GET /reports/{code}?filters` → parameterised aggregate queries (read replicas where available) |
| Data ops | Aggregate read across Lead/StageHistory/SourceAttribution |
| Validation | Filters allow-listed; scope enforced |
| Authorization | reports scope |
| State/side effects | None (read) |
| Failure handling | Heavy query timeout → async (ExportJob); zero-denom "–" |
| Dependencies | §12 metric dictionary |
| Test guidance | Unit: metric formulas. API: scope filter, reconciliation |

#### FR-121: NBFC differentiator reports
**Module:** M13 · **Priority:** MVP-Must / MVP-Should · **Roles:** management
**User story:** As management, I want NBFC-specific analytics so that I can manage SLAs, KYC TAT, partner quality, and leakage.
**Acceptance criteria:** reports below, scope-filtered and reconciled:

| Report | Priority | Answers |
|---|---|---|
| First Contact SLA | Must | Are hot/new leads contacted in time by branch/team/RM/source? |
| KYC & Document Ageing | Must | Which docs/products/branches delay hand-off? |
| DSA/Dealer Quality | Must | Which partners send contactable, non-duplicate, convertible leads? |
| Duplicate Leakage | Must | Which sources create duplicates and where caught? |
| Handoff Failure | Must | Why are hand-offs failing; which integration errors recur? |
| Source ROI | Should | Which source/campaign converts best after cost? |
| Contactability | Should | Which leads fail (wrong number/no response) and from where? |
| Consent & Privacy Ops | Should | Which leads lack consent/have withdrawals/open requests? |
| Product/Branch Heatmap | Should | Which products/branches have volume/conversion/TAT issues? |
| RM Capacity & Load | Should | Which RMs are overloaded/under-utilised? |

| LLD area | Guidance |
|---|---|
| Components | Report viewer + heatmap/SLA visualisations |
| Backend flow | `GET /reports/{code}` parameterised aggregates; partner quality uses §12.4 |
| Data ops | Aggregate read Lead/Task/IntegrationLog/CommunicationLog/DuplicateMatch/ConsentRecord |
| Validation | Scope + filters |
| Authorization | reports scope (partner sees own) |
| State/side effects | None |
| Failure handling | zero-denom "–"; async for large |
| Dependencies | §12, FR-092 |
| Test guidance | Unit: each report formula. API: reconciliation vs dashboard |

#### FR-122: Report export governance
**Module:** M13 · **Priority:** MVP-Must · **Roles:** management, DPO
**User story:** As Compliance, I want governed exports so that sensitive data leaves the system only with masking, approval, and audit.
**Acceptance criteria**
1. Exports record filters, generated-by, timestamp, scope, masking level, purpose.
2. High-volume/sensitive exports require approval if configured.
3. Files watermarked with user ID + timestamp.
4. Export access audited.
**Edge cases:** > threshold rows or unmasked PII → awaiting_approval.

| LLD area | Guidance |
|---|---|
| Components | Export button → ExportJob status; approval queue |
| Backend flow | `POST /exports` create `ExportJob`(queued/awaiting_approval) → async generate (masked, watermarked) → GCS artefact |
| Data ops | Insert/Update ExportJob; AuditLog(export_generate/download) |
| Validation | Masking ≥ role minimum; threshold check |
| Authorization | export scope; unmasked needs approval |
| State/side effects | EXPORT_COMPLETED outbox/notification |
| Failure handling | Over threshold → awaiting_approval; download out-of-scope → `FORBIDDEN` |
| Dependencies | FR-002, FR-120/121 |
| Test guidance | API: masking, approval threshold, watermark, audit |

#### FR-123: Audit explorer & evidence export
**Module:** M13 · **Priority:** MVP-Must · **Roles:** DPO, ADMIN (system scope)
**User story:** As Compliance, I want to search and export the audit trail so that I can produce evidence for any lead/actor/action.
**Acceptance criteria**
1. Search audit by lead, actor, action, entity, date range.
2. Tamper-evidence verifiable (hash chain).
3. Evidence export via governed ExportJob (masked).
**Edge cases:** hash-chain break → integrity alert.

| LLD area | Guidance |
|---|---|
| Components | Audit explorer (filters + timeline), integrity badge |
| Backend flow | `GET /audit?filters` paginated; integrity check verifies prev_audit_hash chain |
| Data ops | Read AuditLog (append-only); export via FR-122 |
| Validation | Filters allow-listed; scope (DPO=A/M, ADMIN=system) |
| Authorization | DPO/ADMIN only |
| State/side effects | None (read) |
| Failure handling | Chain mismatch → integrity alert + log |
| Dependencies | AuditLog, FR-122 |
| Test guidance | Unit: chain verify. API: search scope, evidence export |

### M14 — Administration

#### FR-130: User, role, team & branch administration
**Module:** M14 · **Priority:** MVP-Must · **Roles:** ADMIN
**User story:** As an admin, I want to manage users/roles/teams/branches so that access stays correct and current.
**Acceptance criteria**
1. Create/edit/deactivate users; assign role, branch, team, region, product skills, partner mapping, reporting manager.
2. Deactivating a user with open leads requires reassignment or exception.
3. Role changes logged.
**Edge cases:** deactivate with open leads → forced reassign flow.

| LLD area | Guidance |
|---|---|
| Components | Admin Settings → Users/Roles/Teams/Branches |
| Backend flow | CRUD User/Role/Team/Branch; deactivation triggers reassignment check |
| Data ops | Insert/Update User/Role/Team/Branch; AuditLog(user_change/role_change) |
| Validation | Unique username/email; required scope attrs |
| Authorization | user_mgmt = ADMIN only |
| State/side effects | Role change effective per token policy |
| Failure handling | Deactivate with open leads → `CONFLICT`(reassign required) |
| Dependencies | FR-001/002, FR-030 |
| Test guidance | API: CRUD, deactivation reassign gate, audit |

#### FR-131: Master configuration
**Module:** M14 · **Priority:** MVP-Must · **Roles:** ADMIN, Product Ops
**User story:** As an admin, I want to configure master data so that the LMS adapts without code changes.
**Acceptance criteria:** configurable — products/versions, field groups/validation, document checklists/mandatory flags, sources/sub-sources/DSAs/dealers/connectors/OEMs, branches/pin mapping/territories, rejection reasons/sub-reasons, SLA thresholds, allocation rules, notification templates, consent purposes/notice versions, retention categories, integration endpoints/retry policies.
**Edge cases:** referenced master cannot be deleted (deactivate only).

| LLD area | Guidance |
|---|---|
| Components | Admin Settings master editors |
| Backend flow | CRUD across master entities, each via `ConfigurationVersion` governance (FR-132) |
| Data ops | Insert/Update master entities (Partner/Source/RejectionReason/SLAPolicy/AllocationRule/CommunicationTemplate/RetentionPolicy/DLARegistry/Branch) |
| Validation | Referential integrity; active-use checks |
| Authorization | ADMIN/Product Ops per type |
| State/side effects | CONFIG_CHANGED outbox |
| Failure handling | Delete-in-use → `CONFLICT`; invalid → `VALIDATION_ERROR` |
| Dependencies | FR-132, all consumers |
| Test guidance | API: CRUD, in-use protection, versioning |

#### FR-132: Configuration governance
**Module:** M14 · **Priority:** MVP-Must · **Roles:** ADMIN (maker), checker
**User story:** As an admin, I want versioned, maker-checker, rollback-able configuration so that changes are safe and reversible.
**Acceptance criteria**
1. Configuration changes versioned and audited.
2. High-impact changes require maker-checker where enabled.
3. Changes testable in sandbox before production activation.
4. Rollback supported per config version.
**Edge cases:** checker = maker rejected; rollback restores prior active version.

| LLD area | Guidance |
|---|---|
| Components | Change request + approval queue, version history, rollback action |
| Backend flow | All config writes create `ConfigurationVersion`(pending) → checker approve → active; rollback re-activates rollback_ref |
| Data ops | Insert/Update ConfigurationVersion; AuditLog(config_change) |
| Validation | checker ≠ maker for high-impact; effective_at future |
| Authorization | maker/checker roles |
| State/side effects | CONFIG_CHANGED outbox; activation switches live config |
| Failure handling | Self-approval → `FORBIDDEN`; invalid → `VALIDATION_ERROR` |
| Dependencies | FR-040, FR-131 |
| Test guidance | API: maker→checker→active; rollback; self-approval block |

### M15 — Integration & Events

#### FR-140: Integration framework (idempotency, retry, webhooks, monitor)
**Module:** M15 · **Priority:** MVP-Must · **Roles:** system, IT/ADMIN (monitor)
**User story:** As IT, I want a robust integration layer so that external calls are idempotent, retried, observable, and never duplicate state.
**Acceptance criteria**
1. Every state-changing external call carries correlation + idempotency keys; replays are safe.
2. Provider responses stored with status, timestamp, masked data, retention policy.
3. Synchronous and asynchronous providers supported.
4. Failures appear in operational queues; retries use backoff and circuit breakers.
**Edge cases:** provider down → circuit open + queue; duplicate inbound webhook → idempotent.

| LLD area | Guidance |
|---|---|
| Components | Integration Monitor (logs, queues, retries, webhook status, failure categories) |
| Backend flow | `IntegrationGateway` wraps all provider calls → IntegrationLog + idempotency cache (Redis) + retry queue (Cloud Tasks) + circuit breaker |
| Data ops | Insert/Update IntegrationLog; CRUD WebhookSubscription |
| Validation | Idempotency key uniqueness; HMAC on inbound |
| Authorization | Monitor = IT/ADMIN |
| State/side effects | Retry/backoff; circuit state; failure dashboards |
| Failure handling | Map provider errors to `UPSTREAM_UNAVAILABLE`(503)/`RATE_LIMITED`(429); poison-message → dead-letter |
| Dependencies | FR-071/080/081/082/101 |
| Test guidance | Unit: idempotency, backoff, circuit. API: replay no-dup, webhook signature |

#### FR-141: Event outbox & analytics/AI-readiness stream
**Module:** M15 · **Priority:** MVP-Must · **Roles:** system
**User story:** As the platform, I want a durable domain-event stream so that analytics and future AI can consume consistent, masked events without coupling to the OLTP database.
**Acceptance criteria**
1. Domain events written to `EventOutbox` in the same transaction as the state change (transactional outbox).
2. A publisher relays events to the stream/analytics sink; at-least-once with idempotent consumers.
3. Payloads are masked and schema-versioned.
4. No automated credit decisioning consumes these events in MVP.
**Edge cases:** publish failure → retry; schema evolution via schema_version.

| LLD area | Guidance |
|---|---|
| Components | Outbox publisher worker; event schema registry (doc) |
| Backend flow | Writers insert EventOutbox in tx → publisher polls pending → publish (Pub/Sub) → mark published |
| Data ops | Insert EventOutbox (all state changes); update status |
| Validation | event_code ∈ enum; payload masked |
| Authorization | system only |
| State/side effects | Feeds §12 analytics + future AI (governed) |
| Failure handling | Publish fail → retry; never block the originating transaction |
| Dependencies | All write FRs, NFR-20 (AI governance) |
| Test guidance | Unit: transactional outbox atomicity. Integration: at-least-once, idempotent consume |

## 7. User Interface Requirements

### 7.1 Global UX standards

- Responsive web/PWA for desktop, tablet, mobile; installable PWA.
- Left navigation filtered by role; **mobile bottom navigation** for RM core actions (Inbox, Capture, Tasks, Search, More).
- Top bar: global masked search (cmd-k, FR-054), quick-create (lead/task/upload/send-link), notifications bell, profile/MFA.
- Consistent `StatusChip` set: consent, KYC, document, SLA, duplicate, hand-off.
- Every data view implements **loading / empty / error / success / disabled** states.
- Low-bandwidth mode: compressed images, deferred charts, reduced payloads.
- Accessibility: **WCAG 2.1 AA** for core flows; keyboard navigable; dark mode.
- Localisation: INR, `dd-MM-yyyy`, IST, pin/branch hierarchy; English UI + regional-language message templates.
- Design system: **Tailwind + shadcn/ui** primitives (§4.5): `DataTable`, `EntityForm`, `Modal`, `Drawer`, `Toast`, `StatusChip`, `MaskedField`, `EmptyState`, `LoadingSkeleton`, `ErrorState`, `ConfirmDialog`.

### 7.2 Screen catalogue

| Screen | Primary users | Purpose & key components | Related FRs / entities / APIs |
|---|---|---|---|
| Login & MFA | all | Auth, MFA challenge, password reset | FR-001 · User · `/auth/*` |
| Dashboard / Home | RM/BM/SM/HEAD | KPI cards, SLA alerts, hot leads, tasks, source summary, hand-off failures; drill-through | FR-053 · Lead/Task · `/dashboard` |
| Lead Inbox / List | RM/BM/SM/KYC | Saved queues, filter drawer, `DataTable`, bulk actions | FR-050/054 · Lead/SavedView · `/leads` |
| Lead Capture | RM/BM/PARTNER | Quick + full capture form, product picker, duplicate warning modal | FR-010/011/020 · Lead/LeadIdentity · `/leads` |
| Bulk Import | BM/SM/ADMIN | Upload→map→validate→commit wizard, row-error file | FR-010 · Lead · `/leads/import` |
| Lead 360 | RM/BM/KYC/DPO | Tabbed detail: Overview/Docs/KYC/Tasks/Comms/Consent/LOS/Audit; masked | FR-051 + most · Lead+ · `/leads/{id}` |
| Pipeline Board | RM/BM/SM | Kanban stage columns, drag/drop, SLA cards, mobile stage selector | FR-052 · Lead · `/leads/{id}/stage` |
| Customer Link Mgmt | RM/BM/KYC | Send/resend/revoke links, doc status, link audit | FR-060/062 · CustomerLink · `/leads/{id}/customer-link` |
| Customer Micro-site (public) | CUSTOMER | OTP, consent, upload, callback, status, grievance | FR-060/061/062/110 · CustomerLink/Document · `/c/{token}` |
| KYC Workbench | KYC/Ops/BM | Verification queues, provider status, exceptions, sign-off | FR-070/071/072 · Document/KYCVerification · `/leads/{id}/kyc/*` |
| Tasks | RM/BM/SM/KYC | Task list/board, overdue queue, visit logger (geo/photo) | FR-100/102 · Task · `/tasks` |
| Partner Console (partner) | PARTNER | Submit lead, upload docs, limited status, duplicate feedback, own quality | FR-091/092 · Partner/Lead · `/partners/leads` |
| Partner Management | BM/SM/ADMIN | Partner master, status, mapping, quality metrics | FR-090/092 · Partner · `/partners` |
| Reports & MIS | RM/BM/SM/HEAD | Core + differentiator reports, filters, heatmaps, export | FR-120/121/122 · aggregates · `/reports/*` |
| Compliance Console | DPO | Consent ledger, rights requests, grievance, DLA/LSP registry, retention review, break-glass | FR-110–115/003 · consent/grievance · `/compliance/*` |
| Audit Explorer | DPO/ADMIN | Search audit, integrity badge, evidence export | FR-123 · AuditLog · `/audit` |
| Admin Settings | ADMIN/Product Ops | Users/roles/teams/branches, product config, SLAs, sources, templates, allocation, retention, integrations; config approval queue | FR-130/131/132/040/104 · config entities · `/admin/*` |
| Integration Monitor | IT/ADMIN | API logs, queues, retries, webhook status, failure categories | FR-140 · IntegrationLog · `/admin/integrations` |

### 7.3 Key layout notes

- **Lead 360** is the workhorse: header (masked profile, product/source, stage tracker, score chip), tabbed body, right rail (next-best-action, tasks, consent coverage, LOS panel). Each tab lazy-loads and shows its own empty/error state.
- **DataTable** everywhere for lists: server pagination (limit ≤ 100), column visibility, sticky header, bulk-select with scope-aware actions, saved-view chips.
- **Forms** use React Hook Form + Zod mirroring §5 field validations; inline field errors map to `VALIDATION_ERROR.fields`.
- **Destructive actions** (merge, revoke link, deactivate user, config rollback) always use `ConfirmDialog` with reason capture where audited.

### 7.4 Mobile / field-sales requirements

- Minimum-field lead capture usable in **< 3 minutes**.
- Image upload auto-compresses with retake; camera capture supported.
- Visit logging captures geotag + timestamp where permission granted (consent-bound); works without geo if denied.
- Offline draft capture (Phase 1.5): local encrypted store, sync on reconnect, conflicts → review queue.
- Touch-friendly pipeline cards; share customer link via WhatsApp/SMS from mobile.

## 8. API & Integration Requirements

All conventions (base URL, auth, correlation, idempotency, pagination, envelope) are defined in §4.4 and apply to every endpoint.

### 8.1 Authentication

JWT Bearer (access 15 min + rotating refresh); optional enterprise SSO (OIDC); MFA per §4.6. Customer micro-site (`/c/{token}`) uses opaque token + OTP step-up, never a JWT. LOS status webhook is authenticated by HMAC signature.

### 8.2 Core internal endpoints

| Method | Path | Purpose | FR |
|---|---|---|---|
| POST | /auth/login · /auth/mfa · /auth/refresh · /auth/reset | Auth lifecycle | FR-001 |
| POST | /leads | Create lead | FR-010 |
| POST | /leads/import | Bulk import | FR-010 |
| GET/PATCH | /leads/{id} | View / update lead | FR-051/050 |
| PATCH | /leads/{id}/stage | Move stage | FR-052 |
| POST | /leads/{id}/duplicate-check | Run duplicate check | FR-020 |
| POST | /leads/{id}/merge | Merge duplicate | FR-021 |
| POST | /leads/{id}/reassign | Reassign owner | FR-030 |
| POST/GET | /leads/{id}/consents | Capture / view consent | FR-110 |
| POST/GET | /leads/{id}/documents | Upload / view documents | FR-070 |
| POST | /leads/{id}/kyc/{type} | KYC verification | FR-071 |
| PATCH | /leads/{id}/kyc/{kid}/resolve | Resolve KYC exception | FR-072 |
| POST | /leads/{id}/eligibility | Request LOS eligibility | FR-080 |
| POST | /leads/{id}/handoff | Hand off to LOS | FR-081 |
| POST | /leads/{id}/customer-link | Create customer link | FR-060 |
| GET | /dashboard | Role dashboard | FR-053 |
| GET | /search | Global search | FR-054 |
| POST/GET/PATCH | /tasks | Manage tasks | FR-100 |
| PUT | /preferences | Notification preferences | FR-103 |
| POST/GET | /partners · /partners/leads | Partner master / submission | FR-090/091 |
| GET | /partners/{id}/quality | Partner quality | FR-092 |
| GET | /reports/{code} | Reports | FR-120/121 |
| POST/GET | /exports | Governed export | FR-122 |
| GET | /audit | Audit explorer | FR-123 |
| POST/PATCH | /data-rights · /grievances | Rights / grievance | FR-112/114 |
| CRUD | /admin/users · /admin/products · /admin/* | Administration | FR-130/131/132 |
| GET | /admin/integrations | Integration monitor | FR-140 |
| POST | /admin/break-glass · /approve | Break-glass | FR-003 |

### 8.3 Standard error envelope

```json
{
  "data": null,
  "meta": { "correlation_id": "corr_20260605_001" },
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid.",
    "retryable": false,
    "fields": [
      { "field": "mobile", "issue": "Mobile must be 10 digits starting 6-9" },
      { "field": "source", "issue": "Source is mandatory" }
    ]
  }
}
```

### 8.4 HTTP status + error-code catalog (single source of truth)

Every endpoint, every LLD "Failure handling" row, and every UI error state uses **only** these codes. New codes must be registered here first (Amendments log).

| Code | HTTP | Meaning | Typical triggering FRs | User-visible message template |
|---|---|---|---|---|
| VALIDATION_ERROR | 400 | Field/payload invalid | FR-010/040/070/110 + most | "Please correct the highlighted fields." |
| AUTH_REQUIRED | 401 | Missing/invalid/expired auth | FR-001 | "Please sign in to continue." |
| FORBIDDEN | 403 | Authenticated but not permitted / out of scope | FR-002/003/091 + all | "You don't have access to this." |
| NOT_FOUND | 404 | Resource absent or out of scope (existence hidden) | FR-051/060/082 | "We couldn't find that item." |
| CONFLICT | 409 | Duplicate / optimistic-lock / illegal state | FR-010/020/052/081/130 | "This action conflicts with the current state. Refresh and retry." |
| RATE_LIMITED | 429 | Too many requests (auth/OTP/public/search) | FR-001/060/054 | "Too many attempts. Please wait and try again." |
| PAYLOAD_TOO_LARGE | 413 | File/import exceeds limit | FR-010/070 | "File is too large." |
| UNSUPPORTED_MEDIA | 415 | Disallowed file type | FR-070 | "Unsupported file type." |
| INTERNAL_ERROR | 500 | Unhandled server error (no stack leaked) | any | "Something went wrong. We're on it." |
| UPSTREAM_UNAVAILABLE | 503 | External provider/LOS down or timed out | FR-071/080/081/082/101/140 | "A service is temporarily unavailable. We'll retry." |

Domain-specific codes (subtypes carried in `error.detail.reason`, HTTP as above):
`DUPLICATE_BLOCKED` (409, FR-020), `STAGE_GUARD_FAILED` (400, FR-052/081 — `detail.guard`), `CONSENT_MISSING` (403, FR-110), `KYC_EXCEPTION_OPEN` (409, FR-081), `IDEMPOTENT_REPLAY` (200 with original result, FR-140), `EXPORT_APPROVAL_REQUIRED` (409, FR-122), `LEGAL_HOLD` (409, FR-115).

### 8.5 Request/response examples (most complex endpoints)

**Create lead — `POST /api/v1/leads`** (headers: `Authorization`, `Idempotency-Key`, `X-Correlation-Id`)
```json
// request
{
  "product_code": "CV",
  "identity": { "name": "Ramesh T", "mobile": "9812345610", "preferred_language": "Marathi" },
  "source": { "source": "DSA", "sub_source": "Apex-walkin", "partner_code": "PRT-00045" },
  "branch_code": "BR-Pune-01", "pin_code": "411001",
  "requested_amount": 1800000,
  "product_detail": { "vehicle_type": "truck", "new_used": "used", "invoice": 1800000 },
  "consents": [{ "purpose": "lead_contact", "state": "granted", "actor": "customer", "notice_version": "v3" }]
}
// 201 response
{
  "data": {
    "lead_id": "8f1c...e2", "lead_code": "LD-2026-000123", "stage": "captured",
    "product_code": "CV", "is_hot": true, "score": 78, "score_reasons": ["complete_mobile_product_pin","hot_amount"],
    "consent_status": "captured", "duplicate_status": "none", "owner_id": null
  },
  "meta": { "correlation_id": "corr_20260605_001" }, "error": null
}
// 409 duplicate (DUPLICATE_BLOCKED)
{ "data": null, "error": { "code": "CONFLICT", "message": "A matching lead already exists.",
  "detail": { "reason": "DUPLICATE_BLOCKED", "matches": [{ "lead_code": "LD-2026-000101", "confidence": "strong", "matched_on": ["pan","mobile"] }] } } }
```

**List leads — `GET /api/v1/leads?filter[stage]=documents_pending&filter[product_code]=CV&sort=-created_at&page=1&limit=25`**
```json
{
  "data": [
    { "lead_code": "LD-2026-000123", "name_masked": "Ramesh T", "mobile_masked": "98xxxxxx10",
      "product_code": "CV", "stage": "documents_pending", "owner": "R. Meena", "is_hot": true,
      "consent_status": "captured", "kyc_status": "in_progress", "sla_state": "on_track" }
  ],
  "meta": { "correlation_id": "corr_...", "pagination": { "page": 1, "limit": 25, "total": 42 } },
  "error": null
}
```

**Hand off to LOS — `POST /api/v1/leads/{id}/handoff`** (with `Idempotency-Key`)
```json
// request
{ "confirm": true }
// 200 success
{ "data": { "lead_code": "LD-2026-000125", "stage": "handed_off", "los_application_id": "LOSAPP-99812",
    "handed_off_at": "2026-06-05T11:20:00+05:30" }, "error": null }
// 400 guard failed (STAGE_GUARD_FAILED)
{ "data": null, "error": { "code": "VALIDATION_ERROR", "message": "Hand-off guards not satisfied.",
    "detail": { "reason": "STAGE_GUARD_FAILED", "failed_guards": ["kyc_signoff","mandatory_docs"] } } }
// replayed idempotency key → original 200 result (no duplicate LOS application)
```

### 8.6 Public (unauthenticated) endpoints

Only these are public (still rate-limited; see auth-matrix equivalent):
`POST /auth/login`, `POST /auth/mfa`, `POST /auth/reset`, public lead capture `POST /public/leads` (QR/website, captcha + rate-limited), customer micro-site `GET/POST /c/{token}/*` (token + OTP), and `POST /los/webhooks/status` (HMAC-signed). Everything else requires a valid JWT.

### 8.7 Integration catalogue

| Integration | Direction | Priority | Purpose | LMS stores |
|---|---|---|---|---|
| LOS eligibility | LMS→LOS | MVP-Must | Read-only indicative eligibility | request/response refs, snapshot, validity |
| LOS hand-off | LMS→LOS | MVP-Must | Create/submit application | LOS app id, status, correlation id, idempotency key |
| LOS status | LOS→LMS / poll | MVP-Must | Application status mirror | status timeline |
| PAN verification | LMS→provider | MVP-Must | Identity verification | masked PAN, status, reference |
| CKYC | LMS→provider | MVP-Should | Retrieve KYC records/identifier | CKYC id/ref, status |
| DigiLocker/e-document | LMS→provider | MVP-Should | Customer documents | document ref/verified e-doc |
| Aadhaar OTP/offline | LMS→provider | MVP-Should | KYC verification | masked/tokenised reference only |
| V-CIP | LMS→provider | Phase 1.5 | Video KYC | session ref, outcome, recording ref |
| Communication | LMS→SMS/WhatsApp/email | MVP-Must | Notifications/reminders | delivery status, template version |
| Telephony/CTI | LMS↔CTI | Phase 1.5 | Calls/disposition | call ref/disposition; recording where allowed |
| Account Aggregator | LMS/LOS→AA/FIU | Phase 1.5 | Consented bank-statement data | consent artefact ref, fetch status |
| GST/GSTIN | LMS/LOS→provider | Phase 1.5 | Business verification | GSTIN status/ref, summary |
| VAHAN/RTO/asset valuation | LMS/LOS→provider | Phase 1.5 | Vehicle/asset verification | asset refs/status |
| Bureau via LOS | LMS→LOS→bureau | Phase 1.5/2 | Consent-based pre-screen | LOS-returned summary flag only |
| Campaign/marketing | external→LMS | MVP-Should | Source attribution | UTM/campaign/source metadata |

All integrations are wrapped by the §6 FR-140 `IntegrationGateway` (idempotency, retry, circuit breaker, IntegrationLog).

## 9. Non-Functional Requirements

| Ref | Category | Requirement |
|---|---|---|
| NFR-01 | Platform | Responsive web/PWA on current Chrome, Edge, Safari, Firefox; mobile-first RM flows |
| NFR-02 | Performance | Dashboard/list ≤ 2.5s normal load; search ≤ 1.5s; **API P95 ≤ 500 ms** for reads, ≤ 800 ms for writes (excluding external provider latency) at agreed volume |
| NFR-03 | Capacity | Design for 3× initial branch/user/lead volume without redesign |
| NFR-04 | Availability | Business-hours availability ≥ 99.5%; graceful degradation when LOS/KYC/comm providers are down |
| NFR-05 | Scalability | Stateless app tier, horizontal scaling (Cloud Run), queue-based integrations |
| NFR-06 | Security | TLS in transit; encryption at rest; field-level encryption/tokenisation for sensitive identifiers; RBAC/ABAC; masking |
| NFR-07 | MFA | Mandatory MFA for privileged (ADMIN/DPO/HEAD) and external (PARTNER) users |
| NFR-08 | Auditability | Append-only, tamper-evident (hash-chained) audit logs; retention per policy |
| NFR-09 | Data residency | Production data stored in India; cross-border processing only if legally approved and logged |
| NFR-10 | Privacy | Purpose limitation, data minimisation, consent ledger, retention + erasure workflow |
| NFR-11 | Backup/DR | Daily backups minimum; RPO ≤ 24h, RTO ≤ 4h unless stricter targets agreed |
| NFR-12 | Low bandwidth | Core mobile flows usable on low bandwidth; compressed images/uploads |
| NFR-13 | Accessibility | WCAG 2.1 AA for core workflows |
| NFR-14 | Observability | Application/audit/integration logs, metrics, alerts, correlation/trace IDs |
| NFR-15 | Resilience | Retries, queues, circuit breakers, idempotency, provider-failure dashboards |
| NFR-16 | Export governance | Masking, watermarking, audit, asynchronous export for large files |
| NFR-17 | Data access | **Every list query carries a server-enforced LIMIT (≤ 100)**; no unbounded scans; parameterised queries only |
| NFR-18 | Document storage | Documents in GCS with signed-URL access, virus scan before availability, classification, never served inline/executed |
| NFR-19 | Testing | Functional, performance, security, VA/PT, integration, UAT, regression before go-live |
| NFR-20 | AI governance readiness | If AI is added later: model registry, human override, explainability, bias testing, monitoring, drift detection, rollback |
| NFR-21 | Maintainability | Configuration over code for products, documents, sources, SLAs, templates, allocation rules |
| NFR-22 | Localisation | INR, IST, Indian date formats, pin/branch hierarchy, regional message templates |

## 10. Workflow & State Diagrams

### 10.1 Canonical lead lifecycle (`lead_stage` enum)

`captured → (consent_pending) → assigned → first_contact_pending → contacted → qualified → documents_pending → kyc_in_progress → eligibility_requested → ready_for_handoff → handed_off`; with branches to `rejected` (terminal unless reopened) and `dormant` (nurture). `handed_off` is terminal in LMS (LOS owns the application; LMS shows read-only status).

### 10.2 Stage definitions

| Stage | Definition | Entry criteria | Exit criteria |
|---|---|---|---|
| captured | Lead exists with minimum info | Valid source, mobile, product interest | Consent captured or pending path chosen |
| assigned | Lead has an owner | Allocation/manual assignment | First contact attempted |
| first_contact_pending | SLA timer running | Owner set | Contact logged or breach/escalation |
| contacted | RM/partner/customer interaction occurred | Call/visit/response logged | Qualified, Docs Pending, Dormant, or Rejected |
| qualified | Product fit & intent established | Product min fields complete | Document request / KYC / eligibility |
| documents_pending | Required docs requested | Checklist generated | Mandatory docs uploaded/waived or rejected |
| kyc_in_progress | KYC checks underway | Docs available or verification initiated | KYC verified, exception, or rejection |
| eligibility_requested | LOS eligibility call made | Min payload + consent | Offer received/pending/failure |
| ready_for_handoff | All guards pass | KYC sign-off, docs, consent, duplicate clear | Handed off to LOS |
| handed_off | LMS terminal; LOS owns application | Successful hand-off | Read-only status updates only |
| rejected | Closed as not proceeding | Rejection reason mandatory | Reopen within window |
| dormant | Future follow-up / low intent | Nurture reason + next date | Reactivate or reject |

### 10.3 State transitions (Current → Action → Next → Guards → Side effects)

| From → To | Allowed roles | Required guards | Side effects |
|---|---|---|---|
| captured → assigned | system, BM, SM | Valid branch/product/source | Owner assigned; first-contact SLA timer starts; LEAD_ASSIGNED |
| assigned → contacted | RM, BM | Contact attempt/disposition logged | First-contact TAT recorded |
| contacted → qualified | RM, BM | Intent/product-fit captured; mandatory progressive fields | Product checklist starts |
| qualified → documents_pending | RM, BM | Product checklist generated | Customer link may be sent (DOC_REQUEST) |
| documents_pending → kyc_in_progress | RM, KYC, BM | Mandatory docs uploaded or waiver exists | KYC verification queue created |
| kyc_in_progress → eligibility_requested | RM/BM/KYC (configured) | KYC sufficient; consent for eligibility/LOS | Eligibility API call; DataSharingLog |
| eligibility_requested → ready_for_handoff | system, BM/KYC | Eligibility received or bypass allowed; docs/KYC ready | Hand-off readiness flag; HANDOFF_READY |
| ready_for_handoff → handed_off | BM/KYC/RM (delegated) | Consent present, duplicate clear, mandatory docs verified/waived, KYC sign-off, valid payload | LOS hand-off; los_application_id stored; LEAD_HANDED_OFF |
| any active → rejected | RM/BM/SM (configured) | Rejection reason + sub-reason | Stage history; notification; reopen window opens |
| rejected → prior active | BM/SM/RM (configured) | Within reopen window; reason | reopened_count++; notifications |
| any active → dormant | RM/BM/SM | Nurture reason + next follow-up date | Nurture task created |
| dormant → assigned/contacted | RM/BM/SM/system | Follow-up due / reactivation | SLA reset per rule |

**Guard enforcement:** every transition runs `StageGuardService`; failure returns `VALIDATION_ERROR` with `detail.reason=STAGE_GUARD_FAILED` and the failing guard(s). Each successful transition writes — in one transaction — a `StageHistory` row (§5.2.43), `AuditLog(stage_transition)`, and `EventOutbox(LEAD_STAGE_CHANGED)`.

### 10.4 Rejection reason taxonomy

Primary reason mandatory (enum `rejection_primary`); sub-reason where applicable; remarks mandatory for `other`:
no_response, not_interested, duplicate, product_unsuitable, low_income, out_of_area, document_incomplete, kyc_mismatch, asset_unacceptable, partner_withdrawal, consent_withdrawn, other.

### 10.5 Other state machines (summary)

- **Document** (`doc_status`): not_required → pending → uploaded → under_review → (verified | mismatch | waived); → expired by validity job.
- **KYCVerification** (`kyc_check_status`): initiated → (success | failed → exception → resolved | waived).
- **Consent** (`consent_state`): granted ↔ withdrawn; granted → expired/superseded (append-only new rows).
- **Grievance** (`grievance_status`): open → in_progress → (escalated) → resolved → closed.
- **ConfigurationVersion** (`config_change_status`): pending → (approved → active | rejected); active → rolled_back.
- **IntegrationLog** (`integration_status`): pending → (success | failed → retrying → success/failed).

## 11. Notification & Communication Requirements

### 11.1 Event matrix

Every notification flows through the dispatch service (FR-101), honours `NotificationPreference` (FR-103) and `ConsentRecord` (FR-110), and (for domain events) is mirrored to `EventOutbox` (FR-141).

| Event code | Recipient | Channels | Trigger | Related FR / entity / consent basis |
|---|---|---|---|---|
| LEAD_CREATED | Owner/BM | in_app/email | Lead captured | FR-010 · Lead · n/a |
| LEAD_ASSIGNED | RM | in_app/email | Assignment/reassignment | FR-030 · Lead · n/a (incl. SLA due) |
| HOT_LEAD | RM/BM | in_app/sms* | Hot flag set | FR-031 · Lead · n/a |
| FIRST_CONTACT_DUE | RM | in_app/email | SLA approaching | FR-104 · Task/Lead |
| FIRST_CONTACT_BREACH | RM/BM/SM | in_app/email | SLA breached | FR-104 · Lead (feeds report) |
| DOC_REQUEST | Customer/Partner | whatsapp/sms/email | Document request sent | FR-070/101 · Document · document_processing |
| DOC_UPLOADED | RM/KYC | in_app | Customer/partner upload | FR-070 · Document |
| DOC_MISMATCH | Customer/RM/BM | in_app/email/whatsapp/sms | Document marked mismatch | FR-072 · Document · document_processing |
| CONSENT_PENDING | RM/Customer | in_app/sms/whatsapp | Required consent missing | FR-110 · ConsentRecord · lead_contact |
| CONSENT_WITHDRAWN | RM/BM/DPO | in_app/email | Customer withdraws consent | FR-110 · ConsentRecord |
| KYC_EXCEPTION | RM/BM/KYC | in_app/email | Exception raised | FR-072 · KYCVerification |
| ELIGIBILITY_RECEIVED | RM/BM | in_app/email | LOS response received | FR-080 · EligibilitySnapshot |
| HANDOFF_READY | BM/KYC/RM-delegated | in_app/email | All guards pass | FR-081 · Lead |
| HANDOFF_FAILED | BM/IT/KYC | in_app/email | LOS hand-off error | FR-081/140 · IntegrationLog |
| LEAD_HANDED_OFF | RM/BM/Customer* | in_app/email/sms | LOS app id created | FR-081 · Lead · communication |
| GRIEVANCE_CREATED | Grievance owner | in_app/email | Complaint raised | FR-114 · Grievance |
| DATA_RIGHT_REQUEST | DPO | in_app/email | Customer request | FR-112 · DataRightsRequest |
| EXPORT_COMPLETED | Requestor | in_app/email | Export ready | FR-122 · ExportJob |
| CONFIG_CHANGED | Admin/Approver | in_app/email | Config version changed | FR-132 · ConfigurationVersion |

\* customer/marketing channels require opt-in + consent.

### 11.2 Communication controls

- Internal users always receive in-app notifications unless disabled by role policy.
- Customer messages are template-based (versioned) and logged in `CommunicationLog`.
- Marketing communication requires separate opt-in from transactional (FR-103); transactional KYC/document reminders are never sent under a marketing basis.
- WhatsApp/SMS/email failure triggers retry/failover per provider policy (FR-140).
- Customer message language follows preference where configured.

## 12. Reporting & Analytics

### 12.1 Metric dictionary

| Metric | Definition | Notes |
|---|---|---|
| Leads Captured | Distinct leads created in period after duplicate handling | Role-scoped |
| Contacted Leads | Leads with ≥ 1 valid call/visit/customer interaction | Contactability base |
| First Contact TAT | Median time assignment → first valid contact | Hot-lead SLA critical |
| Qualified Leads | Leads that reached Qualified at least once | Stage-history based |
| Documents Pending | Leads with ≥ 1 mandatory doc pending | Checklist-based |
| KYC Completed | Leads with required KYC verified | Waivers counted separately |
| Eligibility Requested | Leads sent to LOS eligibility | LOS/API based |
| Ready for Hand-off | Leads satisfying hand-off guards | Guard-based |
| Handed-off | Leads successfully handed to LOS | Terminal in LMS |
| Overall Conversion | Handed-off / Captured | Same filters/scope |
| KYC Conversion | KYC Completed / Documents Pending | Doc/KYC efficiency |
| Source Conversion | Handed-off / Captured by source | Source quality |
| Partner Quality Score | Transparent score (§12.4) | Not a payout engine |
| Duplicate Rate | Duplicate/linked leads / captured | By source/partner/product |
| Rejection Rate | Rejected / Captured | Reason mandatory |
| Active Pipeline | Captured − Handed-off − Rejected | Same period/scope |
| Hand-off Failure Rate | Failed hand-offs / attempted | Integration health |
| Consent Coverage | Leads with required consent for next stage / active leads | Compliance KPI |
| Data Request Open Age | Age of open privacy/rights requests | Compliance SLA |

### 12.2 Sample funnel by product (illustrative, one month, all branches)

| Product | Captured | Qualified | KYC | Handed-off | Conversion % |
|---|---:|---:|---:|---:|---:|
| Commercial Vehicle | 210 | 138 | 93 | 64 | 30.5% |
| Car | 160 | 105 | 68 | 48 | 30.0% |
| Tractor | 130 | 84 | 55 | 39 | 30.0% |
| Construction Equipment | 90 | 58 | 38 | 27 | 30.0% |
| Two Wheeler | 170 | 100 | 57 | 36 | 21.2% |
| Secured Business | 150 | 96 | 65 | 44 | 29.3% |
| Home Renovation – Mortgage | 90 | 59 | 34 | 22 | 24.4% |
| **Total** | **1,000** | **640** | **410** | **280** | **28.0%** |

### 12.3 Sample source performance (illustrative)

| Source | Leads | Handed-off | Conversion % | Interpretation |
|---|---:|---:|---:|---|
| DSA | 280 | 78 | 27.9% | High volume; quality varies by partner |
| Dealer/OEM | 190 | 62 | 32.6% | Strong for vehicle/asset finance |
| Branch Walk-in | 150 | 50 | 33.3% | High intent, capacity-dependent |
| Website/Digital | 160 | 42 | 26.3% | Needs faster first contact |
| Referral | 110 | 28 | 25.5% | Quality depends on referrer tagging |
| Tele-calling | 70 | 8 | 11.4% | Weak; review script/targeting |
| Field/Feet-on-Street | 40 | 12 | 30.0% | Small volume, good conversion |
| **Total** | **1,000** | **280** | **28.0%** | |

### 12.4 DSA/dealer quality score formula (configurable)

```
contactability_index   = contactable_leads / leads * 100
duplicate_penalty       = duplicate_leads / leads * 100
rejection_penalty       = rejected_leads / leads * 100
handoff_index           = handed_off / leads * 100
document_quality_index  = verified_docs_first_time / uploaded_docs * 100
speed_index             = min(partner_median_doc_tat) / partner_median_doc_tat * 100

partner_quality_score = round(
    0.25 * contactability_index
  + 0.30 * handoff_index
  + 0.20 * document_quality_index
  + 0.15 * speed_index
  - 0.05 * duplicate_penalty
  - 0.05 * rejection_penalty )
```
Rules: used for operational review/coaching; does not determine payout unless a separate approved module consumes it; must show factor breakdown; written to `Partner.quality_score`.

### 12.5 Reconciliation rules

- Captured = Active + Rejected + Handed-off, within the same period/scope.
- Stage counts monotonic when computed as stage-reached funnel.
- Rates recomputed from summed numerator/denominator, never averaged.
- Product/source/partner breakdowns reconcile to the total.
- The same metric under the same filters must match across dashboard and reports.
- Funnel stage-reached counts and stage dwell/TAT derive from the single `StageHistory` read-model (§5.2.43), so dashboards (FR-053) and reports (FR-120/121) cannot diverge.
- Zero denominator displays "–", not 0%.

### 12.6 Report data sources & governance

All reports are parameterised aggregate reads over §5 entities (`Lead`, `StageHistory`, `SourceAttribution`, `DuplicateMatch`, `KYCVerification`, `Document`, `CommunicationLog`, `IntegrationLog`, `ConsentRecord`), scope-filtered (FR-002), exported under governance (FR-122). Heavy queries run asynchronously as `ExportJob`. Where available, reporting uses read replicas to protect OLTP latency (NFR-02).

## 13. Migration & Launch Plan

### 13.1 Data migration

- Historic lead/customer migration is a **separate workstream** (Assumption §2.5.6). If included, migrate into `Lead`/`LeadIdentity`/`CustomerProfile`/`SourceAttribution` with a `migration` creation_channel, duplicate check on import, and a reconciliation report. Consent for migrated records must be re-established or carry documented legal basis before any outbound communication.
- Master data (branches, users, teams, products, sources, partners, SLAs, document lists, rejection reasons, templates) is loaded first via FR-130/131 and validated before lead onboarding.

### 13.2 Phased rollout

| Increment | Deliverables | Modules |
|---|---|---|
| 1 | Auth/RBAC/ABAC, user/branch/team master, basic lead capture, source master, lead list | M1, M2, M6(list) |
| 2 | Product config + seven products, product forms, document checklist, Lead 360 | M5, M6, M8(docs) |
| 3 | Duplicate detection, allocation rules, tasks, pipeline board, SLA engine, dashboard, search | M3, M4, M6, M11(SLA) |
| 4 | Consent ledger, customer self-service link, communication templates/provider, notification prefs | M7, M11, M12(consent) |
| 5 | KYC workbench, PAN integration, document verification, KYC exceptions | M8 |
| 6 | LOS eligibility, hand-off, status mirror, integration framework + monitor, event outbox | M9, M15 |
| 7 | Reports/MIS, partner console + quality, export governance, compliance console, audit explorer, retention engine | M10, M12, M13 |
| 8 | Hardening: security/VA-PT, performance, UAT, migration, training, go-live readiness | all |

### 13.3 Go-live checklist

- Master data loaded & validated; roles/users configured.
- Products/checklists/SLAs approved; consent text & privacy notices approved; templates approved in required languages.
- LOS/KYC/communication integrations tested in a production-like environment.
- VA/PT completed and critical gaps closed.
- Audit/export governance tested; retention policies configured.
- UAT sign-off by Sales, Ops, Compliance, IT, and selected branch users.
- Training material/SOPs ready; hypercare owners assigned.

## 14. Traceability, Dependency & Parallel Agent Plan

### 14.1 FR traceability matrix

Roles abbreviated per §3.1. "Entities" lists primary writes; "Events" lists emitted notifications/domain events.

| FR | Title | Roles | Screen(s) | API | Entities | Workflow | Events | Tests |
|---|---|---|---|---|---|---|---|---|
| FR-001 | Login/MFA | all | Login & MFA | /auth/* | User | — | login/login_failed | unit+API+E2E |
| FR-002 | ABAC | all | (cross-cutting) | all | RolePermission | — | unmask audit | unit+API |
| FR-003 | Break-glass | ADMIN/DPO | Compliance Console | /admin/break-glass | BreakGlassGrant | grant→active→expire | break_glass_access | unit+API |
| FR-010 | Omnichannel capture | RM/BM/SM/PARTNER | Capture, Bulk Import | /leads, /leads/import | Lead/LeadIdentity/SourceAttribution | captured | LEAD_CREATED | unit+API+E2E |
| FR-011 | Enrichment/score | RM | Lead 360 | /leads | Lead(score) | — | — | unit+API |
| FR-020 | Duplicate detect | RM/BM/SM | Duplicate modal/queue | /leads/{id}/duplicate-check | DuplicateMatch | — | — | unit+API |
| FR-021 | Merge | BM/SM | Merge dialog | /leads/{id}/merge | Lead(master) | — | lead_merge | unit+API |
| FR-030 | Allocation | BM/SM | Allocation admin, reassign | /leads/{id}/reassign | Lead(owner) | assigned | LEAD_ASSIGNED | unit+API |
| FR-031 | Hot/score | system/RM | Lead 360 | /leads | Lead(is_hot) | — | HOT_LEAD | unit+API |
| FR-040 | Product config | ADMIN/ProdOps | Admin Settings | /admin/products | ProductConfig/ConfigVersion | — | CONFIG_CHANGED | unit+API |
| FR-041 | Launch products | ProdOps | Admin Settings | /admin/products | ProductConfig×7 | — | — | API |
| FR-042 | Scheme | ProdOps/RM | Lead 360, Scheme admin | /admin/schemes | Scheme | — | — | unit+API |
| FR-050 | List/queues | RM/BM/SM/KYC | Lead Inbox | /leads, /saved-views | SavedView | — | — | API+E2E |
| FR-051 | Lead 360 | RM/BM/KYC/DPO | Lead 360 | /leads/{id} | (read) | — | — | API+E2E |
| FR-052 | Pipeline board | RM/BM/SM | Pipeline Board | /leads/{id}/stage | Lead(stage) | all transitions | LEAD_STAGE_CHANGED | unit+API+E2E |
| FR-053 | Dashboard | RM/BM/SM/HEAD | Dashboard | /dashboard | (read) | — | — | API+E2E |
| FR-054 | Global search | internal | (top bar) | /search | (read) | — | — | API+E2E |
| FR-060 | Customer link | RM/BM/KYC/CUST | Customer Link Mgmt, Micro-site | /leads/{id}/customer-link, /c/{token} | CustomerLink/Document | — | link_create/open | API+E2E |
| FR-061 | Cust grievance | CUST | Micro-site, Compliance | /c/{token}/grievance | Grievance | grievance open | GRIEVANCE_CREATED | API |
| FR-062 | Cust status/callback | CUST | Micro-site | /c/{token}/status | Task(callback) | — | — | API |
| FR-070 | Doc checklist/upload | RM/KYC/BM/CUST/PARTNER | KYC Workbench, Micro-site | /leads/{id}/documents | Document | documents_pending | DOC_UPLOADED/REQUEST | unit+API |
| FR-071 | KYC orchestration | KYC/BM | KYC Workbench | /leads/{id}/kyc/{type} | KYCVerification | kyc_in_progress | KYC_EXCEPTION | unit+API |
| FR-072 | KYC exception | KYC/BM | KYC Workbench | /leads/{id}/kyc/{kid}/resolve | KYCVerification | — | KYC_EXCEPTION | unit+API |
| FR-080 | Eligibility | RM/BM | Lead 360 | /leads/{id}/eligibility | EligibilitySnapshot | eligibility_requested | ELIGIBILITY_RECEIVED | unit+API |
| FR-081 | LOS hand-off | BM/KYC/RM | Lead 360 | /leads/{id}/handoff | Lead/LOSMirror/DataSharingLog | handed_off | HANDOFF_READY/FAILED, LEAD_HANDED_OFF | unit+API |
| FR-082 | LOS status mirror | RM/BM | Lead 360 | /los/webhooks/status | LOSApplicationMirror | — | — | API |
| FR-090 | Partner master | BM/SM/ADMIN | Partner Management | /partners | Partner | — | — | API |
| FR-091 | Partner submission | PARTNER | Partner Console | /partners/leads | Lead/SourceAttribution | captured | LEAD_CREATED | API |
| FR-092 | Partner quality | BM/SM/HEAD/PARTNER | Partner dashboard | /partners/{id}/quality | Partner(score) | — | — | unit+API |
| FR-100 | Tasks | RM/BM/SM/KYC | Tasks | /tasks | Task | — | overdue | unit+API |
| FR-101 | Templates/comms | ADMIN/RM/BM | Template mgr, Lead 360 | (dispatch) | CommunicationLog | — | DOC_REQUEST etc | unit+API |
| FR-102 | Telephony/visit | RM/BM | Tasks, visit logger | /tasks | Task(geo) | — | — | API+E2E |
| FR-103 | Notif prefs | RM/BM/CUST | Preference centre | /preferences | NotificationPreference | — | — | unit+API |
| FR-104 | SLA engine | ADMIN/system | SLA admin | /admin/sla | SLAPolicy/Lead(sla) | — | FIRST_CONTACT_DUE/BREACH | unit+API |
| FR-110 | Consent ledger | RM/CUST/DPO | Consent panel, Compliance | /leads/{id}/consents | ConsentRecord | gates transitions | CONSENT_PENDING/WITHDRAWN | unit+API |
| FR-111 | Data minimisation | system/DPO | Compliance Console | (cross-cutting) | DataSharingLog | — | — | unit+API |
| FR-112 | Rights/retention | CUST/DPO | Compliance Console | /data-rights | DataRightsRequest | — | DATA_RIGHT_REQUEST | API |
| FR-113 | DLA/LSP registry | DPO/ADMIN | Compliance Console | /compliance/dla | DLARegistry | — | — | API |
| FR-114 | Grievance workflow | all/owner | Compliance Console | /grievances | Grievance | grievance lifecycle | GRIEVANCE_CREATED | API |
| FR-115 | Retention engine | system/DPO | Retention review | (scheduled) | RetentionPolicy | purge/anonymise | — | unit+integration |
| FR-120 | Core reports | RM/BM/SM/HEAD | Reports & MIS | /reports/{code} | (read) | — | — | unit+API |
| FR-121 | Differentiator reports | mgmt | Reports & MIS | /reports/{code} | (read) | — | — | unit+API |
| FR-122 | Export governance | mgmt/DPO | Reports, approval queue | /exports | ExportJob | — | EXPORT_COMPLETED | API |
| FR-123 | Audit explorer | DPO/ADMIN | Audit Explorer | /audit | (read AuditLog) | — | — | unit+API |
| FR-130 | User/role admin | ADMIN | Admin Settings | /admin/users | User/Role/Team/Branch | — | user_change | API |
| FR-131 | Master config | ADMIN/ProdOps | Admin Settings | /admin/* | master entities | — | CONFIG_CHANGED | API |
| FR-132 | Config governance | ADMIN/checker | Approval queue | /admin/config | ConfigurationVersion | config lifecycle | CONFIG_CHANGED | API |
| FR-140 | Integration framework | system/IT | Integration Monitor | /admin/integrations | IntegrationLog/WebhookSubscription | — | HANDOFF_FAILED | unit+API |
| FR-141 | Event outbox | system | (internal) | (internal) | EventOutbox | — | all domain events | unit+integration |

### 14.2 Feature dependency map

**Foundation (build first — no dependents can merge before these):** FR-001, FR-002 (auth/ABAC), FR-130/131/132 (users + master data + config governance), FR-140/141 (integration + outbox), §5 data model + §5.5 enums.

| FR group | Depends on | Can run parallel with | Notes |
|---|---|---|---|
| Capture (FR-010/011) | FR-001/002, FR-040/041 (products), FR-131 (sources/partners) | FR-090 (partner master can mock) | duplicate check (FR-020) can be stubbed initially |
| Identity resolution (FR-020/021) | FR-010 | FR-030 | merge needs AuditLog |
| Allocation (FR-030/031) | FR-010, FR-104 (SLA) | FR-020 | SLA engine can be stubbed then replaced |
| Product config (FR-040/041/042) | FR-132 | independent | foundation for capture |
| Workspace (FR-050–054) | FR-002, FR-010, FR-051 reads many | each other | dashboard/search read-only |
| Customer self-service (FR-060/061/062) | FR-070 (docs), FR-110 (consent), FR-101 (send) | — | public surface; rate-limit early |
| KYC/docs (FR-070/071/072) | FR-040 (checklist), FR-140 (providers) | — | providers behind IntegrationGateway |
| LOS (FR-080/081/082) | FR-070/071, FR-110, FR-140 | — | hand-off needs guards from many FRs |
| Partner (FR-090/091/092) | FR-010, FR-131 | capture | quality needs reporting (FR-092 after FR-120) |
| Tasks/comms (FR-100–104) | FR-110 (consent), FR-103 prefs | — | SLA engine (FR-104) is shared foundation |
| Compliance (FR-110–115) | FR-001/002, AuditLog | — | consent gates many transitions; build early |
| Reporting (FR-120–123) | most write FRs (data to report on) | — | build after data-producing FRs |
| Integration/events (FR-140/141) | FR-001 | — | foundation; everything emits to outbox |

### 14.3 Agent assignment guidance

Recommended parallel agent groups (each owns its module's entities; consumes shared via service interfaces):

| Agent | Owns (write) | Consumes (read/service) |
|---|---|---|
| A1 Platform | M1 (User/Role/Branch/Team/Region/BreakGlass), EntitlementService, AuditLog | — |
| A2 Capture & Identity | M2, M3 (Lead/LeadIdentity/CustomerProfile/SourceAttribution/DuplicateMatch) | A1, A5 (products), A8 (partners) |
| A3 Product & Config | M5, M14 (ProductConfig/Scheme/SLAPolicy/RejectionReason/ConfigurationVersion) | A1 |
| A4 Workspace | M6 (SavedView), dashboard/search read models | A2, A1 |
| A5 KYC & Docs | M8 (Document/KYCVerification) | A2, A9 (integration), A3 |
| A6 LOS | M9 (Eligibility/LOSMirror) | A5, A7 (consent), A9 |
| A7 Compliance | M12 (Consent/DataSharing/Grievance/Rights/DLA/Retention) | A1, A2 |
| A8 Partner & Self-service | M10 (Partner), M7 (CustomerLink) | A2, A5, A7 |
| A9 Integration & Comms | M15 (IntegrationLog/Webhook/Outbox), M11 (Task/Template/CommLog/Notification/Pref/SLAEngine) | A1 |
| A10 Reporting | M13 (read models, ExportJob, audit explorer) | all (read-only) |

### 14.4 Integration checkpoints

1. **After foundation (A1, A3, A9-core):** freeze §5 schema, §5.5 enums, §8.4 error catalog, §4 conventions. All later agents pin this version.
2. **After capture + identity (A2):** reconcile Lead lifecycle, duplicate/merge effects, outbox events.
3. **After KYC + LOS (A5, A6):** reconcile hand-off guards, IntegrationGateway contracts, consent gates.
4. **After compliance (A7):** verify consent gating across all transitions and retention/legal-hold exclusions.
5. **Before reporting (A10):** verify metric definitions reconcile (§12.5) against produced data.
6. **Pre-go-live:** full cross-FR review (§13.3) + regression scenarios (§14.7).

### 14.5 Shared-contract change rule

If any agent needs a new field, enum value, error code, endpoint, or shared component: update the relevant top-level section (§4/§5/§8) **first**, bump this document's version + Amendments log, then update the affected FR LLDs. No code referencing an unregistered contract may merge.

### 14.6 Conflict-resolution protocol

When two agents propose incompatible changes to the same shared contract (entity/enum/API/error code/shared component):
1. The change is **paused**; neither version is merged.
2. It is routed to the **arbiter — the Lead Architect Agent (human Tech Lead as fallback)**.
3. The arbiter selects one canonical version; the document version is bumped and the change logged in the Amendments log (date, FRs affected, rationale).
4. All dependent agents **re-pull** the updated contract before resuming.
5. No agent may merge a feature whose LLD references a contract version older than the current document version.

### 14.7 Regression scenarios (must pass before go-live)

Duplicate lead from DSA + branch walk-in; customer withdraws marketing but keeps KYC consent; customer withdraws los_handoff consent before hand-off; provider downtime during PAN verification; hand-off succeeds but webhook delayed (poll reconciles); RM deactivated with open leads; product checklist version changes while leads in progress; customer link expired + resent; large export by BM masked correctly; partner attempts to view another partner's lead (denied); ADMIN attempts lead-content access without break-glass (denied); idempotent hand-off replay creates no duplicate LOS application; retention purge skips legal-hold rows.

### 14.8 Final Contract Reconciliation Table

Proves every FR has a data-model home, an API contract, a UI surface, a permission, tests, and (where applicable) workflow/notification/report references. `Y` = present; `n/a` = not applicable by design.

| FR | Data model | API | UI | Permission | Workflow | Notification | Report | Tests |
|---|---|---|---|---|---|---|---|---|
| FR-001 | Y | Y | Y | Y | n/a | Y | n/a | Y |
| FR-002 | Y | Y | Y | Y | n/a | n/a | n/a | Y |
| FR-003 | Y | Y | Y | Y | Y | n/a | n/a | Y |
| FR-010 | Y | Y | Y | Y | Y | Y | Y | Y |
| FR-011 | Y | Y | Y | Y | n/a | n/a | n/a | Y |
| FR-020 | Y | Y | Y | Y | n/a | n/a | Y | Y |
| FR-021 | Y | Y | Y | Y | n/a | Y | Y | Y |
| FR-030 | Y | Y | Y | Y | Y | Y | Y | Y |
| FR-031 | Y | Y | Y | Y | n/a | Y | Y | Y |
| FR-040 | Y | Y | Y | Y | n/a | Y | n/a | Y |
| FR-041 | Y | Y | Y | Y | n/a | n/a | n/a | Y |
| FR-042 | Y | Y | Y | Y | n/a | n/a | n/a | Y |
| FR-050 | Y | Y | Y | Y | n/a | n/a | n/a | Y |
| FR-051 | Y | Y | Y | Y | n/a | n/a | n/a | Y |
| FR-052 | Y | Y | Y | Y | Y | Y | n/a | Y |
| FR-053 | Y | Y | Y | Y | n/a | n/a | Y | Y |
| FR-054 | Y | Y | Y | Y | n/a | n/a | n/a | Y |
| FR-060 | Y | Y | Y | Y | n/a | Y | n/a | Y |
| FR-061 | Y | Y | Y | Y | Y | Y | Y | Y |
| FR-062 | Y | Y | Y | Y | n/a | n/a | n/a | Y |
| FR-070 | Y | Y | Y | Y | Y | Y | Y | Y |
| FR-071 | Y | Y | Y | Y | Y | Y | n/a | Y |
| FR-072 | Y | Y | Y | Y | Y | Y | Y | Y |
| FR-080 | Y | Y | Y | Y | Y | Y | n/a | Y |
| FR-081 | Y | Y | Y | Y | Y | Y | Y | Y |
| FR-082 | Y | Y | Y | Y | n/a | n/a | Y | Y |
| FR-090 | Y | Y | Y | Y | n/a | n/a | n/a | Y |
| FR-091 | Y | Y | Y | Y | Y | Y | n/a | Y |
| FR-092 | Y | Y | Y | Y | n/a | n/a | Y | Y |
| FR-100 | Y | Y | Y | Y | n/a | Y | Y | Y |
| FR-101 | Y | Y | Y | Y | n/a | Y | Y | Y |
| FR-102 | Y | Y | Y | Y | n/a | n/a | Y | Y |
| FR-103 | Y | Y | Y | Y | n/a | n/a | n/a | Y |
| FR-104 | Y | Y | Y | Y | Y | Y | Y | Y |
| FR-110 | Y | Y | Y | Y | Y | Y | Y | Y |
| FR-111 | Y | Y | Y | Y | n/a | n/a | n/a | Y |
| FR-112 | Y | Y | Y | Y | n/a | Y | Y | Y |
| FR-113 | Y | Y | Y | Y | n/a | n/a | Y | Y |
| FR-114 | Y | Y | Y | Y | Y | Y | Y | Y |
| FR-115 | Y | Y | Y | Y | Y | n/a | Y | Y |
| FR-120 | Y | Y | Y | Y | n/a | n/a | Y | Y |
| FR-121 | Y | Y | Y | Y | n/a | n/a | Y | Y |
| FR-122 | Y | Y | Y | Y | n/a | Y | Y | Y |
| FR-123 | Y | Y | Y | Y | n/a | n/a | Y | Y |
| FR-130 | Y | Y | Y | Y | n/a | Y | n/a | Y |
| FR-131 | Y | Y | Y | Y | n/a | Y | n/a | Y |
| FR-132 | Y | Y | Y | Y | Y | Y | n/a | Y |
| FR-140 | Y | Y | Y | Y | Y | Y | Y | Y |
| FR-141 | Y | Y | n/a | Y | n/a | Y | Y | Y |

**Unresolved gaps: 0.** Every FR maps to ≥1 entity in §5, an API in §8, a permission in §3.3, and tests in its LLD; workflow/notification/report columns are `Y` where the FR participates and `n/a` only where it genuinely does not apply (e.g., FR-141 has no end-user UI; FR-002 is cross-cutting middleware).

## 15. Glossary

| Term | Definition |
|---|---|
| NBFC | Non-Banking Financial Company |
| LMS | Lead Management System (this product) |
| LOS | Loan Origination System (owns credit decisioning/disbursement) |
| RM / BM / SM | Relationship Manager / Branch Manager / Sales Manager |
| HEAD | Sales / Business Head |
| DSA | Direct Selling Agent |
| Dealer / OEM | Vehicle/equipment dealer or original equipment manufacturer source |
| Connector / Referral | Lead-referral partner types |
| DLA | Digital Lending App/interface |
| LSP | Lending Service Provider |
| KYC | Know Your Customer |
| CKYC / CKYCR | Central KYC / Central KYC Records Registry |
| V-CIP | Video-based Customer Identification Process |
| DPDPA | Digital Personal Data Protection Act, 2023 |
| DPO | Data Protection Officer |
| PII / SPII | Personal / Sensitive Personal Information |
| BRE | Business Rule Engine (credit) — out of LMS scope |
| LTV | Loan-to-Value |
| FOIR | Fixed Obligation to Income Ratio |
| TAT | Turnaround Time |
| SLA | Service Level Agreement |
| AA | Account Aggregator |
| FIU / FIP | Financial Information User / Provider |
| KFS | Key Fact Statement (LOS-owned) |
| ABAC / RBAC | Attribute- / Role-Based Access Control |
| MFA | Multi-Factor Authentication |
| PWA | Progressive Web Application |
| ABAC attribute | branch/team/region/product/source/partner/classification used in entitlement decisions |
| Idempotency key | Client-supplied key making a state-creating call safe to replay |
| Transactional outbox | Pattern writing domain events in the same DB transaction as the state change |
| Break-glass | Time-bound, approved, audited emergency access to data otherwise out of scope |
| Hash-chained audit | Audit rows linked by `prev_audit_hash` for tamper evidence |
| StageHistory | Append-only lead stage-transition read-model; single source for funnel/TAT/dwell metrics |
| Subvention | Interest or price subsidy funded by a manufacturer/dealer/scheme; non-credit metadata only — the LMS does not compute pricing |
| UTM | Urchin Tracking Module parameters (source/medium/campaign/term/content) tagging a lead's digital origin (FR-010, SourceAttribution) |
| QR lead form | A scannable QR code that opens a public lead-capture form — an FR-010 capture channel |
| Geotag | Latitude/longitude (+accuracy) captured with a field visit, consent- and permission-bound (FR-102) |
| Missed-call capture | Lead creation triggered by a customer's missed call via telephony integration (FR-010 channel) |
| Circuit breaker | Resilience pattern that stops calling a failing provider until it recovers (FR-140) |
| Round-robin | Allocation method distributing leads evenly in rotation across an RM pool (FR-030) |

## 16. Appendices

### 16.1 Appendix A — Compliance & regulatory anchors for product design

This appendix turns regulatory expectations into product requirements. It is not a legal opinion; the NBFC's legal/compliance teams validate final wording.

**A.1 Digital lending readiness** — consent need-based/prior/explicit/auditable (FR-110); avoid unnecessary device resources (FR-111); customer can deny/restrict/revoke/erase subject to retention (FR-112); storage/retention/destruction/breach/privacy references configurable & auditable (FR-115, NFR-08/09/10); DLA/LSP/customer-care/grievance details available on customer-facing channels (FR-113/061); internal DLA/LSP registry export for compliance (FR-113).

**A.2 KYC design controls** — KYC methods configurable per product/customer type (FR-040/071); CKYC capture/retrieval where available; digital KYC / V-CIP / DigiLocker / Aadhaar OTP-offline / PAN / manual orchestrated, final interpretation per NBFC policy; raw Aadhaar & biometrics never stored (FR-071/111); V-CIP readiness includes trained-official assignment, liveness/spoof, audit, secure infra (FR-071, Phase 1.5).

**A.3 Data protection controls** — purpose-wise consent ledger (FR-110); notice/text versioning; rights workflow (FR-112); retention/deletion/anonymisation (FR-115); data-sharing ledger (FR-111); role-based masking + export governance (FR-002/122).

**A.4 AI & scoring guardrails** — MVP lead score is rules-based and explainable (FR-011/031); LMS must not auto-approve/auto-reject credit; any future AI requires business/model owner, approval, training-data lineage, explainability, bias testing, monitoring, drift detection, human override, fallback rule (NFR-20).

### 16.2 Appendix B — Open decisions log

| Ref | Open decision | Recommended default | Owner |
|---|---|---|---|
| OD-01 | Duplicate action by match type | Block strong PAN+mobile; warn medium; queue weak | Sales + Compliance |
| OD-02 | PAN mandatory timing | Progressive; mandatory before KYC/hand-off (per product) | Compliance + Sales |
| OD-03 | Hand-off owner | BM default; configurable delegation to KYC/Ops or authorised RM | Sales Head + Ops |
| OD-04 | Hot-lead rules | priority High OR amount threshold OR returning OR docs submitted | Sales Head |
| OD-05 | SLA thresholds | First contact: hot 2 business hours, normal 1 business day; documents 3 business days | Sales Ops |
| OD-06 | Consent purpose list & text | §5.5 consent_purpose enum + NBFC-approved text | Legal/DPO |
| OD-07 | DLA/LSP registry scope | Track all customer-facing digital lead/application interfaces | Compliance |
| OD-08 | CKYC/DigiLocker provider | Select provider & integration method | IT + Compliance |
| OD-09 | V-CIP in MVP vs Phase 1.5 | Phase 1.5 unless provider/SOP ready | Ops + Compliance |
| OD-10 | Account Aggregator scope | Phase 1.5 for Secured Business & Mortgage | Product + IT |
| OD-11 | Offline field mode | Phase 1.5 unless rural/field is launch-critical | Sales + IT |
| OD-12 | Export approval thresholds | Approval for > 10,000 rows or unmasked PII/SPII | Compliance + IT |
| OD-13 | Regional language support | Hindi + top 2 state languages for pilot regions | Sales Ops |
| OD-14 | Data retention by outcome | Legal/compliance-defined by category & product | DPO + Legal |
| OD-15 | Partner portal scope | MVP limited submission/status; full portal Phase 1.5 | Channel Head |
| OD-16 | Tech stack confirmation | React/TS + NestJS + PostgreSQL + Cloud Run (§4.1 defaults) | IT/Architecture |
| OD-17 | India messaging registration | Register TRAI DLT principal-entity + SMS sender headers/content templates and WhatsApp BSP/WABA + per-template approval before go-live; FR-060/101 outbound messages must use pre-approved templates, not free-form text | Compliance + IT + Marketing |

### 16.3 Appendix C — Regulatory reference notes (verify latest before sign-off)

1. **RBI (Digital Lending) Directions, 2025** — consented/need-based data collection, no unnecessary mobile-resource access, storage/privacy controls, DLA/LSP reporting, grievance redressal, KFS/disclosures. https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12848&Mode=0
2. **RBI Master Direction — KYC, 2016** (updated 14 Aug 2025) — CKYCR, digital KYC, Aadhaar OTP e-KYC limits, V-CIP, liveness/spoof, audit trail, secure infrastructure. https://www.rbi.org.in/commonman/english/scripts/notification.aspx?id=2607
3. **Digital Personal Data Protection Act, 2023 (MeitY)** — consent, correction/updating/erasure, grievance redressal, nomination, duties of Data Principal. https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf
4. **Digital Personal Data Protection Rules, 2025 (MeitY)** — commencement, verifiable consent, techno-legal measures, phased implementation. https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf
5. **Sahamati — Account Aggregator ecosystem** — consent-based financial data sharing, FIU/FIP participation, AA readiness. https://sahamati.org.in/

### 16.4 Appendix D — Final product recommendation

Build and sell the V5 LMS as a **front-office origination control tower for NBFCs**, not a generic lead tracker. Differentiators: (1) omnichannel, partner-aware capture; (2) rules-based allocation + SLA discipline; (3) customer self-service for consent/documents; (4) product-configurable NBFC capture/checklist engine; (5) consent/data-sharing/DLA-LSP/grievance/audit readiness; (6) a strong LOS boundary with clean, idempotent hand-off; (7) DSA/dealer quality analytics; (8) mobile field usability; (9) an AI-ready event model without unsafe automated credit decisions.

---

*End of Business Requirements Document — Version 5.0.*

