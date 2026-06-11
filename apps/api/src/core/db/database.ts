import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import { Pool } from 'pg';

import type { AppConfigService } from '../config';
import type { DB } from './types';

/** DI token for the root {@link Kysely} instance (the connection pool). */
export const KYSELY = Symbol('KYSELY');

/** A Kysely handle bound to the database — either the pool or an open transaction. */
export type KyselyDb = Kysely<DB>;
export type DbTransaction = Transaction<DB>;

/**
 * Builds the single application-wide Kysely instance over a `pg` Pool.
 * Connection string and pool bounds come from the validated config
 * (DATABASE_URL / DB_POOL_MIN / DB_POOL_MAX) — never hardcoded. One pool per
 * process; one connection per request is enforced by the UnitOfWork (§11.1).
 */
export function createKysely(config: AppConfigService): Kysely<DB> {
  const pool = new Pool({
    connectionString: config.get('DATABASE_URL'),
    min: config.get('DB_POOL_MIN'),
    max: config.get('DB_POOL_MAX'),
    connectionTimeoutMillis: 5_000,
  });

  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  });
}
