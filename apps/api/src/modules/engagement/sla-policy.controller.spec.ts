import { Reflector } from '@nestjs/core';

import { Capability } from '@lms/shared';

import { REQUIRES_KEY, type RequiresMetadata } from '../../core/auth';
import { SlaPolicyController } from './sla-policy.controller';

/**
 * FR-104 (contract gap fix) — asserts the `@Requires` metadata the {@link AbacGuard}
 * will read for each admin SLA-policy handler. `sla_policies` is org-scoped config
 * (auth-matrix `"scoped": false`), so the handler must pin the ABAC resource to
 * `resourceType: 'sla_policies'` (NOT the `'leads'` default) for the decision/audit.
 */
describe('SlaPolicyController @Requires metadata', () => {
  // Mirror the guard's lookup: handler metadata overrides the class default.
  const reflector = new Reflector();
  const metaFor = (handler: unknown): RequiresMetadata | undefined =>
    reflector.getAllAndOverride<RequiresMetadata | undefined>(REQUIRES_KEY, [
      handler as Parameters<typeof reflector.getAllAndOverride>[1][number],
      SlaPolicyController,
    ]);

  it('GET (list) requires CONFIGURATION scoped to resourceType sla_policies', () => {
    const meta = metaFor(SlaPolicyController.prototype.list);
    expect(meta?.capability).toBe(Capability.CONFIGURATION);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'sla_policies' });
  });

  it('POST (create) requires CONFIGURATION scoped to resourceType sla_policies', () => {
    const meta = metaFor(SlaPolicyController.prototype.create);
    expect(meta?.capability).toBe(Capability.CONFIGURATION);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'sla_policies' });
  });
});
