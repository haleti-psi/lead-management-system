import 'reflect-metadata';

import { Reflector } from '@nestjs/core';

import { Capability } from '@lms/shared';

import { IS_PUBLIC_KEY, REQUIRES_KEY, type RequiresMetadata } from '../../../core/auth';
import { ApprovalController } from './approval.controller';

/**
 * FR-055 — controller metadata tests.
 * Verifies: capability = APPROVE_LEAD, leads resource resolver present, no @Public.
 */
describe('ApprovalController ABAC metadata', () => {
  const reflector = new Reflector();
  const metaFor = (handler: unknown, controller: unknown): RequiresMetadata | undefined =>
    reflector.getAllAndOverride<RequiresMetadata | undefined>(REQUIRES_KEY, [
      handler as Parameters<typeof reflector.getAllAndOverride>[1][number],
      controller as Parameters<typeof reflector.getAllAndOverride>[1][number],
    ]);

  it('POST /leads/:id/approval requires APPROVE_LEAD capability', () => {
    const meta = metaFor(
      ApprovalController.prototype.decide,
      ApprovalController,
    );
    expect(meta?.capability).toBe(Capability.APPROVE_LEAD);
  });

  it('POST /leads/:id/approval has an explicit leads resource resolver', () => {
    const meta = metaFor(
      ApprovalController.prototype.decide,
      ApprovalController,
    );
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'leads' });
  });

  it('POST /leads/:id/approval does not opt out of JwtAuthGuard (@Public absent)', () => {
    for (const target of [
      ApprovalController,
      ApprovalController.prototype.decide,
    ]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, target)).toBeUndefined();
    }
  });
});
