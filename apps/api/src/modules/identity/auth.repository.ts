import { Inject, Injectable } from '@nestjs/common';

import type { DataScope, RoleCode, UserStatus } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import { DEFAULT_ORG_ID } from './identity.constants';

/** The columns the auth flow needs about a user + their role (LLD §Data Operations). */
export interface AuthUserRow {
  user_id: string;
  username: string;
  email: string;
  password_hash: string | null;
  totp_secret_enc: string | null;
  status: UserStatus;
  mfa_enabled: boolean;
  org_id: string;
  role_id: string;
  role_code: RoleCode;
  default_scope: DataScope;
  last_login_at: Date | null;
  branch_id: string | null;
  team_id: string | null;
  region_id: string | null;
  partner_id: string | null;
}

/**
 * Read/write access to `users` for the auth flow (owner: M1 identity). All
 * queries are parameterised Kysely and scoped to `org_id`. Writes accept the
 * ambient `tx` so they can be enlisted in a surrounding transaction.
 */
@Injectable()
export class AuthRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** Lookup by username within the org; `undefined` when no such user. */
  async findUserByUsername(username: string, orgId = DEFAULT_ORG_ID): Promise<AuthUserRow | undefined> {
    return this.baseUserSelect().where('u.username', '=', username).where('u.org_id', '=', orgId).executeTakeFirst();
  }

  /** Lookup by email within the org (password reset); `undefined` when no such user. */
  async findUserByEmail(email: string, orgId = DEFAULT_ORG_ID): Promise<AuthUserRow | undefined> {
    return this.baseUserSelect().where('u.email', '=', email).where('u.org_id', '=', orgId).executeTakeFirst();
  }

  /** Re-read a user by id (refresh path picks up role/status changes). */
  async findUserById(userId: string, orgId = DEFAULT_ORG_ID): Promise<AuthUserRow | undefined> {
    return this.baseUserSelect().where('u.user_id', '=', userId).where('u.org_id', '=', orgId).executeTakeFirst();
  }

  /** Stamp the successful-authentication time. */
  async setLastLoginAt(userId: string, when: Date, actorId: string, tx?: DbTransaction): Promise<void> {
    const executor = tx ?? this.db;
    await executor
      .updateTable('users')
      .set({ last_login_at: when, updated_by: actorId })
      .where('user_id', '=', userId)
      .execute();
  }

  /** Transition `users.status` (e.g. → 'locked' on threshold). */
  async setStatus(userId: string, status: UserStatus, actorId: string, tx?: DbTransaction): Promise<void> {
    const executor = tx ?? this.db;
    await executor
      .updateTable('users')
      .set({ status, updated_by: actorId })
      .where('user_id', '=', userId)
      .execute();
  }

  private baseUserSelect() {
    return this.db
      .selectFrom('users as u')
      .innerJoin('roles as r', 'r.role_id', 'u.role_id')
      .select([
        'u.user_id',
        'u.username',
        'u.email',
        'u.password_hash',
        'u.totp_secret_enc',
        'u.status',
        'u.mfa_enabled',
        'u.org_id',
        'u.role_id',
        'r.code as role_code',
        'r.default_scope',
        'u.last_login_at',
        'u.branch_id',
        'u.team_id',
        'u.region_id',
        'u.partner_id',
      ]);
  }
}
