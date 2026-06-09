# Migrations Reference

Guidelines for generating, naming, and evolving database migrations for both Cloud SQL (Flyway) and Supabase CLI.

---

## Table of Contents

1. Migration Formats
2. Naming Conventions
3. Initial Schema Migration
4. Common ALTER TABLE Patterns
5. Enum Evolution
6. Index Changes
7. Data Migrations
8. Rollback Strategy
9. Supabase-Specific Workflow
10. Cloud SQL / Flyway Workflow

---

## 1. Migration Formats

### Flyway (Cloud SQL / standard PostgreSQL)

Files live in `migrations/` and follow Flyway versioned migration naming:

```
migrations/
  V1__initial_schema.sql
  V2__add_user_roles.sql
  V3__add_payments_table.sql
  V4__add_search_index.sql
```

Each file:
- Starts with `-- Flyway migration` comment header
- Is idempotent where possible (`IF NOT EXISTS`, `IF EXISTS`)
- Never modifies a previously-applied migration file

### Supabase CLI

Files live in `supabase/migrations/` with timestamp prefix:

```
supabase/migrations/
  20240101000000_initial_schema.sql
  20240115120000_add_user_roles.sql
  20240201083000_add_payments.sql
```

Timestamp format: `YYYYMMDDHHMMSS` — use the current date/time when generating.

Each file:
- Optionally starts with `-- migrate:up` (dbmate compatibility)
- Applied via `supabase db push` or `supabase migration up`

---

## 2. Naming Conventions

| Change type | Example name |
|-------------|-------------|
| Add table | `V2__add_payments_table.sql` |
| Add columns | `V3__add_phone_to_profiles.sql` |
| Add index | `V4__add_search_index_on_products.sql` |
| Rename column | `V5__rename_username_to_display_name.sql` |
| Add enum value | `V6__add_archived_to_order_status.sql` |
| Data backfill | `V7__backfill_default_org_for_users.sql` |
| Drop column | `V8__drop_legacy_phone_column.sql` |
| Add FK | `V9__add_fk_orders_customer_id.sql` |

---

## 3. Initial Schema Migration

The initial migration is identical to `schema.sql` / `schema_supabase.sql`, wrapped with a header:

```sql
-- =============================================================
-- V1__initial_schema.sql
-- Initial database schema
-- Project: <Project Name>
-- Created: <date>
-- =============================================================

-- (full contents of schema.sql here)
```

---

## 4. Common ALTER TABLE Patterns

### Add a column (safe — no downtime)

```sql
-- Always nullable OR with a default — never NOT NULL without a default on existing data
ALTER TABLE <table> ADD COLUMN <column> <type> DEFAULT <value>;

-- After backfilling, add NOT NULL constraint:
UPDATE <table> SET <column> = <default> WHERE <column> IS NULL;
ALTER TABLE <table> ALTER COLUMN <column> SET NOT NULL;
```

### Drop a column (two-step for safety)

```sql
-- Step 1: Stop reading/writing the column in application code first
-- Step 2: In a later migration, drop it:
ALTER TABLE <table> DROP COLUMN IF EXISTS <column>;
```

### Rename a column (zero-downtime approach)

```sql
-- Step 1: Add new column + copy data
ALTER TABLE <table> ADD COLUMN new_name <type>;
UPDATE <table> SET new_name = old_name;
ALTER TABLE <table> ALTER COLUMN new_name SET NOT NULL;

-- Step 2: After application is reading new_name:
ALTER TABLE <table> DROP COLUMN old_name;

-- Single-step (causes brief lock — acceptable for small tables):
ALTER TABLE <table> RENAME COLUMN old_name TO new_name;
```

### Add a NOT NULL column to an existing table

```sql
-- 1. Add nullable
ALTER TABLE <table> ADD COLUMN <column> <type>;
-- 2. Backfill
UPDATE <table> SET <column> = <default_value> WHERE <column> IS NULL;
-- 3. Constrain
ALTER TABLE <table> ALTER COLUMN <column> SET NOT NULL;
```

### Add a foreign key

```sql
-- Add column first
ALTER TABLE <table> ADD COLUMN <col> UUID;
-- Backfill if needed
UPDATE <table> SET <col> = ...;
-- Add constraint (VALIDATE separately for zero-downtime on large tables)
ALTER TABLE <table> ADD CONSTRAINT fk_<table>_<col>
  FOREIGN KEY (<col>) REFERENCES <other_table>(id) ON DELETE RESTRICT
  NOT VALID;  -- skips full table scan

-- Validate in a separate transaction (advisory lock, not full lock):
ALTER TABLE <table> VALIDATE CONSTRAINT fk_<table>_<col>;
```

---

## 5. Enum Evolution

PostgreSQL allows adding values to an enum but not removing or reordering them.

### Add a value (safe)

```sql
-- Can be done without downtime in Postgres 12+
ALTER TYPE <enum_name> ADD VALUE IF NOT EXISTS 'new_value';
-- Note: new value not visible in same transaction — commit first
```

### Rename a value (Postgres 10+)

```sql
ALTER TYPE <enum_name> RENAME VALUE 'old_value' TO 'new_value';
```

### Remove a value (requires enum replacement)

```sql
-- 1. Create replacement enum
CREATE TYPE <enum_name>_new AS ENUM ('value1', 'value2'); -- omit removed value

-- 2. Update all columns using old enum
ALTER TABLE <table> ALTER COLUMN <col> TYPE <enum_name>_new
  USING <col>::text::<enum_name>_new;

-- 3. Drop old enum and rename
DROP TYPE <enum_name>;
ALTER TYPE <enum_name>_new RENAME TO <enum_name>;
```

---

## 6. Index Changes

### Add index (concurrent — no table lock)

```sql
-- CONCURRENTLY builds index without blocking reads/writes
-- Cannot run inside a transaction block
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_<table>_<col> ON <table>(<col>);
```

### Drop index

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_<table>_<col>;
```

### Replace index (concurrent, zero-downtime)

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_<table>_<col>_new ON <table>(<col> DESC);
DROP INDEX CONCURRENTLY IF EXISTS idx_<table>_<col>;
ALTER INDEX idx_<table>_<col>_new RENAME TO idx_<table>_<col>;
```

---

## 7. Data Migrations

Keep data migrations separate from DDL migrations:

```sql
-- V7__backfill_default_org.sql
DO $$
DECLARE
  default_org_id UUID;
BEGIN
  -- Get or create default org
  SELECT id INTO default_org_id FROM orgs WHERE slug = 'default' LIMIT 1;

  IF default_org_id IS NULL THEN
    INSERT INTO orgs (name, slug) VALUES ('Default', 'default')
    RETURNING id INTO default_org_id;
  END IF;

  -- Backfill users missing org_id
  UPDATE users SET org_id = default_org_id WHERE org_id IS NULL;
END $$;
```

Rules:
- Always wrap in a `DO $$ ... $$` block or explicit transaction
- Add `RAISE NOTICE` statements for progress on large backfills
- Batch large updates: `WHERE id IN (SELECT id FROM <table> WHERE ... LIMIT 1000)`

---

## 8. Rollback Strategy

PostgreSQL DDL is transactional — most migrations can be rolled back:

```sql
BEGIN;

ALTER TABLE orders ADD COLUMN discount_pct NUMERIC(5,2) DEFAULT 0;
-- ... other changes ...

-- If something is wrong:
ROLLBACK;

-- If all good:
COMMIT;
```

Exceptions (cannot rollback without extra steps):
- `CREATE INDEX CONCURRENTLY` (runs outside transaction)
- `ALTER TYPE ... ADD VALUE` (new enum values persist even on rollback in PG < 13)
- `DROP TABLE` / `DROP COLUMN` (data is gone)

For destructive operations, always create a reverse migration file alongside:

```
V8__drop_legacy_column.sql          ← forward
V8__drop_legacy_column.undo.sql     ← reverse (for documentation; Flyway Pro supports undo)
```

---

## 9. Supabase-Specific Workflow

```bash
# Create a new migration
supabase migration new add_payments_table

# Apply all pending migrations to local dev
supabase db push

# Check migration status
supabase migration list

# Reset local DB and replay all migrations
supabase db reset

# Generate migration from diff between local schema and remote
supabase db diff --use-migra -f add_payments_table

# Deploy to production
supabase db push --db-url postgresql://...
```

### RLS in migrations

Always pair DDL with RLS in the same migration file:

```sql
-- 20240201_add_payments.sql

CREATE TABLE payments ( ... );

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

CREATE POLICY "payments_select_own" ON payments
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "payments_insert_own" ON payments
  FOR INSERT WITH CHECK (user_id = auth.uid());
```

Never ship a table migration without its RLS policies — a table without RLS in Supabase is publicly readable.

---

## 10. Cloud SQL / Flyway Workflow

```bash
# Configure Flyway (flyway.conf or env vars)
FLYWAY_URL=jdbc:postgresql://<host>:5432/<db>
FLYWAY_USER=<user>
FLYWAY_PASSWORD=<password>
FLYWAY_LOCATIONS=filesystem:./migrations

# Check pending migrations
flyway info

# Apply migrations
flyway migrate

# Repair failed migration (after fixing the SQL)
flyway repair

# Validate migration checksums
flyway validate
```

### Cloud SQL Auth Proxy

```bash
# Start proxy
./cloud-sql-proxy <project>:<region>:<instance> &

# Then run Flyway against localhost
FLYWAY_URL=jdbc:postgresql://localhost:5432/<db> flyway migrate
```
