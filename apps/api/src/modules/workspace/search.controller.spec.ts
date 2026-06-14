import 'reflect-metadata';

import { Reflector } from '@nestjs/core';

import { Capability } from '@lms/shared';

import { IS_PUBLIC_KEY, REQUIRES_KEY, type RequiresMetadata } from '../../core/auth';
import { SearchController } from './search.controller';

/**
 * FR-054 — controller metadata tests: the search endpoint carries `@Requires`
 * with `view_lead` + an explicit resource resolver pinning `leads`, and is NOT
 * decorated with `@Public()` (which would bypass the global JwtAuthGuard).
 */
describe('SearchController ABAC metadata', () => {
  const reflector = new Reflector();
  const metaFor = (handler: unknown, controller: unknown): RequiresMetadata | undefined =>
    reflector.getAllAndOverride<RequiresMetadata | undefined>(REQUIRES_KEY, [
      handler as Parameters<typeof reflector.getAllAndOverride>[1][number],
      controller as Parameters<typeof reflector.getAllAndOverride>[1][number],
    ]);

  it('GET /search requires VIEW_LEAD capability', () => {
    const meta = metaFor(SearchController.prototype.search, SearchController);
    expect(meta?.capability).toBe(Capability.VIEW_LEAD);
  });

  it('GET /search has an explicit leads resource scope resolver', () => {
    const meta = metaFor(SearchController.prototype.search, SearchController);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'leads' });
  });

  it('GET /search is NOT decorated with @Public() — must go through JwtAuthGuard', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SearchController.prototype.search)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SearchController)).toBeUndefined();
  });
});
