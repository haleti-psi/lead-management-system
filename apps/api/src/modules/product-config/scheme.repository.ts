import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';

import type { ProductCode } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { Schemes } from '../../core/db/types.generated';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';

/** Read shape of a `schemes` row (all columns). */
export type SchemeRow = Selectable<Schemes>;

/** The write-field set the creator persists (scalars only; no governance cols). */
export interface SchemeWriteFields {
  code: string;
  name: string;
  product_code: ProductCode | null;
  subvention_flag: boolean;
  valid_from: string;
  valid_to: string;
}

export interface ListFilters {
  product_code?: ProductCode;
  is_active?: boolean;
}

export interface ListPagination {
  page: number;
  limit: number;
}

/** Postgres unique-violation SQLSTATE (duplicate key) — `uq_schemes_code`. */
const PG_UNIQUE_VIOLATION = '23505';

/** Narrow a thrown error to a Postgres unique-constraint (23505) violation. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

/**
 * FR-042 — owner repository for `schemes` (M5). This is the ONLY class that issues
 * SQL against `schemes` (owner-writes rule, architecture §11.2). All queries are
 * parameterised Kysely, org-scoped, and every list query is `LIMIT`-bounded
 * (NFR-17). Schemes are immediately active — there is no draft/maker-checker step,
 * so {@link insert} persists `is_active=true` directly.
 */
@Injectable()
export class SchemeRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** Paginated list for the org, newest validity first. LIMIT ≤ 100. */
  async list(filters: ListFilters, pagination: ListPagination): Promise<SchemeRow[]> {
    return this.db
      .selectFrom('schemes')
      .selectAll()
      .where('org_id', '=', ORG_ID_DEFAULT)
      .$if(filters.product_code != null, (qb) => qb.where('product_code', '=', filters.product_code!))
      .$if(filters.is_active != null, (qb) => qb.where('is_active', '=', filters.is_active!))
      .orderBy('valid_from', 'desc')
      .limit(pagination.limit)
      .offset((pagination.page - 1) * pagination.limit)
      .execute();
  }

  /** Total matching rows (for pagination meta). */
  async count(filters: ListFilters): Promise<number> {
    const row = await this.db
      .selectFrom('schemes')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('org_id', '=', ORG_ID_DEFAULT)
      .$if(filters.product_code != null, (qb) => qb.where('product_code', '=', filters.product_code!))
      .$if(filters.is_active != null, (qb) => qb.where('is_active', '=', filters.is_active!))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  /**
   * Resolve a single scheme by `code` for the org (LLD §3.3). Returns `undefined`
   * when absent; the caller decides whether that is NOT_FOUND or a field-level
   * VALIDATION_ERROR. Parameterised + LIMIT 1.
   */
  async findByCode(
    code: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<SchemeRow | undefined> {
    return executor
      .selectFrom('schemes')
      .selectAll()
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('code', '=', code)
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Insert a new scheme as immediately active (`is_active=true`). `created_by`/
   * `updated_by` are the actor. The unique constraint `uq_schemes_code`
   * (`org_id, code`) and the check `ck_schemes_validity` (`valid_to >= valid_from`)
   * are enforced by the DB; a 23505 surfaces to the caller as CONFLICT (see
   * {@link isUniqueViolation}). Runs in the caller's executor (tx or base db).
   */
  async insert(
    fields: SchemeWriteFields,
    actorId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<SchemeRow> {
    return executor
      .insertInto('schemes')
      .values({
        org_id: ORG_ID_DEFAULT,
        code: fields.code,
        name: fields.name,
        product_code: fields.product_code,
        subvention_flag: fields.subvention_flag,
        valid_from: fields.valid_from,
        valid_to: fields.valid_to,
        is_active: true,
        created_by: actorId,
        updated_by: actorId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
