---
name: adversarial-idea-evaluator
description: "Evaluate any idea, proposal, strategy, or decision through a 5-advisor council with independent parallel analysis, anonymous peer review, iterative refinement on contested points, and a chairman synthesis. Combines Karpathy's LLM Council methodology with structured adversarial debate. Produces a markdown report. Use this skill whenever the user wants to: evaluate an idea, stress-test a proposal, do a pre-mortem, think through pros and cons, analyze a business decision, assess feasibility, debate the merits of an approach, play devil's advocate, do adversarial analysis, red-team a proposal, or says things like 'what could go wrong', 'help me think this through', 'evaluate this from all angles', 'should I do X or Y', 'what am I missing', or 'challenge this idea'. Also trigger when someone describes a plan and asks for critical feedback, risk assessment, or wants to strengthen their thinking before committing to a decision. Always use this skill — do not attempt a multi-perspective evaluation without it."
allowed-tools: Read Write Edit Bash Glob Grep WebSearch WebFetch
---

# Adversarial Idea Evaluator — 5-Advisor Council

## Why This Process Works

Most ideas fail not because they are bad, but because they were never properly stress-tested. Confirmation bias makes us gravitate toward evidence that supports what we already believe. Optimism bias makes us underweight risks we haven't personally experienced. And when evaluation is done sequentially — one voice responding to the previous — each perspective is contaminated by what came before.

This skill addresses all three failure modes:

- **Five independent cognitive modes** cover angles that a simple Proponent/Opponent debate cannot reach — including the perspective that questions the problem itself, and the perspective of someone with no domain knowledge at all
- **Parallel spawning** ensures each advisor forms their position in isolation, before any cross-pollination occurs, producing genuinely independent views
- **Anonymous peer review** forces reviewers to engage with arguments on their merits, not their source — the same mechanism that makes double-blind academic peer review more reliable than open review
- **Targeted second-pass debate** recovers the iterative refinement dynamic: when the Chairman identifies a fundamental disagreement, the opposing advisors engage directly, forcing positions to evolve in response to the strongest counter-argument
- **Chairman synthesis with veto power** produces a verdict, not a summary — and is explicitly licensed to side with the minority if their reasoning is strongest

---

## The Five Advisors

**The Proponent** thinks like a venture capitalist who just invested in this idea. Builds the most compelling, evidence-grounded case possible. Identifies unique advantages, timing, moats, and opportunities the originator may have missed. When challenged, does not dismiss objections — either shows why they are less severe than they appear, or proposes concrete modifications that address them while preserving core value. Never naively cheerleads.

**The Contrarian** assumes a fatal flaw exists and searches for it. Examines failure modes, competitive threats, regulatory risks, execution risks, second-order effects, and historical precedents of similar ideas failing. Goal is not to kill the idea but to make it bulletproof. A strong attack that gets addressed makes the idea stronger. Occasionally acknowledges genuine strengths — this builds credibility.

**The First Principles Thinker** strips away assumptions and rebuilds from the ground up. Asks "what are we actually trying to solve, and is this the right way to frame it?" May conclude that the question itself is wrong, that a simpler solution exists, or that an unstated assumption is doing most of the work. Does not accept domain conventions as given.

**The Outsider** brings zero domain context. Responds purely to what is presented. Catches the curse of knowledge: jargon that obscures rather than clarifies, hidden assumptions that insiders share but newcomers would reject, complexity that seems necessary from inside the domain but arbitrary from outside it. If the idea cannot be understood without domain knowledge it does not explain, says so.

**The Executor** only cares about feasibility and speed. What is the fastest path to testing this? What do you do Monday morning? What resources, decisions, or dependencies are on the critical path? If there is no clear first step, says so explicitly. Does not engage in abstract debate — evaluates whether the idea can actually be implemented by real people in real conditions.

---

## Process

### Step 1 — Context Enrichment and Framing

Before convening the council:

- Scan the workspace for relevant context: CLAUDE.md, memory files, referenced documents, past evaluations in `doc/evaluations/` (in Claude Code), or any files mentioned in the request
- Frame the question neutrally with enriched context: core decision, key background, what is at stake, what a good outcome looks like
- If the question is too vague to evaluate meaningfully, ask **one** clarifying question, then proceed regardless of the answer

Do not over-interview. Part of the value of this process is surfacing what is unclear about the idea itself.

---

### Step 2 — First-Pass Council (5 Parallel Sub-Agents)

**In Claude Code:** Spawn all 5 advisors simultaneously as parallel sub-agents. Each receives only the framed question and their advisor role description — no other advisor's output.

**In claude.ai (no sub-agents):** Reason through each advisor sequentially, treating each as a fully independent voice. Actively suppress awareness of what previous advisors said while writing each one. Each advisor produces their analysis as if they have seen only the framed question.

Each advisor produces **200–400 words** of substantive, specific analysis. Arguments must reference concrete facts, precedents, examples, or logical reasoning — not vague assertions. No bullet-point summaries; full analytical paragraphs.

---

### Step 3 — Anonymous Peer Review (5 Parallel Sub-Agents)

**This step must not be skipped.** It is the mechanism that catches blind spots no individual advisor sees.

1. Assign a random letter (A–E) to each advisor's response, recording the mapping privately
2. Present all five responses (labelled A–E only) to five new reviewer instances — one per advisor acting as reviewer, each seeing all five responses but not knowing which is theirs

Each reviewer answers three questions:
1. **Which response is strongest, and why?** Be specific about what makes it compelling.
2. **Which response has the biggest blind spot?** Name the blind spot precisely.
3. **What did ALL five responses miss?** This is the most important question — the shared blind spot that no single perspective caught.

**In claude.ai:** Reason through each reviewer perspective sequentially, with the anonymised responses visible. The key discipline is answering question 3 genuinely — what did every response miss, including the one you might implicitly favour?

---

### Step 4 — Chairman Synthesis and Contested Points

The Chairman receives everything: all five advisor responses (de-anonymised), all five peer reviews, and the anonymisation mapping.

The Chairman first produces an **initial synthesis** identifying:

- **Where the Council Agrees** — High-confidence convergence points that multiple advisors reached independently
- **Where the Council Clashes** — Genuine disagreements, not just differences of emphasis
- **Blind Spots Caught** — Insights that only emerged through peer review (question 3 answers)

The Chairman then makes a **contested points determination**: are any of the clashes *fundamental* — meaning the recommendation would materially differ depending on which side is correct?

**If no fundamental clashes exist:** proceed directly to Step 5.

**If one or more fundamental clashes exist:** trigger the targeted second pass (Step 4b).

#### Step 4b — Targeted Second Pass (Contested Points Only)

For each fundamental clash, identify the two or three advisors with the most directly opposing positions on that specific point. Present them only with each other's arguments on that point and ask each to:

1. Identify the strongest element of the opposing argument they must genuinely account for
2. Either defend their original position with that element addressed, or modify it

This is not a full second round — it is a focused exchange on the single most important unresolved disagreement. One pass per contested point.

**In claude.ai:** Reason through each advisor's targeted response sequentially.

The Chairman incorporates the second-pass exchange into the final synthesis.

---

### Step 5 — Final Verdict

The Chairman produces the complete output:

**Where the Council Agrees** — Convergence points that survived independent analysis and peer review. These are the highest-confidence findings.

**Where the Council Clashes** — Genuine disagreements with both sides' strongest reasoning stated fairly. If a second pass occurred, include how positions evolved.

**Blind Spots Caught** — Insights that only emerged through peer review. Name the blind spot and which reviewer(s) caught it.

**Idea Evolution** — How the idea or the evaluation of it changed from first-pass advisor responses through peer review to final synthesis. What prompted each significant shift.

**Risk Register** — Structured table of identified risks:

| Risk | Severity | Source Advisor | Addressed in Second Pass? | Mitigation |
|------|----------|---------------|--------------------------|------------|
| ... | High/Med/Low | ... | Yes/No/N/A | ... |

**The Recommendation** — A clear, direct answer. Not "it depends." The Chairman is licensed to disagree with the majority if the dissenting reasoning is strongest — in which case the dissent and its reasoning must be explicitly stated.

**The One Thing to Do First** — A single concrete next step. Specific enough to act on Monday morning.

---

### Step 6 — Generate Report

**In Claude Code:** Write the full report to `doc/evaluations/<idea-slug>-council-report-<timestamp>.md`

**In claude.ai:** Write the report as a downloadable `.md` file in the outputs directory, or present it directly in the conversation if no filesystem is available.

**Report structure:**

```
# Council Evaluation: <Idea Title>
*Date · Framed question*

## Chairman's Verdict
[Where Council Agrees · Where Council Clashes · Blind Spots ·
 Idea Evolution · Risk Register · Recommendation · First Step]

## Advisor Responses
[All 5 first-pass responses, labelled by advisor name]

## Peer Reviews
[All 5 peer reviews, with anonymisation mapping revealed]

## Second Pass (if triggered)
[Contested point(s) · Advisor exchanges · How positions evolved]
```

---

### Step 7 — Present Results in Chat

Brief summary only — the report has the details. Cover:
- The recommendation and the one first step
- The single most important thing the council agreed on
- The single most important clash (if unresolved)
- Whether a second pass was triggered and what it changed

---

## Quality Standards

These apply whether running with sub-agents (Claude Code) or sequentially (claude.ai):

- Each advisor must produce analysis specific to this idea — not generic observations that would apply to any proposal in the domain
- The Contrarian must identify at least one risk that is non-obvious — something the proposer likely did not consider
- The First Principles Thinker must either validate the problem framing or challenge it — not simply restate the proposal
- The Outsider must identify at least one piece of jargon or hidden assumption — not simply say the idea is clear
- The Executor must name a specific first action, resource requirement, or dependency — not simply endorse or reject feasibility in the abstract
- Peer reviewers must answer question 3 (what did all responses miss) with genuine content — "nothing was missed" is not an acceptable answer
- The Chairman's recommendation must be actionable — a verdict the user can act on, not a balanced summary of the debate

---

## Rules

- Do not council trivial questions — just answer them directly
- Always anonymise before peer review — never skip this step
- The Chairman can and should overrule the majority when the minority reasoning is stronger; state the overrule explicitly
- Use web search to verify factual claims when available and relevant
- Context enrichment before convening is high-leverage — reading relevant workspace files dramatically improves specificity
- The second pass is triggered by *fundamental* clashes only — not every disagreement. If the recommendation is the same regardless of which side is right, no second pass is needed
