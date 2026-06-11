import { Reflector } from '@nestjs/core';

import { Capability } from '@lms/shared';

import { REQUIRES_KEY, type RequiresMetadata } from '../../core/auth';
import { SchemeController } from './scheme.controller';

/**
 * FR-042 — asserts the `@Requires` metadata the {@link AbacGuard} reads for each
 * `/admin/schemes` handler. `schemes` is org-scoped config (auth-matrix
 * `"scoped": false`), so every handler must pin the ABAC resource to
 * `resourceType: 'schemes'` (NOT the `'leads'` default) for the decision/audit,
 * and require the `configuration` capability (TC-042-13/16/17 gating). The scope-A
 * floor for creation is enforced in the service (covered in scheme.service.spec).
 */
describe('SchemeController @Requires metadata', () => {
  // Mirror the guard's lookup: handler metadata overrides the class default.
  const reflector = new Reflector();
  const metaFor = (handler: unknown): RequiresMetadata | undefined =>
    reflector.getAllAndOverride<RequiresMetadata | undefined>(REQUIRES_KEY, [
      handler as Parameters<typeof reflector.getAllAndOverride>[1][number],
      SchemeController,
    ]);

  it('GET (list) requires CONFIGURATION scoped to resourceType schemes', () => {
    const meta = metaFor(SchemeController.prototype.list);
    expect(meta?.capability).toBe(Capability.CONFIGURATION);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'schemes' });
  });

  it('POST (create) requires CONFIGURATION scoped to resourceType schemes', () => {
    const meta = metaFor(SchemeController.prototype.create);
    expect(meta?.capability).toBe(Capability.CONFIGURATION);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'schemes' });
  });
});
