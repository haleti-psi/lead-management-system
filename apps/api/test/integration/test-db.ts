import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

import type { DB } from '../../src/core/db/types';
import type { DbTransaction, KyselyDb } from '../../src/core/db/database';
import type { UnitOfWork } from '../../src/core/db/unit-of-work';

/** Repo-root Flyway migrations, applied in version order to the throwaway DB. */
const MIGRATIONS_DIR = join(__dirname, '../../../../docs/data-model/migrations');

export interface TestDb {
  db: KyselyDb;
  uow: UnitOfWork;
  pool: Pool;
  container: StartedPostgreSqlContainer;
  teardown: () => Promise<void>;
}

/**
 * Start a throwaway Postgres 15 (Testcontainers) and apply EVERY Flyway
 * migration in version order — the same DDL production runs. The returned Kysely
 * + UnitOfWork let integration tests exercise real services against a real DB
 * (real FK constraints, transactions, ON CONFLICT, NOT EXISTS, enum checks) —
 * the gap the mocked-DB unit tests cannot cover.
 */
export async function setupTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:15-alpine')
    .withDatabase('lms_test')
    .withUsername('app')
    .withPassword('app')
    .start();

  const pool = new Pool({ connectionString: container.getConnectionUri() });
  // Swallow idle-client errors (e.g. "terminating connection" when the container
  // stops at teardown) so they don't surface as unhandled 'error' events.
  pool.on('error', () => undefined);

  // Lexicographic sort == version order for V1..V9 (this project only reaches V5).
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const ddl = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await pool.query(ddl);
  }

  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const uow = makeRealUow(db);

  return {
    db,
    uow,
    pool,
    container,
    teardown: async () => {
      await db.destroy();
      await container.stop();
    },
  };
}

/**
 * A real UnitOfWork over the test Kysely. Backed by a closure (tests run
 * sequentially, maxWorkers=1) instead of nestjs-cls — same `run`/`tx` contract:
 * `run` opens one real transaction and enlists nested calls; `tx()` returns the
 * active transaction or the pool.
 */
export function makeRealUow(db: KyselyDb): UnitOfWork {
  let current: DbTransaction | undefined;
  return {
    run: async <T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> => {
      if (current) return fn(current);
      return db.transaction().execute(async (tx) => {
        current = tx;
        try {
          return await fn(tx);
        } finally {
          current = undefined;
        }
      });
    },
    tx: () => current ?? db,
    get isActive() {
      return current !== undefined;
    },
  } as unknown as UnitOfWork;
}
