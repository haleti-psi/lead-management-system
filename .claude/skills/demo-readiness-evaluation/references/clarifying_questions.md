# Clarifying Questions Bank

Organized by demo scenario. Pick the relevant subset — never ask all questions. Skip anything already known from the codebase or conversation.

---

## Core Questions (Ask for Every Demo)

1. **Who is the prospect?** Company name (if shareable), industry, rough size, and what you know about their environment (existing tools, pain points, decision drivers).

2. **Who will be in the room?** Roles and their priorities:
   - Decision maker (budget authority) → cares about ROI, risk, vendor viability
   - Champion (internal advocate) → cares about looking good, easy adoption
   - End users → care about usability, speed, learning curve
   - Technical evaluators → care about architecture, security, integration
   - Procurement → cares about compliance, pricing, contract terms

3. **What's the goal of this demo?** Stage and success criteria:
   - First touch → goal: get a follow-up meeting
   - Second meeting → goal: get a pilot/POC approved
   - Final pre-contract → goal: close the deal
   - Proof of value → goal: prove ROI with their data
   - Kickoff → goal: build confidence in the team

4. **How long is the demo?** Duration and format:
   - Under 15 min → elevator pitch, show 1–2 features max
   - 30 min → standard demo, 3–5 features with narrative
   - 60 min → deep dive, include Q&A and exploration time
   - Live / recorded / hybrid

5. **What is the prospect's primary pain point?** In their words if possible. This anchors the entire narrative.

---

## Strategic Questions (Ask When Competitive Situation Exists)

6. **Who are you competing against?** Named competitors or categories (build-vs-buy, status quo, etc.)

7. **What's their typical objection to your product?** The thing that makes prospects hesitate:
   - "Too expensive" → need strong ROI proof
   - "Too complex" → need simplicity wow moment
   - "Too new / unproven" → need stability and data volume signals
   - "Missing feature X" → need to address or redirect
   - "We can build this ourselves" → need to show hidden complexity

8. **What are the 2–3 things you most want them to remember?** The mental anchors after the call ends.

---

## Environment & Constraints Questions (Ask When Demo Logistics Matter)

9. **What environment will the demo run on?**
   - Local laptop → risk: hardware failure, network dependency
   - Staging server → risk: stale data, unexpected changes
   - Production → risk: real user data visible, live bugs
   - Prospect's own environment → risk: setup complexity, data migration
   - Sandbox with prospect's data → risk: data quality, PII concerns

10. **Any non-negotiables from the prospect?**
    - Must run on-prem or specific cloud
    - SOC 2 / HIPAA / GDPR compliance required
    - Specific integrations must be shown
    - Data residency requirements
    - Accessibility standards (WCAG, Section 508)
    - Language/localization requirements

11. **Any known weak spots you already worry about?** The presenter's own anxieties are valuable signal — they often know exactly what could go wrong.

---

## Scenario-Specific Questions

### For Government / Public Sector Demos

- Is there an RFP or formal requirements document we should map to?
- What compliance frameworks apply (FedRAMP, StateRAMP, FISMA, etc.)?
- Are there specific accessibility requirements (Section 508, WCAG 2.1 AA)?
- Will the demo be scored against a rubric? Can we see it?
- Is multi-language support required?
- Are there data sovereignty / residency requirements?

### For Enterprise / Fortune 500 Demos

- What's the existing tech stack we need to integrate with?
- Is SSO/SAML a hard requirement for the demo?
- Who is the economic buyer vs. the technical buyer?
- Is there a security questionnaire we'll need to complete?
- What's the expected implementation timeline they're evaluating against?
- Will they want to see admin/configuration capabilities?

### For Startup / SMB Demos

- What's driving the urgency? (Growth pain, investor pressure, compliance deadline)
- How tech-savvy is the primary user?
- Are they currently using spreadsheets / manual processes?
- What's the budget range (affects how we position value)?
- Is self-service setup important or will they have dedicated onboarding?

### For Technical Audience Demos

- Should we show the API / developer documentation?
- Do they care about the architecture / tech stack decisions?
- Should we demonstrate the deployment / DevOps story?
- Are they evaluating extensibility / customization capabilities?
- Should we show performance benchmarks or scalability evidence?

### For Investor / Board Demos

- What metrics matter most to this audience? (ARR, DAU, retention, NPS)
- Should we show competitive positioning?
- Is there a market-size or TAM slide needed alongside the demo?
- Should we show the product roadmap?
- Are there specific customer logos or case studies to reference?

---

## Questions to Skip (Already Answered by Codebase Analysis)

Do NOT ask these — answer them yourself from the code:

- What does the app do? (Infer from codebase)
- What's the tech stack? (Read package.json / configs)
- What features exist? (Explore routes and components)
- What integrations are configured? (Check configs and dependencies)
- What's the deployment setup? (Check Dockerfiles, CI configs, deploy scripts)
- What data exists? (Check seed scripts and migrations)
- What's the current state of the UI? (Read component files)

---

## Handling "Skip" Responses

If the user says "just evaluate it generically" or "I don't know the prospect details yet":

1. Proceed with the evaluation using a generic prospect profile
2. In the report, clearly mark these sections as "Assumed — update when prospect details are known"
3. Lower confidence ratings on dimensions 8, 9, 11, and 12 (which depend most on prospect context)
4. Provide the demo flow as a template with [PROSPECT PAIN POINT] placeholders
5. Include a "Personalization Checklist" appendix listing what to update when details are known
