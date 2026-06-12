// FR-001 LLD names this module as the auth hook entry point. The implementation
// (context + provider) lives in lib/auth; this re-exports the consumer surface.
export { useAuth, AuthProvider } from '../lib/auth/auth-context';
export type { AuthContextValue, LoginResult } from '../lib/auth/auth-context';
export type { AuthUser } from '../lib/auth/jwt';
