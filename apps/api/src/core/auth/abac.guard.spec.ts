import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Logger } from 'nestjs-pino';

import { Capability, DataScope, type EntitlementResult } from '@lms/shared';

import type { AuditAppender, AuditEntry } from '../audit';
import { DomainException } from '../http/domain-exception';
import { AbacGuard } from './abac.guard';
import { SCOPE_PREDICATE_KEY, EFFECTIVE_SCOPE_KEY, MASKING_LEVEL_KEY } from './abac-context';
import { AUTH_USER_KEY, type AuthUser } from './auth-user';
import type { EntitlementService } from './entitlement.service';
import { REQUIRES_KEY, type RequiresMetadata } from './requires.decorator';

const USER: AuthUser = {
  userId: 'u1',
  orgId: 'org1',
  role: 'RM' as AuthUser['role'],
  scope: 'O' as AuthUser['scope'],
  jti: 'jti1',
};

interface Built {
  guard: AbacGuard;
  ctx: ExecutionContext;
  req: Record<string, unknown>;
  audited: AuditEntry[];
  canSpy: jest.Mock;
}

function build(opts: {
  meta: RequiresMetadata | undefined;
  result?: EntitlementResult;
  user?: AuthUser | undefined;
}): Built {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(opts.meta);

  const req: Record<string, unknown> = { headers: {} };
  if (opts.user !== undefined) req[AUTH_USER_KEY] = opts.user;

  const ctx = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: <T>(): T => req as T }),
  } as unknown as ExecutionContext;

  const canSpy = jest.fn(async () => opts.result);
  const entitlement = { can: canSpy } as unknown as EntitlementService;

  const audited: AuditEntry[] = [];
  const audit = {
    append: jest.fn(async (entry: AuditEntry) => {
      audited.push(entry);
    }),
  } as unknown as AuditAppender;

  const logger = { error: jest.fn() } as unknown as Logger;

  const guard = new AbacGuard(reflector, entitlement, audit, logger);
  return { guard, ctx, req, audited, canSpy };
}

const GRANT_O: EntitlementResult = {
  granted: true,
  scope: DataScope.O,
  scopePredicate: { type: 'own', userId: 'u1' },
};

describe('AbacGuard', () => {
  it('passes through (no enforcement) when the handler has no @Requires metadata', async () => {
    const { guard, ctx, canSpy } = build({ meta: undefined });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(canSpy).not.toHaveBeenCalled();
  });

  // A-14
  it('throws VALIDATION_ERROR (400) for an unknown capability and never calls EntitlementService', async () => {
    const { guard, ctx, canSpy } = build({
      meta: { capability: 'fly_to_moon' as Capability },
      user: USER,
    });
    const err = await guard.canActivate(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainException);
    expect((err as DomainException).code).toBe('VALIDATION_ERROR');
    expect((err as DomainException).httpStatus).toBe(400);
    expect(canSpy).not.toHaveBeenCalled();
  });

  // B-01
  it('throws ForbiddenException (403) when EntitlementService returns granted=false (OUT_OF_SCOPE)', async () => {
    const { guard, ctx, audited } = build({
      meta: { capability: Capability.VIEW_LEAD },
      user: USER,
      result: { granted: false, reason: 'OUT_OF_SCOPE' },
    });
    const err = await guard.canActivate(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainException);
    expect((err as DomainException).httpStatus).toBe(403);
    expect((err as DomainException).code).toBe('FORBIDDEN');
    expect((err as DomainException).detail).toEqual({ reason: 'OUT_OF_SCOPE' });
    expect(audited).toHaveLength(1);
  });

  // B-02
  it('throws NotFoundException (404) when denial reason is PARTNER_CROSS_ACCESS', async () => {
    const { guard, ctx } = build({
      meta: { capability: Capability.VIEW_LEAD },
      user: USER,
      result: { granted: false, reason: 'PARTNER_CROSS_ACCESS' },
    });
    const err = await guard.canActivate(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainException);
    expect((err as DomainException).httpStatus).toBe(404);
    expect((err as DomainException).code).toBe('NOT_FOUND');
  });

  // B-03
  it('attaches scopePredicate (and effective scope + masking level) to the request on grant', async () => {
    const { guard, ctx, req } = build({
      meta: { capability: Capability.VIEW_LEAD },
      user: USER,
      result: GRANT_O,
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req[SCOPE_PREDICATE_KEY]).toEqual({ type: 'own', userId: 'u1' });
    expect(req[EFFECTIVE_SCOPE_KEY]).toBe(DataScope.O);
    expect(req[MASKING_LEVEL_KEY]).toBe('partial');
  });

  // B-04
  it('does not attach scopePredicate when denied', async () => {
    const { guard, ctx, req } = build({
      meta: { capability: Capability.VIEW_LEAD },
      user: USER,
      result: { granted: false, reason: 'OUT_OF_SCOPE' },
    });
    await guard.canActivate(ctx).catch(() => undefined);
    expect(req[SCOPE_PREDICATE_KEY]).toBeUndefined();
  });

  // B-05
  it('calls AuditAppender.append with an abac_deny record on every deny path', async () => {
    const { guard, ctx, audited } = build({
      meta: { capability: Capability.EDIT_LEAD },
      user: USER,
      result: { granted: false, reason: 'NO_CAPABILITY' },
    });
    await guard.canActivate(ctx).catch(() => undefined);
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      action: 'abac_deny',
      actor_id: 'u1',
      org_id: 'org1',
      entity_type: 'leads',
      detail: { denied: true, reason: 'NO_CAPABILITY', capability: Capability.EDIT_LEAD },
    });
  });

  it('sets masking level strict for the DPO masked scope (M)', async () => {
    const { guard, ctx, req } = build({
      meta: { capability: Capability.VIEW_LEAD },
      user: USER,
      result: { granted: true, scope: DataScope.M, scopePredicate: { type: 'masked', orgId: 'org1' } },
    });
    await guard.canActivate(ctx);
    expect(req[MASKING_LEVEL_KEY]).toBe('strict');
  });

  it('sets masking level strict for any export capability', async () => {
    const { guard, ctx, req } = build({
      meta: { capability: Capability.EXPORT },
      user: USER,
      result: { granted: true, scope: DataScope.O, scopePredicate: { type: 'own', userId: 'u1' } },
    });
    await guard.canActivate(ctx);
    expect(req[MASKING_LEVEL_KEY]).toBe('strict');
  });

  it('invokes the scopeResolver to build the resource passed to EntitlementService', async () => {
    const meta: RequiresMetadata = {
      capability: Capability.VIEW_LEAD,
      scopeResolver: (r) => ({ resourceType: 'leads', ownerId: (r as { ownerId?: string }).ownerId }),
    };
    const { guard, ctx, req, canSpy } = build({ meta, user: USER, result: GRANT_O });
    (req as { ownerId?: string }).ownerId = 'owner-9';
    await guard.canActivate(ctx);
    expect(canSpy).toHaveBeenCalledWith(
      { userId: 'u1', orgId: 'org1' },
      Capability.VIEW_LEAD,
      { resourceType: 'leads', ownerId: 'owner-9' },
    );
  });

  it('still throws the deny error (not 500) when the audit append fails', async () => {
    const { guard, ctx } = build({
      meta: { capability: Capability.VIEW_LEAD },
      user: USER,
      result: { granted: false, reason: 'OUT_OF_SCOPE' },
    });
    // Force the audit to reject; the guard must log and still throw FORBIDDEN.
    const failingAudit = { append: jest.fn(async () => { throw new Error('db down'); }) };
    // Rebuild the guard with the failing audit but same context.
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ capability: Capability.VIEW_LEAD });
    const logger = { error: jest.fn() } as unknown as Logger;
    const entitlement = { can: jest.fn(async () => ({ granted: false, reason: 'OUT_OF_SCOPE' })) } as unknown as EntitlementService;
    const guard2 = new AbacGuard(reflector, entitlement, failingAudit as unknown as AuditAppender, logger);
    void guard; void ctx;

    const req: Record<string, unknown> = { headers: {}, [AUTH_USER_KEY]: USER };
    const ctx2 = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: <T>(): T => req as T }),
    } as unknown as ExecutionContext;

    const err = await guard2.canActivate(ctx2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainException);
    expect((err as DomainException).code).toBe('FORBIDDEN');
    expect(logger.error).toHaveBeenCalled();
  });

  it('reads @Requires metadata via REQUIRES_KEY', async () => {
    const { guard, ctx } = build({ meta: { capability: Capability.VIEW_LEAD }, user: USER, result: GRANT_O });
    const reflector = (guard as unknown as { reflector: Reflector }).reflector;
    const spy = reflector.getAllAndOverride as unknown as jest.Mock;
    await guard.canActivate(ctx);
    expect(spy).toHaveBeenCalledWith(REQUIRES_KEY, expect.any(Array));
  });
});
