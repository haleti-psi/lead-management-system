-- FR-051 — DPO masked-compliance-view audit action.
-- Adds the `view_sensitive` value to the `audit_action` enum so that DPO
-- accesses to the Lead-360 view are recorded with the correct action rather
-- than the placeholder `break_glass_access` value used before this migration.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'view_sensitive';
