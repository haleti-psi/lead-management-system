import type { DataScope, ScopePredicate } from '@lms/shared';

import type { RequestWithUser } from './auth-user';

/** Request keys under which {@link AbacGuard} binds its grant outputs. */
export const SCOPE_PREDICATE_KEY = 'abacScopePredicate' as const;
export const EFFECTIVE_SCOPE_KEY = 'abacEffectiveScope' as const;
export const MASKING_LEVEL_KEY = 'abacMaskingLevel' as const;

/**
 * Masking strength the {@link MaskingInterceptor} should apply to the response
 * (FR-002 §Masking Rules). `unmasked` is only ever set when an active break-glass
 * grant authorises raw PII; `strict` is the DPO/export floor; `partial` is the
 * default for internal roles.
 */
export type MaskingLevel = 'partial' | 'strict' | 'unmasked';

/**
 * A request that has passed {@link AbacGuard} on a grant carries the resolved
 * scope predicate (for the repository), the effective scope, and the masking
 * level (for the interceptor). These are absent on a deny (the guard throws) and
 * on `@Public()` / un-decorated routes.
 */
export interface AbacRequestContext extends RequestWithUser {
  [SCOPE_PREDICATE_KEY]?: ScopePredicate;
  [EFFECTIVE_SCOPE_KEY]?: DataScope;
  [MASKING_LEVEL_KEY]?: MaskingLevel;
}
