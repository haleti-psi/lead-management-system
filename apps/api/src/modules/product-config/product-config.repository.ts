import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';

import type { ConfigStatus, PanTiming, ProductCode } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { ProductConfigs } from '../../core/db/types.generated';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import { PRODUCT_CONFIG_CONFIG_TYPE } from './product-config.constants';
import type { SortableColumn } from './dto/list-product-configs.dto';

/** Read shape of a `product_configs` row (all columns). */
export type ProductConfigRow = Selectable<ProductConfigs>;

/** Columns returned in the list view (large JSONB fields omitted — LLD §1). */
export const LIST_COLUMNS = [
  'product_config_id',
  'product_code',
  'name',
  'version',
  'status',
  'pan_required_at',
  'created_at',
  'updated_at',
  'created_by',
] as const;

export type ProductConfigListRow = Pick<ProductConfigRow, (typeof LIST_COLUMNS)[number]>;

export interface ListFilters {
  status?: ConfigStatus;
  product_code?: ProductCode;
}

export interface ListPagination {
  page: number;
  limit: number;
  sort: SortableColumn;
  direction: 'asc' | 'desc';
}

/** The full set of config payload fields the writer persists (JSONB + scalars). */
export interface ProductConfigWriteFields {
  product_code: ProductCode;
  name: string;
  field_schema: unknown;
  document_checklist: unknown;
  sla_config: unknown | null;
  eligibility_mapping: unknown | null;
  pan_required_at: PanTiming;
}

/**
 * FR-040 — owner repository for `product_configs` and the `product_config` rows of
 * `configuration_versions` (maker-checker). All queries are parameterised Kysely,
 * org-scoped, and every list query is `LIMIT`-bounded (NFR-17). Owner-writes rule:
 * this is the ONLY class that issues SQL against `product_configs`; the activation
 * status flip on approval is delegated by FR-132 to the product_config activator,
 * which writes through this same table inside the governance transaction.
 */
@Injectable()
export class ProductConfigRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** Paginated list for the org with allow-listed sort. LIMIT ≤ 100. */
  async list(filters: ListFilters, pagination: ListPagination): Promise<ProductConfigListRow[]> {
    return this.db
      .selectFrom('product_configs')
      .where('org_id', '=', ORG_ID_DEFAULT)
      .$if(filters.status != null, (qb) => qb.where('status', '=', filters.status!))
      .$if(filters.product_code != null, (qb) => qb.where('product_code', '=', filters.product_code!))
      .select([...LIST_COLUMNS])
      .orderBy(pagination.sort, pagination.direction)
      .limit(pagination.limit)
      .offset((pagination.page - 1) * pagination.limit)
      .execute();
  }

  /** Total matching rows (for pagination meta). */
  async count(filters: ListFilters): Promise<number> {
    const row = await this.db
      .selectFrom('product_configs')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('org_id', '=', ORG_ID_DEFAULT)
      .$if(filters.status != null, (qb) => qb.where('status', '=', filters.status!))
      .$if(filters.product_code != null, (qb) => qb.where('product_code', '=', filters.product_code!))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  /** Full single config for the org, or undefined when absent/another org. */
  async findById(id: string, executor: KyselyDb | DbTransaction = this.db): Promise<ProductConfigRow | undefined> {
    return executor
      .selectFrom('product_configs')
      .selectAll()
      .where('product_config_id', '=', id)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .executeTakeFirst();
  }

  /**
   * FR-041 — all ACTIVE configs for the org, ordered by `product_code`. Surfaces
   * the seeded launch products to the lead-capture product-picker (FR-010 UI).
   * LIMIT-bounded (NFR-17): the supported-product set is small (7 at launch) and
   * is never expected to approach 100.
   */
  async findAllActive(): Promise<ProductConfigRow[]> {
    return this.db
      .selectFrom('product_configs')
      .selectAll()
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('status', '=', 'active')
      .orderBy('product_code', 'asc')
      .limit(100)
      .execute();
  }

  /**
   * FR-041 — the single ACTIVE config for a `product_code` (highest version wins),
   * or undefined when none is active. Consumed by FR-010 capture validation to
   * resolve the config a new lead pins to. Parameterised + LIMIT 1.
   */
  async findActiveByProductCode(productCode: ProductCode): Promise<ProductConfigRow | undefined> {
    return this.db
      .selectFrom('product_configs')
      .selectAll()
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('product_code', '=', productCode)
      .where('status', '=', 'active')
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Highest existing `version` for `(org, product_code)`, or 0 when none. Run
   * inside the create/edit transaction so the version assignment is consistent
   * with the unique constraint `uq_product_configs_version`.
   */
  async maxVersion(productCode: ProductCode, tx: DbTransaction): Promise<number> {
    const row = await tx
      .selectFrom('product_configs')
      .select((eb) => eb.fn.max('version').as('max_v'))
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('product_code', '=', productCode)
      .executeTakeFirst();
    return Number(row?.max_v ?? 0);
  }

  /**
   * Insert a new `product_configs` row as `draft` (maker-checker activates it
   * later via FR-132). JSONB columns are serialised; `created_by`/`updated_by` are
   * the maker. Returns the new id + version.
   */
  async insertDraft(
    fields: ProductConfigWriteFields,
    version: number,
    actorId: string,
    tx: DbTransaction,
  ): Promise<{ product_config_id: string; version: number }> {
    const row = await tx
      .insertInto('product_configs')
      .values({
        org_id: ORG_ID_DEFAULT,
        product_code: fields.product_code,
        name: fields.name,
        version,
        status: 'draft',
        field_schema: JSON.stringify(fields.field_schema),
        document_checklist: JSON.stringify(fields.document_checklist),
        sla_config: fields.sla_config != null ? JSON.stringify(fields.sla_config) : null,
        eligibility_mapping:
          fields.eligibility_mapping != null ? JSON.stringify(fields.eligibility_mapping) : null,
        pan_required_at: fields.pan_required_at,
        created_by: actorId,
        updated_by: actorId,
      })
      .returning(['product_config_id', 'version'])
      .executeTakeFirstOrThrow();
    return { product_config_id: row.product_config_id, version: row.version };
  }

  /**
   * Insert the paired `configuration_versions` row (`config_type='product_config'`,
   * `status='pending'`, `maker_id=actor`) in the same transaction. The `diff`
   * JSONB records the operation shape so FR-132's eligibility-mapping scope gate
   * (`hasEligibilityMappingChange`) can inspect it on approval. Returns the new id.
   */
  async insertConfigVersion(
    configRef: string,
    version: number,
    diff: Record<string, unknown>,
    actorId: string,
    tx: DbTransaction,
  ): Promise<string> {
    const row = await tx
      .insertInto('configuration_versions')
      .values({
        org_id: ORG_ID_DEFAULT,
        config_type: PRODUCT_CONFIG_CONFIG_TYPE,
        config_ref: configRef,
        version,
        maker_id: actorId,
        checker_id: null,
        status: 'pending',
        effective_at: null,
        rollback_ref: null,
        diff: JSON.stringify(diff),
        created_by: actorId,
        updated_by: actorId,
      })
      .returning('configuration_version_id')
      .executeTakeFirstOrThrow();
    return row.configuration_version_id;
  }

  /**
   * Status-only retire of an ACTIVE config (in-flight leads keep their pinned
   * row — no field is mutated, no `leads` row is touched). Returns the number of
   * rows updated (0 when the row was not active, so the caller can map CONFLICT).
   */
  async retireActive(id: string, actorId: string, tx: DbTransaction): Promise<number> {
    const result = await tx
      .updateTable('product_configs')
      .set({ status: 'retired', updated_by: actorId, updated_at: new Date() })
      .where('product_config_id', '=', id)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('status', '=', 'active')
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }
}
