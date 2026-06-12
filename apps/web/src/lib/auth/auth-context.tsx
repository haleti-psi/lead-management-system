import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { apiClient, setAccessToken, setUnauthorizedHandler } from '../api';
import { decodeAccessToken, type AuthUser } from './jwt';

/**
 * Auth state for the whole app (FR-001 LLD §"Auth state management"). The access
 * token lives in-memory inside the apiClient; this provider owns the derived
 * `user` and the login/logout/refresh lifecycle around it.
 *
 * On mount it calls `refresh()` once: the in-memory access token is lost on a
 * page reload, but the `lms_refresh` httpOnly cookie survives, so a successful
 * refresh restores the session silently. The apiClient's own 401 interceptor
 * fires the unauthorized handler wired here (clears `user`) so route guards can
 * redirect to /login.
 */

/** The /auth/login | /auth/mfa | /auth/refresh 200 body (FR-001 token response). */
interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  mfa_required: false;
}

/** The /auth/login 200 body when MFA is required (FR-001 challenge response). */
interface MfaChallenge {
  mfa_required: true;
  mfa_challenge_token: string;
  mfa_method: string;
}

type LoginResponse = TokenResponse | MfaChallenge;

export type LoginResult =
  | { mfaRequired: false }
  | { mfaRequired: true; challengeToken: string; method: string };

export interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  verifyMfa: (challengeToken: string, otp: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applyTokens = useCallback((data: TokenResponse): void => {
    setAccessToken(data.access_token);
    setUser(decodeAccessToken(data.access_token));
  }, []);

  const clearSession = useCallback((): void => {
    setAccessToken(null);
    setUser(null);
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<LoginResult> => {
      // @Public endpoint: a 401 here is bad credentials, not a refreshable session.
      const data = await apiClient.post<LoginResponse>(
        '/auth/login',
        { username, password },
        { skipAuthRefresh: true },
      );
      if (data.mfa_required) {
        return { mfaRequired: true, challengeToken: data.mfa_challenge_token, method: data.mfa_method };
      }
      applyTokens(data);
      return { mfaRequired: false };
    },
    [applyTokens],
  );

  const verifyMfa = useCallback(
    async (challengeToken: string, otp: string): Promise<void> => {
      const data = await apiClient.post<TokenResponse>(
        '/auth/mfa',
        { mfa_challenge_token: challengeToken, otp },
        { skipAuthRefresh: true },
      );
      applyTokens(data);
    },
    [applyTokens],
  );

  const logout = useCallback((): void => {
    clearSession();
  }, [clearSession]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await apiClient.post<TokenResponse>('/auth/refresh', undefined, {
        skipAuthRefresh: true,
      });
      applyTokens(data);
    } catch {
      clearSession();
    }
  }, [applyTokens, clearSession]);

  useEffect(() => {
    let active = true;
    setUnauthorizedHandler(() => {
      clearSession();
    });
    void refresh().finally(() => {
      if (active) setIsLoading(false);
    });
    return () => {
      active = false;
      setUnauthorizedHandler(null);
    };
  }, [refresh, clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoading, login, verifyMfa, logout, refresh }),
    [user, isLoading, login, verifyMfa, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>');
  return ctx;
}
