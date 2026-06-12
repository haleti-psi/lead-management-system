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
import { MergeLeadController } from './merge-lead.controller';
import type { MergeLeadService } from './merge-lead.service';

/**
 * FR-021 — controller-level guarantees for `POST /leads/{id}/merge` and
 * `POST /leads/{id}/unmerge` (T-008's 401 and the live 429 of T-027 are
 * guard-tier behaviours enforced by the global JwtAuthGuard / ThrottlerGuard;
 * the deferred supertest tier exercises them end-to-end — here we assert the
 * METADATA those guards read):
 *  - both handlers require `edit_lead` with an EXPLICIT leads scope resolver
 *    (the Wave-1 FR-104 catch: never the implicit default);
 *  - neither is @Public();
 *  - the mutation throttle override (60/min tier) is declared on the class;
 *  - the resolved AbacGuard predicate is forwarded to the service.
 */
describe('MergeLeadController metadata', () => {
  const reflector = new Reflector();

  it.each([
    ['merge', MergeLeadController.prototype.merge],
    ['unmerge', MergeLeadController.prototype.unmerge],
  ] as const)('POST /leads/{id}/%s requires EDIT_LEAD with an explicit leads resolver', (_name, handler) => {
    const meta = reflector.getAllAndOverride<RequiresMetadata | undefined>(REQUIRES_KEY, [
      handler as Parameters<typeof reflector.getAllAndOverride>[1][number],
      MergeLeadController,
    ]);
    expect(meta?.capability).toBe(Capability.EDIT_LEAD);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'leads' });
  });

  it('T-008 analogue: neither handler opts out of the global JwtAuthGuard', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, MergeLeadController)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, MergeLeadController.prototype.merge)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, MergeLeadController.prototype.unmerge)).toBeUndefined();
  });

  it('T-027 analogue: the mutation throttle tier override is declared on the controller', () => {
    const keys = Reflect.getMetadataKeys(MergeLeadController) as unknown[];
    const throttleKey = keys.find((k) => typeof k === 'string' && k.toLowerCase().includes('throttle'));
    expect(throttleKey).toBeDefined();
  });
});

describe('MergeLeadController behaviour', () => {
  const user: AuthUser = {
    userId: 'bm-1',
    orgId: '00000000-0000-0000-0000-000000000001',
    role: 'BM',
    scope: 'B',
    jti: 'jti-1',
  };
  const predicate = { type: 'branch' as const, branchId: 'branch-1' };
  const req = { [SCOPE_PREDICATE_KEY]: predicate };

  it('merge delegates to MergeLeadService.merge with the caller and the resolved predicate', async () => {
    const response = { master_lead_id: 'm-1', duplicate_lead_id: 'd-1' };
    const service = { merge: jest.fn().mockResolvedValue(response), unmerge: jest.fn() };
    const controller = new MergeLeadController(service as unknown as MergeLeadService);
    const dto = {
      master_lead_id: 'a0000000-0000-0000-0000-00000000000a',
      reason: 'dup',
      field_precedence: 'master' as const,
      expected_version: 1,
    };

    await expect(controller.merge('d-1', dto, user, req as never)).resolves.toBe(response);
    expect(service.merge).toHaveBeenCalledWith('d-1', dto, user, { predicate });
  });

  it('unmerge delegates to MergeLeadService.unmerge with the caller and the resolved predicate', async () => {
    const response = { unmerged_lead_id: 'd-1', master_lead_id: 'm-1' };
    const service = { merge: jest.fn(), unmerge: jest.fn().mockResolvedValue(response) };
    const controller = new MergeLeadController(service as unknown as MergeLeadService);
    const dto = { reason: 'undo', expected_master_version: 2 };

    await expect(controller.unmerge('d-1', dto, user, req as never)).resolves.toBe(response);
    expect(service.unmerge).toHaveBeenCalledWith('d-1', dto, user, { predicate });
  });
});
