import { SetMetadata, type CustomDecorator } from '@nestjs/common';

import type { AbacResource, Capability } from '@lms/shared';

import type { RequestWithUser } from './auth-user';

/** Reflector metadata key carrying the {@link RequiresMetadata} for a handler. */
export const REQUIRES_KEY = 'abac:requires';

/**
 * Resolves the {@link AbacResource} for a request from its path params and/or a
 * pre-loaded entity (e.g. `req.lead`). Pure and synchronous — any DB load needed
 * to know the resource's owner/branch belongs in a prior step, not here.
 */
export type ScopeResolver = (req: RequestWithUser) => AbacResource;

export interface RequiresMetadata {
  readonly capability: Capability;
  readonly scopeResolver?: ScopeResolver;
}

/**
 * Declares that a controller handler is governed by ABAC (FR-002): the caller
 * must hold `capability` and pass the scope check for the resource the optional
 * `scopeResolver` derives from the request. {@link AbacGuard} (registered after
 * the global {@link JwtAuthGuard}) enforces this; handlers WITHOUT `@Requires`
 * are authenticated but not ABAC-scoped, so every protected data endpoint must
 * carry it. When no resolver is given, the resource defaults to `{ resourceType:
 * 'leads' }` and only capability + scope-availability are checked (suitable for
 * list/create endpoints whose row-level filtering is applied via the predicate).
 */
export function Requires(capability: Capability, scopeResolver?: ScopeResolver): CustomDecorator<string> {
  return SetMetadata<string, RequiresMetadata>(REQUIRES_KEY, { capability, scopeResolver });
}
