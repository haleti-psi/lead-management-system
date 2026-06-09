---
name: brd-data-modeler
description: "Read a BRD, SPEC.md, PRD, or any requirements document and generate a complete, production-ready PostgreSQL data model — normalized table definitions, ERD narrative, indexes, constraints, foreign keys, RLS policies, and migration scripts. Output is ready-to-run SQL DDL deployable to Cloud SQL (PostgreSQL) or Supabase. Use this skill whenever the user has a BRD, spec, or requirements doc and wants a data model, database schema, ERD, SQL DDL, Postgres schema, Supabase schema, migration files, or says things like 'generate the schema from my BRD', 'create the data model', 'turn this into a Postgres schema', 'build the tables for this spec', 'what tables do I need', 'create the database model for my project', 'generate migrations from the spec', or 'design the DB layer'. Also trigger when the user is working with Claude Code and has a BRD or SPEC.md open and asks about the database, schema, or storage layer. Always use this skill — do not attempt to generate a schema without it."
---

# BRD Data Modeler — PostgreSQL Schema Generator

## Purpose

Parse a BRD, SPEC.md, PRD, or any requirements document and produce a production-ready PostgreSQL data model deployable to **Google Cloud SQL** or **Supabase**.

## Reference Files

Load these when you reach the relevant step — do not load all upfront:

| File | Load when |
|------|-----------|
| `references/patterns.md` | Step 3 — writing DDL (common SQL patterns) |
| `references/migrations.md` | Step 5 — generating migration files |

## Output Files

| File | Contents |
|------|----------|
| `schema.sql` | Complete DDL: enums, tables, indexes, constraints, triggers |
| `schema_supabase.sql` | Same DDL + auth integration, RLS policies, realtime hints |
| `migrations/V1__initial_schema.sql` | Flyway-compatible migration (same as schema.sql with header) |
| `migrations/supabase/20240101000000_initial_schema.sql` | Supabase CLI migration format |
| `DATA_MODEL.md` | ERD narrative, design decisions, deployment guide, assumptions |

Produce all five unless the user specifies otherwise. Files go to `outputs/` or the user's working folder.

---

## Process

### Step 1: Read and Parse the Input Document

Accept any of:
- A file path under `/mnt/user-data/uploads/` or the Claude Code project directory
- A SPEC.md from the `brd-generator` skill (check Section 4 "Data Model" first — expand from it)
- Pasted text

Extract:
- **Entities** — nouns that store state (users, orders, products, etc.)
- **Attributes** — names, types, constraints inferred from context
- **Relationships** — one-to-many, many-to-many, optional vs required
- **Enumerations** — status fields, role fields, category fields
- **Audit requirements** — created_at, updated_at, deleted_at, created_by
- **Auth/tenancy model** — single-tenant, multi-tenant, user-owned rows
- **Soft-delete needs** — archiving, reversible deletion
- **Business rules** — constraints, triggers, state machine transitions
- **Performance hints** — search fields, sort columns, high-volume tables

---

### Step 2: Build the Entity-Relationship Map

Before writing any SQL, reason through the full ER model and output a brief summary to the user:

1. List every entity with a one-line description
2. For each entity, list key attributes with inferred Postgres types
3. Map all relationships with cardinality (1:1, 1:N, M:N)
4. Identify junction tables for M:N relationships
5. Resolve polymorphic associations explicitly — no generic `entity_type`/`entity_id` unless truly necessary
6. Choose normalization level: default 3NF; denormalize only when justified (document why)
7. Note every assumption made for missing info

Show this ER summary to the user in a `<details>` block or brief prose before writing files, so they can catch errors early.

---

### Step 3: Write `schema.sql` — Core DDL

**Read `references/patterns.md` before writing SQL.**

Follow this exact file structure:

```sql
-- =============================================================
-- <Project Name> — PostgreSQL Schema
-- Generated from: <source document name>
-- Target: PostgreSQL 15+ / Cloud SQL
-- Generated: <date>
-- =============================================================

-- ── 0. Extensions ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- if full-text search needed
CREATE EXTENSION IF NOT EXISTS "btree_gin"; -- if composite GIN indexes needed

-- ── 1. Custom Types / Enumerations ────────────────────────────
CREATE TYPE <name> AS ENUM (...);

-- ── 2. Tables (dependency order — referenced tables first) ────
CREATE TABLE <name> ( ... );

-- ── 3. Indexes ────────────────────────────────────────────────

-- ── 4. Functions & Triggers ───────────────────────────────────

-- ── 5. Seed / Reference Data ──────────────────────────────────
```

#### Table Design Rules

- **Primary keys**: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` unless BRD specifies integer sequences
- **Timestamps**: every table gets `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` and `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- **Soft deletes**: add `deleted_at TIMESTAMPTZ` + `deleted_by UUID` when BRD mentions archiving or reversible deletion; add partial index `WHERE deleted_at IS NULL`
- **Tenant isolation**: multi-tenant tables get `org_id UUID NOT NULL REFERENCES orgs(id)`
- **Audit columns**: `created_by UUID REFERENCES profiles(id)` and `updated_by UUID REFERENCES profiles(id)` on any table with audit requirements
- **Foreign keys**: always explicit, always named `fk_<table>_<column>`, always with `ON DELETE` action:
  - `CASCADE` — child has no meaning without parent (order_items → orders)
  - `RESTRICT` — prevent orphaning (users → orgs)
  - `SET NULL` — optional reference (assigned_to on tasks)
- **Check constraints**: encode business rules (positive amounts, valid email format, non-empty strings)
- **NOT NULL discipline**: nullable only when the field is genuinely optional
- **Naming**: `snake_case` throughout; junction tables as `<table_a>_<table_b>`
- **Versioning/optimistic locking**: add `version INTEGER NOT NULL DEFAULT 1` on tables subject to concurrent edits

#### Index Strategy

- All FK columns (Postgres does not auto-index them)
- Columns in WHERE clauses (infer from BRD workflows and search features)
- Columns in ORDER BY (e.g. `created_at DESC` on feed tables)
- Unique constraints for business-rule uniqueness (one active subscription per user)
- `GIN` indexes for JSONB and full-text search columns
- Partial indexes for soft-delete (`WHERE deleted_at IS NULL`) and status filters (`WHERE status = 'active'`)
- Composite indexes when queries filter on multiple columns together

#### Standard Triggers

Always include the `set_updated_at` function once and apply to every table:

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Applied per table:
CREATE TRIGGER trg_<table>_updated_at
  BEFORE UPDATE ON <table>
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

### Step 4: Write `schema_supabase.sql` — Supabase Variant

Start from `schema.sql` DDL and add:

#### 4a. Auth Integration

```sql
-- profiles links to Supabase-managed auth.users
CREATE TABLE public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  role        app_role NOT NULL DEFAULT 'member',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

#### 4b. Row Level Security

Enable RLS on every user-facing table. Write explicit policies for each CRUD operation — never a single permissive `USING (true)` policy:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY; -- applies to table owner too

-- SELECT: own rows
CREATE POLICY "<table>_select_own" ON <table>
  FOR SELECT USING (user_id = auth.uid());

-- SELECT: multi-tenant (org scope)
CREATE POLICY "<table>_select_org" ON <table>
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- INSERT: user can only insert their own rows
CREATE POLICY "<table>_insert_own" ON <table>
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- UPDATE: own rows only
CREATE POLICY "<table>_update_own" ON <table>
  FOR UPDATE USING (user_id = auth.uid());

-- DELETE: own rows only
CREATE POLICY "<table>_delete_own" ON <table>
  FOR DELETE USING (user_id = auth.uid());

-- Admin bypass (using security-definer function to avoid RLS recursion)
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE POLICY "<table>_admin_all" ON <table>
  USING (is_admin());
```

#### 4c. Realtime

```sql
-- Enable for tables needing live updates
ALTER PUBLICATION supabase_realtime ADD TABLE <table>;
```

#### 4d. Storage Buckets (if BRD mentions file uploads)

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('<bucket-name>', '<bucket-name>', false);

CREATE POLICY "users_upload_own" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = '<bucket-name>' AND auth.uid()::text = (storage.foldername(name))[1]
  );
```

---

### Step 5: Generate Migration Files

**Read `references/migrations.md` before writing migration files.**

Produce two migration formats:

**Flyway / Cloud SQL** → `migrations/V1__initial_schema.sql`
```sql
-- Flyway migration
-- V1__initial_schema.sql
-- Created: <date>
<exact contents of schema.sql>
```

**Supabase CLI** → `migrations/supabase/<timestamp>_initial_schema.sql`
- Timestamp format: `YYYYMMDDHHMMSS` (e.g. `20240101000000`)
- Contents identical to `schema_supabase.sql`
- Include `-- migrate:up` header for dbmate compatibility

---

### Step 6: Write `DATA_MODEL.md`

```markdown
# <Project Name> — Data Model

## Entity Overview
| Table | Description | Key Relationships |
|-------|-------------|-------------------|
| ...   | ...         | ...               |

## Relationship Map
ASCII or mermaid ERD:
```
users ||--o{ orders : places
orders ||--|{ order_items : contains
```

## Design Decisions
- Primary key strategy (UUID rationale)
- Soft-delete tables and rationale
- Tenancy model
- Denormalization decisions and why
- Enum choices and extensibility notes
- Versioning / optimistic locking choices

## Deployment Guide
### Cloud SQL
```bash
gcloud sql connect <instance> --user=postgres --database=<db>
\i schema.sql
# Or with Flyway:
flyway -url=jdbc:postgresql://<host>/<db> migrate
```

### Supabase
```bash
# Via CLI (recommended)
supabase db push
# Or apply manually in SQL Editor
# Dashboard → SQL Editor → paste schema_supabase.sql
```

## Evolving the Schema
See `references/migrations.md` for ALTER TABLE patterns and migration workflow.

## Assumptions & Gaps
| # | Assumption | Field/Table | Action Required |
|---|------------|-------------|-----------------|
| 1 | ...        | ...         | Confirm / reject |
```

---

### Step 7: Final Validation Checklist

Before writing any file, mentally verify:

**Schema correctness**
- [ ] Every table has a UUID primary key
- [ ] Every FK is named `fk_<table>_<column>` with explicit `ON DELETE`
- [ ] Every FK column has an index
- [ ] Every table has `created_at` and `updated_at`
- [ ] Every table with `updated_at` has the trigger applied
- [ ] No circular FK dependencies (or handled with `DEFERRABLE INITIALLY DEFERRED`)
- [ ] All enums cover every state mentioned in the BRD
- [ ] Junction tables have a composite UNIQUE constraint on their FK pair

**Supabase-specific**
- [ ] Every user-facing table has `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`
- [ ] Every operation (SELECT/INSERT/UPDATE/DELETE) has an explicit policy — no blanket `USING (true)`
- [ ] `profiles` references `auth.users(id) ON DELETE CASCADE`
- [ ] `handle_new_user` trigger is `SECURITY DEFINER`
- [ ] No direct `CREATE` or `ALTER` on `auth.*` tables

**Migrations**
- [ ] Flyway migration matches `schema.sql` exactly
- [ ] Supabase migration matches `schema_supabase.sql` exactly
- [ ] Timestamp in Supabase filename is unique and sortable

**Documentation**
- [ ] Every assumption is recorded in the Assumptions & Gaps table
- [ ] Every `-- TODO:` in SQL is cross-referenced in Assumptions & Gaps
