# Lead Management System for NBFCs in India — Business Requirements Document

**Version:** 4.0  
**Document type:** Business Requirements Document (BRD) / Product Requirement Baseline  
**Product/System:** Lead Management System (LMS) for NBFC originations and pre-origination sales  
**Market focus:** Indian NBFCs across asset finance, mortgage-backed lending, secured business lending, and branch/DSA/dealer-led distribution  
**Status:** Revised Version 4 — strengthened for market differentiation, regulatory readiness, and AI-buildable delivery  
**Date:** 04 June 2026  
**Classification:** Confidential — for client review and sign-off  

> **Important note:** This document is a product and business requirements baseline. Regulatory references are included for product design context; final compliance wording and operational interpretation must be validated by the NBFC's legal, compliance, information security, and risk teams before release.

---

## 0. Version 4 Executive Change Log

Version 3.3 was a solid MVP baseline: it defined role-based access, lead capture, product-specific checklists, KYC, pipeline, tasks, MIS, consent, audit, and read-only LOS hand-off/status. Version 4 makes the document stronger for the Indian NBFC market by changing the LMS from a generic lead tracker into a **regulated, partner-aware, consent-led, field-sales-ready origination front office**.

### 0.1 High-impact additions in Version 4

| Area | Version 4 enhancement | Why it matters for Indian NBFCs |
|---|---|---|
| Omnichannel acquisition | Manual, bulk upload, branch walk-in, website/API, QR lead forms, missed-call callback, dealer/OEM, DSA, field RM, and campaign/UTM lead sources | NBFC distribution is fragmented; market differentiation comes from clean capture across branches, DSAs, dealers, digital, and field teams |
| Partner/dealer/DSA management | Lightweight DSA/dealer lead submission, source attribution, duplicate control, lead quality score, rejection analytics, and partner SLA visibility | Reduces leakage, improves channel ROI, and creates accountability without building a full payout portal in MVP |
| Consent and privacy ledger | Purpose-wise consent, communication preference, third-party sharing consent, revocation, data-rights request tracking, and audit trail | Moves beyond simple DPDPA checkbox; creates compliance evidence and customer trust |
| RBI Digital Lending readiness | DLA/LSP registry, grievance officer details, data-minimization controls, no unconsented phone-resource access, storage/residency controls, and audit evidence | Helps NBFCs operate LMS as a responsible digital lending interface, not just a CRM |
| Product configuration | Configurable product capture forms, document checklists, SLA thresholds, mandatory fields, and source/DSA rules — without configuring credit policy or BRE | Hard-coding seven products is too rigid for NBFCs with changing schemes, dealers, branches, and asset segments |
| Customer self-service links | Secure customer web link for consent, document upload, status check, callback scheduling, and grievance initiation | Reduces RM follow-up workload and improves document TAT |
| KYC orchestration | PAN, CKYC identifier, DigiLocker/e-document, Aadhaar verification token handling, V-CIP readiness, masked identifiers, and manual exception workflow | More practical than only PAN + Aadhaar OTP; supports varied NBFC operating models |
| Smart allocation | Rules-based allocation by branch, pin code, product, RM capacity, language, partner, SLA, and hot-lead priority | Improves first-contact speed and fairness without requiring ML in MVP |
| Pre-screening support | Rules-based lead quality score, LOS-owned eligibility call, consented bank-statement/AA readiness, GST/business-document readiness, and bureau-readiness via LOS only | Helps identify high-intent and low-friction leads without putting underwriting inside LMS |
| Field-sales mode | Mobile-responsive PWA, low-bandwidth screens, visit geotagging, image compression, offline draft capture, and visit/task route planning | Essential for branch, rural, semi-urban, vehicle, tractor, and equipment finance teams |
| API and data model | Reintroduced integration contracts, canonical entities, event model, idempotency, webhook reconciliation, and audit/error logging | Version 3.3 had removed data/API details; Version 4 restores buildability |
| Advanced MIS | DSA/dealer quality, first-contact SLA, KYC ageing, duplicate leakage, source ROI, contactability, stage ageing, and product/branch heatmaps | Differentiates sales operations from basic funnel reporting |
| AI-ready but safe | Event instrumentation, explainable rule scores, human override, model governance hooks; AI features remain Phase 2 unless explicitly approved | Makes the product future-ready without turning LMS into an automated credit decision system |

### 0.2 Items modified or eliminated from Version 3.3

| Version 3.3 treatment | Version 4 decision | Rationale |
|---|---|---|
| All AI/ML capabilities fully out of scope | Keep AI underwriting out of scope, but add transparent rules-based scoring and AI-ready telemetry in MVP; optional AI modules in Phase 2 | A modern NBFC LMS must at least support explainable prioritisation and future AI readiness |
| No product configuration UI | Add limited product/admin configuration for capture fields, document checklists, SLAs, schemes, sources, and communication templates; keep credit policy/BRE out of LMS | Product capture changes more often than credit policy; hard-coded forms reduce market fit |
| Native mobile app out of scope | Keep native app out of MVP, but add mobile-first PWA and field-sales mode; offline sync as MVP stretch or Phase 1.5 | NBFC field acquisition needs mobile usability even if native apps are deferred |
| Campaign and DSA portal out of scope | Keep full campaign automation and payout out of scope; add campaign tags, UTM, partner lead intake, DSA quality, and dealer attribution in MVP | Channel attribution is core to NBFC lead management |
| Admin cannot view lead data; only Admin sees audit | Add Compliance/DPO role with masked read-only compliance view; keep System Admin separated from lead data | Better segregation of duties and audit usefulness |
| BM-only hand-off to LOS | Allow configurable hand-off owners: BM, KYC Supervisor, or authorised RM within delegation limits; all hand-offs require guards and audit | BM-only workflow can bottleneck high-volume branches |
| PAN at capture ambiguity | Use progressive capture: mobile + consent + source mandatory at creation; PAN required before KYC/eligibility/LOS hand-off unless product policy says otherwise | Many field leads do not have PAN at first contact; blocking capture causes leakage |
| Product examples in reports inconsistent with seven products | Replaced report samples with Version 4 product set: Commercial Vehicle, Car, Tractor, Construction Equipment, Two Wheeler, Secured Business, Home Renovation - Mortgage | Removes internal inconsistency |
| Disbursed amount/AUM dashboard vision tiles inside MVP logic | Move disbursed/AUM into Phase 2/read-only LOS/core mirror only | LMS should not pretend to own post-disbursement metrics unless downstream feeds exist |
| KYC = PAN + Aadhaar OTP only | Add CKYC, DigiLocker/e-document, V-CIP readiness, masked identifiers, and exception handling | More aligned with practical KYC flows |
| No data model/API sections | Reintroduced canonical data model and API/event requirements | Necessary for AI-buildable delivery |

---

## 1. Critical Analysis of Version 3.3

### 1.1 Strengths retained in Version 4

Version 3.3 had a good foundation and should not be discarded. The following elements are retained and strengthened:

1. **Clear boundary with LOS:** LMS owns lead capture, qualification, KYC collection, tasks, and hand-off. LOS owns eligibility decisioning, underwriting, sanction, and disbursement.
2. **Role-based access:** RM, BM, SM, and Admin separation is a useful starting point.
3. **Product-specific capture:** The product-wise form/checklist concept is essential for NBFCs.
4. **Pipeline discipline:** The staged workflow, SLA ageing, and state transition guards are valuable.
5. **Consent and audit:** The prior version correctly recognised consent and immutable audit trail as first-class requirements.
6. **Report definitions:** The metric dictionary, reconciliation rules, and dashboard computation appendix are strong and should be preserved.
7. **Idempotent LOS hand-off:** The retry/backoff and webhook/polling idea is important for real enterprise integration.

### 1.2 Gaps that would weaken market differentiation

| Gap | Risk if not fixed | Version 4 fix |
|---|---|---|
| MVP is still close to a generic CRM | Hard to differentiate from existing CRM/LMS tools | Reposition as NBFC-specific origination command centre |
| DSA/dealer journeys are deferred too heavily | NBFCs depend on DSAs, dealers, branches, and field teams | Add lightweight partner lead intake, quality dashboards, and attribution |
| Product configuration is excluded | Any product/form/checklist change becomes a change request | Add limited non-credit product configuration |
| No customer self-service | RMs still chase documents manually | Add secure customer links for consent, documents, status, and callback |
| Compliance is too thin | DPDPA/RBI evidence may be insufficient | Add consent ledger, DLA/LSP registry support, data minimisation, retention, rights requests, and grievance workflow |
| KYC flow is narrow | PAN + Aadhaar OTP does not cover all operating scenarios | Add CKYC, DigiLocker, V-CIP readiness, masked identifiers, manual exception workflows |
| No field-sales mode | Branch/rural/asset-finance users may find desktop LMS impractical | Add responsive PWA, low-bandwidth, geotagged visit/task capability |
| No API/data model | Build teams lack integration precision | Add canonical data model, event bus, APIs, webhooks, error contracts |
| AI fully excluded | Product may look dated, but unmanaged AI is risky | Add transparent rules now; AI optional later under governance |

### 1.3 Version 4 product positioning

The product should be positioned as:

> **A regulated NBFC lead and pre-origination platform that captures demand across branches, field staff, DSAs, dealers, and digital channels; manages consent and KYC evidence; prioritises and allocates leads with transparent rules; drives faster document completion; and hands a clean, auditable, product-specific record to LOS.**

This positioning is stronger than “lead management system” because it speaks directly to NBFC realities: multi-channel acquisition, asset/product-specific information, partner accountability, consent, KYC, field work, and LOS dependency.

---

# Version 4 Business Requirements Document

---

## 2. Executive Summary

### 2.1 Product purpose

The Lead Management System (LMS) is the NBFC's front-office origination platform for lead capture, pre-qualification, consent management, document collection, KYC coordination, partner attribution, task discipline, and hand-off to LOS. The system must support both high-volume sales teams and compliance-sensitive lending operations.

The LMS is **not** the credit underwriting engine. It does not approve loans, sanction limits, calculate final APR, generate Key Fact Statements, manage disbursement, or own collections. Those functions remain in LOS/core lending systems. The LMS may display LOS-owned eligibility, application status, and downstream outcomes read-only when integrated feeds are available.

### 2.2 Version 4 business objectives

| Objective ID | Objective | Success metric |
|---|---|---|
| BO-01 | Centralise lead capture across all NBFC channels | 100% of leads have source, sub-source, owner, product, consent status, and creation channel |
| BO-02 | Reduce lead leakage and duplicates | Duplicate action captured for 100% of matched leads; merge/override audited |
| BO-03 | Improve first-contact speed | Hot leads contacted within configured SLA; first-contact breach dashboard by RM/team/source |
| BO-04 | Improve conversion to LOS hand-off | Higher Pre-qualified-to-KYC and KYC-to-handoff conversion by product/source/team |
| BO-05 | Reduce KYC/document TAT | Product-wise document ageing and pending customer actions visible in real time |
| BO-06 | Increase partner accountability | DSA/dealer/source quality reports with conversion, rejection, duplicate, and SLA metrics |
| BO-07 | Strengthen compliance evidence | Purpose-wise consent ledger, audit trail, privacy controls, data-sharing events, export logs, and grievance trail |
| BO-08 | Improve management visibility | Role-scoped dashboards, MIS, cohorts, heatmaps, and operational exception queues |
| BO-09 | Improve field adoption | Mobile-first PWA with low-bandwidth capture, visit logging, and geotagged follow-ups |
| BO-10 | Prepare for safe AI | Event data model, explainable rules, human override, model governance hooks, no automated underwriting in LMS |

### 2.3 Target users and pain points

| User/persona | Primary goal | Pain point | Version 4 response |
|---|---|---|---|
| Relationship Manager (RM) | Convert assigned leads quickly | Multiple WhatsApp sheets, repeated data entry, manual follow-up | Guided capture, smart tasks, customer upload links, mobile-first workflow |
| Branch Manager (BM) | Control branch funnel, KYC quality, and hand-off | No real-time branch queue, bottleneck in approvals | Branch dashboard, exception queues, delegation, SLA alerts |
| Sales Manager (SM) | Allocate fairly and improve team productivity | Manual allocation, no capacity or SLA view | Rule allocation, team performance, capacity dashboard |
| Sales/Business Head | Grow volume and quality | Slow MIS, weak attribution, no product/source comparison | Executive dashboard, funnel, source ROI, DSA/dealer quality, product heatmap |
| DSA/Dealer/Connector | Submit and track leads | No transparency; repeated follow-up with RM | Lightweight external lead submission/status, duplicate feedback, quality score |
| KYC/Operations team | Complete KYC and documents correctly | Fragmented document collection, unclear exceptions | Product checklist, verification queue, exception workflow |
| Compliance/DPO | Evidence of consent, data sharing, audit, grievance handling | Consent captured as a checkbox only | Consent ledger, rights requests, grievance workflow, audit exports |
| System Admin/IT | Secure user/access/integration operations | Role drift, audit gaps, integration failures | RBAC/ABAC, integration log, monitoring, configuration management |
| Customer/prospect | Share documents and know next action | Repeated requests, unclear status | Secure self-service link for consent, docs, callback, status, grievance |

### 2.4 Differentiating design principles

1. **NBFC-first, not CRM-first:** product capture must understand asset finance, secured business, mortgage-backed loans, branch/DSA/dealer distribution, and field visits.
2. **Consent-first:** every customer data action must map to a purpose, channel, consent state, expiry/retention rule, and audit event.
3. **LOS-owned credit:** LMS can pre-screen and prioritise but must not underwrite.
4. **Partner-aware:** every lead should carry source lineage, sub-source, DSA/dealer/connector, campaign/UTM, and attribution rules.
5. **Mobile-field-ready:** core RM actions must work on low-bandwidth mobile browsers.
6. **Configurable, not hard-coded:** products, checklists, SLAs, sources, templates, rejection reasons, and allocation rules must be configurable by authorised roles.
7. **Explainability over black box:** allocation, scoring, alerts, and nudges must show rule reasons and allow human override.
8. **Audit everything that matters:** data access, exports, consent, KYC, hand-off, stage transitions, overrides, duplicate merges, and external API calls must be traceable.

---

## 3. Scope and Phasing

### 3.1 Phase 1 / MVP scope for Version 4

The Version 4 MVP should include the following modules:

1. **Authentication, RBAC, and ABAC**
   - Secure login, session management, MFA for privileged roles, password reset, role-based navigation, and server-side entitlement enforcement.
   - Attribute-based constraints by branch, team, product, source, DSA/dealer, and data classification.

2. **Omnichannel lead capture**
   - Manual RM/branch capture.
   - Bulk CSV/Excel import with validation and duplicate check.
   - API/webhook lead intake from website, landing pages, telecalling tools, marketing systems, dealer/OEM systems, DSA portals, and QR forms.
   - Missed-call/callback lead creation where telephony integration is available.

3. **Lead identity, duplicate detection, and merge workflow**
   - Match on mobile, PAN, email, CKYC ID, GSTIN, vehicle/asset identifiers, loan product, pin code, and fuzzy name where available.
   - Strong/medium/weak match scoring.
   - Merge, link, override, or reject duplicate actions with audit.

4. **Source, campaign, partner, and attribution management**
   - Mandatory source and sub-source.
   - Optional campaign/UTM fields.
   - DSA/dealer/connector master data.
   - Source ownership and attribution history.

5. **Product-specific capture and configuration**
   - Seven initial products supported: Commercial Vehicle, Car, Tractor, Construction Equipment, Two Wheeler, Secured Business, Home Renovation - Mortgage.
   - Admin-configurable capture fields, mandatory fields, document checklists, SLAs, eligibility payload mapping, rejection reasons, and communication templates.
   - No credit policy/BRE decisioning in LMS.

6. **Lead workspace and pipeline**
   - Lead list, saved tabs, filters, bulk actions, lead 360 view, notes, activity history, tasks, communication history, stage tracker, and pipeline board.

7. **Rules-based allocation and prioritisation**
   - Allocation by branch, pin code, product, RM capacity, source, DSA/dealer, language, SLA, and hot-lead rules.
   - Lead quality score and priority using transparent configured rules.
   - Manual override with reason and audit.

8. **Tasks, follow-ups, and communication**
   - Calls, visits, document requests, KYC appointments, callback, customer reminders.
   - In-app notifications, email, SMS, WhatsApp provider integration.
   - Customer opt-in/opt-out and purpose-specific communication controls.

9. **Customer self-service web link**
   - Secure tokenised link for document upload, consent confirmation, callback scheduling, status tracking, and grievance initiation.
   - Link expiry, resend, revocation, and audit.

10. **KYC and document orchestration**
    - Document checklist, uploads, verification status, mismatch handling, manual exception workflow.
    - PAN verification integration.
    - CKYC ID capture/search/download readiness.
    - DigiLocker/e-document readiness.
    - Aadhaar OTP/offline verification token support where allowed; raw Aadhaar not stored.
    - V-CIP readiness as configurable Phase 1.5 if the NBFC has provider and SOP readiness.

11. **LOS hand-off, eligibility, and status mirror**
    - Eligibility request to LOS/core rules service where available.
    - Read-only eligibility snapshot.
    - Idempotent LOS hand-off with retries, queue, failure handling, and reconciliation.
    - Read-only LOS application status via webhook/poll.

12. **Reports and analytics**
    - Funnel, source performance, RM/team performance, rejection summary.
    - Additional Version 4 reports: DSA/dealer quality, first-contact SLA, KYC/document ageing, duplicate leakage, source ROI, contactability, product/branch heatmap.

13. **Compliance, consent, privacy, and audit**
    - Purpose-wise consent ledger.
    - Data-sharing ledger.
    - Data-rights request workflow.
    - DLA/LSP registry support.
    - Grievance workflow.
    - Tamper-evident audit trail.

14. **Administration and configuration**
    - Users, roles, teams, branches, products, documents, sources, partners, SLAs, rejection reasons, templates, allocation rules, notification rules, retention rules.

15. **Integration and event layer**
    - API gateway, webhooks, standard error contracts, idempotency, integration audit, retry queues, event stream for analytics and future AI.

### 3.2 Phase 1.5 scope

Phase 1.5 should include features that are highly valuable but may depend on vendor readiness or operational maturity:

- Offline field capture and sync.
- V-CIP full workflow with recording, liveness/spoof checks, trained official assignment, and VA/PT completion.
- Account Aggregator consent flow and bank-statement retrieval via FIU/AA integration.
- GSTIN verification, GST return data ingestion, and basic cash-flow extraction where customer/business consent and provider readiness exist.
- Expanded DSA/dealer portal with login, lead status, document upload, SLA dashboard, and partner dispute workflow.
- Telephony/CTI integration with click-to-call, call disposition, call recording where legally and contractually permitted.
- Field route planning and branch catchment heatmaps.

### 3.3 Phase 2 / advanced scope

- AI/ML lead scoring, next-best-action, churn/revival, cross-sell propensity, and document intelligence.
- GenAI RM assistant for summarising lead history and drafting compliant messages.
- Full campaign management and marketing automation.
- Native mobile apps.
- Full DSA/connector payout/commission module.
- Advanced BI/custom report builder and data lake.
- Bureau report display in LMS, if separately approved by compliance and integrated via the bureau/LOS architecture.
- Post-disbursement lifecycle, collections, and servicing.

### 3.4 Explicit out of scope for Version 4 MVP

The following must remain out of MVP unless approved through change control:

- Credit underwriting, sanction, APR/final pricing, KFS generation, disbursement, and collections.
- Credit policy/BRE configuration.
- Automated adverse decisioning or automated rejection solely by LMS.
- Raw bureau report storage/display in LMS.
- Raw Aadhaar storage or biometric storage unless expressly permitted by law and NBFC policy.
- Access to customer's contact list, call logs, media files, or device resources not required for explicit onboarding/KYC purpose.
- Full campaign automation.
- Native Android/iOS applications.
- Partner payout/commission accounting.

### 3.5 Assumptions

1. LOS exposes or will expose APIs/webhooks for eligibility, hand-off, application status, and downstream outcome mirror.
2. NBFC provides master data for branches, users, teams, products, sources, DSAs/dealers, SLAs, document lists, rejection reasons, and communication templates.
3. Vendor accounts and sandbox access are available for PAN, CKYC/DigiLocker, Aadhaar/offline verification, communication providers, and any AA/GST/asset providers.
4. NBFC legal/compliance teams approve consent text, privacy notices, retention rules, DLA/LSP disclosures, grievance workflows, and customer communications.
5. India data residency is mandatory unless approved by compliance under applicable law and RBI directions.
6. Historic migration is a separate workstream unless explicitly added to Phase 1.

### 3.6 Constraints

- LMS must be built as a responsive web/PWA application.
- LMS must not become a shadow LOS or credit BRE.
- All external data pulls must be consented, logged, and mapped to purpose.
- All data access must be role, scope, and classification controlled.
- Business rules that affect eligibility or credit decisioning must reside in LOS/BRE, not LMS.

---

## 4. Roles, Permissions, and Entitlements

### 4.1 Role definitions

| Role | Description |
|---|---|
| Relationship Manager (RM) | Front-line sales user. Captures, works, follows up, and updates own assigned leads. |
| Branch Manager (BM) | Branch owner. Oversees branch leads, KYC exceptions, allocation, hand-off, and branch MIS. |
| Sales Manager (SM) | Team owner. Allocates/reassigns team leads, monitors team performance, and resolves SLA exceptions. |
| Sales/Business Head | National/regional leadership. Views cross-branch dashboards, source ROI, product performance, and executive MIS. |
| KYC/Operations User | Verifies documents/KYC, handles mismatch queues, and marks KYC completion within entitlement. |
| Compliance/DPO User | Read-only masked compliance view, consent ledger, audit, data-rights requests, DLA/LSP registry, grievance reports. |
| DSA/Dealer/Connector User | External or semi-external partner. Creates/views own submitted leads and pending document requirements. No customer PII beyond own submissions. |
| System Administrator | Manages users, roles, master data, configuration, integrations, and notification settings. Does not access lead content unless explicitly granted under break-glass audit. |
| Customer/Prospect | External tokenised access to own consent, documents, status, callback, and grievance pages. No login required unless customer portal is enabled. |

### 4.2 Data scope notation

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

### 4.3 Permissions matrix

| Capability | RM | BM | SM | Sales Head | KYC/Ops | Compliance/DPO | DSA/Dealer | Admin | Customer |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Create lead | O | B | T | A | - | - | P | - | C/self-link |
| View lead | O | B | T | A | B/queue | M/A | P | X | C |
| Edit lead profile | O | B | T limited | - | KYC fields only | - | P limited | - | C limited |
| Upload documents | O | B | - | - | B/queue | - | P | - | C |
| Verify documents | O preliminary | B | - | - | B/queue | - | - | - | - |
| KYC sign-off | - | B | - | - | B/queue | Oversight only | - | - | - |
| Move stage | O | B | T | - | KYC stages only | - | P limited | - | - |
| Hand-off to LOS | Configurable | B | - | - | Configurable | Oversight only | - | - | - |
| Allocate/reassign | - | B | T | A | - | - | - | - | - |
| Bulk actions | - | B | T | A | Queue actions | - | - | - | - |
| Customer communication | O | B | T | - | KYC templates | - | Own lead only | Template config | Own link |
| Reports/MIS | O | B | T | A | KYC ops | Compliance | P | System only | - |
| Export | O masked/limited | B | T | A | Queue export | Compliance export | P limited | Config logs only | Own docs/status |
| Consent ledger | O view | B view | T view | A aggregate | KYC purpose view | A/M full | Own submissions | Config only | Own |
| Audit trail | Own lead activity | B | T | A summary | KYC activity | A/M full | Own actions | System config | Own actions |
| User/role management | - | - | - | - | - | - | - | A | - |
| Configuration | - | B limited | - | A request | KYC templates request | Compliance rules | - | A | - |
| Break-glass access | - | - | - | - | - | A/M with approval | - | Time-bound only | - |

### 4.4 Segregation of duties

1. System Admin must not automatically receive lead-content access.
2. Compliance/DPO must view masked data unless explicit unmasking is approved and audited.
3. KYC sign-off and LOS hand-off must be configurable but controlled by approval rules.
4. Partner users must never view leads that they did not submit unless the NBFC explicitly assigns them.
5. Customer links must be tokenised, expiring, and scoped to a single lead/application.

---

## 5. Functional Requirements

Each requirement uses the following priority labels: **MVP-Must**, **MVP-Should**, **Phase 1.5**, **Phase 2**.

### 5.1 Authentication, access, and security

#### FR-001 — Secure login, sessions, and MFA

**Priority:** MVP-Must  
**User story:** As an authorised user, I want secure access so that customer and lead data is protected.

**Acceptance criteria**

- System authenticates users using email/username and password or enterprise SSO where enabled.
- MFA is mandatory for Admin, Compliance/DPO, Sales Head, and external DSA/dealer users; optional/configurable for other internal roles.
- Session idle timeout default is 30 minutes and configurable.
- Logout invalidates session immediately.
- Failed login lockout default: 5 failed attempts, 15-minute lock.
- Server-side authorisation is enforced on every endpoint.

**Business rules**

- Password policy: minimum 10 characters, upper/lower/digit/symbol, password history and expiry as per NBFC IT policy.
- Direct URL access to unauthorised pages returns 403 and is audited.
- Role changes take effect immediately or at next token refresh, whichever is configured.

#### FR-002 — Attribute-based access control

**Priority:** MVP-Must

**Acceptance criteria**

- Access is evaluated by role plus branch, team, region, product, source, partner, and data classification.
- PII/SPII masking rules are configurable by role.
- Bulk export applies the strictest applicable masking rule.
- Privileged unmasking requires reason, approval where configured, and audit.

---

### 5.2 Lead capture and source attribution

#### FR-010 — Omnichannel lead capture

**Priority:** MVP-Must

**User story:** As sales operations, I want every lead to enter a single LMS regardless of source so that no lead is lost and attribution is clean.

**Acceptance criteria**

- Lead can be created via manual form, bulk import, API/webhook, customer QR form, DSA/dealer portal, website form, telecalling import, or missed-call integration.
- Minimum lead creation fields: mobile number, customer/prospect name or placeholder, source, source detail, product interest, branch/pin code, consent status, creator/channel.
- PAN is not mandatory at first capture unless configured for a product/source; PAN becomes mandatory before KYC completion/LOS hand-off or earlier if NBFC policy requires.
- Every lead receives immutable lead_code and channel_created_by.
- Source cannot be blank and must use configured source master.

**Business rules**

- Source hierarchy: Source -> Sub-source -> Partner/DSA/Dealer -> Campaign/UTM -> Creator.
- If source = DSA/dealer, partner ID is mandatory.
- If lead is customer-created, system assigns default branch based on pin code or product routing rules.

**Edge cases**

- API lead with missing mandatory field is rejected with field-level error.
- Bulk import with partial failures creates valid leads and returns row-level error file.
- Repeated API call with same idempotency key does not create duplicate lead.

#### FR-011 — Lead quality enrichment at capture

**Priority:** MVP-Should

**Acceptance criteria**

- System captures optional context: preferred language, best time to call, employment/business type, requested amount, customer type, pin code, asset details, dealer name, referral code.
- System computes a rules-based lead quality score with reason codes such as "complete mobile + product + pin code", "PAN missing", "source historically high rejection", "hot amount", "returning customer".
- Score never approves/rejects credit; it is only used for prioritisation and routing.

---

### 5.3 Duplicate detection and identity resolution

#### FR-020 — Duplicate and near-duplicate detection

**Priority:** MVP-Must

**User story:** As sales management, I want duplicate and near-duplicate leads detected early so that channel attribution and RM effort remain clean.

**Acceptance criteria**

- Duplicate check runs at create, edit, import, API intake, and before LOS hand-off.
- Matching fields include mobile, PAN, email, CKYC ID, GSTIN, vehicle registration/engine/chassis where available, name+DOB, and branch/product/pin code proximity.
- Match confidence displayed as Strong, Medium, or Weak with reasons.
- System allows configured action: block, warn, route to duplicate queue, link as related, merge, or override.
- All duplicate overrides/merges are audited.

**Default rules**

| Match type | Default treatment |
|---|---|
| Same PAN + mobile | Block creation unless BM/SM override with reason |
| Same PAN, different mobile | Warn and route to identity review |
| Same mobile, no PAN | Warn; allow creation with duplicate flag |
| Same vehicle/asset ID | Block or route to asset-review queue |
| Same GSTIN + product | Warn and link to existing business profile |
| Fuzzy name + same pin + same source | Weak match; show warning only |

#### FR-021 — Merge and source attribution preservation

**Priority:** MVP-Must

**Acceptance criteria**

- Merge keeps one master lead and links duplicate source records.
- Original source attribution history is preserved; final attribution rule is configurable.
- Merge cannot delete audit history, consent history, or documents.
- Unmerge is allowed only for authorised users within a configurable window and must be audited.

---

### 5.4 Lead allocation and prioritisation

#### FR-030 — Rules-based allocation

**Priority:** MVP-Must

**User story:** As a BM/SM, I want leads allocated automatically using transparent rules so that high-intent leads are contacted quickly and fairly.

**Acceptance criteria**

- Allocation rules can use branch, pin code, product, source, partner, RM capacity, RM availability, language, historical conversion band, lead priority, and existing relationship ownership.
- Allocation produces an owner and reason codes.
- Manual reassignment requires reason and is audited.
- System supports round-robin, capacity-weighted, product-specialist, branch-routing, partner-dedicated, and escalation allocation methods.
- Hot leads can be routed to priority queues.

**Example rules**

| Rule | Logic |
|---|---|
| Branch routing | Pin code maps to branch; lead assigned to branch RM pool |
| Product specialist | Commercial Vehicle leads assigned to CV-trained RM list |
| Partner ownership | Leads from Dealer X assigned to the dealer-mapped RM/team |
| Capacity limit | RM cannot receive more than N open hot leads unless BM override |
| SLA escalation | If not contacted within SLA, lead escalates to BM/SM and may be reassigned |

#### FR-031 — Hot lead and lead score

**Priority:** MVP-Must

**Acceptance criteria**

- Hot lead flag is rules-based and explainable.
- Default hot rules: priority = High; requested amount above product threshold; returning customer; partner-verified lead; customer submitted documents; LOS indicative eligibility positive; high-intent event such as callback request.
- Lead score is displayed with factors; no score is used for automated credit approval/rejection.

---

### 5.5 Product-specific capture and configuration

#### FR-040 — Product configuration without credit BRE

**Priority:** MVP-Must

**User story:** As product operations, I want configurable capture fields and checklists so that the LMS can adapt to NBFC products without development for every form change.

**Acceptance criteria**

- Authorised Admin/Product Ops can configure product status, field groups, labels, mandatory flags, validation, document checklist, SLA thresholds, eligibility payload mapping, and templates.
- Credit policy, pricing, LTV/FOIR decisioning, sanction, and final eligibility remain in LOS/BRE.
- Product changes are versioned; leads created under older product form keep their original form version.
- Any change to LOS eligibility payload mapping requires IT approval and test environment validation.

#### FR-041 — Initial supported products

**Priority:** MVP-Must

| Product | Key capture fields | Documents/checks | Eligibility payload to LOS |
|---|---|---|---|
| Commercial Vehicle | Vehicle type, make/model, new/used, invoice/valuation, route/permit, fleet size, operator profile, dealer, down payment | ID, PAN, address, income/banking, quotation/invoice, RC if used, permit, insurance where applicable, field visit | Asset value, LTV inputs, income/cash flow, vintage, fleet, route/usage |
| Car | Make/model, new/used, dealer, quotation, down payment, employment/business, co-applicant | ID, PAN, address, income proof, bank statement, quotation/proforma, RC if used | Vehicle cost, down payment, income, FOIR inputs, LTV inputs |
| Tractor | Make/model, implement, land holding, crop pattern, dealer, village/pin code, seasonality | ID, PAN, land records, income/agri proof, quotation, field visit photo | Asset value, land/income, LTV, seasonality inputs |
| Construction Equipment | Equipment type, make/model, contractor/project, new/used, usage hours, work order, dealer | ID, PAN, financials, bank statement, quotation/invoice, RC if used, project/work order | Asset value, business cash-flow, utilisation, LTV |
| Two Wheeler | Make/model, dealer, down payment, employment, residence stability, preferred EMI | ID, PAN where available, address proof, income/self-declaration, quotation | Vehicle cost, down payment, income, LTV, residence/employment stability |
| Secured Business | Constitution, vintage, turnover, GSTIN, bank statement, collateral property, ownership, purpose | KYC of applicant/business/beneficial owners, GST/ITR/bank statements, property docs, valuation, title chain | Turnover, banking, GST, property value, LTV, business vintage |
| Home Renovation - Mortgage | Property details, ownership, title status, renovation purpose, estimate, co-applicant, income | KYC, property docs, valuation, title chain, renovation estimate, income proof | Property value, renovation estimate, income, FOIR, LTV |

#### FR-042 — Scheme and offer capture

**Priority:** MVP-Should

**Acceptance criteria**

- System allows non-credit scheme metadata such as festival scheme, dealer scheme, subvention flag, campaign code, and offer validity.
- Scheme metadata is passed to LOS if mapping exists.
- LMS does not calculate final pricing or sanction terms.

---

### 5.6 Lead workspace and pipeline

#### FR-050 — Lead list and saved work queues

**Priority:** MVP-Must

**Acceptance criteria**

- Lead list supports search by name, mobile, lead code, PAN masked search, partner, vehicle/asset ID, GSTIN, and LOS application ID.
- Saved queues include: My Leads, Hot, New Today, First Contact Pending, Docs Pending, KYC Pending, Duplicate Review, SLA Breached, Handoff Failed, Rejected, Reopened, Partner Leads, Customer Upload Received.
- Filters include product, stage, branch, team, RM, source, partner, priority, consent status, KYC status, date range, SLA state, lead score band.
- Bulk actions respect role/scope and write audit logs.

#### FR-051 — Lead 360 view

**Priority:** MVP-Must

**Acceptance criteria**

Lead detail page contains:

- Customer profile with masked identifiers.
- Product and source card.
- Stage tracker.
- Consent status and purpose coverage.
- Lead score/reason codes.
- Eligibility snapshot from LOS.
- Document checklist.
- KYC status.
- Tasks and next best action/rule nudge.
- Communication timeline.
- Notes and activity log.
- Related/duplicate leads.
- Partner/dealer details.
- LOS hand-off/status panel.

#### FR-052 — Pipeline board

**Priority:** MVP-Must

**Acceptance criteria**

- Board supports drag/drop where allowed and fallback stage selector on mobile.
- Columns are configurable but must map to canonical stages.
- Cards show ageing, product, amount, source, owner, hot flag, consent/KYC status, and next action.
- Invalid moves are blocked with reason.

---

### 5.7 Customer self-service journey

#### FR-060 — Secure customer action link

**Priority:** MVP-Must

**User story:** As a prospect, I want a simple secure link to submit documents and view next steps without installing an app.

**Acceptance criteria**

- RM/system can send secure customer link by SMS/WhatsApp/email.
- Link is tokenised, lead-specific, expiring, and revocable.
- Customer can view required documents, upload files/photos, provide/confirm consent, select callback slot, and view high-level status.
- Customer cannot see internal notes, scoring, RM performance, or other leads.
- Link access and actions are audited.

**Security rules**

- Step-up verification with OTP is required before viewing sensitive details or uploading sensitive documents.
- Uploaded documents are virus-scanned and classified.
- Link expiry default is 7 days; resend generates new token.

#### FR-061 — Customer grievance and service request

**Priority:** MVP-Should

**Acceptance criteria**

- Customer can raise a complaint/service request from the self-service link.
- LMS captures category, description, document attachment, source, and timestamp.
- Complaint is routed to configured owner with SLA.
- Grievance officer details and escalation information are displayed where required by NBFC policy.

---

### 5.8 KYC and documents

#### FR-070 — Document checklist and upload

**Priority:** MVP-Must

**Acceptance criteria**

- Checklist is derived from product, applicant type, entity type, co-applicant/guarantor, and collateral/asset.
- Each document item has status: Not Required, Pending, Uploaded, Under Review, Verified, Mismatch, Waived, Expired.
- Waiver requires authorised role, reason, expiry/review date, and audit.
- File types: PDF/JPG/PNG/HEIC where supported; max size configurable; image compression for mobile.
- Document versioning preserved.

#### FR-071 — KYC verification orchestration

**Priority:** MVP-Must / Phase 1.5 for some providers

**Acceptance criteria**

- PAN verification captures provider reference, response status, timestamp, and masked PAN.
- CKYC ID can be captured or retrieved where integration is available.
- DigiLocker/e-document retrieval can be initiated where integration is available.
- Aadhaar OTP/offline verification stores only masked/tokenised reference; raw Aadhaar and biometrics are not stored.
- V-CIP readiness supports appointment, agent assignment, liveness/spoof check result, recording reference, and audit where provider is integrated.
- KYC failures create exception queue and block hand-off unless authorised exception/waiver exists.

#### FR-072 — KYC exception handling

**Priority:** MVP-Must

**Acceptance criteria**

- Exceptions include PAN mismatch, name mismatch, expired document, unreadable document, address mismatch, CKYC unavailable, duplicate CKYC, V-CIP failed, provider downtime.
- Each exception has owner, SLA, remarks, evidence, and resolution code.
- Provider downtime allows manual fallback only if enabled by compliance and with audit.

---

### 5.9 LOS eligibility and hand-off

#### FR-080 — Eligibility request and read-only snapshot

**Priority:** MVP-Must where LOS API exists

**Acceptance criteria**

- LMS sends product-specific eligibility payload to LOS/eligibility service.
- Request includes lead_code, product, customer attributes, source, consent reference, documents/KYC status, and idempotency key.
- LMS displays read-only response: indicative amount, tenure, rate/range, conditions, validity, and response basis as provided by LOS.
- LMS labels response as indicative/preliminary unless LOS explicitly returns final status.
- Failure shows Pending/Retry and does not crash lead workflow.

#### FR-081 — LOS hand-off

**Priority:** MVP-Must

**Acceptance criteria**

- Hand-off requires configured guards: consent present, mandatory data complete, duplicate clear/overridden, mandatory documents verified/waived, KYC sign-off, product payload valid.
- Hand-off payload is idempotent and retried with exponential backoff.
- Success stores LOS application ID and marks lead as Handed off to LOS.
- Failure creates Handoff Failed queue with error category and retry action.
- Manual retry cannot create duplicate LOS application.

#### FR-082 — LOS application status mirror

**Priority:** MVP-Must where LOS supports it

**Acceptance criteria**

- LMS receives status updates via webhook and/or polling.
- Status is read-only and clearly marked as LOS-owned.
- Status timeline includes timestamps, source, and correlation ID.
- Missed webhooks are reconciled by scheduled polling.

---

### 5.10 DSA, dealer, and partner workflows

#### FR-090 — Partner master and onboarding metadata

**Priority:** MVP-Must

**Acceptance criteria**

- Partner master supports DSA, dealer, connector, OEM, aggregator, and referral partner types.
- Captures partner code, legal name, branch/territory, products, contact person, status, validity, agreement reference, commission flag, mapped RM/team, risk category, and documents.
- Partner status controls whether new leads can be submitted.

#### FR-091 — Partner lead submission

**Priority:** MVP-Must

**Acceptance criteria**

- DSA/dealer can create lead via limited portal or API.
- Partner sees only own leads and limited status.
- Partner is warned on duplicate/invalid leads without exposing other customer details.
- Partner-submitted documents go to KYC/document queue.

#### FR-092 — Partner quality score and dashboard

**Priority:** MVP-Should

**Acceptance criteria**

- Dashboard shows leads submitted, contactable %, duplicate %, rejected %, KYC mismatch %, hand-off %, TAT, and conversion value.
- Quality score is transparent and does not determine payout unless integrated with a separate payout system.
- Partner performance supports coaching and partner prioritisation.

---

### 5.11 Tasks, follow-ups, and communications

#### FR-100 — Task management

**Priority:** MVP-Must

**Acceptance criteria**

- Tasks support type: call, visit, document request, KYC appointment, dealer follow-up, customer callback, internal approval, hand-off retry.
- Tasks have owner, due date/time, priority, SLA, status, result/disposition, and next action.
- Overdue tasks appear in dashboard and escalation queue.
- Completing a task records timestamp, result, and next action.

#### FR-101 — Communication templates and audit

**Priority:** MVP-Must

**Acceptance criteria**

- Templates are configurable by event, product, language, channel, and recipient type.
- Every communication stores channel, template version, recipient, consent basis, delivery status, provider reference, and failure reason.
- Customer-facing messages respect opt-out and purpose-specific consent.
- Transactional KYC/document reminders are separated from marketing communication.

#### FR-102 — Telephony and visit logging

**Priority:** MVP-Should / Phase 1.5 for CTI

**Acceptance criteria**

- RM can log call disposition manually in MVP.
- CTI integration can add click-to-call and call disposition sync.
- Visit logs can capture time, notes, geotag, photo evidence, and customer availability.
- Any recording or location capture must be compliant with NBFC policy and customer/user consent requirements.

---

### 5.12 Compliance, consent, privacy, and grievance

#### FR-110 — Purpose-wise consent ledger

**Priority:** MVP-Must

**User story:** As Compliance/DPO, I want purpose-wise consent and data-sharing records so that the NBFC can evidence lawful processing and customer choice.

**Acceptance criteria**

- Consent record stores customer, lead, purpose, data category, channel, language, notice version, consent text version, timestamp, IP/device/channel, expiry/retention, source, and actor.
- Consent purposes include lead contact, product eligibility, KYC, document processing, LOS hand-off, communication, partner sharing, AA/bank-statement data, GST/business data, marketing, and grievance handling.
- Consent can be granted, denied, withdrawn, expired, or superseded.
- Withdrawal affects only the relevant purpose unless legal/regulatory retention requires continued storage.
- Consent history is append-only.

#### FR-111 — Data minimisation and resource-access controls

**Priority:** MVP-Must

**Acceptance criteria**

- System stores only necessary data for configured purposes.
- Raw Aadhaar number and biometrics are not stored.
- Any camera, microphone, or location access is one-time/purpose-bound and logged.
- LMS must not request or access phone contacts, call logs, SMS inbox, general media files, or unrelated device resources.
- Third-party data sharing requires purpose, recipient, legal basis/consent, and audit.

#### FR-112 — Data principal rights and retention workflow

**Priority:** MVP-Should

**Acceptance criteria**

- Customer requests for access, correction, update, erasure, withdrawal, and grievance are captured and routed.
- System shows whether data can be erased or must be retained due to legal/regulatory/business obligation.
- Retention rules can be configured by data category and lead outcome.
- Purge/anonymisation jobs are logged and reviewable by Compliance/DPO.

#### FR-113 — DLA/LSP registry support

**Priority:** MVP-Should

**Acceptance criteria**

- System stores DLA/LSP/partner metadata required for internal compliance monitoring: name, owner, URL/app store link where applicable, grievance officer details, customer care details, RE website reference, enabled products, data collected, storage location, and status.
- System supports export for compliance reporting and internal review.
- LMS displays customer-facing lender/LSP/partner and grievance information where required by product/channel configuration.

#### FR-114 — Grievance workflow

**Priority:** MVP-Should

**Acceptance criteria**

- Grievances can be captured from customer link, RM, branch, call centre, partner, or admin entry.
- System tracks complaint category, owner, SLA, status, response, escalation, and closure proof.
- If no response or dissatisfied response is recorded within configured days, escalation prompts are shown as per NBFC policy.

---

### 5.13 Reporting and analytics

#### FR-120 — Core report pack

**Priority:** MVP-Must

Reports retained from Version 3.3:

1. Funnel/Conversion Report.
2. Source Performance Report.
3. RM/Team Performance Report.
4. Rejection Summary Report.

#### FR-121 — Version 4 NBFC differentiator reports

**Priority:** MVP-Must / MVP-Should as indicated

| Report | Priority | Key questions answered |
|---|---|---|
| First Contact SLA | MVP-Must | Are hot/new leads being contacted fast enough by branch/team/RM/source? |
| KYC & Document Ageing | MVP-Must | Which documents/products/branches are delaying hand-off? |
| DSA/Dealer Quality | MVP-Must | Which partners send contactable, non-duplicate, conversion-ready leads? |
| Duplicate Leakage | MVP-Must | Which sources create duplicates and where were duplicates caught? |
| Source ROI | MVP-Should | Which source/campaign gives high conversion/value after cost? |
| Contactability | MVP-Should | Which leads fail due to wrong number/no response and from which sources? |
| Handoff Failure | MVP-Must | Why are leads failing LOS hand-off and which integration errors recur? |
| Consent & Privacy Operations | MVP-Should | Which leads lack consent, have withdrawals, or have open data requests? |
| Product/Branch Heatmap | MVP-Should | Which products/branches have high volume, conversion, or TAT issues? |
| RM Capacity & Load | MVP-Should | Which RMs are overloaded or under-utilised? |

#### FR-122 — Report export governance

**Priority:** MVP-Must

**Acceptance criteria**

- Exports include filters, generated by, timestamp, scope, masking level, and purpose.
- Export of high-volume or sensitive data requires approval if configured.
- Export files can be watermarked with user ID and timestamp.
- Export access is audited.

---

### 5.14 Administration and configuration

#### FR-130 — User, role, team, and branch administration

**Priority:** MVP-Must

**Acceptance criteria**

- Admin can create/edit/deactivate users, assign roles, branch, team, region, product skills, partner mappings, and reporting manager.
- Deactivation of a user with open leads requires reassignment or exception.
- Role changes are logged.

#### FR-131 — Master configuration

**Priority:** MVP-Must

Configurable master data:

- Products and product versions.
- Field groups and validation rules.
- Document checklists and mandatory flags.
- Sources, sub-sources, DSAs, dealers, connectors, OEMs.
- Branches, pin-code mapping, territories.
- Rejection reasons and sub-reasons.
- SLA thresholds.
- Allocation rules.
- Notification templates.
- Consent purposes and notice versions.
- Data retention categories.
- Integration endpoints and retry policies.

#### FR-132 — Configuration governance

**Priority:** MVP-Must

**Acceptance criteria**

- Configuration changes are versioned and audited.
- High-impact changes require maker-checker approval where enabled.
- Changes can be tested in sandbox before production activation.
- Rollback is supported for configuration versions.

---

## 6. Workflow and State Model

### 6.1 Canonical lead lifecycle

1. **Captured** — lead created from any channel; source and minimum details captured.
2. **Consent Pending / Consent Captured** — consent purpose captured or pending; progression controlled by purpose.
3. **Assigned** — owner allocated automatically or manually.
4. **First Contact Pending** — SLA timer starts.
5. **Contacted** — call/visit/customer response recorded.
6. **Qualified** — basic product fit and intent captured; product-specific fields started.
7. **Documents Pending** — customer/partner/RM document checklist active.
8. **KYC In Progress** — KYC verification and exceptions being handled.
9. **Eligibility Requested** — payload sent to LOS/eligibility service.
10. **Ready for Hand-off** — all hand-off guards satisfied.
11. **Handed off to LOS** — terminal in LMS except read-only LOS updates.
12. **Rejected** — terminal unless reopened within configured window.
13. **Dormant/Nurture** — lead not rejected but paused for follow-up, missing consent, low intent, or future need.

### 6.2 Stage definitions

| Stage | Definition | Entry criteria | Exit criteria |
|---|---|---|---|
| Captured | Lead exists with minimum information | Valid source, mobile, product interest | Consent captured or pending path selected |
| Assigned | Lead has owner | Allocation/manual assignment | First contact attempted |
| Contacted | RM/partner/customer interaction occurred | Call/visit/response logged | Qualified, Docs Pending, Nurture, or Rejected |
| Qualified | Product fit and basic intent established | Product fields minimum complete | Document request/KYC/Eligibility |
| Documents Pending | Required docs requested | Checklist generated | Mandatory docs uploaded/waived or rejected |
| KYC In Progress | KYC checks underway | Documents available or verification initiated | KYC verified, exception, or rejection |
| Eligibility Requested | LOS eligibility call initiated | Minimum payload complete and consent present | Offer received/pending/failure |
| Ready for Hand-off | All guards pass | KYC sign-off, docs, consent, duplicate clearance | Handed off to LOS |
| Handed off to LOS | LMS terminal; LOS owns application | Successful hand-off | Read-only status updates only |
| Rejected | Lead closed as not proceeding | Rejection reason mandatory | Reopen within window |
| Dormant/Nurture | Future follow-up or low intent | Nurture reason + next follow-up date | Reactivate or reject |

### 6.3 State transition guards

| From -> To | Allowed roles | Required guards | Side effects |
|---|---|---|---|
| Captured -> Assigned | System, BM, SM | Valid branch/product/source | Owner assigned, SLA timer starts |
| Assigned -> Contacted | RM, BM | Contact attempt/disposition logged | First-contact TAT recorded |
| Contacted -> Qualified | RM, BM | Intent/product fit captured; mandatory progressive fields | Product checklist starts |
| Qualified -> Documents Pending | RM, BM | Product checklist generated | Customer self-service link may be sent |
| Documents Pending -> KYC In Progress | RM, KYC/Ops, BM | Mandatory docs uploaded or waiver exists | KYC verification queue created |
| KYC In Progress -> Eligibility Requested | RM/BM/KYC as configured | KYC status sufficient; consent for eligibility/LOS | Eligibility API call |
| Eligibility Requested -> Ready for Hand-off | System, BM/KYC as configured | Eligibility received or bypass allowed; docs/KYC ready | Handoff readiness flag |
| Ready for Hand-off -> Handed off to LOS | BM/KYC/RM delegated | Consent, duplicate clearance, mandatory docs, KYC sign-off, valid payload | LOS hand-off, application ID stored |
| Any active -> Rejected | RM/BM/SM as configured | Rejection reason and sub-reason | Stage history, notification, reopen window |
| Rejected -> Prior active stage | BM/SM/RM as configured | Within reopen window; reason | reopened_count++, notifications |
| Any active -> Dormant/Nurture | RM/BM/SM | Nurture reason + next date | Nurture task created |
| Dormant/Nurture -> Assigned/Contacted | RM/BM/SM/System | Next follow-up due or reactivation | SLA resets per rule |

### 6.4 Rejection reason taxonomy

Mandatory primary and sub-reason:

- No response/contact failed.
- Customer not interested.
- Duplicate/already in LOS.
- Product not suitable.
- Low income/pre-screen mismatch.
- Out of serviceable area.
- Document incomplete/invalid.
- KYC mismatch.
- Asset not acceptable.
- Partner/dealer withdrawal.
- Customer withdrew consent.
- Other with mandatory remarks.

---

## 7. User Interface Requirements

### 7.1 Global UX standards

- Responsive web/PWA layout for desktop, tablet, and mobile.
- Left navigation filtered by role; mobile bottom navigation for RM core actions.
- Global search with masked results.
- Quick-create lead, task, upload document, and send link actions.
- Clear status chips: consent, KYC, document, SLA, duplicate, hand-off.
- Low-bandwidth mode with compressed images and reduced charts.
- Accessibility target: WCAG 2.1 AA for core flows.
- Indian localisation: INR, Indian date/time formats, IST, branch/pin code support, English UI with regional-language templates where configured.

### 7.2 Screen catalogue

| Screen | Primary users | Key components |
|---|---|---|
| Dashboard | RM/BM/SM/Sales Head | KPI cards, SLA alerts, hot leads, tasks, source summary, hand-off failures |
| Lead Inbox | RM/BM/SM | Saved queues, filters, bulk actions, lead table/cards |
| Lead 360 | RM/BM/KYC/Compliance | Profile, consent, documents, KYC, tasks, notes, LOS status, audit |
| Pipeline Board | RM/BM/SM | Stage columns, drag/drop, SLA cards, filters |
| Customer Link Management | RM/BM/KYC | Send/resend/revoke links, document status, link audit |
| KYC Workbench | KYC/Ops/BM | Verification queues, exceptions, provider status, sign-off |
| Partner Console | DSA/Dealer | Submit lead, upload docs, view limited status, duplicate feedback |
| Partner Management | BM/SM/Admin | Partner master, status, mapping, quality metrics |
| Reports & MIS | RM/BM/SM/Sales Head | Core reports and Version 4 analytics |
| Compliance Console | Compliance/DPO | Consent ledger, privacy requests, grievance, DLA/LSP registry, audit |
| Admin Settings | Admin/Product Ops | Users, roles, product config, SLAs, sources, templates, integrations |
| Integration Monitor | IT/Admin | API logs, queues, retries, webhook status, failure categories |

### 7.3 Mobile/field-sales requirements

- Lead capture must be usable in less than 3 minutes for minimum fields.
- Image upload should compress automatically and allow retake.
- Visit logging must work with geotag and timestamp where permission is granted.
- Offline draft capture stores data locally encrypted and syncs when online; conflicts route to review.
- Pipeline/cards must be touch-friendly.
- Customer link can be shared via WhatsApp/SMS from mobile.

---

## 8. Reporting and Analytics Specification

### 8.1 Metric dictionary

| Metric | Definition | Notes |
|---|---|---|
| Leads Captured | Distinct leads created in period after duplicate handling | Role-scoped |
| Contacted Leads | Leads with at least one valid call/visit/customer interaction | Used for contactability |
| First Contact TAT | Median time from assignment to first valid contact | Hot lead SLA critical |
| Qualified Leads | Leads moved to Qualified stage at least once | Stage history-based |
| Documents Pending | Leads with at least one mandatory document pending | Product checklist-based |
| KYC Completed | Leads with required KYC status complete/verified | Includes waivers separately |
| Eligibility Requested | Leads sent to LOS eligibility service | LOS/API based |
| Ready for Hand-off | Leads satisfying hand-off guards | LMS guard-based |
| Handed-off | Leads successfully handed to LOS | Terminal in LMS |
| Overall Conversion | Handed-off / Captured | Same filters/scope |
| KYC Conversion | KYC Completed / Documents Pending | Measures doc/KYC efficiency |
| Source Conversion | Handed-off / Captured by source | Source quality |
| Partner Quality Score | Transparent score using contactable %, duplicate %, rejection %, handoff %, doc mismatch %, TAT | Not a payout engine |
| Duplicate Rate | Duplicate or linked leads / leads captured | By source/partner/product |
| Rejection Rate | Rejected / Captured | Reason mandatory |
| Active Pipeline | Captured - Handed-off - Rejected | Same period/scope |
| Handoff Failure Rate | Failed hand-offs / attempted hand-offs | Integration health |
| Consent Coverage | Leads with required consent for next stage / active leads | Compliance KPI |
| Data Request Open Age | Age of open privacy/right requests | Compliance SLA |

### 8.2 Revised sample funnel by product

Sample data for one month, all branches, using the seven Version 4 products.

| Product | Captured | Qualified | KYC | Handed-off | Conversion % |
|---|---:|---:|---:|---:|---:|
| Commercial Vehicle | 210 | 138 | 93 | 64 | 30.5% |
| Car | 160 | 105 | 68 | 48 | 30.0% |
| Tractor | 130 | 84 | 55 | 39 | 30.0% |
| Construction Equipment | 90 | 58 | 38 | 27 | 30.0% |
| Two Wheeler | 170 | 100 | 57 | 36 | 21.2% |
| Secured Business | 150 | 96 | 65 | 44 | 29.3% |
| Home Renovation - Mortgage | 90 | 59 | 34 | 22 | 24.4% |
| **Total** | **1,000** | **640** | **410** | **280** | **28.0%** |

### 8.3 Revised sample source performance

| Source/channel | Leads | Handed-off | Conversion % | Key interpretation |
|---|---:|---:|---:|---|
| DSA | 280 | 78 | 27.9% | High volume; quality varies by partner |
| Dealer/OEM | 190 | 62 | 32.6% | Strong for vehicle/asset finance |
| Branch Walk-in | 150 | 50 | 33.3% | High intent, branch capacity dependent |
| Website/Digital | 160 | 42 | 26.3% | Needs faster first contact |
| Referral | 110 | 28 | 25.5% | Quality depends on referrer tagging |
| Tele-calling/Outbound | 70 | 8 | 11.4% | Weak source; needs script/targeting review |
| Field/Feet-on-Street | 40 | 12 | 30.0% | Small volume, good conversion |
| **Total** | **1,000** | **280** | **28.0%** |  |

### 8.4 DSA/dealer quality score formula

The score is transparent and configurable. Default:

```
contactability_index = contactable_leads / leads * 100
duplicate_penalty = duplicate_leads / leads * 100
rejection_penalty = rejected_leads / leads * 100
handoff_index = handed_off / leads * 100
document_quality_index = verified_docs_first_time / uploaded_docs * 100
speed_index = min(partner_median_doc_tat) / partner_median_doc_tat * 100

partner_quality_score = round(
  0.25 * contactability_index
+ 0.30 * handoff_index
+ 0.20 * document_quality_index
+ 0.15 * speed_index
- 0.05 * duplicate_penalty
- 0.05 * rejection_penalty
)
```

Rules:

- Score is used for operational review and partner coaching.
- Score does not determine payout unless a separate approved payout module consumes it.
- Score must show factor breakdown.

### 8.5 Reconciliation rules

- Captured = Active + Rejected + Handed-off, within the same period/scope definition.
- Stage counts must be monotonic when calculated as stage-reached funnel.
- Rates must be recomputed from summed numerator/denominator, not averaged.
- Product/source/partner breakdowns must reconcile to total.
- Same metric under same filters must match across dashboard and reports.
- Metrics with zero denominator show “-”, not 0%.

---

## 9. Notifications and Communication Requirements

### 9.1 Event matrix

| Event code | Recipient | Channels | Trigger | Notes |
|---|---|---|---|---|
| LEAD_CREATED | Owner/BM | In-app/email | Lead captured | Source and product included |
| LEAD_ASSIGNED | RM | In-app/email | Assignment/reassignment | Includes SLA due time |
| HOT_LEAD | RM/BM | In-app/SMS optional | Hot flag set | Higher priority |
| FIRST_CONTACT_DUE | RM | In-app/email | SLA approaching | Escalates if breached |
| FIRST_CONTACT_BREACH | RM/BM/SM | In-app/email | SLA breached | Used in reports |
| DOC_REQUEST | Customer/Partner | WhatsApp/SMS/email | Document request sent | Requires communication consent/policy basis |
| DOC_UPLOADED | RM/KYC | In-app | Customer/partner uploads document | Adds to KYC queue |
| DOC_MISMATCH | Customer/RM/BM | In-app/email/WhatsApp/SMS | Document marked mismatch | Customer receives re-upload request |
| CONSENT_PENDING | RM/Customer | In-app/SMS/WhatsApp | Required consent missing | Purpose-specific |
| CONSENT_WITHDRAWN | RM/BM/Compliance | In-app/email | Customer withdraws consent | Blocks affected purpose |
| KYC_EXCEPTION | RM/BM/KYC | In-app/email | Exception raised | SLA starts |
| ELIGIBILITY_RECEIVED | RM/BM | In-app/email | LOS response received | Read-only |
| HANDOFF_READY | BM/KYC/RM delegated | In-app/email | All guards pass | Action required |
| HANDOFF_FAILED | BM/IT/KYC | In-app/email | LOS hand-off error | Retry/queue |
| LEAD_HANDED_OFF | RM/BM/Customer optional | In-app/email/SMS | LOS app ID created | Customer status may update |
| GRIEVANCE_CREATED | Grievance owner | In-app/email | Complaint raised | SLA starts |
| DATA_RIGHT_REQUEST | Compliance/DPO | In-app/email | Customer request | SLA starts |
| EXPORT_COMPLETED | Requestor | In-app/email | Export ready | Audit included |
| CONFIG_CHANGED | Admin/Approver | In-app/email | Config version changed | Maker-checker where enabled |

### 9.2 Communication controls

- Internal users always receive in-app notifications unless disabled by role policy.
- Customer messages are template-based and logged.
- Marketing communication requires separate opt-in from transactional communication.
- WhatsApp/SMS/email failure triggers retry/failover according to provider policy.
- Customer message language follows customer preference if configured.

---

## 10. Integration Requirements

### 10.1 Integration principles

- All external calls must include correlation ID and idempotency key where action creates or changes state.
- All provider responses must be stored with status, timestamp, masked response data, and raw payload retention policy.
- System must support synchronous and asynchronous providers.
- Retry policies must prevent duplicate application creation or duplicate customer messages.
- Integration failures must appear in operational queues.

### 10.2 Integration catalogue

| Integration | Direction | Priority | Purpose | LMS stores |
|---|---|---|---|---|
| LOS eligibility | LMS -> LOS | MVP-Must | Read-only indicative eligibility | Request/response refs, snapshot, validity |
| LOS hand-off | LMS -> LOS | MVP-Must | Create/submit application | LOS app ID, status, correlation ID |
| LOS status | LOS -> LMS / poll | MVP-Must | Application status mirror | Status timeline |
| PAN verification | LMS -> provider | MVP-Must | Identity verification | Masked PAN, status, reference |
| CKYC | LMS/LOS -> CKYC provider | MVP-Should | Retrieve KYC records/identifier | CKYC ID/ref, status, no unnecessary raw data |
| DigiLocker/e-document | LMS -> provider | MVP-Should | Customer documents | Document ref/verified e-document |
| Aadhaar OTP/offline verification | LMS -> provider | MVP-Should | KYC verification | Masked/tokenised reference only |
| V-CIP | LMS -> provider | Phase 1.5 | Video KYC workflow | Session ref, outcome, recording ref |
| Communication provider | LMS -> SMS/WhatsApp/email | MVP-Must | Notifications/reminders | Delivery status, template version |
| Telephony/CTI | LMS <-> CTI | Phase 1.5 | Calls/disposition | Call ref/disposition; recording ref where allowed |
| Account Aggregator | LMS/LOS -> AA/FIU | Phase 1.5 | Consented bank-statement/cash-flow data | Consent artefact ref, fetch status |
| GST/GSTIN | LMS/LOS -> provider | Phase 1.5 | Business verification/cash-flow input | GSTIN status/ref, summary only |
| VAHAN/RTO/asset valuation | LMS/LOS -> provider | Phase 1.5 | Vehicle/asset verification | Asset refs/status |
| Bureau via LOS | LMS -> LOS -> bureau | Phase 1.5/2 | Consent-based bureau pre-screen | Only LOS-returned summary flag unless approved |
| Campaign/marketing source | External -> LMS | MVP-Should | Source attribution | UTM/campaign/source metadata |

### 10.3 Standard API error contract

```json
{
  "error_code": "LMS_VALIDATION_ERROR",
  "message": "One or more fields are invalid.",
  "correlation_id": "corr_20260604_001",
  "fields": [
    {"field": "mobile", "issue": "Mobile must be 10 digits"},
    {"field": "source", "issue": "Source is mandatory"}
  ],
  "retryable": false
}
```

### 10.4 Core API endpoints

| API | Method | Purpose |
|---|---|---|
| /api/v1/leads | POST | Create lead |
| /api/v1/leads/import | POST | Bulk import |
| /api/v1/leads/{lead_id} | GET/PATCH | View/update lead |
| /api/v1/leads/{lead_id}/duplicate-check | POST | Run duplicate check |
| /api/v1/leads/{lead_id}/consents | POST/GET | Capture/view consent |
| /api/v1/leads/{lead_id}/documents | POST/GET | Upload/view documents |
| /api/v1/leads/{lead_id}/kyc/pan | POST | PAN verification |
| /api/v1/leads/{lead_id}/eligibility | POST | Request eligibility from LOS |
| /api/v1/leads/{lead_id}/handoff | POST | Hand off to LOS |
| /api/v1/los/webhooks/status | POST | Receive LOS status |
| /api/v1/tasks | POST/GET/PATCH | Manage tasks |
| /api/v1/partners/leads | POST/GET | Partner lead submission/view |
| /api/v1/reports/{report_id} | GET | Reports |
| /api/v1/audit | GET | Audit search |

---

## 11. Data Model

### 11.1 Canonical entities

| Entity | Purpose | Key fields |
|---|---|---|
| Lead | Central lead record | lead_id, lead_code, stage, product_id, branch_id, owner_id, source_id, priority, score, created_at |
| LeadIdentity | Customer identity attributes | name, mobile, email, PAN token, CKYC ID, GSTIN, DOB, masked identifiers |
| CustomerProfile | Reusable customer shell | customer_id, demographic, address, preferred language, relationship flag |
| SourceAttribution | Source lineage | source, sub-source, partner_id, campaign_id, UTM, attribution status |
| Partner | DSA/dealer/connector/OEM | partner_id, type, branch, products, status, mapped RM, agreement ref |
| ProductConfig | Product form/checklist config | product_id, version, field schema, document checklist, SLA config, LOS mapping |
| LeadProductDetail | Product-specific answers | lead_id, product_id, version, attribute JSON, validation status |
| ConsentRecord | Purpose-wise consent | consent_id, purpose, text version, status, timestamp, channel, expiry, withdrawal |
| DataSharingLog | Third-party data sharing | recipient, purpose, data category, consent ref, timestamp, status |
| Document | Uploaded/retrieved documents | document_id, type, status, version, storage ref, verification status |
| KYCVerification | KYC checks | provider, type, status, reference, masked response, exception flag |
| Task | Follow-up and operations tasks | task_id, lead_id, type, owner, due date, status, disposition |
| CommunicationLog | Messages/calls | channel, template, recipient, consent basis, status, provider ref |
| StageHistory | Stage transitions | from_stage, to_stage, actor, timestamp, guard result, reason |
| EligibilitySnapshot | LOS response | request id, indicative amount, tenure, rate/range, conditions, validity, status |
| LOSApplicationMirror | LOS status | los_app_id, status, status date, webhook/poll ref |
| AuditLog | Tamper-evident audit | actor, action, entity, before/after hash, timestamp, IP/device |
| IntegrationLog | Provider/API observability | endpoint, payload ref, status, correlation ID, retry count |
| Grievance | Complaints/service requests | complaint_id, category, owner, SLA, status, response |
| DataRightsRequest | DPDPA/customer data requests | request type, customer, status, owner, due date, disposition |
| ConfigurationVersion | Config governance | config type, version, maker, checker, effective date, rollback ref |

### 11.2 Data classification

| Classification | Examples | Control |
|---|---|---|
| Public | Generic product info | No special access |
| Internal | Branch/source performance | Role-scoped |
| Confidential | Lead details, task notes, partner performance | RBAC/ABAC, audit |
| PII | Name, mobile, email, address, PAN | Masking, encryption, access audit |
| Sensitive/Regulated | Aadhaar token/ref, KYC docs, bank statements, consent records | Strict masking, encryption, retention, DPO access, no raw Aadhaar |
| Restricted | Credentials, API secrets, encryption keys | Vault/HSM/secret manager; no user access |

### 11.3 Audit events

Minimum audit actions:

- Login, logout, failed login, MFA failure.
- Lead create/update/delete/merge/override.
- Source/partner attribution change.
- Consent grant/withdraw/expire/supersede.
- Document upload/view/download/verify/waive/delete/anonymise.
- KYC provider request/response/exception.
- Stage transition/rejection/reopen/nurture.
- Allocation/reassignment.
- Customer link created/sent/opened/revoked.
- Communication sent/delivered/failed.
- LOS eligibility request/response.
- LOS hand-off attempt/success/failure.
- Export generation/download.
- Configuration change.
- User/role change.
- Break-glass access.

---

## 12. Non-Functional Requirements

| Ref | Category | Requirement |
|---|---|---|
| NFR-01 | Platform | Responsive web/PWA for current Chrome, Edge, Safari, Firefox; mobile-first RM flows |
| NFR-02 | Performance | Dashboard/list load <= 2.5s for normal load; search <= 1.5s; API P95 targets configured after sizing |
| NFR-03 | Capacity | Design for 3x initial branch/user/lead volume without redesign |
| NFR-04 | Availability | Business-hours availability >= 99.5%; graceful degradation for LOS/KYC/communication provider downtime |
| NFR-05 | Scalability | Stateless app tier, horizontal scaling, queue-based integrations |
| NFR-06 | Security | TLS, encryption at rest, field-level encryption/tokenisation for sensitive identifiers, RBAC/ABAC, masking |
| NFR-07 | MFA | Mandatory MFA for privileged and external users |
| NFR-08 | Auditability | Append-only, tamper-evident audit logs; retention as per policy |
| NFR-09 | Data residency | Production data stored in India; cross-border processing only if legally approved and logged |
| NFR-10 | Privacy | Purpose limitation, data minimisation, consent ledger, retention and erasure workflow |
| NFR-11 | Backup/DR | Daily backups minimum; RPO <= 24h and RTO <= 4h unless stricter targets agreed |
| NFR-12 | Low bandwidth | Core mobile flows usable on low bandwidth; compressed images/uploads |
| NFR-13 | Accessibility | WCAG 2.1 AA target for core workflows |
| NFR-14 | Observability | Application logs, audit logs, integration logs, metrics, alerts, trace IDs |
| NFR-15 | Resilience | Retries, queues, circuit breakers, idempotency, provider-failure dashboards |
| NFR-16 | Export governance | Masking, watermarking, audit, asynchronous export for large files |
| NFR-17 | Testing | Functional, performance, security, VA/PT, integration, UAT, and regression testing before go-live |
| NFR-18 | Maintainability | Configuration over code for products, documents, sources, SLAs, templates, allocation rules |
| NFR-19 | Localisation | INR, IST, Indian date formats, pin code/branch hierarchy, regional message templates |
| NFR-20 | AI governance readiness | If AI is added later: model registry, human override, explainability, bias testing, monitoring, rollback |

---

## 13. Compliance and Regulatory Anchors for Product Design

This section turns regulatory expectations into product requirements. It is not a legal opinion.

### 13.1 Digital lending readiness

Version 4 should support the following design controls:

- Consent for data collection must be need-based, prior, explicit, and auditable.
- Data collection must avoid unnecessary mobile/device resources.
- Customer should be able to deny, restrict, revoke, and request deletion/forgetting subject to legal/regulatory retention.
- Storage rules, retention, destruction protocol, breach handling, and privacy policy references must be configurable and auditable.
- DLA/LSP/customer-care/grievance details should be available for customer-facing channels where applicable.
- The LMS should maintain internal registry/export of DLA/LSP metadata to support NBFC compliance reporting and website disclosure.

### 13.2 KYC design controls

- KYC methods must be configurable because different NBFC products and customer types may use different customer identification procedures.
- CKYC identifier capture/retrieval should be supported where available.
- Digital KYC, V-CIP, DigiLocker/e-documents, Aadhaar OTP/offline verification, PAN verification, and manual verification should be orchestrated but final interpretation must follow NBFC KYC policy.
- Raw Aadhaar and biometrics must not be stored in LMS unless expressly permitted and approved.
- V-CIP readiness should include trained official assignment, liveness/spoof checks, audit trail, secure infrastructure, and periodic testing where used.

### 13.3 Data protection design controls

- Purpose-wise consent ledger.
- Privacy notice and consent text versioning.
- Data principal rights workflow for access, correction, updating, erasure, grievance, and withdrawal.
- Data retention and deletion/anonymisation policy.
- Data-sharing ledger with third-party recipient and purpose.
- Role-based masking and export governance.

### 13.4 AI and scoring guardrails

- MVP lead score is rules-based and explainable.
- LMS must not auto-reject or auto-approve credit.
- Any future AI model must have business owner, model owner, approval status, training data lineage, explainability, bias testing, monitoring, drift detection, human override, and fallback rule.

---

## 14. UAT and Acceptance Criteria

### 14.1 MVP acceptance gates

| Gate | Acceptance evidence |
|---|---|
| Lead capture | Leads created from manual, bulk, API, partner, and customer QR flows with source attribution |
| Duplicate detection | Strong/medium/weak matches tested; override/merge audited |
| Consent ledger | Purpose-wise consent grant/withdraw/deny tested and visible in lead 360/compliance console |
| Product forms | Seven products configured with product-specific fields and documents |
| Allocation | Rules allocate leads with reason codes; manual reassignment audited |
| Customer link | Link creation, OTP/step-up, document upload, expiry, revoke, and audit tested |
| KYC | PAN, document checklist, manual exception, sign-off, and provider failure tested |
| LOS integration | Eligibility request, successful hand-off, duplicate retry prevention, failure queue, status webhook/poll tested |
| Reports | Core and Version 4 reports reconcile under same filters |
| Security | Role/scope/masking/export restrictions validated |
| Audit | Key actions appear in immutable audit log |
| Performance | Load/search/API targets met for agreed volume |
| Compliance | Compliance/DPO can export required audit/consent/grievance evidence |

### 14.2 Regression scenarios

- Duplicate lead from DSA and branch walk-in.
- Customer withdraws marketing consent but keeps KYC consent.
- Customer withdraws LOS hand-off consent before hand-off.
- Provider downtime during PAN verification.
- LOS hand-off succeeds but webhook is delayed.
- RM deactivated with open leads.
- Product checklist version changes while existing leads are in progress.
- Customer link expired and resent.
- Large export requested by BM and masked correctly.
- Partner user attempts to view another partner's lead.
- Admin attempts to view lead content without permission.

---

## 15. Implementation Roadmap

### 15.1 Suggested delivery increments

| Sprint/Increment | Deliverables |
|---|---|
| Increment 1 | Auth/RBAC, user/branch/team master, basic lead capture, source master, lead list |
| Increment 2 | Product config, product-specific forms, document checklist, lead 360 |
| Increment 3 | Duplicate detection, allocation rules, tasks, pipeline, SLA alerts |
| Increment 4 | Consent ledger, customer self-service link, communication templates/provider integration |
| Increment 5 | KYC workbench, PAN integration, document verification, KYC exceptions |
| Increment 6 | LOS eligibility, LOS hand-off, status mirror, integration monitor |
| Increment 7 | Reports/MIS, partner dashboard, export governance, compliance console |
| Increment 8 | Hardening: security, performance, UAT, migration, training, go-live readiness |

### 15.2 Go-live checklist

- Master data loaded and validated.
- Roles and users configured.
- Products/checklists/SLAs approved.
- Consent text and privacy notices approved.
- Templates approved in all required languages.
- LOS/KYC/communication integrations tested in production-like environment.
- VA/PT completed and critical gaps closed.
- Audit/export governance tested.
- UAT sign-off by Sales, Ops, Compliance, IT, and selected branch users.
- Training material and SOPs ready.
- Hypercare owners assigned.

---

## 16. Open Decisions Log

| Ref | Open decision | Recommended default | Owner |
|---|---|---|---|
| OD-01 | Duplicate action by match type | Block strong PAN+mobile; warn medium; queue weak | Sales + Compliance |
| OD-02 | PAN mandatory timing | Progressive capture; mandatory before KYC/hand-off | Compliance + Sales |
| OD-03 | Hand-off owner | BM default; configurable delegation to KYC/Ops or authorised RM | Sales Head + Ops |
| OD-04 | Hot lead rules | Priority high OR amount threshold OR returning customer OR customer submitted docs | Sales Head |
| OD-05 | SLA thresholds | First contact: hot 2 business hours, normal 1 business day; documents 3 business days | Sales Ops |
| OD-06 | Consent purpose list and text | Use purpose-wise consent ledger with NBFC-approved text | Legal/DPO |
| OD-07 | DLA/LSP registry scope | Track all customer-facing digital lead/application interfaces | Compliance |
| OD-08 | CKYC/DigiLocker provider | Select provider and integration method | IT + Compliance |
| OD-09 | V-CIP in MVP or Phase 1.5 | Phase 1.5 unless provider/SOP ready | Ops + Compliance |
| OD-10 | Account Aggregator scope | Phase 1.5 for Secured Business and Mortgage where value is high | Product + IT |
| OD-11 | Offline field mode | Phase 1.5 unless rural/field use case is launch-critical | Sales + IT |
| OD-12 | Export approval thresholds | Approval for >10,000 rows or unmasked PII/SPII | Compliance + IT |
| OD-13 | Regional language support | Templates in Hindi + top 2 state languages for pilot regions | Sales Ops |
| OD-14 | Data retention by lead outcome | Legal/compliance-defined by data category and product | DPO + Legal |
| OD-15 | Partner portal scope | MVP limited submission/status; full portal in Phase 1.5 | Channel Head |

---

## 17. Requirements Traceability Matrix

| Requirement group | Business objectives | Stakeholders | Acceptance evidence |
|---|---|---|---|
| Auth/RBAC/ABAC | BO-07 | IT, Compliance | Role/scope/security tests |
| Omnichannel capture | BO-01 | Sales, Marketing, Branch, Partners | Leads from all configured channels |
| Duplicate/merge | BO-02 | Sales Ops, Compliance | Duplicate queue and audited actions |
| Allocation/scoring | BO-03, BO-04 | BM, SM, Sales Head | Rule allocation and SLA reports |
| Product config | BO-04, BO-05 | Product Ops, RM, IT | Seven product forms/checklists versioned |
| Customer self-service | BO-05 | RM, Customer, Ops | Link upload/status/consent tests |
| KYC orchestration | BO-05, BO-07 | KYC/Ops, Compliance | KYC queue, provider refs, exceptions |
| LOS integration | BO-04 | IT, LOS Ops | Eligibility, hand-off, status mirror |
| Partner workflows | BO-06 | Channel Head, DSA/Dealer | Partner lead submission and quality dashboard |
| Reports/MIS | BO-08 | Sales Head, BM, SM | Reconciled reports and exports |
| Consent/privacy/grievance | BO-07 | DPO, Compliance, Customer | Consent ledger, rights requests, grievance workflow |
| Mobile/field mode | BO-09 | RM, Branch, Field Sales | Mobile/PWA field tests |
| AI-ready telemetry | BO-10 | Product, Data, Risk | Event model and explainable rule score |

---

## 18. Glossary

| Term | Definition |
|---|---|
| NBFC | Non-Banking Financial Company |
| LMS | Lead Management System |
| LOS | Loan Origination System |
| RM/BM/SM | Relationship Manager / Branch Manager / Sales Manager |
| DSA | Direct Selling Agent |
| Dealer/OEM | Vehicle/equipment dealer or original equipment manufacturer source |
| DLA | Digital Lending App/interface |
| LSP | Lending Service Provider |
| KYC | Know Your Customer |
| CKYC/CKYCR | Central KYC / Central KYC Records Registry |
| V-CIP | Video-based Customer Identification Process |
| DPDPA | Digital Personal Data Protection Act |
| DPO | Data Protection Officer |
| PII/SPII | Personal/Sensitive Personal Information |
| BRE | Business Rule Engine |
| LTV | Loan-to-Value |
| FOIR | Fixed Obligation to Income Ratio |
| TAT | Turnaround Time |
| SLA | Service Level Agreement |
| AA | Account Aggregator |
| FIU/FIP | Financial Information User / Financial Information Provider |
| KFS | Key Fact Statement |
| ABAC | Attribute-Based Access Control |
| MFA | Multi-Factor Authentication |
| PWA | Progressive Web Application |

---

## 19. Regulatory Reference Notes Used for Version 4 Design

The following public references were used as product-design anchors. The implementation team should verify the latest versions before sign-off.

1. Reserve Bank of India — **Reserve Bank of India (Digital Lending) Directions, 2025**. Relevant design themes: consented/need-based data collection, no unnecessary mobile-resource access, data storage and privacy policy controls, DLA/LSP reporting, grievance redressal, KFS/disclosures.  
   URL: https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12848&Mode=0

2. Reserve Bank of India — **Master Direction - Know Your Customer (KYC) Direction, 2016**, updated as on 14 August 2025. Relevant design themes: CKYCR, digital KYC, Aadhaar OTP-based e-KYC limits, V-CIP, liveness/spoof checks, audit trail, and secure infrastructure.  
   URL: https://www.rbi.org.in/commonman/english/scripts/notification.aspx?id=2607

3. Government of India / MeitY — **Digital Personal Data Protection Act, 2023**. Relevant design themes: consent, right to correction/updating/erasure, grievance redressal, nomination, and duties of Data Principal.  
   URL: https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf

4. Government of India / MeitY — **Digital Personal Data Protection Rules, 2025**. Relevant design themes: commencement, verifiable consent, techno-legal measures, and phased implementation.  
   URL: https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf

5. Sahamati — **Account Aggregator ecosystem resources**. Relevant design themes: consent-based financial data sharing, FIU/FIP participation, and AA readiness for lending use cases.  
   URL: https://sahamati.org.in/

---

## 20. Final Product Recommendation

The Version 4 LMS should be sold and built as a **front-office origination control tower for NBFCs** rather than a simple lead tracker. The most important differentiators are:

1. Omnichannel, partner-aware lead capture.
2. Rules-based allocation and SLA discipline.
3. Customer self-service for consent and documents.
4. Product-configurable NBFC capture and checklist engine.
5. Consent, data-sharing, DLA/LSP, grievance, and audit readiness.
6. Strong LOS boundary with clean, idempotent hand-off.
7. DSA/dealer quality analytics.
8. Mobile field usability.
9. AI-ready event model without unsafe automated credit decisions.

This combination makes the BRD substantially stronger for Indian NBFCs because it addresses the real operating model: branches, field RMs, DSAs, dealers, asset-specific documents, KYC friction, regulated digital lending, and dependence on LOS/core systems.
