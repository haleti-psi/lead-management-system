# Demo Readiness Report — Document Template

Use this template to structure the .docx output. Every section is mandatory unless noted otherwise.

---

## Document Metadata

- **Title:** Demo Readiness Report — {Application Name}
- **Subtitle:** Prepared for {Prospect Name} Demo on {Date}
- **Date:** {Generation Date}
- **Confidentiality:** Internal — Do Not Distribute

---

## Section 1: Executive Summary

**Format:** 1 page max. No subsections.

**Content:**

> **Overall Readiness Score: {X.X}/10 — {Traffic Light Verdict: GREEN / YELLOW / RED}**
>
> **Go/No-Go Recommendation:** {One paragraph. Be direct. "This application is ready for a live demo with the following caveats..." or "This application is not ready. The following critical gaps must be addressed before presenting to {Prospect}..."}
>
> **Top 3 Strengths:**
> 1. {Strength with specific evidence}
> 2. {Strength with specific evidence}
> 3. {Strength with specific evidence}
>
> **Top 3 Critical Gaps:**
> 1. {Gap with severity and effort estimate}
> 2. {Gap with severity and effort estimate}
> 3. {Gap with severity and effort estimate}

---

## Section 2: Demo Context

**Format:** Short paragraphs or a key-value table.

| Field | Value |
|-------|-------|
| Prospect | {Name, industry, size} |
| Audience | {Roles in the room and their priorities} |
| Demo Goal | {Stage and success criteria} |
| Duration | {Minutes, format (live/recorded/hybrid)} |
| Environment | {Where the demo will run} |
| Prospect Pain Point | {In their words if available} |
| Key Competitors | {If known} |
| Non-Negotiables | {Hard requirements from the prospect} |

If any fields are unknown, mark them as "Not provided — assumptions noted below" and state the assumption.

---

## Section 3: Application Snapshot

**Format:** Narrative paragraph + summary table.

| Attribute | Finding |
|-----------|---------|
| Domain | {e.g., Government workflow automation} |
| Value Proposition | {One sentence} |
| Primary Personas | {List} |
| Core User Journeys | {3–5 journeys identified} |
| Tech Stack | {Frontend, backend, database, infra} |
| Maturity Stage | {Prototype / MVP / Beta / Production} |
| Notable Integrations | {Auth, payments, APIs, etc.} |

---

## Section 4: Dimension Scorecard

**Format:** Table with conditional formatting guidance.

| # | Dimension | Score | Weight | Weighted | Confidence | Verdict |
|---|-----------|-------|--------|----------|------------|---------|
| 1 | Value Proposition Clarity | X | 1.5x | X.X | High/Med/Low | Brief note |
| 2 | Core Functional Completeness | X | 1.5x | X.X | High/Med/Low | Brief note |
| 3 | Demo Data Quality | X | 1.5x | X.X | High/Med/Low | Brief note |
| 4 | UI/UX Polish | X | 1.0x | X.X | High/Med/Low | Brief note |
| 5 | Performance & Responsiveness | X | 1.0x | X.X | High/Med/Low | Brief note |
| 6 | Stability & Error Handling | X | 1.0x | X.X | High/Med/Low | Brief note |
| 7 | Wow Factor & Differentiation | X | 1.5x | X.X | High/Med/Low | Brief note |
| 8 | Integration & Ecosystem Story | X | 1.0x | X.X | High/Med/Low | Brief note |
| 9 | Security, Privacy & Compliance | X | 1.0x | X.X | High/Med/Low | Brief note |
| 10 | Deployment & Demo Environment | X | 1.0x | X.X | High/Med/Low | Brief note |
| 11 | Narrative & Demo Flow Readiness | X | 1.5x | X.X | High/Med/Low | Brief note |
| 12 | Business Outcome Proof | X | 1.0x | X.X | High/Med/Low | Brief note |
| | **Overall** | | | **X.X** | | **{Verdict}** |

Color guidance for the Word doc:
- Score >= 8: Green fill
- Score 6–7: Yellow fill
- Score <= 5: Red fill

---

## Section 5: Detailed Dimension Analysis

**Format:** One subsection per dimension. Each subsection follows this structure:

### 5.{N} — {Dimension Name} — Score: {X}/10 ({Confidence})

**Evidence:**
- {Specific observation citing file path, feature, or behavior}
- {Second observation}
- {Third observation if applicable}

**Recommendations:**
| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| 1 | {Specific action} | {Hours/Days/Weeks} | {High/Medium/Low} |
| 2 | {Specific action} | {Hours/Days/Weeks} | {High/Medium/Low} |

---

## Section 6: Critical Gaps to Fix Before the Demo

**Format:** Numbered list, sorted by severity (deal-killers first).

### Gap {N}: {Short Title}

- **What's wrong:** {Specific description with file/feature reference}
- **Why it loses the deal:** {Impact on the prospect's perception or decision}
- **Recommended fix:** {Concrete steps}
- **Estimated effort:** {Hours / Days / Weeks}
- **Owner suggestion:** {Role or person best suited, if obvious}

---

## Section 7: Quick Wins

**Format:** Bulleted list of high-impact, low-effort improvements.

Each item: "{What to do} — {Why it matters} — {Effort: under N hours}"

Target 5–10 items. These should be things that can be done the day before the demo.

---

## Section 8: Recommended Demo Flow

**Format:** Scene-by-scene outline with timing.

### Scene {N}: {Title} ({X} minutes)

- **What to show:** {Specific screens/features}
- **What to say:** {Key talking points — 2–3 bullets}
- **Prospect pain point addressed:** {Which pain this maps to}
- **Wow moment:** {Yes/No — if yes, describe the moment}
- **Transition to next scene:** {How to move naturally to the next topic}

Include total timing that matches the demo duration constraint.

---

## Section 9: Risk Register & Contingencies

**Format:** Table with 5–8 risks.

| # | Risk | Likelihood | Impact | Mitigation | Backup Plan |
|---|------|-----------|--------|------------|-------------|
| 1 | {Risk description} | High/Med/Low | High/Med/Low | {Prevention steps} | {What to do if it happens live} |

---

## Section 10: Talking Points & Objection Handling

**Format:** Two sub-sections.

### Key Talking Points
- {Point 1 — maps to prospect's pain}
- {Point 2 — maps to differentiator}
- {Point 3 — maps to business outcome}

### Expected Objections & Responses

| Objection | Response |
|-----------|----------|
| "{Expected objection}" | "{Prepared response with evidence}" |

---

## Section 11: Post-Demo Follow-Up Suggestions

**Format:** Bulleted list.

- **Within 24 hours:** {What to send — summary email, recording, specific artifact}
- **Within 1 week:** {Follow-up action — POC proposal, technical deep-dive, reference call}
- **Ask for:** {Commitments to request — next meeting, access to their data, intro to decision maker}

---

## Section 12: Appendix — Evidence Log

**Format:** Table or structured list.

| Dimension | Evidence Type | Source | Detail |
|-----------|--------------|--------|--------|
| {Dimension} | File reference | {path:line} | {What was observed} |
| {Dimension} | Feature test | {URL/screen} | {Behavior noted} |
| {Dimension} | Code pattern | {path:line} | {Pattern found — e.g., hardcoded mock data} |

This section is the audit trail. Include everything that informed the scoring so the user can verify and challenge specific findings.
