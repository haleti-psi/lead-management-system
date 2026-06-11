import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/** Reflector metadata key marking a route handler (or controller) as public. */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Exempts an endpoint from the global {@link JwtAuthGuard} (architecture §5;
 * security.md). The ONLY legitimate way to make a route public — and only the
 * BRD §8.6 / auth-matrix `public_endpoints` list may use it. Public routes are
 * still rate-limited (the throttler runs independently of authentication).
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
