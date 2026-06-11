import * as argon2 from 'argon2';

import { AuditAction, RoleCode, UserStatus } from '@lms/shared';

import { DomainException } from '../../core/http';
import { AuthService } from './auth.service';
import {
  FakeAudit,
  FakeNotifier,
  FakeRepo,
  FakeSessions,
  FakeTokens,
  FakeTotp,
  makeConfig,
  makeLogger,
  makeUser,
} from './auth.test-helpers';
import type { AuthOutcome } from './auth.types';

jest.mock('argon2', () => ({
  verify: jest.fn(),
}));
const argonVerify = argon2.verify as jest.MockedFunction<typeof argon2.verify>;

interface Harness {
  service: AuthService;
  repo: FakeRepo;
  sessions: FakeSessions;
  tokens: FakeTokens;
  totp: FakeTotp;
  audit: FakeAudit;
  notifier: FakeNotifier;
}

function harness(): Harness {
  const repo = new FakeRepo();
  const sessions = new FakeSessions(5);
  const tokens = new FakeTokens();
  const totp = new FakeTotp();
  const audit = new FakeAudit();
  const notifier = new FakeNotifier();
  const service = new AuthService(
    repo.asRepo(),
    sessions.asStore(),
    tokens.asService(),
    totp.asService(),
    audit.asAppender(),
    makeConfig(),
    makeLogger(),
    notifier,
  );
  return { service, repo, sessions, tokens, totp, audit, notifier };
}

const CTX = { ip: '203.0.113.7', userAgent: 'jest' };

function expectDomain(err: unknown): DomainException {
  expect(err).toBeInstanceOf(DomainException);
  return err as DomainException;
}

async function capture(p: Promise<unknown>): Promise<DomainException> {
  try {
    await p;
    throw new Error('expected the call to reject');
  } catch (err) {
    return expectDomain(err);
  }
}

describe('AuthService', () => {
  beforeEach(() => argonVerify.mockReset());

  // T-001
  it('T-001: logs in without MFA, issues an access token + refresh, audits login', async () => {
    const h = harness();
    h.repo.add(makeUser());
    argonVerify.mockResolvedValue(true);

    const outcome = (await h.service.login('rm.delhi.001', 'good', CTX)) as Extract<
      AuthOutcome,
      { kind: 'tokens' }
    >;

    expect(outcome.kind).toBe('tokens');
    expect(outcome.body.access_token).toBe('access-user-1');
    expect(outcome.body.mfa_required).toBe(false);
    expect(outcome.body.token_type).toBe('Bearer');
    expect(outcome.refreshToken).toEqual(expect.any(String));
    expect(h.sessions.refreshTokens.get(outcome.refreshToken)).toBe('user-1');
    expect(h.repo.setLastLoginAt).toHaveBeenCalledTimes(1);
    expect(h.audit.ofAction(AuditAction.LOGIN)).toHaveLength(1);
  });

  // T-002
  it('T-002: ADMIN login issues an MFA challenge and does NOT yet issue tokens or a login audit', async () => {
    const h = harness();
    h.repo.add(makeUser({ user_id: 'admin-1', username: 'admin', role_code: RoleCode.ADMIN, mfa_enabled: true }));
    argonVerify.mockResolvedValue(true);

    const outcome = (await h.service.login('admin', 'good', CTX)) as Extract<
      AuthOutcome,
      { kind: 'challenge' }
    >;

    expect(outcome.kind).toBe('challenge');
    expect(outcome.body.mfa_required).toBe(true);
    expect(outcome.body.mfa_challenge_token).toBe('mfa_challenge:admin-1');
    expect(outcome.body.mfa_method).toBe('totp');
    expect(h.sessions.mfaChallenges.has('admin-1')).toBe(true);
    expect(h.audit.ofAction(AuditAction.LOGIN)).toHaveLength(0);
    expect(h.repo.setLastLoginAt).not.toHaveBeenCalled();
  });

  // T-003
  it('T-003: MFA verify succeeds → tokens issued, challenge consumed, login audited', async () => {
    const h = harness();
    h.repo.add(makeUser({ user_id: 'admin-1', role_code: RoleCode.ADMIN, mfa_enabled: true, totp_secret_enc: 'enc' }));
    h.sessions.mfaChallenges.add('admin-1');

    const outcome = (await h.service.verifyMfa('mfa_challenge:admin-1', FakeTotp.GOOD_OTP, CTX)) as Extract<
      AuthOutcome,
      { kind: 'tokens' }
    >;

    expect(outcome.kind).toBe('tokens');
    expect(outcome.body.access_token).toBe('access-admin-1');
    expect(h.sessions.mfaChallenges.has('admin-1')).toBe(false);
    expect(h.audit.ofAction(AuditAction.LOGIN)).toHaveLength(1);
    expect(h.repo.setLastLoginAt).toHaveBeenCalledTimes(1);
  });

  // T-004
  it('T-004: refresh rotates the token — old token invalidated, new one issued', async () => {
    const h = harness();
    h.repo.add(makeUser({ last_login_at: new Date() }));
    h.sessions.refreshTokens.set('old-refresh', 'user-1');

    const outcome = (await h.service.refresh('old-refresh', CTX)) as Extract<AuthOutcome, { kind: 'tokens' }>;

    expect(outcome.kind).toBe('tokens');
    expect(outcome.body.access_token).toBe('access-user-1');
    expect(h.sessions.refreshTokens.has('old-refresh')).toBe(false);
    expect(h.sessions.refreshTokens.get(outcome.refreshToken)).toBe('user-1');
    expect(outcome.refreshToken).not.toBe('old-refresh');
  });

  // T-005
  it('T-005: wrong password (1st) → AUTH_REQUIRED, login_failed audit, fail counter = 1, no lock', async () => {
    const h = harness();
    h.repo.add(makeUser());
    argonVerify.mockResolvedValue(false);

    const err = await capture(h.service.login('rm.delhi.001', 'bad', CTX));

    expect(err.code).toBe('AUTH_REQUIRED');
    expect(err.httpStatus).toBe(401);
    expect(h.sessions.failCounts.get('user-1')).toBe(1);
    expect(h.audit.ofAction(AuditAction.LOGIN_FAILED)).toHaveLength(1);
    expect(h.sessions.lockouts.has('user-1')).toBe(false);
  });

  // T-006
  it('T-006: 5th wrong password triggers lockout (status=locked, lockout key, lockout audit)', async () => {
    const h = harness();
    h.repo.add(makeUser());
    argonVerify.mockResolvedValue(false);
    // Seed 4 prior failures.
    h.sessions.failCounts.set('user-1', 4);

    const err = await capture(h.service.login('rm.delhi.001', 'bad', CTX));

    expect(err.code).toBe('AUTH_REQUIRED'); // 5th attempt still returns 401
    expect(h.sessions.failCounts.get('user-1')).toBe(5);
    expect(h.repo.setStatus).toHaveBeenCalledWith('user-1', UserStatus.LOCKED, expect.any(String));
    expect(h.sessions.lockouts.has('user-1')).toBe(true);
    const failed = h.audit.ofAction(AuditAction.LOGIN_FAILED);
    expect(failed.at(-1)?.detail).toMatchObject({ reason: 'lockout_triggered' });
  });

  // T-007
  it('T-007: login on a locked account → FORBIDDEN/ACCOUNT_LOCKED + retry_after, no password check', async () => {
    const h = harness();
    h.repo.add(makeUser({ status: UserStatus.LOCKED }));
    h.sessions.lockouts.set('user-1', 720);

    const err = await capture(h.service.login('rm.delhi.001', 'whatever', CTX));

    expect(err.code).toBe('FORBIDDEN');
    expect(err.httpStatus).toBe(403);
    expect(err.detail).toMatchObject({ reason: 'ACCOUNT_LOCKED', retry_after_seconds: 720 });
    expect(argonVerify).not.toHaveBeenCalled();
    expect(h.audit.ofAction(AuditAction.LOGIN_FAILED)).toHaveLength(1);
  });

  // T-008
  it('T-008: wrong OTP → AUTH_REQUIRED, mfa_failed audit, challenge NOT consumed', async () => {
    const h = harness();
    h.repo.add(makeUser({ user_id: 'admin-1', role_code: RoleCode.ADMIN, mfa_enabled: true, totp_secret_enc: 'enc' }));
    h.sessions.mfaChallenges.add('admin-1');

    const err = await capture(h.service.verifyMfa('mfa_challenge:admin-1', '000000', CTX));

    expect(err.code).toBe('AUTH_REQUIRED');
    expect(h.audit.ofAction(AuditAction.MFA_FAILED)).toHaveLength(1);
    expect(h.sessions.mfaChallenges.has('admin-1')).toBe(true); // still present
  });

  // T-009
  it('T-009: replayed MFA challenge (Redis marker absent) → AUTH_REQUIRED, no token issuance', async () => {
    const h = harness();
    h.repo.add(makeUser({ user_id: 'admin-1', role_code: RoleCode.ADMIN, mfa_enabled: true, totp_secret_enc: 'enc' }));
    // No marker added → already consumed.

    const err = await capture(h.service.verifyMfa('mfa_challenge:admin-1', FakeTotp.GOOD_OTP, CTX));

    expect(err.code).toBe('AUTH_REQUIRED');
    expect(h.tokens.signAccessToken).not.toHaveBeenCalled();
  });

  // T-010
  it('T-010: expired/unknown refresh token (not in store) → AUTH_REQUIRED', async () => {
    const h = harness();
    const err = await capture(h.service.refresh('00000000-not-in-redis', CTX));
    expect(err.code).toBe('AUTH_REQUIRED');
  });

  // T-011
  it('T-011: idle timeout on refresh → AUTH_REQUIRED and refresh token deleted', async () => {
    const h = harness();
    const stale = new Date(Date.now() - 31 * 60_000); // 31 min ago > 30 min idle
    h.repo.add(makeUser({ last_login_at: stale }));
    h.sessions.refreshTokens.set('refresh-x', 'user-1');

    const err = await capture(h.service.refresh('refresh-x', CTX));

    expect(err.code).toBe('AUTH_REQUIRED');
    expect(h.sessions.refreshTokens.has('refresh-x')).toBe(false);
  });

  // T-015
  it('T-015: password reset for an active email → reset key set + email dispatched (pw_reset_link)', async () => {
    const h = harness();
    h.repo.add(makeUser());

    await h.service.initiatePasswordReset('rm@nbfc.in', CTX);

    expect(h.sessions.pwResets.has('user-1')).toBe(true);
    expect(h.notifier.sends).toHaveLength(1);
    expect(h.notifier.sends[0]?.templateCode).toBe('pw_reset_link');
    expect(h.notifier.sends[0]?.recipient).toBe('rm@nbfc.in');
    expect(h.audit.ofAction(AuditAction.USER_CHANGE).at(0)?.detail).toMatchObject({
      sub_action: 'password_reset_requested',
    });
  });

  // T-016
  it('T-016: password reset for an unknown email → no email, no reset key (no enumeration)', async () => {
    const h = harness();
    // No user added.
    await h.service.initiatePasswordReset('nobody@nbfc.in', CTX);

    expect(h.notifier.sends).toHaveLength(0);
    expect(h.sessions.pwResets.size).toBe(0);
  });

  // T-017
  it('T-017: lockout counter is cleared after a successful password verify', async () => {
    const h = harness();
    h.repo.add(makeUser());
    h.sessions.failCounts.set('user-1', 4);
    argonVerify.mockResolvedValue(true);

    await h.service.login('rm.delhi.001', 'good', CTX);

    expect(h.sessions.clearFailCount).toHaveBeenCalledWith('user-1');
    expect(h.sessions.failCounts.has('user-1')).toBe(false);
  });

  // T-018
  it('T-018: MFA is mandatory for PARTNER even with mfa_enabled=false', async () => {
    const h = harness();
    const partner = makeUser({ user_id: 'p-1', username: 'partner', role_code: RoleCode.PARTNER, mfa_enabled: false });
    expect(h.service.isMfaRequired(partner)).toBe(true);

    h.repo.add(partner);
    argonVerify.mockResolvedValue(true);
    const outcome = await h.service.login('partner', 'good', CTX);
    expect(outcome.kind).toBe('challenge');
  });

  // T-019
  it('T-019: MFA is not mandatory for RM with mfa_enabled=false', async () => {
    const h = harness();
    const rm = makeUser({ role_code: RoleCode.RM, mfa_enabled: false });
    expect(h.service.isMfaRequired(rm)).toBe(false);

    h.repo.add(rm);
    argonVerify.mockResolvedValue(true);
    const outcome = await h.service.login('rm.delhi.001', 'good', CTX);
    expect(outcome.kind).toBe('tokens');
  });

  // T-023 (service-level half: identical generic outcome for unknown vs wrong-password)
  it('T-023: non-existent username and wrong password both yield the same AUTH_REQUIRED body', async () => {
    const h1 = harness();
    const unknownErr = await capture(h1.service.login('ghost', 'x', CTX));

    const h2 = harness();
    h2.repo.add(makeUser());
    argonVerify.mockResolvedValue(false);
    const wrongPwErr = await capture(h2.service.login('rm.delhi.001', 'x', CTX));

    expect(unknownErr.code).toBe(wrongPwErr.code);
    expect(unknownErr.httpStatus).toBe(wrongPwErr.httpStatus);
    expect(unknownErr.message).toBe(wrongPwErr.message);
    expect(unknownErr.detail).toBeUndefined();
    expect(wrongPwErr.detail).toBeUndefined();
    // Unknown user is audited under the system actor, not a real user id.
    expect(h1.audit.ofAction(AuditAction.LOGIN_FAILED).at(0)?.actor_id).toBe(
      '00000000-0000-0000-0000-000000000000',
    );
  });

  // T-024
  it('T-024: no audit detail for an auth event contains a password, token, or OTP', async () => {
    const h = harness();
    h.repo.add(makeUser());
    argonVerify.mockResolvedValue(true);
    await h.service.login('rm.delhi.001', 'S3cret!', CTX);

    const serialized = JSON.stringify(h.audit.entries);
    expect(serialized).not.toContain('S3cret!');
    expect(serialized).not.toContain('access-user-1');
    expect(serialized.toLowerCase()).not.toContain('password_hash');
    expect(serialized).not.toContain('$argon2');
    // ip_device is carried in its own field, never inside detail.
    for (const entry of h.audit.entries) {
      expect(JSON.stringify(entry.detail ?? {})).not.toContain('203.0.113.7');
    }
  });

  // Refresh on a now-inactive/locked user is denied and the token cleared.
  it('refresh denies a user whose status is no longer active and clears the token', async () => {
    const h = harness();
    h.repo.add(makeUser({ status: UserStatus.LOCKED }));
    h.sessions.refreshTokens.set('r1', 'user-1');

    const err = await capture(h.service.refresh('r1', CTX));
    expect(err.code).toBe('AUTH_REQUIRED');
    expect(h.sessions.refreshTokens.has('r1')).toBe(false);
  });

  // A user locked/deactivated between the password step and the MFA step cannot
  // complete MFA and mint tokens (mirrors the refresh() ACTIVE guard).
  it('verifyMfa denies a user who is no longer active, issues no tokens, clears the challenge', async () => {
    const h = harness();
    h.repo.add(
      makeUser({ user_id: 'admin-1', role_code: RoleCode.ADMIN, mfa_enabled: true, totp_secret_enc: 'enc', status: UserStatus.LOCKED }),
    );
    h.sessions.mfaChallenges.add('admin-1');

    const err = await capture(h.service.verifyMfa('mfa_challenge:admin-1', FakeTotp.GOOD_OTP, CTX));

    expect(err.code).toBe('AUTH_REQUIRED');
    expect(h.tokens.signAccessToken).not.toHaveBeenCalled();
    expect(h.totp.verify).not.toHaveBeenCalled(); // denied before TOTP is even checked
    expect(h.sessions.mfaChallenges.has('admin-1')).toBe(false); // dead challenge invalidated
  });

  // MFA failures escalate to a lockout at the threshold.
  it('MFA wrong-OTP at threshold locks the account and returns FORBIDDEN', async () => {
    const h = harness();
    h.repo.add(makeUser({ user_id: 'admin-1', role_code: RoleCode.ADMIN, mfa_enabled: true, totp_secret_enc: 'enc' }));
    h.sessions.mfaChallenges.add('admin-1');
    h.sessions.mfaFailCounts.set('admin-1', 4);

    const err = await capture(h.service.verifyMfa('mfa_challenge:admin-1', '000000', CTX));
    expect(err.code).toBe('FORBIDDEN');
    expect(err.detail).toMatchObject({ reason: 'ACCOUNT_LOCKED' });
    expect(h.sessions.lockouts.has('admin-1')).toBe(true);
  });

  // unlockUser reactivates and clears lock state (FR-130 entry point).
  it('unlockUser sets status active and clears lockout + fail counters', async () => {
    const h = harness();
    h.repo.add(makeUser({ status: UserStatus.LOCKED }));
    h.sessions.lockouts.set('user-1', 500);
    h.sessions.failCounts.set('user-1', 5);

    await h.service.unlockUser('user-1', 'admin-actor');

    expect(h.repo.setStatus).toHaveBeenCalledWith('user-1', UserStatus.ACTIVE, 'admin-actor');
    expect(h.sessions.lockouts.has('user-1')).toBe(false);
    expect(h.sessions.failCounts.has('user-1')).toBe(false);
  });

  // Audit-failure resilience: a login still succeeds if the audit append throws.
  it('login still succeeds when the audit append fails (logged, not swallowed silently)', async () => {
    const h = harness();
    h.repo.add(makeUser());
    argonVerify.mockResolvedValue(true);
    h.audit.append.mockRejectedValueOnce(new Error('audit sink down'));

    const outcome = await h.service.login('rm.delhi.001', 'good', CTX);
    expect(outcome.kind).toBe('tokens');
  });
});
