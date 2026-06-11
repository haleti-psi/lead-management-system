import { RoleCode, DataScope, UserStatus } from '@lms/shared';
import type { Logger } from 'nestjs-pino';

import type { AppConfigService } from '../../core/config';
import type { AppEnv } from '../../core/config/env.schema';
import type { AuditAppender, AuditEntry } from '../../core/audit';
import type { TokenService } from '../../core/auth';
import type { NotificationChannelPort, NotificationSend } from '../../core/integration/ports/notification-channel.port';
import type { AuthRepository, AuthUserRow } from './auth.repository';
import type { AuthSessionStore } from './auth-session.store';
import type { TotpService } from './totp.service';

/**
 * Test-only fakes for the auth unit tests. These are in-memory, fully-typed
 * doubles (no `any`) of the collaborators the {@link AuthService} depends on, so
 * every FR-001 scenario can be exercised without Postgres/Redis. They are not
 * wired into the Nest container and never ship in `dist` (excluded by tsconfig).
 */

export const TEST_CONFIG: Partial<AppEnv> = {
  LOCKOUT_THRESHOLD: 5,
  LOCKOUT_MINUTES: 15,
  OTP_TTL_SECONDS: 300,
  SESSION_IDLE_MINUTES: 30,
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL: '7d',
  APP_BASE_URL: 'https://lms.test',
  MFA_ISSUER: 'LMS TEST',
  TOKENIZATION_KMS_KEY: 'test-kms-key',
};

export function makeConfig(overrides: Partial<AppEnv> = {}): AppConfigService {
  const values: Partial<AppEnv> = { ...TEST_CONFIG, ...overrides };
  return {
    get: <K extends keyof AppEnv>(key: K): AppEnv[K] => values[key] as AppEnv[K],
    isProduction: false,
  } as AppConfigService;
}

export function makeLogger(): Logger {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  } as unknown as Logger;
}

export function makeUser(overrides: Partial<AuthUserRow> = {}): AuthUserRow {
  return {
    user_id: 'user-1',
    username: 'rm.delhi.001',
    email: 'rm@nbfc.in',
    password_hash: '$argon2id$hash',
    totp_secret_enc: null,
    status: UserStatus.ACTIVE,
    mfa_enabled: false,
    org_id: '00000000-0000-0000-0000-000000000001',
    role_id: 'role-rm',
    role_code: RoleCode.RM,
    default_scope: DataScope.O,
    last_login_at: new Date(),
    branch_id: 'branch-1',
    team_id: null,
    region_id: null,
    partner_id: null,
    ...overrides,
  };
}

/** In-memory AuthRepository fake backed by a username/email/id map. */
export class FakeRepo {
  setLastLoginAt = jest.fn(async () => undefined);
  setStatus = jest.fn(async (userId: string, status: UserStatus) => {
    const u = this.byId.get(userId);
    if (u) u.status = status;
  });

  private byId = new Map<string, AuthUserRow>();

  add(user: AuthUserRow): this {
    this.byId.set(user.user_id, user);
    return this;
  }

  findUserByUsername = jest.fn(async (username: string): Promise<AuthUserRow | undefined> =>
    [...this.byId.values()].find((u) => u.username === username),
  );
  findUserByEmail = jest.fn(async (email: string): Promise<AuthUserRow | undefined> =>
    [...this.byId.values()].find((u) => u.email === email),
  );
  findUserById = jest.fn(async (userId: string): Promise<AuthUserRow | undefined> => this.byId.get(userId));

  asRepo(): AuthRepository {
    return this as unknown as AuthRepository;
  }
}

/** In-memory AuthSessionStore fake (counters + key sets), thresholds from config. */
export class FakeSessions {
  failCounts = new Map<string, number>();
  mfaFailCounts = new Map<string, number>();
  lockouts = new Map<string, number>(); // userId → ttl seconds
  mfaChallenges = new Set<string>();
  refreshTokens = new Map<string, string>(); // token → userId
  pwResets = new Set<string>();

  constructor(private threshold = 5) {}

  incrementFailCount = jest.fn(async (userId: string): Promise<number> => {
    const next = (this.failCounts.get(userId) ?? 0) + 1;
    this.failCounts.set(userId, next);
    return next;
  });
  clearFailCount = jest.fn(async (userId: string) => {
    this.failCounts.delete(userId);
  });
  isAtLockoutThreshold = jest.fn((count: number): boolean => count >= this.threshold);
  setLockout = jest.fn(async (userId: string) => {
    this.lockouts.set(userId, 900);
  });
  getLockoutTtl = jest.fn(async (userId: string): Promise<number> => this.lockouts.get(userId) ?? 0);
  clearLockout = jest.fn(async (userId: string) => {
    this.lockouts.delete(userId);
  });

  setMfaChallenge = jest.fn(async (userId: string) => {
    this.mfaChallenges.add(userId);
  });
  hasMfaChallenge = jest.fn(async (userId: string): Promise<boolean> => this.mfaChallenges.has(userId));
  clearMfaChallenge = jest.fn(async (userId: string) => {
    this.mfaChallenges.delete(userId);
  });
  incrementMfaFailCount = jest.fn(async (userId: string): Promise<number> => {
    const next = (this.mfaFailCounts.get(userId) ?? 0) + 1;
    this.mfaFailCounts.set(userId, next);
    return next;
  });
  clearMfaFailCount = jest.fn(async (userId: string) => {
    this.mfaFailCounts.delete(userId);
  });

  storeRefreshToken = jest.fn(async (token: string, userId: string) => {
    this.refreshTokens.set(token, userId);
  });
  getRefreshUser = jest.fn(async (token: string): Promise<string | null> => this.refreshTokens.get(token) ?? null);
  deleteRefreshToken = jest.fn(async (token: string) => {
    this.refreshTokens.delete(token);
  });
  setPasswordReset = jest.fn(async (userId: string) => {
    this.pwResets.add(userId);
  });

  asStore(): AuthSessionStore {
    return this as unknown as AuthSessionStore;
  }
}

/** TokenService fake: deterministic tokens; purpose tokens are `type:subject`. */
export class FakeTokens {
  signAccessToken = jest.fn(async (u: { userId: string }) => ({
    token: `access-${u.userId}`,
    jti: `jti-${u.userId}`,
    expiresIn: 900,
  }));
  signMfaChallenge = jest.fn(async (userId: string) => `mfa_challenge:${userId}`);
  signPasswordReset = jest.fn(async (userId: string) => `pw_reset:${userId}`);
  verifyPurpose = jest.fn(
    async (token: string, expected: string): Promise<{ sub: string; jti: string; type: string } | null> => {
      const [type, sub] = token.split(':');
      return type === expected && sub ? { sub, jti: 'jti', type } : null;
    },
  );
  verifyAccessToken = jest.fn(async () => null);

  asService(): TokenService {
    return this as unknown as TokenService;
  }
}

/** TotpService fake: a fixed "good" OTP verifies; everything else fails. */
export class FakeTotp {
  static GOOD_OTP = '123456';
  verify = jest.fn((otp: string, secret: string | null): boolean => secret != null && otp === FakeTotp.GOOD_OTP);
  generateSecret = jest.fn(() => 'BASE32SECRET');
  encrypt = jest.fn((s: string) => `enc(${s})`);
  keyUri = jest.fn((_s: string, account: string) => `otpauth://totp/LMS:${account}`);

  asService(): TotpService {
    return this as unknown as TotpService;
  }
}

/** AuditAppender fake recording every appended entry. */
export class FakeAudit {
  entries: AuditEntry[] = [];
  append = jest.fn(async (entry: AuditEntry) => {
    this.entries.push(entry);
  });
  ofAction(action: string): AuditEntry[] {
    return this.entries.filter((e) => e.action === action);
  }
  asAppender(): AuditAppender {
    return this as unknown as AuditAppender;
  }
}

/** NotificationChannelPort fake capturing sends. */
export class FakeNotifier implements NotificationChannelPort {
  sends: NotificationSend[] = [];
  send = jest.fn(async (message: NotificationSend) => {
    this.sends.push(message);
  });
}
