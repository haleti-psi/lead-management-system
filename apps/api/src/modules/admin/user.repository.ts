import { Inject, Injectable } from '@nestjs/common';

import { ERROR_CODES, type UserStatus } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import { DomainException } from '../../core/http';
import { TERMINAL_LEAD_STAGES } from './admin.constants';
import { MAX_PAGE_LIMIT, type UserSortColumn } from './dto/list-users.dto';

/** A row of the `users` list projection (LLD §Data Operations → List users). */
export interface UserListRow {
  user_id: string;
  username: string;
  full_name: string;
  email: string;
  mobile: string | null;
  role_id: string;
  role_code: string | null;
  branch_id: string | null;
  team_id: string | null;
  region_id: string | null;
  partner_id: string | null;
  product_skills: unknown;
  mfa_enabled: boolean;
  status: UserStatus;
  reporting_manager_id: string | null;
  last_login_at: Date | null;
  created_at: Date;
}

/** Filters accepted by {@link UserRepository.listUsers}. */
export interface UserListFilters {
  status?: UserStatus;
  role_id?: string;
  branch_id?: string;
  team_id?: string;
}

/** Pagination + sort accepted by {@link UserRepository.listUsers}. */
export interface UserListPaging {
  page: number;
  limit: number;
  column: UserSortColumn;
  direction: 'asc' | 'desc';
}

/** Values written by {@link UserRepository.createUser}. `product_skills` is pre-serialised JSON. */
export interface CreateUserValues {
  username: string;
  email: string;
  full_name: string;
  mobile: string | null;
  password_hash: string;
  role_id: string;
  branch_id: string | null;
  team_id: string | null;
  region_id: string | null;
  partner_id: string | null;
  product_skills: string | null;
  mfa_enabled: boolean;
  reporting_manager_id: string | null;
}

/** Patch written by {@link UserRepository.updateUser}; only present keys are set. */
export interface UpdateUserValues {
  full_name?: string;
  mobile?: string | null;
  role_id?: string;
  branch_id?: string | null;
  team_id?: string | null;
  region_id?: string | null;
  partner_id?: string | null;
  product_skills?: string | null;
  mfa_enabled?: boolean;
  status?: UserStatus;
}

const USER_COLUMNS = [
  'u.user_id',
  'u.username',
  'u.full_name',
  'u.email',
  'u.mobile',
  'u.role_id',
  'u.branch_id',
  'u.team_id',
  'u.region_id',
  'u.partner_id',
  'u.product_skills',
  'u.mfa_enabled',
  'u.status',
  'u.reporting_manager_id',
  'u.last_login_at',
  'u.created_at',
] as const;

/** Postgres unique-violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * FR-130 — owner repository for the `users` table (M1/M14, ADMIN). All queries
 * are parameterised Kysely, `org_id`-scoped, and list reads are `LIMIT`-bounded
 * (≤100). A `password_hash` is required on insert and is never selected back into
 * any read projection (security.md: never return password hashes). Unique
 * constraint violations on (`org_id`,`username`) / (`org_id`,`email`) are mapped
 * to `CONFLICT` (409).
 */
@Injectable()
export class UserRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** Paginated, filtered list of users joined to their role code. Read-only. */
  async listUsers(
    orgId: string,
    filters: UserListFilters,
    paging: UserListPaging,
    tx?: DbTransaction,
  ): Promise<UserListRow[]> {
    const limit = Math.min(paging.limit, MAX_PAGE_LIMIT);
    const executor = tx ?? this.db;
    return executor
      .selectFrom('users as u')
      .leftJoin('roles as r', 'r.role_id', 'u.role_id')
      .select([...USER_COLUMNS, 'r.code as role_code'])
      .where('u.org_id', '=', orgId)
      .$if(filters.status != null, (q) => q.where('u.status', '=', filters.status!))
      .$if(filters.role_id != null, (q) => q.where('u.role_id', '=', filters.role_id!))
      .$if(filters.branch_id != null, (q) => q.where('u.branch_id', '=', filters.branch_id!))
      .$if(filters.team_id != null, (q) => q.where('u.team_id', '=', filters.team_id!))
      .orderBy(`u.${paging.column}`, paging.direction)
      .limit(limit)
      .offset((paging.page - 1) * limit)
      .execute();
  }

  /** Total count matching the same filters (for pagination meta). Read-only. */
  async countUsers(orgId: string, filters: UserListFilters, tx?: DbTransaction): Promise<number> {
    const executor = tx ?? this.db;
    const row = await executor
      .selectFrom('users as u')
      .select((eb) => eb.fn.countAll().as('total'))
      .where('u.org_id', '=', orgId)
      .$if(filters.status != null, (q) => q.where('u.status', '=', filters.status!))
      .$if(filters.role_id != null, (q) => q.where('u.role_id', '=', filters.role_id!))
      .$if(filters.branch_id != null, (q) => q.where('u.branch_id', '=', filters.branch_id!))
      .$if(filters.team_id != null, (q) => q.where('u.team_id', '=', filters.team_id!))
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  /** Fetch a single user by id within the org (list projection). Read-only. */
  async findById(orgId: string, userId: string, tx?: DbTransaction): Promise<UserListRow | undefined> {
    const executor = tx ?? this.db;
    return executor
      .selectFrom('users as u')
      .leftJoin('roles as r', 'r.role_id', 'u.role_id')
      .select([...USER_COLUMNS, 'r.code as role_code'])
      .where('u.org_id', '=', orgId)
      .where('u.user_id', '=', userId)
      .executeTakeFirst();
  }

  /** Fetch a user's status + role for active/transition checks (e.g. reassign target). */
  async findStatus(
    orgId: string,
    userId: string,
    tx?: DbTransaction,
  ): Promise<{ user_id: string; status: UserStatus; role_id: string } | undefined> {
    const executor = tx ?? this.db;
    return executor
      .selectFrom('users')
      .select(['user_id', 'status', 'role_id'])
      .where('org_id', '=', orgId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  /** True if a user already exists with this username OR email in the org. */
  async existsByUsernameOrEmail(
    orgId: string,
    username: string,
    email: string,
    tx?: DbTransaction,
  ): Promise<boolean> {
    const executor = tx ?? this.db;
    const row = await executor
      .selectFrom('users')
      .select('user_id')
      .where('org_id', '=', orgId)
      .where((eb) => eb.or([eb('username', '=', username), eb('email', '=', email)]))
      .limit(1)
      .executeTakeFirst();
    return row != null;
  }

  /**
   * Insert a new user (status defaults to `active` at the DB). Maps a unique
   * violation to `CONFLICT` (409). Returns the new user id only — the caller
   * re-reads the masked projection for the response.
   */
  async createUser(
    orgId: string,
    values: CreateUserValues,
    actorId: string,
    tx: DbTransaction,
  ): Promise<string> {
    try {
      const inserted = await tx
        .insertInto('users')
        .values({
          org_id: orgId,
          username: values.username,
          email: values.email,
          full_name: values.full_name,
          mobile: values.mobile,
          password_hash: values.password_hash,
          role_id: values.role_id,
          branch_id: values.branch_id,
          team_id: values.team_id,
          region_id: values.region_id,
          partner_id: values.partner_id,
          product_skills: values.product_skills,
          mfa_enabled: values.mfa_enabled,
          reporting_manager_id: values.reporting_manager_id,
          created_by: actorId,
          updated_by: actorId,
        })
        .returning('user_id')
        .executeTakeFirstOrThrow();
      return inserted.user_id;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainException(ERROR_CODES.CONFLICT, undefined, {
          detail: { reason: 'username or email already exists in this org' },
          cause: err,
        });
      }
      throw err;
    }
  }

  /**
   * Partial update of a user's fields/status within the org. Only the keys
   * present in `values` are written; `updated_by`/`updated_at` are always
   * stamped. Returns the number of rows updated (0 ⇒ not found in this org).
   */
  async updateUser(
    orgId: string,
    userId: string,
    values: UpdateUserValues,
    actorId: string,
    tx: DbTransaction,
  ): Promise<number> {
    const result = await tx
      .updateTable('users')
      .set({ ...values, updated_by: actorId, updated_at: new Date() })
      .where('org_id', '=', orgId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  /**
   * Count the user's open (non-terminal, non-deleted) leads (LLD Assumption A-2).
   * Read-only; runs inside the deactivation transaction so the gate sees a
   * consistent snapshot. This is a read of `leads` (owner-writes governs writes,
   * not reads).
   */
  async countOpenLeads(orgId: string, userId: string, tx: DbTransaction): Promise<number> {
    const row = await tx
      .selectFrom('leads')
      .select((eb) => eb.fn.countAll().as('open_count'))
      .where('org_id', '=', orgId)
      .where('owner_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where('stage', 'not in', [...TERMINAL_LEAD_STAGES])
      .executeTakeFirstOrThrow();
    return Number(row.open_count);
  }

  /** True if a role with this id exists in the org. */
  async roleExists(orgId: string, roleId: string, tx: DbTransaction): Promise<boolean> {
    const row = await tx
      .selectFrom('roles')
      .select('role_id')
      .where('org_id', '=', orgId)
      .where('role_id', '=', roleId)
      .limit(1)
      .executeTakeFirst();
    return row != null;
  }

  /** True if a region with this id exists in the org. */
  async regionExists(orgId: string, regionId: string, tx: DbTransaction): Promise<boolean> {
    const row = await tx
      .selectFrom('regions')
      .select('region_id')
      .where('org_id', '=', orgId)
      .where('region_id', '=', regionId)
      .limit(1)
      .executeTakeFirst();
    return row != null;
  }

  /** True if a partner with this id exists in the org. */
  async partnerExists(orgId: string, partnerId: string, tx: DbTransaction): Promise<boolean> {
    const row = await tx
      .selectFrom('partners')
      .select('partner_id')
      .where('org_id', '=', orgId)
      .where('partner_id', '=', partnerId)
      .limit(1)
      .executeTakeFirst();
    return row != null;
  }

  /** True if a branch with this id exists and is active in the org. */
  async branchActive(orgId: string, branchId: string, tx: DbTransaction): Promise<boolean> {
    const row = await tx
      .selectFrom('branches')
      .select('branch_id')
      .where('org_id', '=', orgId)
      .where('branch_id', '=', branchId)
      .where('is_active', '=', true)
      .limit(1)
      .executeTakeFirst();
    return row != null;
  }

  /** True if a team with this id exists in the org. */
  async teamExists(orgId: string, teamId: string, tx: DbTransaction): Promise<boolean> {
    const row = await tx
      .selectFrom('teams')
      .select('team_id')
      .where('org_id', '=', orgId)
      .where('team_id', '=', teamId)
      .limit(1)
      .executeTakeFirst();
    return row != null;
  }
}

/** Narrow a thrown error to a Postgres unique-constraint (23505) violation. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
