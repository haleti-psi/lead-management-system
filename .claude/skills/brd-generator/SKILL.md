---
name: brd-generator
description: "Generate a comprehensive, AI-buildable Business Requirements Document (BRD) from a single paragraph of input. Use this skill whenever a user asks to create a BRD, business requirements document, product requirements, PRD, software spec, functional specification, app requirements, or says anything like 'write requirements for an app', 'spec out this idea', 'document the requirements', 'create a requirements doc for this project', or 'I have an app idea and need a BRD'. Also trigger when someone provides a short description of a business/app idea and asks for it to be fleshed out into a full document. The output is a professional .docx file detailed enough for an AI coding agent (or a fleet of parallel agents) to build the entire application without further clarification."
---

# BRD Writer Skill

## Purpose

Transform a short (1-paragraph) business idea description into a comprehensive Business Requirements Document (BRD) delivered as a professionally formatted .docx file. The BRD must be detailed enough that an AI platform (Claude, GPT, Copilot, etc.) could build the complete application from it without asking follow-up questions.

The BRD must also act as a **shared build contract for parallel AI agents**. It must define the common application foundation, a single holistic data model, cross-feature implementation conventions, and a low-level design for every functional requirement so separate agents do not invent incompatible schemas, APIs, validations, or UI patterns.

Keep the BRD readable for business stakeholders while giving AI builders implementation-grade guidance. Keep executive, scope, user, and KPI sections business-facing. Put technical specificity in the shared foundation, data model, API, low-level design, traceability, and testing sections.

## Why This Level of Detail Matters

A BRD that says "the system should manage users" is useless to an AI builder. An AI builder needs: what fields does a user have? What are the validation rules? What roles exist? What can each role do? What happens on failed login? Which shared user table should every feature reference? Which API error shape should every endpoint return? This skill produces that level of specificity — every section contains concrete fields, rules, constraints, and behaviors, not vague descriptions.

## Process

### Step 1: Analyze the Input Paragraph

Read the user's paragraph carefully and extract:
- **Core domain**: What business problem does this solve?
- **Primary users**: Who will use this? (Infer roles even if not stated)
- **Key entities**: What are the main data objects? (e.g., Orders, Products, Users)
- **Core workflows**: What are the 3-5 main things users will do?
- **Implied requirements**: What's not said but obviously needed? (Authentication, notifications, dashboards, etc.)
- **Shared platform capabilities**: What functionality applies across many modules? (Authentication, authorization, audit trail, search/filter/sort, pagination, file uploads, notifications, reporting, settings, reference data)
- **Cross-feature dependencies**: Which features depend on the same entities, workflows, permissions, APIs, or state transitions?
- **Implementation risks**: Where might separate AI agents accidentally create duplicate tables, inconsistent statuses, conflicting validations, or incompatible UI/API contracts?

Think expansively. A user who says "I want a restaurant ordering app" implicitly needs: a menu management system, an order workflow, payment processing, delivery tracking, customer accounts, restaurant admin panel, notification system, and reporting. Spell all of this out.

### Step 1A: Calibrate Document Depth

Scale BRD depth to the size and risk of the idea without weakening the required structure:
- **Small/simple app**: Keep all mandatory sections, but use fewer entities, fewer FRs, compact LLDs, and only the APIs/screens/workflows that are genuinely needed. Do not invent enterprise features unless clearly implied.
- **Medium business app**: Provide full detail for core modules, shared platform capabilities, canonical data model, major APIs, key screens, workflows, notifications, reports, and integration points.
- **Complex/regulated/multi-agent build**: Provide exhaustive low-level design, deeper permission matrices, more detailed data governance, migration, audit, observability, rollback, reconciliation, and agent assignment guidance.

Even for small apps, do not skip the holistic data model, shared conventions, FR-level LLDs, traceability, or final reconciliation. Make them concise instead.

**Small-app LLD exemplar**: For a tiny single-purpose app (e.g., a personal todo list with ~5 entities and ~8 FRs), an acceptably compact LLD for "FR-003: Mark Todo Complete" might be a 9-row LLD table where each cell is 1-2 sentences: Components = "TodoRow component with checkbox; optimistic UI flip"; Backend Flow = "PATCH /api/todos/:id with {completed: true} → validate ownership → UPDATE todos SET completed=true, completed_at=NOW() WHERE id=$1 AND user_id=$2 → return updated row"; Data Operations = "Updates Todo.completed, Todo.completed_at, Todo.updated_at"; Validation = "id must exist and belong to caller"; Authorization = "user must own todo (row.user_id == session.user_id)"; State Changes = "audit_log row written; no notifications"; Failure Handling = "404 if not found, 403 if not owner, 409 if already completed"; Dependencies = "shared auth middleware, shared audit logger"; Test Guidance = "unit: ownership check; API: 200/404/403 paths". That level of compactness is fine — what is NOT fine is omitting the LLD table entirely or collapsing it to "user clicks checkbox, todo is updated".

### Step 1B: Draft the Shared Build Contract First

Before writing detailed requirements, establish the shared foundation that all later sections must obey:
- Define the application modules and their boundaries.
- Create a preliminary canonical entity inventory and relationship map.
- Identify common features that multiple modules will reuse instead of re-implementing.
- Define global conventions for IDs, timestamps, audit fields, soft deletion, statuses, enums, validation messages, pagination, filtering, sorting, API errors, route naming, UI components, and permissions.
- Decide which entities, APIs, screens, workflows, and notifications each feature will reference.
- Note integration dependencies between features so parallel agents know what must be built first or mocked.

This build contract is not optional. Every functional requirement, low-level design, API endpoint, screen, and workflow must reference it instead of creating local alternatives.

### Step 2: Generate the BRD Content

The BRD must contain ALL of the following sections. Do not skip any section. Each section should be substantive (not a placeholder).

#### Section 1: Executive Summary
- Project name (invent a professional one if not given)
- One-paragraph project description
- Business objectives (3-5 bullet points)
- Target users and their pain points
- Success metrics (KPIs with specific measurable targets)

#### Section 2: Scope & Boundaries
- **In Scope**: Explicitly list every feature that will be built
- **Out of Scope**: Explicitly list what will NOT be built (this prevents scope creep and tells the AI builder where to stop)
- **Assumptions**: List what you're assuming about the environment, users, data
- **Constraints**: Technical, budget, timeline, regulatory constraints
- **Feature Module Map**: Group the in-scope work into coherent modules and list which functional requirements belong to each module
- **Common Capabilities**: List features that apply across modules and must be implemented once for the whole application, not separately by each feature team

#### Section 3: User Roles & Permissions
For each role, specify:
- Role name and description
- What they can see (read permissions)
- What they can do (write/edit/delete permissions)
- What they cannot do (explicit denials)

Present as a permissions matrix table.

#### Section 4: Shared Application Foundation & Cross-Agent Build Instructions
This section gives every AI builder the same implementation baseline before they work on separate features. It must be concrete enough that an agent implementing only one feature still understands the global contracts it must follow.

Include:
- **Architecture assumptions**: Frontend framework, backend style, database type, authentication pattern, deployment assumptions, and any explicit technology defaults when the user did not specify them.
- **Module boundaries**: List each module, its responsibility, the entities it owns, and the shared entities it consumes.
- **Common features to implement once**: Authentication, role-based access control, audit logging, validation framework, global search/filter/sort/pagination, notifications, file handling, settings, reference/master data, import/export, reporting, and dashboard widgets when relevant.
- **Shared data conventions**: ID format, naming style, timestamp handling, timezone, currency/number formats, soft deletion, status enum naming, audit fields, optimistic locking/versioning if needed, and tenant/organization scoping if relevant.
- **Shared API conventions**: Base URL, versioning, auth headers, pagination shape, filter/sort syntax, idempotency rules, transaction expectations, standardized errors, and response envelope rules.
- **Shared UI conventions**: Design system, layout shell, navigation model, reusable table/form/modal/toast patterns, loading/empty/error states, responsive breakpoints, accessibility expectations, and date/currency display formats.
- **Shared security conventions**: Password/session rules, permission checks, sensitive-data handling, audit events, file upload restrictions, and rate limits.
- **Parallel-agent instructions**: Agents must reuse the canonical data model, shared APIs, shared components, shared enums, and shared validation rules. Agents must not create feature-local substitutes for entities or conventions already defined in the BRD.
- **Testing expectations**: Unit, integration, API, accessibility, and end-to-end test expectations that apply to all features.

#### Section 5: Holistic Data Model
The data model is the single canonical source of truth for the whole application. It must be designed holistically before or alongside the functional requirements so independent agents do not create isolated tables for their assigned features.

For every entity in the system, specify:
- Entity name
- All fields with: field name, data type, required/optional, validation rules, default value
- Relationships to other entities (one-to-many, many-to-many, etc.)
- Sample data (2-3 rows showing realistic values)
- Owning module and consuming modules
- Functional requirements that read from, write to, create, update, delete, or archive the entity
- Primary keys, foreign keys, unique constraints, indexes, and important query patterns
- Allowed status values, enum values, lifecycle states, and reference/master data values
- Audit, retention, archival, soft-delete, and data privacy rules

Present each entity as a detailed table. This is the most critical section for AI builders — be exhaustive. Include fields that are commonly forgotten: created_at, updated_at, created_by, status, soft-delete flags.

Also include these data-model subsections:
- **Entity Inventory**: One table listing every entity, purpose, owning module, consuming modules, and related FR IDs.
- **Relationship Map**: A concise text or table representation of one-to-one, one-to-many, and many-to-many relationships.
- **Entity Ownership & Reuse Matrix**: A matrix of Entity → Owning Module → Read FRs → Write FRs → Delete/Archive FRs.
- **Enum & Reference Data Catalog**: A single catalog of statuses, types, categories, roles, and other controlled values. Do not redefine enum values inside individual FRs.
- **Data Integrity Rules**: Cross-entity constraints, cascade behavior, uniqueness rules, transaction boundaries, and duplicate-prevention rules.

**Holistic model rule**: Before finalizing the data model, cross-reference every feature in Section 6 (Functional Requirements). If a feature references an entity (e.g., "wishlist", "comments", "ratings"), that entity MUST exist in this section with a full field table. A functional requirement's low-level design may reference entities, fields, relationships, and enums from this section, but it must not invent new tables or conflicting field definitions. After writing both sections, do one final pass to verify: every entity mentioned in any FR, screen, workflow, notification, report, or API has a corresponding data model definition.

**Sample data is mandatory for every entity** — not just the main ones. An AI builder uses sample data to understand field formats, realistic value ranges, and edge cases (e.g., is a phone field stored as "9876543210" or "+91-9876543210"?). Provide 2-3 rows per entity, no exceptions.

#### Section 6: Functional Requirements With Low-Level Design
Organize by feature module. For each feature:
- Feature ID (e.g., FR-001)
- Feature name
- Description (2-3 sentences minimum)
- User story: "As a [role], I want to [action] so that [benefit]" — **mandatory for every FR, no exceptions, including admin features**
- Acceptance criteria (3-5 testable conditions per feature)
- Business rules (specific logic: "If order total > $100, apply 10% discount")
- UI behavior notes (what happens on click, on submit, on error)
- Edge cases and error handling
- Data model references: canonical entities, fields, relationships, and enum values from Section 5 that this feature reads or writes
- API references: internal/external endpoints from Section 8 that this feature uses or exposes
- Permission references: roles and permission rules from Section 3
- Cross-feature dependencies: other FRs, shared services, or workflows this feature depends on

For every functional requirement, include a **Low-Level Design (LLD)** subsection. The LLD must be implementation-oriented but not full source code. It must include:
- **Component and screen behavior**: Screens, reusable components, form fields, table columns, modals, toasts, loading states, empty states, and error states required by the feature.
- **Backend/service flow**: Step-by-step processing logic from request to validation, authorization, database operations, side effects, and response.
- **Data operations**: Exact entities and fields created, read, updated, deleted, archived, or queried. Reference Section 5 entity names and fields exactly.
- **Validation logic**: Field-level and cross-field validations, duplicate checks, and user-visible validation messages.
- **Authorization logic**: Role/permission checks before every sensitive action.
- **State changes and side effects**: Status transitions, notifications, audit events, report updates, cache invalidation, and integration calls.
- **Failure handling**: Realistic failure modes, returned error code, user-facing behavior, retry behavior when relevant, and rollback/transaction behavior.
- **Dependencies and reuse**: Shared components, services, enums, utilities, data model entries, and API contracts that must be reused.
- **Test guidance**: Minimum unit, integration, API, and UI test cases for the feature, including one valid path and the most important invalid/error paths.

Use this exact FR structure so every feature is consistent:

```markdown
### FR-XXX: [Feature Name]

**Module:** [Module name]
**Primary Role(s):** [Role names]
**User Story:** As a [role], I want to [action] so that [benefit].
**Description:** [2-3 concrete sentences]

**Acceptance Criteria**
1. [Testable condition]
2. [Testable condition]
3. [Testable condition]

**Business Rules**
- [Rule with exact condition and outcome]

**Data Model References**
| Entity | Fields Used | Operation | Notes |
| --- | --- | --- | --- |

**API References**
| Method | Endpoint | Purpose | Request/Response Example Location |
| --- | --- | --- | --- |

**UI Behavior Notes**
- [Click/submit/error/loading/empty/success behavior]

**Edge Cases and Error Handling**
- [Failure condition -> system response -> user-visible message]

#### Low-Level Design
| Area | Implementation Guidance |
| --- | --- |
| Components and Screen Behavior | [Screens, components, fields, tables, modals, states] |
| Backend/Service Flow | [Step-by-step request, validation, authorization, persistence, side effects, response] |
| Data Operations | [Exact Section 5 entities and fields read/written] |
| Validation Logic | [Field and cross-field validation plus exact messages] |
| Authorization Logic | [Roles, permissions, ownership checks] |
| State Changes and Side Effects | [Statuses, audit events, notifications, integration calls, cache/report effects] |
| Failure Handling | [Error codes, rollback, retry, user-visible behavior] |
| Dependencies and Reuse | [Shared components, services, enums, API contracts, other FRs] |
| Test Guidance | [Unit, API/integration, UI/E2E valid and invalid cases] |
```

LLDs must reinforce the holistic data model. If an LLD needs data that is not in Section 5, update Section 5 instead of defining a local table, local enum, or duplicate field inside the FR.

Number every requirement for traceability.

#### Section 7: User Interface Requirements
For each major screen/page:
- Screen name and purpose
- Layout description (what sections exist and where)
- Key UI components (tables, forms, charts, cards)
- Design-system expectations: for React apps, specify Tailwind + shadcn/ui/Radix primitives as the preferred default when no mature design system exists; otherwise name the equivalent component library and token system to use.
- Navigation flow (where does this screen lead to/come from)
- Responsive behavior notes
- Related FR IDs, entities, API endpoints, permission checks, and reusable components
- Empty, loading, error, success, and disabled states
- Bulk action behavior, pagination, filter/sort behavior, and column behavior for data-heavy screens

Do NOT create mockups — describe layouts in enough detail that an AI builder can create them.

#### Section 8: API & Integration Requirements
- List all external APIs or services needed (payment gateways, email services, maps, etc.)
- For each internal API endpoint, specify: method, path, request body, response body, error codes
- Authentication method (JWT, OAuth, API keys, etc.)
- Rate limiting requirements
- Shared API conventions: response envelope, pagination shape, filtering/sorting syntax, idempotency keys, retry behavior, versioning, and correlation/request IDs
- Related FR IDs, entities, permission checks, state transitions, side effects, and audit events for each endpoint
- Transaction boundaries for multi-entity writes

**Standardized error response format**: Define the error response shape that all endpoints use (e.g., `{ "error": { "code": "VALIDATION_ERROR", "message": "Email is required", "field": "email" } }`). Specify this once and reference it throughout. AI builders need a single, consistent error contract.

**HTTP status + error-code catalog**: Define a single canonical catalog mapping every error condition to (a) an HTTP status code and (b) a stable machine-readable `code` string. Every endpoint in this section, every LLD's "Failure Handling" row, and every UI error-state must reference codes from this catalog rather than inventing new ones. Cover at minimum: `VALIDATION_ERROR` (400), `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500), `UPSTREAM_UNAVAILABLE` (503), plus any domain-specific codes (e.g., `PAYMENT_DECLINED`, `INVENTORY_OUT_OF_STOCK`). Present the catalog as a table: Code → HTTP Status → Meaning → Typical Triggering FRs → User-Visible Message Template. New codes added by any agent must be registered here first; this is the single source of truth.

**Request/response body examples**: For the 3-5 most complex endpoints (typically: create entity, update entity, list with filters), provide a concrete JSON example of the request body and the expected success response body. Without these, an AI builder has to guess field names and nesting.

#### Section 9: Non-Functional Requirements
- **Performance**: Response time targets, concurrent user capacity
- **Security**: Authentication method, data encryption, OWASP compliance notes
- **Scalability**: Expected growth, horizontal/vertical scaling approach
- **Availability**: Uptime target (e.g., 99.9%)
- **Data Backup & Recovery**: Backup frequency, RPO, RTO
- **Accessibility**: WCAG compliance level
- **Browser/Device Support**: Which browsers, mobile vs desktop

#### Section 10: Workflow & State Diagrams
For each major workflow (order processing, user registration, approval chains, etc.):
- List each state an entity can be in
- List all transitions between states
- Specify who/what triggers each transition
- Describe what happens at each transition (side effects: emails sent, status updates, etc.)

Present as a state table: Current State → Action → Next State → Side Effects.

#### Section 11: Notification & Communication Requirements
- List every event that triggers a notification
- For each notification: channel (email/SMS/in-app/push), recipient, trigger condition, message content template
- Notification preferences (can users opt out?)
- Related FR ID, entity, state transition, and audit event for each notification

#### Section 12: Reporting & Analytics
- List all reports/dashboards needed
- For each report: name, audience, data sources, filters, refresh frequency
- Key metrics and how they're calculated
- Source entities, joins, aggregation formulas, permission filters, export formats, and stale-data behavior

#### Section 13: Migration & Launch Plan
- Data migration needs (if replacing an existing system)
- Phased rollout plan (what ships in v1 vs v2)
- Go-live checklist

#### Section 14: Traceability, Dependency & Parallel Agent Plan
This section is mandatory because many AI builds are split across agents. It must make integration boundaries and shared contracts explicit.

Include:
- **Traceability Matrix**: FR ID → User role → Screen(s) → API endpoint(s) → Entity/entities → Workflow/state transition → Notification(s) → Report(s) → Test cases.
- **Feature Dependency Map**: Which FRs must be implemented first, which can run in parallel, and which require mock/stub contracts.
- **Agent Assignment Guidance**: Recommended grouping of features for parallel implementation, with owned modules and shared dependencies.
- **Integration Checkpoints**: When to reconcile schema, API contracts, permissions, shared components, and workflow states.
- **Shared Contract Change Rule**: If an agent discovers a needed field, enum, API, or shared behavior, update the top-level BRD sections first, then update affected FR LLDs.
- **Conflict-Resolution Protocol**: When two agents propose incompatible extensions to the same shared contract (entity, enum, API endpoint, error code, shared component), the change is paused and routed to a designated arbiter — name the role explicitly in the BRD (e.g., "Lead Architect Agent" or "Human Tech Lead"). The arbiter picks one canonical version, the BRD is versioned (bump the document version in the header, log the change in an "Amendments" subsection with date, FRs affected, and rationale), and all dependent agents re-pull the updated contract before resuming. No agent may merge a feature whose LLD references a contract version older than the current BRD version.
- **Final Contract Reconciliation Table**: A table proving that every FR has data model entries, API contracts, UI screens, permissions, tests, and workflow/notification/report references where applicable. Include a final "Unresolved Gaps" row, and it must be `0`.

#### Section 15: Glossary
- Define all domain-specific terms used in the document

#### Section 16: Appendices
- Any additional reference material, sample data formats, or regulatory requirements

### Step 3: Create the .docx File

Read the docx skill at `/mnt/skills/public/docx/SKILL.md` and follow its instructions to create a professionally formatted Word document. Apply these formatting standards:

- Use Heading 1 for section titles, Heading 2 for subsections, Heading 3 for sub-subsections
- Use properly formatted tables (with header rows shaded) for data models, permissions matrices, traceability matrices, low-level design summaries, and state diagrams
- Use numbered lists for requirements (FR-001, FR-002, etc.)
- Include a table of contents
- Use consistent fonts: Arial 12pt body, with appropriate heading sizes
- Page numbers in footer
- Document title and "Confidential" in header
- Professional color scheme (dark blue headings, light blue table headers)

If the docx skill is not available in the environment (e.g., a local Claude Code session without `/mnt/skills`), fall back to producing a polished Markdown document with the same structure and inform the user that DOCX export requires the docx skill or an external converter like `pandoc`. Do not claim headers, footers, table shading, fonts, or colors were applied unless the conversion tooling actually enforced them.

### Quality Checklist

Before finalizing, verify the BRD against these criteria:
1. **Shared build contract**: Does Section 4 define common application foundation, cross-agent instructions, shared conventions, reusable capabilities, and testing expectations clearly enough for agents working in parallel?
2. **Holistic data model**: Could an AI builder create the database schema from Section 5 alone? Fields, types, relationships, keys, indexes, enums, ownership, reuse, lifecycle, audit rules, and sample data must all be specified.
3. **Data ownership and reuse**: Does Section 5 include an entity inventory, relationship map, entity ownership/reuse matrix, enum/reference catalog, and data integrity rules?
4. **Functional completeness**: Could an AI builder implement every feature from Section 6 alone? Acceptance criteria, business rules, LLD, data references, API references, permissions, and dependencies must be unambiguous.
5. **LLD completeness**: Does every FR include a Low-Level Design subsection with component behavior, backend/service flow, data operations, validation, authorization, state changes, failure handling, dependencies/reuse, and test guidance?
6. **LLD/data consistency**: Does every LLD reference canonical Section 5 entities and fields exactly, without inventing local tables, conflicting enums, duplicate fields, or incompatible validations?
7. **UI buildability**: Could an AI builder build every screen from Section 7 alone? Layout, components, navigation, responsive behavior, states, permissions, API references, and entity references must be specified.
8. **Design-system consistency**: Does Section 7 define a coherent design system and primitive component expectations (Tailwind + shadcn/ui for React by default, or a documented equivalent)?
9. **API completeness**: Does Section 8 define shared API conventions, standardized errors, transaction expectations, and request/response JSON examples for the 3-5 most complex endpoints?
10. **Vagueness removal**: Are there any vague phrases like "the system should handle errors appropriately"? Replace them with specific behavior.
11. **Traceability**: Is every feature numbered for traceability, and does Section 14 map every FR to roles, screens, APIs, entities, workflows, notifications, reports, and tests?
12. **User story completeness**: Does every FR, including admin features, have a "As a [role]..." user story and acceptance criteria?
13. **Entity relationship completeness**: Are all entity relationships explicitly stated, including many-to-many join entities and cascade/retention behavior?
14. **Cross-reference consistency**: Does every entity mentioned in any functional requirement, LLD, screen, workflow, notification, report, or API exist in Section 5? If FR-017 mentions "wishlist", there must be a Wishlist or Wishlists entity in Section 5.
15. **Sample data completeness**: Does every entity in Section 5 have 2-3 rows of realistic sample data?
16. **Notification completeness**: Are notification triggers, recipients, channels, templates, preferences, related FR IDs, and related state transitions defined?
17. **Parallel-agent readiness**: Does Section 14 identify feature dependencies, agent assignment guidance, integration checkpoints, and the shared contract change rule?
18. **Final reconciliation**: Does Section 14 include a Final Contract Reconciliation Table with `0` unresolved gaps across FRs, entities, APIs, screens, permissions, workflows, notifications, reports, and tests?
19. **Depth calibration**: Is the document appropriately detailed for the idea size while still preserving all mandatory sections and build contracts?
20. **Glossary relevance**: Does every term in the glossary appear somewhere in the document? Are there no irrelevant entries?

If any check fails, fix it before generating the document.

## Common Pitfalls to Avoid

- **Vagueness**: Never write "appropriate", "as needed", "etc.", or "and so on" in a requirement. Be specific.
- **Missing error states**: Every form needs validation rules. Every API needs error responses. Every workflow needs a "what if it fails" path.
- **Forgotten audit trail**: Most business apps need created_by, created_at, updated_by, updated_at on every entity. Include them.
- **No sample data**: Data model tables without sample values are ambiguous. Always include 2-3 sample rows for EVERY entity.
- **Skipping permissions**: Don't just list roles — specify exactly what each role can and cannot do in a permissions matrix.
- **One-size-fits-all bloat**: A small app still needs every section, but it does not need enterprise-scale reports, workflows, integrations, or governance unless implied by the idea.
- **Over-technical business sections**: Do not bury stakeholders in implementation details in the executive summary, scope, roles, or objectives. Put technical guidance in the build-focused sections.
- **No shared foundation**: Do not let each feature define its own auth, validation, status values, pagination, API error shape, UI table behavior, or audit rules. Define shared behavior once in Section 4.
- **Per-feature table drift**: Do not create separate feature-local tables for concepts that should be shared. If customer, user, product, order, file, notification, comment, approval, or audit data appears in multiple FRs, define it once in Section 5 and reference it everywhere.
- **LLDs that only restate requirements**: A Low-Level Design must explain how to implement the feature: components, service flow, data operations, validations, authorization, side effects, failures, dependencies, and tests.
- **Cross-section inconsistency**: This is the most common and most damaging pitfall. If a functional requirement mentions a "wishlist" or "favorites" feature, the data model MUST have a corresponding entity with full field specs. An AI builder will halt when it encounters a feature whose underlying data structure is undefined. After writing all sections, do a final consistency pass.
- **API without body examples**: An endpoint table showing "POST /api/books" is insufficient for an AI builder. Include at least one JSON request body example and one response body example for the key creation/update endpoints.
- **Missing traceability**: Without FR-to-entity/API/screen/test mapping, parallel agents cannot reliably integrate their work. Build the Section 14 matrix.
- **No final reconciliation gate**: Do not finish with open mapping gaps. The final reconciliation table must show `0` unresolved gaps.
- **Aspirational DOCX styling**: Do not promise headers, footers, table shading, fonts, or colors unless the local conversion tooling actually applied them.
- **Irrelevant glossary entries**: Every term in the glossary must appear in the document. Remove any entries that were carried over from templates but don't apply to this project.
