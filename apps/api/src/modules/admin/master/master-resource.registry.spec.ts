import { isDomainException } from '../../../core/http';
import { MASTER_SLUGS } from './master.constants';
import { MasterResourceRegistry } from './master-resource.registry';

/**
 * FR-131 unit tests for {@link MasterResourceRegistry} (T05/T30 + route-ownership).
 * The registry is the allow-list gate: it resolves an allow-listed slug to its
 * descriptor and throws VALIDATION_ERROR for anything else. It must NOT contain
 * any resource owned by a concrete controller in another FR.
 */
describe('MasterResourceRegistry', () => {
  const registry = new MasterResourceRegistry();

  it('T30 — resolve(unknown) throws VALIDATION_ERROR with field masterResource', () => {
    expect.assertions(4);
    try {
      registry.resolve('unknown');
    } catch (err) {
      expect(isDomainException(err)).toBe(true);
      if (isDomainException(err)) {
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.httpStatus).toBe(400);
        expect(err.fields?.[0]?.field).toBe('masterResource');
      }
    }
  });

  it('resolves every allow-listed slug to a descriptor whose slug round-trips', () => {
    for (const slug of MASTER_SLUGS) {
      const descriptor = registry.resolve(slug);
      expect(descriptor.slug).toBe(slug);
      expect(typeof descriptor.configType).toBe('string');
      expect(typeof descriptor.entityType).toBe('string');
    }
  });

  it('EXCLUDES every resource owned by another FR (route-ownership split)', () => {
    // FR-130 users/roles/teams; FR-040 products; FR-104 sla-policies;
    // FR-140 webhooks/integrations; FR-003 break-glass;
    // FR-113 M12 dla-registry (claimed out like allocation-rules/FR-030).
    const owned = [
      'users',
      'roles',
      'teams',
      'product-configs',
      'products',
      'sla-policies',
      'webhooks',
      'webhook-subscriptions',
      'integrations',
      'break-glass',
      'dla-registry',
    ];
    for (const slug of owned) {
      expect(registry.has(slug)).toBe(false);
    }
  });

  it('exposes exactly the MASTER_SLUGS allow-list', () => {
    expect(new Set(registry.slugs())).toEqual(new Set(MASTER_SLUGS));
  });
});
