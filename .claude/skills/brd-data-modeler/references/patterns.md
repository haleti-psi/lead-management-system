# SQL Patterns Reference

Apply these patterns when relevant. Each is self-contained — copy and adapt.

---

## Table of Contents

1. Audit Trail
2. Soft Delete
3. Optimistic Locking (versioning)
4. Status State Machine
5. Hierarchical / Tree Data
6. JSONB Metadata
7. Full-Text Search
8. Tagging (M:N)
9. Notifications
10. File Attachments
11. Money / Currency
12. Internationalisation (i18n)
13. Scheduled / Expiring Records
14. Event Log / Append-Only Table

---

## 1. Audit Trail

```sql
-- Add to any table requiring full audit history
created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
updated_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
```

For immutable audit log (separate table):

```sql
CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  TEXT NOT NULL,
  record_id   UUID NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data    JSONB,
  new_data    JSONB,
  changed_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log(table_name, record_id);
CREATE INDEX ON audit_log(changed_at DESC);

-- Generic trigger function (register per table)
CREATE OR REPLACE FUNCTION record_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO audit_log(table_name, record_id, action, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD)::jsonb END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW)::jsonb END
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_<table>_audit
  AFTER INSERT OR UPDATE OR DELETE ON <table>
  FOR EACH ROW EXECUTE FUNCTION record_audit();
```

---

## 2. Soft Delete

```sql
-- Columns
deleted_at  TIMESTAMPTZ,
deleted_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,

-- Partial index: active-record queries use this automatically
CREATE INDEX ON <table>(id)          WHERE deleted_at IS NULL;
CREATE INDEX ON <table>(org_id)      WHERE deleted_at IS NULL; -- multi-tenant variant
CREATE INDEX ON <table>(created_at)  WHERE deleted_at IS NULL;

-- Restore helper function
CREATE OR REPLACE FUNCTION restore_<table>(p_id UUID)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE <table> SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;
$$;
```

---

## 3. Optimistic Locking (versioning)

Prevents lost updates when multiple clients edit the same row:

```sql
-- Column
version  INTEGER NOT NULL DEFAULT 1,

-- Application must include WHERE version = $current_version in UPDATE.
-- Trigger bumps version on every update:
CREATE OR REPLACE FUNCTION bump_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_<table>_version
  BEFORE UPDATE ON <table>
  FOR EACH ROW EXECUTE FUNCTION bump_version();
```

---

## 4. Status State Machine

```sql
-- Define all states as an enum
CREATE TYPE <entity>_status AS ENUM (
  'draft', 'submitted', 'in_review', 'approved', 'rejected', 'archived'
);

-- Column
status  <entity>_status NOT NULL DEFAULT 'draft',

-- Optional: enforce valid transitions via trigger
CREATE OR REPLACE FUNCTION check_<entity>_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'approved' AND NEW.status NOT IN ('archived') THEN
    RAISE EXCEPTION 'Invalid transition from approved to %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_<entity>_status_transition
  BEFORE UPDATE OF status ON <table>
  FOR EACH ROW EXECUTE FUNCTION check_<entity>_transition();

-- Index for status-filtered queries
CREATE INDEX ON <table>(status) WHERE status NOT IN ('archived', 'rejected');
```

---

## 5. Hierarchical / Tree Data

For categories, org charts, comment threads:

```sql
-- Self-referencing FK
parent_id  UUID REFERENCES <table>(id) ON DELETE SET NULL,
depth      INTEGER NOT NULL DEFAULT 0,  -- optional, for display

CREATE INDEX ON <table>(parent_id);

-- Recursive CTE to fetch a full subtree:
-- WITH RECURSIVE tree AS (
--   SELECT * FROM <table> WHERE id = $root_id
--   UNION ALL
--   SELECT c.* FROM <table> c JOIN tree t ON c.parent_id = t.id
-- )
-- SELECT * FROM tree;
```

For deep trees with frequent reads, consider `ltree` extension:

```sql
CREATE EXTENSION IF NOT EXISTS ltree;
path  ltree NOT NULL,
CREATE INDEX ON <table> USING gist(path);
```

---

## 6. JSONB Metadata

For flexible, schema-less extension fields:

```sql
metadata  JSONB NOT NULL DEFAULT '{}',

-- GIN index for key existence and containment queries
CREATE INDEX ON <table> USING gin(metadata);

-- Example queries (no index needed for simple key access):
-- SELECT * FROM <table> WHERE metadata->>'theme' = 'dark';
-- SELECT * FROM <table> WHERE metadata @> '{"plan": "pro"}';
```

---

## 7. Full-Text Search

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Generated tsvector column (auto-updated)
search_vector  TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))
  ) STORED,

CREATE INDEX ON <table> USING gin(search_vector);

-- Trigram index for ILIKE / partial match
CREATE INDEX ON <table> USING gin(title gin_trgm_ops);

-- Query pattern:
-- SELECT * FROM <table>
-- WHERE search_vector @@ plainto_tsquery('english', $query)
-- ORDER BY ts_rank(search_vector, plainto_tsquery('english', $query)) DESC;
```

---

## 8. Tagging (M:N)

```sql
CREATE TABLE tags (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT NOT NULL,
  slug  TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE <entity>_tags (
  <entity>_id  UUID NOT NULL REFERENCES <entity>(id) ON DELETE CASCADE,
  tag_id       UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (<entity>_id, tag_id)
);

CREATE INDEX ON <entity>_tags(tag_id);
```

---

## 9. Notifications

```sql
CREATE TYPE notification_type AS ENUM (
  'mention', 'assignment', 'status_change', 'comment', 'system'
);

CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type         notification_type NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT,
  data         JSONB NOT NULL DEFAULT '{}',   -- entity refs, deep-link params
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON notifications(user_id, read_at) WHERE read_at IS NULL; -- unread count
CREATE INDEX ON notifications(user_id, created_at DESC);
```

---

## 10. File Attachments

```sql
CREATE TABLE attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- polymorphic owner (resolve to explicit FKs when possible)
  entity_type   TEXT NOT NULL,
  entity_id     UUID NOT NULL,
  -- storage
  bucket        TEXT NOT NULL,
  storage_path  TEXT NOT NULL UNIQUE,
  filename      TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL CHECK (size_bytes > 0),
  -- metadata
  uploaded_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON attachments(entity_type, entity_id);
CREATE INDEX ON attachments(uploaded_by);
```

---

## 11. Money / Currency

Never store money in FLOAT. Use NUMERIC or integer cents:

```sql
-- Option A: NUMERIC (exact, human-readable)
amount       NUMERIC(19,4) NOT NULL CHECK (amount >= 0),
currency     CHAR(3) NOT NULL DEFAULT 'USD',  -- ISO 4217

-- Option B: integer cents (fastest, avoids decimal issues)
amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
currency     CHAR(3) NOT NULL DEFAULT 'USD',
```

---

## 12. Internationalisation (i18n)

For multi-language content:

```sql
-- Option A: JSONB translations column (simple)
translations  JSONB NOT NULL DEFAULT '{}',
-- {"en": {"title": "Hello"}, "es": {"title": "Hola"}}

-- Option B: separate translations table (queryable, indexable)
CREATE TABLE <entity>_translations (
  entity_id  UUID NOT NULL REFERENCES <entity>(id) ON DELETE CASCADE,
  locale     CHAR(5) NOT NULL,  -- e.g. 'en', 'en-US', 'es'
  title      TEXT NOT NULL,
  body       TEXT,
  PRIMARY KEY (entity_id, locale)
);
```

---

## 13. Scheduled / Expiring Records

```sql
-- Columns
scheduled_at  TIMESTAMPTZ,
expires_at    TIMESTAMPTZ,
published_at  TIMESTAMPTZ,

-- Partial indexes for job-queue-style polling
CREATE INDEX ON <table>(scheduled_at) WHERE scheduled_at IS NOT NULL AND published_at IS NULL;
CREATE INDEX ON <table>(expires_at)   WHERE expires_at IS NOT NULL;
```

---

## 14. Event Log / Append-Only Table

For immutable event streams (analytics, activity feeds):

```sql
CREATE TABLE events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL,             -- e.g. 'user.login', 'order.placed'
  actor_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  subject_id  UUID,                       -- entity the event is about
  subject_type TEXT,
  payload     JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Never UPDATE or DELETE rows in this table
-- Partition by month for large volumes (PostgreSQL 12+):
-- PARTITION BY RANGE (occurred_at)

CREATE INDEX ON events(type, occurred_at DESC);
CREATE INDEX ON events(actor_id, occurred_at DESC);
CREATE INDEX ON events(subject_type, subject_id, occurred_at DESC);
```
