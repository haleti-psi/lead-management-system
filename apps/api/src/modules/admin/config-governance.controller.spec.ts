import { Reflector } from '@nestjs/core';

import { Capability } from '@lms/shared';

import { REQUIRES_KEY, type RequiresMetadata } from '../../core/auth';
import { CONFIGURATION_RESOURCE_TYPE } from './admin.constants';
import { ConfigGovernanceController } from './config-governance.controller';

/**
 * FR-132 — asserts the `@Requires` metadata the {@link AbacGuard} reads for each
 * governance handler. `configuration_versions` is org-scoped config (auth-matrix
 * `scoped:false`), so each handler pins the ABAC resource to
 * `resourceType: 'configuration_versions'` (NOT the `'leads'` default).
 */
describe('ConfigGovernanceController @Requires metadata', () => {
  const reflector = new Reflector();
  const metaFor = (handler: unknown): RequiresMetadata | undefined =>
    reflector.getAllAndOverride<RequiresMetadata | undefined>(REQUIRES_KEY, [
      handler as Parameters<typeof reflector.getAllAndOverride>[1][number],
      ConfigGovernanceController,
    ]);

  it('listPending requires CONFIGURATION scoped to resourceType configuration_versions', () => {
    const meta = metaFor(ConfigGovernanceController.prototype.listPending);
    expect(meta?.capability).toBe(Capability.CONFIGURATION);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: CONFIGURATION_RESOURCE_TYPE });
  });

  it('approve requires CONFIGURATION scoped to resourceType configuration_versions', () => {
    const meta = metaFor(ConfigGovernanceController.prototype.approve);
    expect(meta?.capability).toBe(Capability.CONFIGURATION);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: CONFIGURATION_RESOURCE_TYPE });
  });

  it('rollback requires CONFIGURATION scoped to resourceType configuration_versions', () => {
    const meta = metaFor(ConfigGovernanceController.prototype.rollback);
    expect(meta?.capability).toBe(Capability.CONFIGURATION);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: CONFIGURATION_RESOURCE_TYPE });
  });
});
