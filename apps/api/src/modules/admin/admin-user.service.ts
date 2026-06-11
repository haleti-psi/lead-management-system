import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

import { AuditAction, DataScope, ERROR_CODES, UserStatus } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { EntitlementCacheService } from '../../core/auth';
import { UnitOfWork, type DbTransaction } from '../../core/db';
import { DomainException } from '../../core/http';
import { USER_ENTITY_TYPE } from './admin.constants';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import { USER_SORT_COLUMNS, type ListUsersQuery } from './dto/list-users.dto';
import { LEAD_REASSIGN_PORT, type LeadReassignPort } from './ports/lead-reassign.port';
import type { UpdateUserValues, UserListRow } from './user.repository';
import { UserRepository } from './user.repository';

/** Result of {@link AdminUserService.listUsers} — rows + pagination total. */
export interface ListUsersResult {
  rows: UserListRow[];
  total: number;
}

/** The optional FK references validated on create/update. */
interface ForeignKeyRefs {
  role_id?: string;
  branch_id?: string;
  team_id?: string;
  region_id?: string;
  partner_id?: string;
}

/**
 * FR-130 — user lifecycle service (M14, ADMIN / capability `user_mgmt`, scope A).
 *
 * Every write runs in ONE {@link UnitOfWork} transaction that atomically performs
 * the data change plus its `audit_logs` intent; any throw rolls the whole
 * transaction back (no partial state). `user_mgmt` is an org-wide capability, so
 * the service enforces an effective scope-A floor before any work (matching the
 * FR-132 governance pattern). On role/attribute changes it evicts the actor's
 * ABAC cache (E1, CORRECTIONS.md) so a revoked grant never survives in Redis.
 *
 * Owner-writes: the `leads` table is never written here. Deactivating a user who
 * still owns open leads is gated — it requires an explicit, active `reassign_to`
 * user, and the reassignment is delegated to {@link LeadReassignPort} (Wave 2 →
 * `LeadService.bulkReassign`) inside the same transaction.
 */
@Injectable()
export class AdminUserService {
  constructor(
    private readonly users: UserRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
    private readonly cache: EntitlementCacheService,
    @Inject(LEAD_REASSIGN_PORT) private readonly leadReassign: LeadReassignPort,
  ) {}

  /** List users (paginated, filtered). Read path — no transaction needed. */
  async listUsers(query: ListUsersQuery, actor: AuthUser, effectiveScope: DataScope | undefined): Promise<ListUsersResult> {
    this.requireScopeA(effectiveScope);
    const filters = {
      status: query.filter?.status,
      role_id: query.filter?.role_id,
      branch_id: query.filter?.branch_id,
      team_id: query.filter?.team_id,
    };
    const { column, direction } = parseSort(query.sort);
    const [rows, total] = await Promise.all([
      this.users.listUsers(actor.orgId, filters, { page: query.page, limit: query.limit, column, direction }),
      this.users.countUsers(actor.orgId, filters),
    ]);
    return { rows, total };
  }

  /** Create a user (argon2-hashed temporary password). Returns the masked projection. */
  async createUser(dto: CreateUserDto, actor: AuthUser, effectiveScope: DataScope | undefined): Promise<UserListRow> {
    this.requireScopeA(effectiveScope);
    const passwordHash = await this.hashTemporaryPassword();

    return this.uow.run(async (tx) => {
      if (await this.users.existsByUsernameOrEmail(actor.orgId, dto.username, dto.email, tx)) {
        throw new DomainException(ERROR_CODES.CONFLICT, undefined, {
          detail: { reason: 'username or email already exists in this org' },
        });
      }
      await this.validateForeignKeys(actor.orgId, dto, tx);

      const userId = await this.users.createUser(
        actor.orgId,
        {
          username: dto.username,
          email: dto.email,
          full_name: dto.full_name,
          mobile: dto.mobile ?? null,
          password_hash: passwordHash,
          role_id: dto.role_id,
          branch_id: dto.branch_id ?? null,
          team_id: dto.team_id ?? null,
          region_id: dto.region_id ?? null,
          partner_id: dto.partner_id ?? null,
          product_skills: dto.product_skills != null ? JSON.stringify(dto.product_skills) : null,
          mfa_enabled: dto.mfa_enabled,
          reporting_manager_id: dto.reporting_manager_id ?? null,
        },
        actor.userId,
        tx,
      );

      await this.audit.append(
        {
          action: AuditAction.USER_CHANGE,
          entity_type: USER_ENTITY_TYPE,
          entity_id: userId,
          actor_id: actor.userId,
          org_id: actor.orgId,
          lead_id: null,
          detail: { sub_action: 'create', role_id: dto.role_id },
        },
        tx,
      );

      const created = await this.users.findById(actor.orgId, userId, tx);
      if (!created) throw new DomainException(ERROR_CODES.INTERNAL_ERROR);
      return created;
    });
  }

  /**
   * Update a user (partial). Handles field edits and the active↔inactive
   * transition (incl. the deactivate-with-open-leads reassignment gate). The
   * DTO already rejects `status='locked'` (system-only lockout) as a validation
   * error, so no illegal transition reaches here.
   */
  async updateUser(
    userId: string,
    dto: UpdateUserDto,
    actor: AuthUser,
    effectiveScope: DataScope | undefined,
  ): Promise<UserListRow> {
    this.requireScopeA(effectiveScope);

    const result = await this.uow.run(async (tx) => {
      const existing = await this.users.findById(actor.orgId, userId, tx);
      if (!existing) throw new DomainException(ERROR_CODES.NOT_FOUND);

      if (dto.status === UserStatus.INACTIVE) {
        await this.handleDeactivation(userId, dto.reassign_to, actor, tx);
      }

      await this.validateForeignKeys(actor.orgId, dto, tx);

      const values = this.toUpdateValues(dto);
      const updated = await this.users.updateUser(actor.orgId, userId, values, actor.userId, tx);
      if (updated === 0) throw new DomainException(ERROR_CODES.NOT_FOUND);

      const roleChanged = dto.role_id != null && dto.role_id !== existing.role_id;
      await this.audit.append(
        {
          action: roleChanged ? AuditAction.ROLE_CHANGE : AuditAction.USER_CHANGE,
          entity_type: USER_ENTITY_TYPE,
          entity_id: userId,
          actor_id: actor.userId,
          org_id: actor.orgId,
          lead_id: null,
          detail: roleChanged
            ? { from: existing.role_id, to: dto.role_id }
            : { changed_fields: Object.keys(values) },
        },
        tx,
      );

      const after = await this.users.findById(actor.orgId, userId, tx);
      if (!after) throw new DomainException(ERROR_CODES.INTERNAL_ERROR);
      return after;
    });

    // E1: evict the actor's cached entitlement AFTER the write commits, so any
    // role/status/attribute change cannot leave a stale grant in Redis.
    await this.cache.invalidateUser(userId, actor.orgId);
    return result;
  }

  /**
   * Deactivation gate (LLD §Backend Flow). If the user owns open (non-terminal)
   * leads, a valid active `reassign_to` user is mandatory; the reassignment runs
   * through {@link LeadReassignPort} (owner-writes) inside this transaction and is
   * audited as a single bulk `reassign` row.
   */
  private async handleDeactivation(
    userId: string,
    reassignTo: string | undefined,
    actor: AuthUser,
    tx: DbTransaction,
  ): Promise<void> {
    const openCount = await this.users.countOpenLeads(actor.orgId, userId, tx);
    if (openCount === 0) return;

    if (reassignTo == null) {
      throw new DomainException(ERROR_CODES.CONFLICT, undefined, {
        detail: { reason: 'user has open leads; supply reassign_to to proceed', open_lead_count: openCount },
      });
    }
    if (reassignTo === userId) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [{ field: 'reassign_to', issue: 'reassign_to must differ from the user being deactivated.' }],
      });
    }

    const target = await this.users.findStatus(actor.orgId, reassignTo, tx);
    if (!target) throw new DomainException(ERROR_CODES.NOT_FOUND);
    if (target.status !== UserStatus.ACTIVE) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [{ field: 'reassign_to', issue: 'reassign_to user not found or not active.' }],
      });
    }

    await this.leadReassign.bulkReassign(userId, reassignTo, 'owner_deactivated', tx);

    await this.audit.append(
      {
        action: AuditAction.REASSIGN,
        entity_type: USER_ENTITY_TYPE,
        entity_id: userId,
        actor_id: actor.userId,
        org_id: actor.orgId,
        lead_id: null,
        detail: { bulk: true, reassigned_to: reassignTo, count: openCount },
      },
      tx,
    );
  }

  /** Map the DTO's present fields to the repository update patch. */
  private toUpdateValues(dto: UpdateUserDto): UpdateUserValues {
    const values: UpdateUserValues = {};
    if (dto.full_name !== undefined) values.full_name = dto.full_name;
    if (dto.mobile !== undefined) values.mobile = dto.mobile;
    if (dto.role_id !== undefined) values.role_id = dto.role_id;
    if (dto.branch_id !== undefined) values.branch_id = dto.branch_id;
    if (dto.team_id !== undefined) values.team_id = dto.team_id;
    if (dto.region_id !== undefined) values.region_id = dto.region_id;
    if (dto.partner_id !== undefined) values.partner_id = dto.partner_id;
    if (dto.product_skills !== undefined) values.product_skills = JSON.stringify(dto.product_skills);
    if (dto.mfa_enabled !== undefined) values.mfa_enabled = dto.mfa_enabled;
    if (dto.status !== undefined) values.status = dto.status;
    return values;
  }

  /** Validate every supplied FK reference exists (and the branch is active). */
  private async validateForeignKeys(orgId: string, dto: ForeignKeyRefs, tx: DbTransaction): Promise<void> {
    if (dto.role_id != null && !(await this.users.roleExists(orgId, dto.role_id, tx))) {
      throw new DomainException(ERROR_CODES.NOT_FOUND, undefined, { detail: { reason: 'role_id not found' } });
    }
    if (dto.branch_id != null && !(await this.users.branchActive(orgId, dto.branch_id, tx))) {
      throw new DomainException(ERROR_CODES.NOT_FOUND, undefined, { detail: { reason: 'branch_id not found or inactive' } });
    }
    if (dto.team_id != null && !(await this.users.teamExists(orgId, dto.team_id, tx))) {
      throw new DomainException(ERROR_CODES.NOT_FOUND, undefined, { detail: { reason: 'team_id not found' } });
    }
    if (dto.region_id != null && !(await this.users.regionExists(orgId, dto.region_id, tx))) {
      throw new DomainException(ERROR_CODES.NOT_FOUND, undefined, { detail: { reason: 'region_id not found' } });
    }
    if (dto.partner_id != null && !(await this.users.partnerExists(orgId, dto.partner_id, tx))) {
      throw new DomainException(ERROR_CODES.NOT_FOUND, undefined, { detail: { reason: 'partner_id not found' } });
    }
  }

  /** Org-wide user administration requires effective scope A. */
  private requireScopeA(effectiveScope: DataScope | undefined): void {
    if (effectiveScope !== DataScope.A) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
  }

  /**
   * Generate a high-entropy temporary password and argon2id-hash it. The cleartext
   * is never persisted, returned, or logged (security.md); the user sets a real
   * password via the FR-001 reset flow. Only the hash leaves this method.
   */
  private async hashTemporaryPassword(): Promise<string> {
    const temporary = randomBytes(24).toString('base64url');
    return argon2.hash(temporary, { type: argon2.argon2id });
  }
}

/** Parse a `+`/`-` prefixed sort token into a safe column + direction. */
function parseSort(sort: string | undefined): { column: (typeof USER_SORT_COLUMNS)[number]; direction: 'asc' | 'desc' } {
  if (sort == null || sort.length === 0) {
    return { column: 'created_at', direction: 'desc' };
  }
  const direction = sort.startsWith('-') ? 'desc' : 'asc';
  const raw = sort.replace(/^[+-]/, '');
  const column = (USER_SORT_COLUMNS as readonly string[]).includes(raw)
    ? (raw as (typeof USER_SORT_COLUMNS)[number])
    : 'created_at';
  return { column, direction };
}
