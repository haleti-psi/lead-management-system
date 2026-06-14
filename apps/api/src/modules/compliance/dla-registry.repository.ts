import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';

import type { DlaType, ConfigStatus } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { DlaRegistry } from '../../core/db/types.generated';
import type { ListDlaFiltersDto } from './dto/list-dla-filters.dto';
import type { GrievanceOfficerDto } from './dto/create-dla.dto';
import {
  DLA_REGISTRY_DEFAULT_SORT,
  DLA_REGISTRY_LIST_MAX_LIMIT,
} from './dla-registry.constants';

export type DlaRegistryRow = Selectable<DlaRegistry>;

/** Insert shape for a new DLA registry row. */
export interface NewDlaRegistry {
  org_id: string;
  name: string;
  type: DlaType;
  owner: string | null;
  url: string | null;
  grievance_officer: string | null;
  enabled_products: string | null;
  data_collected: string | null;
  storage_location: string | null;
  status: ConfigStatus;
  created_by: string;
  updated_by: string;
}

/** Partial update payload; `updated_by` and `updated_at` always set. */
export interface PatchDlaRegistry {
  name?: string;
  type?: DlaType;
  owner?: string | null;
  url?: string | null;
  grievance_officer?: string | null;
  enabled_products?: string | null;
  data_collected?: string | null;
  storage_location?: string | null;
  status?: ConfigStatus;
  updated_by: string;
  updated_at: Date;
}

export interface DlaListInput {
  orgId: string;
  filters: Pick<ListDlaFiltersDto, 'type' | 'status' | 'sort'>;
  pagination: { page: number; limit: number };
}

/**
 * FR-113 — Kysely-backed repository for `dla_registry`.
 * M12 is the SOLE writer of this table (owner-writes §11).
 * All reads are parameterised and LIMIT-bounded (NFR-17).
 */
@Injectable()
export class DlaRegistryRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /**
   * Fetch a single DLA registry entry by primary key, scoped to `org_id`.
   * Returns `undefined` when not found.
   */
  async findById(id: string, orgId: string): Promise<DlaRegistryRow | undefined> {
    return this.db
      .selectFrom('dla_registry')
      .selectAll()
      .where('dla_registry_id', '=', id)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Lookup an entry by name within an org to enforce name-uniqueness (LLD Ambiguity #2).
   * Returns `undefined` when not found.
   */
  async findByNameAndOrg(name: string, orgId: string): Promise<DlaRegistryRow | undefined> {
    return this.db
      .selectFrom('dla_registry')
      .selectAll()
      .where('name', '=', name)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Paginated list, org-scoped, with optional type/status filters.
   * LIMIT is clamped to DLA_REGISTRY_LIST_MAX_LIMIT (100).
   */
  async list(input: DlaListInput): Promise<{ rows: DlaRegistryRow[]; total: number }> {
    const clampedLimit = Math.min(input.pagination.limit, DLA_REGISTRY_LIST_MAX_LIMIT);
    const offset = (input.pagination.page - 1) * clampedLimit;

    // Build a single sort direction from the `sort` field:
    // '-' prefix means descending; no prefix means ascending
    const rawSort = input.filters.sort ?? DLA_REGISTRY_DEFAULT_SORT;
    const isDesc = rawSort.startsWith('-');
    const column = isDesc ? rawSort.slice(1) : rawSort;
    const dir: 'asc' | 'desc' = isDesc ? 'desc' : 'asc';

    // List query
    let rowQuery = this.db
      .selectFrom('dla_registry')
      .selectAll()
      .where('org_id', '=', input.orgId);

    if (input.filters.type !== undefined) {
      rowQuery = rowQuery.where('type', '=', input.filters.type);
    }
    if (input.filters.status !== undefined) {
      rowQuery = rowQuery.where('status', '=', input.filters.status);
    }

    const rows = await rowQuery
      .orderBy(column as 'name' | 'type' | 'status' | 'created_at', dir)
      .limit(clampedLimit)
      .offset(offset)
      .execute();

    // Count query (same filters, no pagination)
    let countQuery = this.db
      .selectFrom('dla_registry')
      .select(this.db.fn.countAll<number>().as('total'))
      .where('org_id', '=', input.orgId);

    if (input.filters.type !== undefined) {
      countQuery = countQuery.where('type', '=', input.filters.type);
    }
    if (input.filters.status !== undefined) {
      countQuery = countQuery.where('status', '=', input.filters.status);
    }

    const { total } = await countQuery.executeTakeFirstOrThrow();

    return { rows, total: Number(total) };
  }

  /**
   * Insert a new DLA registry entry, returning the created row.
   * Must be called inside a UnitOfWork transaction.
   */
  async create(row: NewDlaRegistry, tx: DbTransaction): Promise<DlaRegistryRow> {
    return tx
      .insertInto('dla_registry')
      .values(row)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Patch an existing DLA registry entry. Returns `undefined` when the row is not
   * found for this org (caller maps to NOT_FOUND). Must be called inside a
   * UnitOfWork transaction.
   */
  async update(
    id: string,
    orgId: string,
    patch: PatchDlaRegistry,
    tx: DbTransaction,
  ): Promise<DlaRegistryRow | undefined> {
    return tx
      .updateTable('dla_registry')
      .set(patch)
      .where('dla_registry_id', '=', id)
      .where('org_id', '=', orgId)
      .returningAll()
      .executeTakeFirst();
  }
}

/** Parse a nullable JSONB column into a typed value (or null). */
export function parseJsonColumn<T>(col: unknown): T | null {
  if (col === null || col === undefined) return null;
  if (typeof col === 'string') return JSON.parse(col) as T;
  return col as T;
}

/** Serialise a nullable value to a JSON string for storage, or null. */
export function toJsonColumn<T>(val: T | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  return JSON.stringify(val);
}

/** Map a raw DB row to the canonical DLA entry shape. */
export function rowToDlaData(row: DlaRegistryRow): DlaData {
  return {
    dlaRegistryId: row.dla_registry_id,
    name: row.name,
    type: row.type,
    owner: row.owner ?? null,
    url: row.url ?? null,
    grievanceOfficer: parseJsonColumn<GrievanceOfficerDto>(row.grievance_officer),
    enabledProducts: parseJsonColumn<string[]>(row.enabled_products),
    dataCollected: parseJsonColumn<string[]>(row.data_collected),
    storageLocation: row.storage_location ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Full DLA registry resource shape returned by all endpoints. */
export interface DlaData {
  dlaRegistryId: string;
  name: string;
  type: DlaType;
  owner: string | null;
  url: string | null;
  grievanceOfficer: GrievanceOfficerDto | null;
  enabledProducts: string[] | null;
  dataCollected: string[] | null;
  storageLocation: string | null;
  status: ConfigStatus;
  createdAt: Date;
  updatedAt: Date;
}
