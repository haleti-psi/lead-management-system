import { Inject, Injectable } from '@nestjs/common';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import { MAX_PAGE_LIMIT } from './dto/list-users.dto';

/** A `teams` row for the list/get projection. */
export interface TeamRow {
  team_id: string;
  name: string;
  branch_id: string;
  manager_id: string | null;
  is_active: boolean;
}

/** Filters accepted by {@link TeamRepository.listTeams}. */
export interface TeamListFilters {
  branch_id?: string;
  is_active?: boolean;
}

/** Values written by {@link TeamRepository.createTeam}. */
export interface CreateTeamValues {
  name: string;
  branch_id: string;
  manager_id: string | null;
}

/** Patch for {@link TeamRepository.updateTeam}; only present keys are set. */
export interface UpdateTeamValues {
  name?: string;
  branch_id?: string;
  manager_id?: string | null;
  is_active?: boolean;
}

const TEAM_COLUMNS = ['team_id', 'name', 'branch_id', 'manager_id', 'is_active'] as const;

/**
 * FR-130 — owner repository for the `teams` table (M1/M14, ADMIN). All queries
 * are parameterised Kysely, `org_id`-scoped, and list reads are `LIMIT`-bounded
 * (≤100). A team is scoped to a branch and may carry a manager user; deactivation
 * is a `PATCH … { is_active: false }` (teams are never hard-deleted).
 */
@Injectable()
export class TeamRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** Paginated, filtered list of teams. Read-only. */
  async listTeams(
    orgId: string,
    filters: TeamListFilters,
    page: number,
    limit: number,
    tx?: DbTransaction,
  ): Promise<TeamRow[]> {
    const bounded = Math.min(limit, MAX_PAGE_LIMIT);
    const executor = tx ?? this.db;
    return executor
      .selectFrom('teams')
      .select([...TEAM_COLUMNS])
      .where('org_id', '=', orgId)
      .$if(filters.branch_id != null, (q) => q.where('branch_id', '=', filters.branch_id!))
      .$if(filters.is_active != null, (q) => q.where('is_active', '=', filters.is_active!))
      .orderBy('name', 'asc')
      .limit(bounded)
      .offset((page - 1) * bounded)
      .execute();
  }

  /** Total team count matching the same filters (pagination meta). Read-only. */
  async countTeams(orgId: string, filters: TeamListFilters, tx?: DbTransaction): Promise<number> {
    const executor = tx ?? this.db;
    const row = await executor
      .selectFrom('teams')
      .select((eb) => eb.fn.countAll().as('total'))
      .where('org_id', '=', orgId)
      .$if(filters.branch_id != null, (q) => q.where('branch_id', '=', filters.branch_id!))
      .$if(filters.is_active != null, (q) => q.where('is_active', '=', filters.is_active!))
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  /** Fetch a single team by id within the org. Read-only. */
  async findById(orgId: string, teamId: string, tx?: DbTransaction): Promise<TeamRow | undefined> {
    const executor = tx ?? this.db;
    return executor
      .selectFrom('teams')
      .select([...TEAM_COLUMNS])
      .where('org_id', '=', orgId)
      .where('team_id', '=', teamId)
      .executeTakeFirst();
  }

  /** Insert a team. Returns the new team id; the caller re-reads for the response. */
  async createTeam(
    orgId: string,
    values: CreateTeamValues,
    actorId: string,
    tx: DbTransaction,
  ): Promise<string> {
    const inserted = await tx
      .insertInto('teams')
      .values({
        org_id: orgId,
        name: values.name,
        branch_id: values.branch_id,
        manager_id: values.manager_id,
        created_by: actorId,
        updated_by: actorId,
      })
      .returning('team_id')
      .executeTakeFirstOrThrow();
    return inserted.team_id;
  }

  /** Partial update of a team. Returns rows updated (0 ⇒ not found in this org). */
  async updateTeam(
    orgId: string,
    teamId: string,
    values: UpdateTeamValues,
    actorId: string,
    tx: DbTransaction,
  ): Promise<number> {
    const result = await tx
      .updateTable('teams')
      .set({ ...values, updated_by: actorId, updated_at: new Date() })
      .where('org_id', '=', orgId)
      .where('team_id', '=', teamId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }
}
