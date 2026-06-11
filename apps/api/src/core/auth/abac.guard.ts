import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import {
  AuditAction,
  Capability,
  DataScope,
  ERROR_CODES,
  type AbacResource,
  type EntitlementDenyReason,
} from '@lms/shared';

import { AuditAppender } from '../audit';
import { DomainException } from '../http/domain-exception';
import { readHeader } from '../http/http-types';
import {
  EFFECTIVE_SCOPE_KEY,
  MASKING_LEVEL_KEY,
  SCOPE_PREDICATE_KEY,
  type AbacRequestContext,
  type MaskingLevel,
} from './abac-context';
import { AUTH_USER_KEY } from './auth-user';
import { EntitlementService } from './entitlement.service';
import { REQUIRES_KEY, type RequiresMetadata } from './requires.decorator';

/** Every valid capability literal — used to reject unknown actions (A-14). */
const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set(Object.values(Capability));

/**
 * FR-002 — the authorisation guard. Runs after the global {@link JwtAuthGuard}
 * and enforces ABAC **only** on handlers decorated with `@Requires`; every other
 * (authenticated) handler passes through untouched. On grant it attaches the
 * resolved scope predicate / effective scope / masking level to the request for
 * the repository and {@link MaskingInterceptor}. On deny it appends an
 * `abac_deny` audit event and throws the taxonomy error — `FORBIDDEN` (403) for
 * an in-scope-unknown denial, `NOT_FOUND` (404) where a cross-partner resource's
 * existence must be hidden (auth-matrix `http_status_rules`). It never reveals
 * which rule failed beyond the allowed `detail.reason` code.
 */
@Injectable()
export class AbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlement: EntitlementService,
    private readonly audit: AuditAppender,
    private readonly logger: Logger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<RequiresMetadata | undefined>(REQUIRES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @Requires → not an ABAC-scoped handler; JwtAuthGuard already authned it.
    if (!meta) {
      return true;
    }

    // Unknown capability literal → reject as a validation error before any
    // entitlement work (deny-by-default; the guard never calls the evaluator).
    if (!KNOWN_CAPABILITIES.has(meta.capability)) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR);
    }

    const req = context.switchToHttp().getRequest<AbacRequestContext>();
    const user = req[AUTH_USER_KEY];
    if (!user) {
      // A @Requires handler must be authenticated; defensive (JwtAuthGuard runs first).
      throw new DomainException(ERROR_CODES.AUTH_REQUIRED);
    }

    const resource: AbacResource = meta.scopeResolver
      ? meta.scopeResolver(req)
      : { resourceType: 'leads' };

    const result = await this.entitlement.can(
      { userId: user.userId, orgId: user.orgId },
      meta.capability,
      resource,
    );

    if (!result.granted) {
      await this.auditDeny(req, user.userId, user.orgId, meta.capability, resource, result.reason);
      throw this.denyException(result.reason);
    }

    req[SCOPE_PREDICATE_KEY] = result.scopePredicate;
    req[EFFECTIVE_SCOPE_KEY] = result.scope;
    req[MASKING_LEVEL_KEY] = this.maskingLevel(result.scope, meta.capability);
    return true;
  }

  /**
   * Strictest masking for the DPO masked view (scope M) and for any export;
   * partial masking otherwise. Raw (unmasked) PII is never auto-served here — it
   * is only revealed through the explicit, separately-audited unmask path
   * (FR-003), so the interceptor floor stays at partial/strict.
   */
  private maskingLevel(scope: DataScope, capability: Capability): MaskingLevel {
    if (scope === DataScope.M || capability === Capability.EXPORT) {
      return 'strict';
    }
    return 'partial';
  }

  /** PARTNER cross-access hides existence (404); every other deny is 403. */
  private denyException(reason: EntitlementDenyReason): DomainException {
    if (reason === 'PARTNER_CROSS_ACCESS') {
      return new DomainException(ERROR_CODES.NOT_FOUND);
    }
    return new DomainException(ERROR_CODES.FORBIDDEN, undefined, { detail: { reason } });
  }

  /**
   * Append an `abac_deny` audit intent (schema.sql `audit_action` value added in
   * v5.3). `detail.denied=true` plus the reason and attempted capability are
   * recorded; no PII is written. The deny itself is the authoritative outcome, so
   * an audit-store failure is logged (not swallowed) and must not be allowed to
   * convert the 403/404 into a 500 — we log the cause and let the caller throw
   * the correct taxonomy error.
   */
  private async auditDeny(
    req: AbacRequestContext,
    actorId: string,
    orgId: string,
    capability: Capability,
    resource: AbacResource,
    reason: EntitlementDenyReason,
  ): Promise<void> {
    try {
      await this.audit.append({
        action: AuditAction.ABAC_DENY,
        entity_type: resource.resourceType,
        entity_id: null,
        actor_id: actorId,
        org_id: orgId,
        detail: { denied: true, reason, capability },
        ipDevice: this.ipDevice(req),
      });
    } catch (cause) {
      this.logger.error(
        { err: cause, reason, capability, entity_type: resource.resourceType },
        'Failed to append abac_deny audit event',
      );
    }
  }

  private ipDevice(req: AbacRequestContext): { ip?: string; user_agent?: string } {
    return {
      ip: readHeader(req, 'x-forwarded-for') ?? undefined,
      user_agent: readHeader(req, 'user-agent') ?? undefined,
    };
  }
}
