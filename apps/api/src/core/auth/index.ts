export { AuthCoreModule } from './auth-core.module';
export { JwtAuthGuard } from './jwt-auth.guard';
export { AppThrottlerGuard } from './app-throttler.guard';
export { RedisThrottlerStorage } from './redis-throttler.storage';
export { Public, IS_PUBLIC_KEY } from './public.decorator';
export { CurrentUser } from './current-user.decorator';
export { TokenService } from './token.service';
export type { AccessTokenClaims, PurposeTokenClaims } from './token.service';
export { AUTH_USER_KEY } from './auth-user';
export type { AuthUser, RequestWithUser } from './auth-user';

// FR-002 — ABAC decision point, guard, decorator, cache (E1 invalidation hook).
export { EntitlementService } from './entitlement.service';
export type { EntitlementActor } from './entitlement.service';
export { EntitlementCacheService } from './entitlement-cache.service';
export { AbacGuard } from './abac.guard';
export { Requires, REQUIRES_KEY } from './requires.decorator';
export type { RequiresMetadata, ScopeResolver } from './requires.decorator';
export {
  SCOPE_PREDICATE_KEY,
  EFFECTIVE_SCOPE_KEY,
  MASKING_LEVEL_KEY,
} from './abac-context';
export type { AbacRequestContext, MaskingLevel } from './abac-context';
export type {
  ActorEntitlement,
  RolePermissionEntry,
  ActiveBreakGlassGrant,
} from './abac.types';
export {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  TokenType,
  MFA_CHALLENGE_TTL_SECONDS,
  PW_RESET_TTL_SECONDS,
} from './auth.constants';
