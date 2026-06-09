---
name: demo-readiness-evaluation
description: Evaluate whether an application is ready for a deal-winning, high-impact demo to potential clients. Use this skill whenever a user wants to assess demo readiness, prepare for a client demo, dry-run a sales pitch, do a pre-demo audit, or says things like 'is my app ready for the demo', 'evaluate demo readiness', 'prep my product for a client pitch', 'what should I fix before showing this to a customer', or 'audit this app before the sales call'. Also trigger when someone shares a codebase or app and mentions an upcoming demo, sales meeting, client presentation, investor pitch, RFP response, or any high-stakes prospect-facing showcase. Works across domains (SaaS, fintech, healthtech, devtools, internal tools, AI products) and adapts by studying the codebase, then asking targeted clarifying questions before producing a scored, prescriptive Demo Readiness Report as a Word document.
allowed-tools: Read Write Edit Bash Glob Grep WebSearch WebFetch Agent AskUserQuestion
---

# Demo Readiness Evaluation Skill

## Purpose

This skill turns "I have a demo next week, am I ready?" into a concrete, scored, prescriptive plan. It produces a **Demo Readiness Report** (.docx) that tells the user:

- **How ready they are** (overall score out of 10, plus per-dimension scores)
- **What will lose the deal** (critical gaps to fix before the demo)
- **What will win the deal** (the wow moments and proof points to lean on)
- **A recommended demo flow** tailored to the prospect and the app
- **A risk register** with contingencies for the things most likely to go wrong live

The skill is intentionally domain-agnostic. It studies the codebase to infer what the application *is* and what it *does*, then asks the user only the things that cannot be inferred — the prospect's context, the goal of the demo, the audience, and any constraints. Everything else is grounded in evidence pulled from the code.

## When to use this skill

Use this skill when the user asks for a demo readiness assessment, a pre-demo audit, a "is this ready for a client" review, a sales-pitch dry-run, an investor-demo readiness check, or anything similar. Also use it when the user shares an application (codebase path, repo, or even a description) alongside an upcoming high-stakes prospect-facing event. If in doubt and the user is talking about a real or planned demo, prefer using this skill — under-triggering here costs more than over-triggering.

## How the skill works

The workflow is four phases. Do them in order. Skipping phases produces shallow, generic reports that miss the deal-winning specifics.

1. **Discover** — study the codebase to infer domain, value proposition, key user journeys, and current state.
2. **Clarify** — ask the user a small, targeted set of questions about prospect context, demo goals, and constraints. Only ask what cannot be inferred.
3. **Evaluate** — score the application across twelve readiness dimensions using rubrics from the scoring rubric reference, with evidence drawn from the codebase and the user's answers.
4. **Report** — produce a polished Word document at `<outputs>/Demo_Readiness_Report.docx` using the report template reference structure.

The goal at every step is **actionable specificity**. "Improve the UI" is useless. "The settings page (`apps/web/src/pages/Settings.tsx`) renders three empty tabs with placeholder text — either populate them with realistic content or hide the tabs before the demo" is what wins deals.

## Phase 1 — Discover the application

Before asking the user anything, study what you have.

If a codebase path or repo was provided:

- List the top-level structure to understand the tech stack and shape of the project.
- Read the `README`, any `docs/` folder, `package.json` / `pyproject.toml` / equivalent, and any obvious entry-point files (`main.*`, `index.*`, `app.*`, `App.tsx`, etc.).
- Sample 5–15 representative source files across UI, API/backend, data models, and configuration to understand what the app actually does.
- Look for tests, CI configuration, deployment configs, and seed/fixture data — these tell you a lot about maturity.
- Identify obvious integrations (Stripe, Auth0, OpenAI, Twilio, databases, queues, etc.) — these shape both the demo story and the risks.
- Note any `TODO`, `FIXME`, `XXX`, hardcoded `localhost`, `console.log`, commented-out blocks, mock data flags, and feature flags. These are the things that bite during live demos.

Produce a short internal mental model (do not show this to the user yet) covering:

- **What the app is** (one sentence)
- **The domain** (e.g., B2B SaaS for restaurant inventory, consumer health tracker, internal ops tool)
- **Primary personas** the UI seems designed for
- **The 3–5 core user journeys** you can identify
- **Apparent maturity** (prototype / MVP / beta / production)
- **Standout capabilities** (AI features, integrations, unusual UX, performance characteristics)
- **Visible red flags** (broken-looking flows, half-built screens, suspicious mock data, security smells)

If no codebase is provided, ask the user for one — or, if they only have a description, work from the description and clearly flag in the report that the evaluation is description-based and therefore less grounded.

## Phase 2 — Clarify with the user

Ask the user only what you cannot infer. Ask these together as a single batched set of questions using the AskUserQuestion tool, not one at a time, so the user isn't ping-ponged. Skip any question whose answer is already clear from the codebase or earlier conversation.

Consult the clarifying questions reference (`references/clarifying_questions.md` relative to this skill file) for the full bank of questions organized by demo scenario, and pick the right subset rather than asking all of them every time.

Standard clarifying questions:

1. **Who is the prospect?** Company name (if shareable), industry, rough size, and what you know about their environment (existing tools, pain points, decision drivers).
2. **Who in the prospect's organization will be in the room?** (Decision maker, champion, end users, technical evaluators, procurement, etc.) Their priorities differ wildly.
3. **What's the goal of this demo?** First meeting / second meeting / final pre-contract / proof-of-value / kickoff? What does success look like — a follow-up, a pilot, a signed contract?
4. **How long is the demo, and is it live, recorded, or hybrid?**
5. **What is the prospect's primary pain point, in their words if possible?** This anchors the narrative.
6. **What are the 2–3 things you most want them to remember?**
7. **Who are you competing against, and what's their typical objection to your product?**
8. **Any non-negotiables from the prospect?** (e.g., must run on-prem, SOC 2 required, specific integrations, data residency.)
9. **What environment will the demo run on?** (Local laptop, staging, production-like, prospect's own data, sandbox.)
10. **Any known weak spots you already worry about?**

If the user prefers to skip clarification ("just evaluate it generically"), proceed — but in the report, clearly mark assumptions and lower the confidence rating on dimensions that depend on prospect context.

## Phase 3 — Evaluate across twelve dimensions

Score the application 1–10 on each dimension below. Consult the scoring rubric reference (`references/scoring_rubric.md` relative to this skill file) for the detailed meaning of each score level. For every dimension, the report must include: the score, 1–3 sentences of evidence citing specific files / features / observations, and 1–3 concrete recommendations.

The twelve dimensions:

1. **Value Proposition Clarity** — Can a stranger watching the app understand what it does and why it matters within 60 seconds?
2. **Core Functional Completeness** — Do the journeys you'll demo actually work end-to-end, or are there dead ends?
3. **Demo Data Quality** — Is the seed data realistic, story-driven, and voluminous enough to be impressive (no `test@test.com`, no Lorem Ipsum, no three-row tables)?
4. **UI/UX Polish** — Visual consistency, typography, empty states, loading states, micro-interactions, mobile/responsive behavior where it matters.
5. **Performance & Responsiveness** — Page loads, API latency under demo conditions, perceived speed.
6. **Stability & Error Handling** — Does the app handle bad input and edge cases gracefully? Any known crashers on the demo path?
7. **Wow Factor & Differentiation** — Is there at least one moment that makes the prospect go "huh, that's clever"? AI features, automation, visualization, speed — something memorable.
8. **Integration & Ecosystem Story** — Auth, payments, third-party data, exports, webhooks, APIs — do the integrations that matter for this prospect work and look good?
9. **Security, Privacy & Compliance Signals** — Visible role-based access, audit logs, encryption, environment hygiene (no secrets in screenshots), and any certifications relevant to the prospect's industry.
10. **Deployment & Demo Environment Reliability** — Is there a stable demo environment? Can it be rebuilt fast? Is there a backup plan if the primary goes down mid-call?
11. **Narrative & Demo Flow Readiness** — Is there a story arc that maps to the prospect's pain → your solution → measurable outcome? Are the wow moments sequenced well?
12. **Business Outcome Proof** — Visible dashboards, case-study-style artifacts, or in-app evidence that quantifies the value (time saved, cost reduced, revenue lifted, errors avoided).

**Weighting**: Treat dimensions 1, 2, 3, 7, and 11 as deal-critical (weight 1.5x). The rest are weight 1.0x. Compute the overall score as the weighted average, rounded to one decimal.

**Confidence**: For each dimension, also tag a confidence level (High / Medium / Low) based on how much evidence you actually have. Low-confidence scores must be flagged in the report so the user knows where to push back.

## Phase 4 — Produce the Demo Readiness Report

Generate a Word document at `<outputs>/Demo_Readiness_Report.docx`. Use `python-docx` (install with `pip install python-docx --break-system-packages` if needed).

Consult the report template reference (`references/report_template.md` relative to this skill file) for the exact section structure and example wording. The report must include:

1. **Cover & Executive Summary** — Overall readiness score, traffic-light verdict (Green / Yellow / Red), top 3 strengths, top 3 critical gaps, and a one-paragraph go/no-go recommendation.
2. **Demo Context** — Prospect, audience, goal, duration, environment, and the prospect's pain point in their own words.
3. **Application Snapshot** — Inferred domain, value proposition, primary personas, core journeys, tech stack, maturity stage.
4. **Dimension Scorecard** — A table listing all twelve dimensions with score, weighted score, and confidence.
5. **Detailed Dimension Analysis** — One subsection per dimension with evidence, recommendations, and effort/impact tags.
6. **Critical Gaps to Fix Before the Demo** — A prioritized list. Each item has: what's wrong, why it loses the deal, the fix, estimated effort (Hours / Days / Weeks), and owner suggestion if obvious.
7. **Quick Wins** — High-impact, low-effort improvements that can be done before the demo.
8. **Recommended Demo Flow** — A scene-by-scene script outline tailored to the prospect, including timing, the wow moment placement, and what to say at each step. Should map every scene back to the prospect's pain point.
9. **Risk Register & Contingencies** — Top 5 things that could go wrong live, with mitigation and backup plans (e.g., pre-recorded fallback video, local copy, second presenter ready).
10. **Talking Points & Objection Handling** — Bullet points the presenter can glance at, including expected objections and prepared responses.
11. **Post-Demo Follow-Up Suggestions** — What artifacts to send after, and what commitments to ask for.
12. **Appendix: Evidence Log** — File paths, line references, screenshots taken (if any), and quotes from the codebase that back up the scoring. This is the audit trail.

End the response to the user with a short summary of the overall score, the traffic-light verdict, the top three gaps, and the path to the report. Keep the chat-side summary short — the report is the deliverable.

## Style and tone of the report

Write the report like a senior solutions engineer who has been in the room when deals were won and lost. Be specific, be direct, and be useful. Avoid corporate hedging ("it could be considered that perhaps..."). If something is broken, say it's broken and say where. If something is great, say why it will land with this specific prospect.

Two non-negotiables:

- **Cite evidence.** Every score must reference at least one specific file, feature, screen, or behavior. Vague praise and vague criticism are equally useless.
- **Be prescriptive.** Every gap must have a recommended fix. Every recommendation must have an effort estimate.

## Operating tips

- **If the codebase is huge**, sample strategically rather than reading everything. Prioritize the entry points, the routes/screens the demo will hit, the data models, the auth/permissions code, and the seed/fixture data. Note in the report which paths you actually explored.
- **If the user is in a hurry** (e.g., "demo is tomorrow"), front-load the critical-gaps section in your chat summary and produce the report in parallel.
- **If the prospect's industry is regulated** (healthcare, finance, government, education), give the security/compliance dimension extra scrutiny — it's often a silent deal-killer.
- **If the app uses AI/ML features**, the wow-factor dimension typically hinges on whether the AI behaves reliably on cherry-picked demo inputs *and* on adversarial inputs the prospect might try. Note both.
- **If integrations are central** (e.g., a CRM add-on, a Slack app, a Stripe-based product), test that the integrations actually work in the demo environment — broken integrations on a live call are catastrophic.

## Reference files

When you need the detail behind anything in this skill, consult these files (paths relative to this SKILL.md):

- `references/scoring_rubric.md` — full 1–10 rubric for each of the twelve dimensions, with anchors for each score level.
- `references/report_template.md` — the exact section structure and example wording for the Demo Report.
- `references/codebase_signals.md` — a checklist of concrete things to look for in the codebase across the twelve dimensions.
- `references/clarifying_questions.md` — the full bank of clarifying questions, organized by demo scenario.

Read the rubric and the template before generating the report. The rest are consulted as needed.
