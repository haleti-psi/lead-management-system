import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Redis } from 'ioredis';

import type { Capability, DataScope, RoleCode, UserStatus } from '@lms/shared';

import { KYSELY, type KyselyDb } from '../db';
import { REDIS } from '../redis';
import {
  ACTOR_CACHE_TTL_SECONDS,
  REGION_BRANCHES_CACHE_TTL_SECONDS,
  ROLE_PERMISSIONS_LIMIT,
  SCOPE_LIST_LIMIT,
  TEAM_MEMBERS_CACHE_TTL_SECONDS,
  actorCacheKey,
  regionBranchesCacheKey,
  teamMembersCacheKey,
} from './abac.constants';
import type {
  ActiveBreakGlassGrant,
  ActorEntitlement,
  RolePermissionEntry,
} from './abac.types';

/** Wire form of {@link ActorEntitlement} (Map → entries array) for Redis JSON. */
interface CachedActor {
  userId: string;
  orgId: string;
  status: UserStatus;
  roleId: string;
  roleCode: RoleCode;
  defaultScope: DataScope;
  branchId: string | null;
  teamId: string | null;
  regionId: string | null;
  partnerId: string | null;
  permissions: Array<[Capability, RolePermissionEntry]>;
}

/**
 * FR-002 §Data Operations — the read + caching layer behind the ABAC decision.
 *
 * Loads the actor entitlement record (Read 1), team membership (Read 2), and
 * region branch list (Read 3) through Redis with the LLD's TTLs; the break-glass
 * grant (Read 4) is read live (never cached — its validity window is the cache).
 * All queries are parameterised Kysely, `org_id`-scoped, and `LIMIT`-bounded.
 *
 * **E1 cache-invalidation hook (CORRECTIONS.md):** {@link invalidateRole} and
 * {@link invalidateUser} are the contractually-pinned entry points FR-130
 * (ADMIN role/permission and user-attribute changes) MUST call after any
 * `role_permissions` / user write, so a revoked grant never survives in cache.
 */
@Injectable()
export class EntitlementCacheService {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Read 1 — the actor's scope attributes + role capability map, cached at
   * `abac:{orgId}:{userId}`. Returns `undefined` for an unknown/inactive user
   * (the evaluator treats that as a hard deny). A user with a role but no
   * capability rows yields an empty `permissions` map (every capability denies).
   */
  async loadActorEntitlement(userId: string, orgId: string): Promise<ActorEntitlement | undefined> {
    const cached = await this.readJson<CachedActor>(actorCacheKey(orgId, userId));
    if (cached) {
      return this.hydrateActor(cached);
    }

    const rows = await this.db
      .selectFrom('users as u')
      .innerJoin('roles as r', 'r.role_id', 'u.role_id')
      .leftJoin('role_permissions as rp', (join) =>
        join.onRef('rp.role_id', '=', 'u.role_id').on('rp.org_id', '=', orgId),
      )
      .where('u.user_id', '=', userId)
      .where('u.org_id', '=', orgId)
      .where('u.status', '=', 'active')
      .select([
        'u.user_id',
        'u.org_id',
        'u.status',
        'u.role_id',
        'r.code as role_code',
        'r.default_scope',
        'u.branch_id',
        'u.team_id',
        'u.region_id',
        'u.partner_id',
        'rp.capability',
        'rp.max_scope',
        'rp.conditions',
      ])
      .limit(ROLE_PERMISSIONS_LIMIT)
      .execute();

    const head = rows[0];
    if (!head) {
      return undefined;
    }

    const permissions: Array<[Capability, RolePermissionEntry]> = [];
    for (const row of rows) {
      if (row.capability == null || row.max_scope == null) continue;
      permissions.push([
        row.capability,
        {
          capability: row.capability,
          maxScope: row.max_scope,
          conditions: (row.conditions as Record<string, unknown> | null) ?? null,
        },
      ]);
    }

    const wire: CachedActor = {
      userId: head.user_id,
      orgId: head.org_id,
      status: head.status,
      roleId: head.role_id,
      roleCode: head.role_code,
      defaultScope: head.default_scope,
      branchId: head.branch_id,
      teamId: head.team_id,
      regionId: head.region_id,
      partnerId: head.partner_id,
      permissions,
    };
    await this.writeJson(actorCacheKey(orgId, userId), wire, ACTOR_CACHE_TTL_SECONDS);
    return this.hydrateActor(wire);
  }

  /** Read 2 — active member user_ids of a team (scope T), cached per team. */
  async loadTeamMemberIds(teamId: string, orgId: string): Promise<string[]> {
    const key = teamMembersCacheKey(teamId);
    const cached = await this.readJson<string[]>(key);
    if (cached) {
      return cached;
    }
    const rows = await this.db
      .selectFrom('users')
      .where('team_id', '=', teamId)
      .where('org_id', '=', orgId)
      .where('status', '=', 'active')
      .select(['user_id'])
      .limit(SCOPE_LIST_LIMIT)
      .execute();
    const ids = rows.map((r) => r.user_id);
    await this.writeJson(key, ids, TEAM_MEMBERS_CACHE_TTL_SECONDS);
    return ids;
  }

  /** Read 3 — active branch_ids of a region (scope R), cached per region. */
  async loadRegionBranchIds(regionId: string, orgId: string): Promise<string[]> {
    const key = regionBranchesCacheKey(regionId);
    const cached = await this.readJson<string[]>(key);
    if (cached) {
      return cached;
    }
    const rows = await this.db
      .selectFrom('branches')
      .where('region_id', '=', regionId)
      .where('org_id', '=', orgId)
      .where('is_active', '=', true)
      .select(['branch_id'])
      .limit(SCOPE_LIST_LIMIT)
      .execute();
    const ids = rows.map((r) => r.branch_id);
    await this.writeJson(key, ids, REGION_BRANCHES_CACHE_TTL_SECONDS);
    return ids;
  }

  /**
   * Read 4 — the actor's currently-active break-glass grant, if any. Never
   * cached: the grant's `valid_until` window is the only "TTL" that may apply, so
   * a revoked or expired grant must drop out immediately.
   */
  async loadActiveBreakGlass(userId: string, orgId: string): Promise<ActiveBreakGlassGrant | undefined> {
    const row = await this.db
      .selectFrom('break_glass_grants')
      .where('grantee_id', '=', userId)
      .where('org_id', '=', orgId)
      .where('status', '=', 'active')
      .where('valid_until', '>', sql<Date>`now()`)
      .select(['grant_id', 'scope_type', 'scope_ref', 'valid_until'])
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      return undefined;
    }
    return {
      grantId: row.grant_id,
      scopeType: row.scope_type as ActiveBreakGlassGrant['scopeType'],
      scopeRef: row.scope_ref,
      validUntil: row.valid_until as unknown as Date,
    };
  }

  /**
   * E1 — drop every cached actor whose role changed. Roles are small and Redis
   * `KEYS`/`SCAN` over `abac:*` would be O(N); instead we evict by the precise
   * set of affected user keys, which FR-130 already holds (it just updated those
   * users). FR-130 passes the affected user/org pairs.
   */
  async invalidateRole(roleId: string, affected: ReadonlyArray<{ userId: string; orgId: string }>): Promise<void> {
    // roleId is part of the public signature (FR-130 contract / E1) and is logged
    // by the caller; eviction is by the concrete user keys it maps to.
    void roleId;
    if (affected.length === 0) return;
    const keys = affected.map(({ userId, orgId }) => actorCacheKey(orgId, userId));
    await this.redis.del(...keys);
  }

  /** E1 — drop a single actor's cached entitlement (role/status/attribute change). */
  async invalidateUser(userId: string, orgId: string): Promise<void> {
    await this.redis.del(actorCacheKey(orgId, userId));
  }

  /** Evict a cached team member list (membership change). */
  async invalidateTeam(teamId: string): Promise<void> {
    await this.redis.del(teamMembersCacheKey(teamId));
  }

  /** Evict a cached region branch list (branch ↔ region change). */
  async invalidateRegion(regionId: string): Promise<void> {
    await this.redis.del(regionBranchesCacheKey(regionId));
  }

  private hydrateActor(wire: CachedActor): ActorEntitlement {
    return {
      userId: wire.userId,
      orgId: wire.orgId,
      status: wire.status,
      roleId: wire.roleId,
      roleCode: wire.roleCode,
      defaultScope: wire.defaultScope,
      branchId: wire.branchId,
      teamId: wire.teamId,
      regionId: wire.regionId,
      partnerId: wire.partnerId,
      permissions: new Map(wire.permissions),
    };
  }

  private async readJson<T>(key: string): Promise<T | undefined> {
    const raw = await this.redis.get(key);
    if (raw == null) return undefined;
    return JSON.parse(raw) as T;
  }

  private async writeJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }
}
