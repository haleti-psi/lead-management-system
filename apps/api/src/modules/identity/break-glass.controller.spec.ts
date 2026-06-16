import { Reflector } from '@nestjs/core';

import { Capability } from '@lms/shared';

import { REQUIRES_KEY, type RequiresMetadata } from '../../core/auth';
import { BreakGlassController } from './break-glass.controller';

/**
 * FR-003 — asserts the `@Requires` metadata the {@link AbacGuard} reads for each
 * break-glass handler. `break_glass_grants` is org-wide (auth-matrix
 * `scoped:false`), so each handler pins the ABAC resource to
 * `resourceType: 'break_glass_grants'` and the `break_glass` capability (only
 * ADMIN/DPO hold it).
 */
describe('BreakGlassController @Requires metadata', () => {
  const reflector = new Reflector();
  const metaFor = (handler: unknown): RequiresMetadata | undefined =>
    reflector.getAllAndOverride<RequiresMetadata | undefined>(REQUIRES_KEY, [
      handler as Parameters<typeof reflector.getAllAndOverride>[1][number],
      BreakGlassController,
    ]);

  it('list requires BREAK_GLASS scoped to resourceType break_glass_grants', () => {
    const meta = metaFor(BreakGlassController.prototype.list);
    expect(meta?.capability).toBe(Capability.BREAK_GLASS);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'break_glass_grants' });
  });

  it('request requires BREAK_GLASS scoped to resourceType break_glass_grants', () => {
    const meta = metaFor(BreakGlassController.prototype.request);
    expect(meta?.capability).toBe(Capability.BREAK_GLASS);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'break_glass_grants' });
  });
});
