import { Injectable } from '@nestjs/common';

import {
  Capability,
  DataScope,
  RoleCode,
  UserStatus,
  type AbacResource,
  type EntitlementResult,
  type ScopePredicate,
} from '@lms/shared';

import { LEAD_CONTENT_CAPABILITIES, narrowerScope } from './abac.constants';
import { EntitlementCacheService } from './entitlement-cache.service';
import type { ActiveBreakGlassGrant, ActorEntitlement } from './abac.types';

/** The minimal identity the evaluator needs: who is asking, in which org. */
export interface EntitlementActor {
  readonly userId: string;
  readonly orgId: string;
}

/**
 * FR-002 — the single ABAC decision point. `can()` is the only place the
 * auth-matrix (role → capability → max_scope) is intersected with the actor's
 * attribute scope (branch/team/region/partner), the `capability_conditions`
 * (ADMIN/DPO break-glass, PARTNER same-partner), and the resource. It is a pure
 * read: it never mutates and never throws on a deny — it returns a typed result
 * (deny-by-default) that {@link AbacGuard} maps to 403/404 + an audit event.
 *
 * The actor's full entitlement record is loaded (and cached) by
 * {@link EntitlementCacheService}; the JWT carries only id/org/role, so scope
 * attributes are resolved here from the DB rather than trusted from the token.
 */
@Injectable()
export class EntitlementService {
  constructor(private readonly cache: EntitlementCacheService) {}

  async can(
    actor: EntitlementActor,
    capability: Capability,
    resource: AbacResource,
  ): Promise<EntitlementResult> {
    // Read 1 — load the actor's attributes + role capability map.
    const entitlement = await this.cache.loadActorEntitlement(actor.userId, actor.orgId);

    // (1) Unknown/inactive user → suspended. (loadActorEntitlement only returns
    // active users; a missing record is treated identically — no standing access.)
    if (!entitlement || entitlement.status !== UserStatus.ACTIVE) {
      return deny('SUSPENDED_USER');
    }

    const isLeadContent = LEAD_CONTENT_CAPABILITIES.has(capability);

    // (4a) ADMIN never has standing lead-record access (auth-matrix `ADMIN.*`):
    // a lead-content capability is authorised only by an active break-glass grant,
    // whose scope_type sets the effective scope. Checked before — and overriding —
    // the capability lookup, so ADMIN cannot gain standing lead access even if a
    // stray role_permission row existed. ADMIN's legitimate org-wide admin/compliance
    // capabilities (export/consent_ledger/audit_trail/customer_comm/configuration/
    // user_mgmt/break_glass) are not lead-content and fall through to step 2.
    if (entitlement.roleCode === RoleCode.ADMIN && isLeadContent) {
      const grant = await this.cache.loadActiveBreakGlass(actor.userId, actor.orgId);
      if (!grant) {
        return deny('ADMIN_LEAD_BLOCKED');
      }
      return this.evaluateBreakGlass(entitlement, grant, resource);
    }

    // (2) Capability lookup — deny-by-default if the role lacks the capability.
    const permission = entitlement.permissions.get(capability);
    if (!permission) {
      return deny('NO_CAPABILITY');
    }

    // (4b) DPO lead-content beyond the masked view requires break-glass. The
    // masked compliance view (max_scope M) is allowed without one and tagged for
    // masking by the interceptor; any other DPO scope needs an active grant.
    if (entitlement.roleCode === RoleCode.DPO && isLeadContent && permission.maxScope === DataScope.M) {
      return grant_(DataScope.M, { type: 'masked', orgId: entitlement.orgId });
    }

    // (3) Effective scope = min(role max_scope, attribute-supplied scope).
    const effectiveScope = narrowerScope(permission.maxScope, this.attributeScope(entitlement, permission.maxScope));

    // (4c) PARTNER: only ever the partner's own submissions (cross-partner hidden).
    if (entitlement.roleCode === RoleCode.PARTNER) {
      if (!entitlement.partnerId) {
        return deny('OUT_OF_SCOPE');
      }
      if (resource.partnerId != null && resource.partnerId !== entitlement.partnerId) {
        return deny('PARTNER_CROSS_ACCESS');
      }
      return grant_(DataScope.P, { type: 'partner', partnerId: entitlement.partnerId });
    }

    // (5) + (6) Resource ownership check for the effective scope, then grant with
    // the matching scope predicate.
    return this.evaluateScope(entitlement, effectiveScope, resource);
  }

  /**
   * The narrowest scope the actor's attributes can actually supply, capped at the
   * role ceiling. A user with a branch can supply up to B; a team grants up to T;
   * a partner is P only. Used as the second operand of the effective-scope `min`.
   */
  private attributeScope(entitlement: ActorEntitlement, ceiling: DataScope): DataScope {
    switch (entitlement.roleCode) {
      case RoleCode.DPO:
        return DataScope.M;
      case RoleCode.PARTNER:
        return DataScope.P;
      case RoleCode.CUSTOMER:
        return DataScope.C;
      case RoleCode.HEAD:
      case RoleCode.ADMIN:
        // Org-wide roles supply up to A; the role ceiling still applies via `min`.
        return ceiling;
      default:
        // RM/BM/SM/KYC: attributes cap what they can reach. The role ceiling
        // (O/T/B) already encodes the intended scope, so honour it directly while
        // ensuring the supplying attribute exists.
        return ceiling;
    }
  }

  /** Steps 5–6 for the org's internal scoped roles. */
  private async evaluateScope(
    entitlement: ActorEntitlement,
    scope: DataScope,
    resource: AbacResource,
  ): Promise<EntitlementResult> {
    switch (scope) {
      case DataScope.O: {
        if (resource.ownerId != null && resource.ownerId !== entitlement.userId) {
          return deny('OUT_OF_SCOPE');
        }
        return grant_(DataScope.O, { type: 'own', userId: entitlement.userId });
      }
      case DataScope.T: {
        if (!entitlement.teamId) {
          return deny('OUT_OF_SCOPE');
        }
        const memberIds = await this.cache.loadTeamMemberIds(entitlement.teamId, entitlement.orgId);
        if (resource.ownerId != null && !memberIds.includes(resource.ownerId)) {
          return deny('OUT_OF_SCOPE');
        }
        return grant_(DataScope.T, { type: 'team', userIds: memberIds });
      }
      case DataScope.B: {
        if (!entitlement.branchId) {
          return deny('OUT_OF_SCOPE');
        }
        if (resource.branchId != null && resource.branchId !== entitlement.branchId) {
          return deny('OUT_OF_SCOPE');
        }
        return grant_(DataScope.B, { type: 'branch', branchId: entitlement.branchId });
      }
      case DataScope.R: {
        if (!entitlement.regionId) {
          return deny('OUT_OF_SCOPE');
        }
        const branchIds = await this.cache.loadRegionBranchIds(entitlement.regionId, entitlement.orgId);
        if (resource.branchId != null && !branchIds.includes(resource.branchId)) {
          return deny('OUT_OF_SCOPE');
        }
        return grant_(DataScope.R, { type: 'region', branchIds });
      }
      case DataScope.A:
        return grant_(DataScope.A, { type: 'all', orgId: entitlement.orgId });
      case DataScope.M:
        return grant_(DataScope.M, { type: 'masked', orgId: entitlement.orgId });
      case DataScope.P: {
        if (!entitlement.partnerId) {
          return deny('OUT_OF_SCOPE');
        }
        return grant_(DataScope.P, { type: 'partner', partnerId: entitlement.partnerId });
      }
      default:
        // Scope X (no access) and any unmapped scope → deny.
        return deny('OUT_OF_SCOPE');
    }
  }

  /**
   * Authorise an ADMIN/DPO lead-content action via an active break-glass grant.
   * The grant's `scope_type` maps to the effective data scope: `all` → A,
   * `branch` → that branch, `lead` → that single lead. A branch/lead-scoped grant
   * that does not match the requested resource is out of scope.
   */
  private evaluateBreakGlass(
    entitlement: ActorEntitlement,
    grant: ActiveBreakGlassGrant,
    resource: AbacResource,
  ): EntitlementResult {
    switch (grant.scopeType) {
      case 'all':
        return grant_(DataScope.A, { type: 'all', orgId: entitlement.orgId });
      case 'branch': {
        if (!grant.scopeRef) {
          return deny('OUT_OF_SCOPE');
        }
        if (resource.branchId != null && resource.branchId !== grant.scopeRef) {
          return deny('OUT_OF_SCOPE');
        }
        return grant_(DataScope.B, { type: 'branch', branchId: grant.scopeRef });
      }
      case 'lead': {
        // A lead-scoped grant authorises exactly one lead — never the whole org.
        // The single-lead predicate (`leads.lead_id = scopeRef`) is the same shape
        // the customer-token scope uses; the resource must be that lead.
        if (!grant.scopeRef) {
          return deny('OUT_OF_SCOPE');
        }
        return grant_(DataScope.A, { type: 'customer_token', leadId: grant.scopeRef });
      }
      default:
        return deny('OUT_OF_SCOPE');
    }
  }
}

/** Construct a deny result (deny-by-default helper). */
function deny(reason: Exclude<EntitlementResult, { granted: true }>['reason']): EntitlementResult {
  return { granted: false, reason };
}

/** Construct a grant result with its resolved scope predicate. */
function grant_(scope: DataScope, scopePredicate: ScopePredicate): EntitlementResult {
  return { granted: true, scope, scopePredicate };
}
