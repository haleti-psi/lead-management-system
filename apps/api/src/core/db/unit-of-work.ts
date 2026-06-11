import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Kysely } from 'kysely';

import { KYSELY, type DbTransaction, type KyselyDb } from './database';

const CLS_TX_KEY = 'uow:tx';

/**
 * Unit of Work — the request-scoped ambient transaction (architecture §11.1).
 *
 * `run(fn)` opens ONE Kysely transaction, stashes it in CLS, and invokes the
 * callback with that transaction. Every owner-service method called within the
 * callback obtains the SAME transaction via {@link tx}, so cross-module writes
 * commit (or roll back) atomically over a single Cloud SQL connection — no
 * distributed transaction. Nested `run` calls re-use the active transaction
 * (they enlist, they do not open a second one), so a use-case that calls
 * another service's `run`-wrapped method still commits once.
 *
 * Owner-writes rule still applies: only an entity's owning service issues SQL
 * against its table; consumers pass the `tx` they received, never the table.
 */
@Injectable()
export class UnitOfWork {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    private readonly cls: ClsService,
  ) {}

  /** Execute `fn` inside a single ambient transaction; commit on resolve, roll back on throw. */
  async run<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
    const existing = this.cls.get<DbTransaction | undefined>(CLS_TX_KEY);
    if (existing) {
      // Already inside a transaction — enlist in it rather than nesting a new one.
      return fn(existing);
    }

    return this.db.transaction().execute(async (tx) => {
      this.cls.set(CLS_TX_KEY, tx);
      try {
        return await fn(tx);
      } finally {
        this.cls.set(CLS_TX_KEY, undefined);
      }
    });
  }

  /**
   * The current ambient Kysely handle: the active transaction inside `run`,
   * otherwise the pool (for standalone reads outside a transaction). Owner
   * services that accept a `tx` parameter should prefer the passed-in handle;
   * this accessor exists for code that must resolve the ambient handle itself.
   */
  tx(): KyselyDb {
    const active = this.cls.get<DbTransaction | undefined>(CLS_TX_KEY);
    return active ?? this.db;
  }

  /** True when called inside an active `run` transaction. */
  get isActive(): boolean {
    return this.cls.get<DbTransaction | undefined>(CLS_TX_KEY) instanceof Kysely;
  }
}
