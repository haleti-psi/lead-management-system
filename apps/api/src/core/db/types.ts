/**
 * Kysely database interface for all tables.
 *
 * The authoritative `DB` interface (47 tables) is generated from
 * docs/data-model/schema.sql via `npm run db:codegen`
 * (kysely-codegen → core/db/types.generated.ts). This module re-exports it so
 * `Kysely<DB>` is fully typed with NO `any`. Import individual table row types
 * directly from `./types.generated` when a repository needs them.
 *
 * Conventions (architecture §10): UUID PKs, TIMESTAMPTZ created_at/updated_at,
 * snake_case columns. Regenerate (do not hand-edit) when the schema changes.
 */
export type { DB } from './types.generated';
