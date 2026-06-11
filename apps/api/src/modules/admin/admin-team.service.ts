import { Injectable } from '@nestjs/common';

import { AuditAction, DataScope, ERROR_CODES, UserStatus } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { UnitOfWork, type DbTransaction } from '../../core/db';
import { DomainException } from '../../core/http';
import { TEAM_ENTITY_TYPE } from './admin.constants';
import type { CreateTeamDto } from './dto/create-team.dto';
import type { UpdateTeamDto } from './dto/update-team.dto';
import { UserRepository } from './user.repository';
import { TeamRepository, type TeamRow, type UpdateTeamValues } from './team.repository';

/** Result of {@link AdminTeamService.listTeams} — rows + pagination total. */
export interface ListTeamsResult {
  rows: TeamRow[];
  total: number;
}

/**
 * FR-130 — team administration (M14, ADMIN / `user_mgmt`, scope A). A team is
 * scoped to an active branch and may carry an active manager user. Create/update
 * commit atomically in one {@link UnitOfWork} transaction with a `user_change`
 * audit intent (team writes audit under `user_change` with `entity_type='team'`,
 * per the LLD). Deactivation is `is_active=false`.
 */
@Injectable()
export class AdminTeamService {
  constructor(
    private readonly teams: TeamRepository,
    private readonly users: UserRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
  ) {}

  /** List teams (paginated, optional branch / is_active filter). Read path. */
  async listTeams(
    filters: { branch_id?: string; is_active?: boolean },
    page: number,
    limit: number,
    actor: AuthUser,
    effectiveScope: DataScope | undefined,
  ): Promise<ListTeamsResult> {
    this.requireScopeA(effectiveScope);
    const [rows, total] = await Promise.all([
      this.teams.listTeams(actor.orgId, filters, page, limit),
      this.teams.countTeams(actor.orgId, filters),
    ]);
    return { rows, total };
  }

  /** Create a team after validating the branch is active and any manager is active. */
  async createTeam(dto: CreateTeamDto, actor: AuthUser, effectiveScope: DataScope | undefined): Promise<TeamRow> {
    this.requireScopeA(effectiveScope);

    return this.uow.run(async (tx) => {
      if (!(await this.users.branchActive(actor.orgId, dto.branch_id, tx))) {
        throw new DomainException(ERROR_CODES.NOT_FOUND, undefined, { detail: { reason: 'branch_id not found or inactive' } });
      }
      if (dto.manager_id != null) {
        await this.requireActiveManager(actor.orgId, dto.manager_id, tx);
      }

      const teamId = await this.teams.createTeam(
        actor.orgId,
        { name: dto.name, branch_id: dto.branch_id, manager_id: dto.manager_id ?? null },
        actor.userId,
        tx,
      );

      await this.audit.append(
        {
          action: AuditAction.USER_CHANGE,
          entity_type: TEAM_ENTITY_TYPE,
          entity_id: teamId,
          actor_id: actor.userId,
          org_id: actor.orgId,
          lead_id: null,
          detail: { sub_action: 'create', name: dto.name, branch_id: dto.branch_id },
        },
        tx,
      );

      const created = await this.teams.findById(actor.orgId, teamId, tx);
      if (!created) throw new DomainException(ERROR_CODES.INTERNAL_ERROR);
      return created;
    });
  }

  /** Update a team (partial); validates branch/manager when supplied. */
  async updateTeam(
    teamId: string,
    dto: UpdateTeamDto,
    actor: AuthUser,
    effectiveScope: DataScope | undefined,
  ): Promise<TeamRow> {
    this.requireScopeA(effectiveScope);

    return this.uow.run(async (tx) => {
      const existing = await this.teams.findById(actor.orgId, teamId, tx);
      if (!existing) throw new DomainException(ERROR_CODES.NOT_FOUND);

      if (dto.branch_id != null && !(await this.users.branchActive(actor.orgId, dto.branch_id, tx))) {
        throw new DomainException(ERROR_CODES.NOT_FOUND, undefined, { detail: { reason: 'branch_id not found or inactive' } });
      }
      if (dto.manager_id != null) {
        await this.requireActiveManager(actor.orgId, dto.manager_id, tx);
      }

      const values: UpdateTeamValues = {};
      if (dto.name !== undefined) values.name = dto.name;
      if (dto.branch_id !== undefined) values.branch_id = dto.branch_id;
      if (dto.manager_id !== undefined) values.manager_id = dto.manager_id;
      if (dto.is_active !== undefined) values.is_active = dto.is_active;

      const updated = await this.teams.updateTeam(actor.orgId, teamId, values, actor.userId, tx);
      if (updated === 0) throw new DomainException(ERROR_CODES.NOT_FOUND);

      await this.audit.append(
        {
          action: AuditAction.USER_CHANGE,
          entity_type: TEAM_ENTITY_TYPE,
          entity_id: teamId,
          actor_id: actor.userId,
          org_id: actor.orgId,
          lead_id: null,
          detail: { changed_fields: Object.keys(values) },
        },
        tx,
      );

      const after = await this.teams.findById(actor.orgId, teamId, tx);
      if (!after) throw new DomainException(ERROR_CODES.INTERNAL_ERROR);
      return after;
    });
  }

  private async requireActiveManager(orgId: string, managerId: string, tx: DbTransaction): Promise<void> {
    const manager = await this.users.findStatus(orgId, managerId, tx);
    if (!manager) throw new DomainException(ERROR_CODES.NOT_FOUND, undefined, { detail: { reason: 'manager_id not found' } });
    if (manager.status !== UserStatus.ACTIVE) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [{ field: 'manager_id', issue: 'manager must be an active user.' }],
      });
    }
  }

  /** Org-wide team administration requires effective scope A. */
  private requireScopeA(effectiveScope: DataScope | undefined): void {
    if (effectiveScope !== DataScope.A) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
  }
}
