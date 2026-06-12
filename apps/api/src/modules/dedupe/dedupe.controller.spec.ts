import 'reflect-metadata';

import { Reflector } from '@nestjs/core';

import { Capability } from '@lms/shared';

import {
  IS_PUBLIC_KEY,
  REQUIRES_KEY,
  SCOPE_PREDICATE_KEY,
  type RequiresMetadata,
} from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import { DedupeController } from './dedupe.controller';
import type { DuplicateService } from './dedupe.service';

/**
 * FR-020 — controller-level guarantees for `POST /leads/{id}/duplicate-check`
 * (T18's 401 and the scope 403s are guard-tier behaviours enforced by the
 * global JwtAuthGuard + AbacGuard; here we assert the METADATA those guards
 * read — the deferred supertest tier exercises them end-to-end):
 *  - the handler requires `edit_lead` with an EXPLICIT leads scope resolver
 *    (the Wave-1 FR-104 catch: never the implicit default);
 *  - it is not @Public();
 *  - it forwards the AbacGuard's resolved predicate to the service for the
 *    row-level scope check.
 */
describe('DedupeController metadata', () => {
  const reflector = new Reflector();

  it('POST /leads/{id}/duplicate-check requires EDIT_LEAD with an explicit leads resolver', () => {
    const meta = reflector.getAllAndOverride<RequiresMetadata | undefined>(REQUIRES_KEY, [
      DedupeController.prototype.check as Parameters<typeof reflector.getAllAndOverride>[1][number],
      DedupeController,
    ]);
    expect(meta?.capability).toBe(Capability.EDIT_LEAD);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'leads' });
  });

  it('T18 analogue: the handler does not opt out of the global JwtAuthGuard', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, DedupeController)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, DedupeController.prototype.check)).toBeUndefined();
  });
});

describe('DedupeController behaviour', () => {
  it('delegates to DuplicateService.check with the caller and the resolved scope predicate', async () => {
    const user: AuthUser = {
      userId: 'rm-1',
      orgId: '00000000-0000-0000-0000-000000000001',
      role: 'RM',
      scope: 'O',
      jti: 'jti-1',
    };
    const response = { lead_id: 'lead-1', duplicate_status: 'none', action_taken: null, matches: [] };
    const service = { check: jest.fn().mockResolvedValue(response) };
    const controller = new DedupeController(service as unknown as DuplicateService);
    const predicate = { type: 'own' as const, userId: 'rm-1' };
    const req = { [SCOPE_PREDICATE_KEY]: predicate };

    const dto = { requested_action: 'warn' as const };
    await expect(controller.check('lead-1', dto, user, req as never)).resolves.toBe(response);
    expect(service.check).toHaveBeenCalledWith('lead-1', dto, user, { predicate });
  });
});
