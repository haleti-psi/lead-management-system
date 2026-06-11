import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Logger } from 'nestjs-pino';

import {
  AuditAction,
  CommChannel,
  ERROR_CODES,
  UserStatus,
  type DataScope,
  type RoleCode,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { TokenService, PW_RESET_TTL_SECONDS } from '../../core/auth';
import { AppConfigService } from '../../core/config';
import { DomainException } from '../../core/http';
import {
  NOTIFICATION_CHANNEL_PORT,
  type NotificationChannelPort,
} from '../../core/integration/ports/notification-channel.port';
import { AuthRepository, type AuthUserRow } from './auth.repository';
import { AuthSessionStore } from './auth-session.store';
import {
  DEFAULT_ORG_ID,
  MFA_MANDATORY_ROLES,
  MFA_METHOD_TOTP,
  SYSTEM_USER_ID,
} from './identity.constants';
import { TotpService } from './totp.service';
import type { AuthOutcome, AuthRequestContext, TokenIssued } from './auth.types';

/**
 * FR-001 authentication & session lifecycle. Password login (argon2), optional
 * TOTP MFA, short-lived access JWT + rotating opaque refresh token, account
 * lockout, idle-timeout-on-refresh, and password-reset request — every step
 * audited. All four entry points are reached only via `@Public()` controllers.
 *
 * Generic-message discipline: a non-existent username and a wrong password both
 * yield `AUTH_REQUIRED` with the same body (no user enumeration).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly sessions: AuthSessionStore,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly audit: AuditAppender,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
    @Inject(NOTIFICATION_CHANNEL_PORT) private readonly notifier: NotificationChannelPort,
  ) {}

  /** Whether a user must clear an MFA challenge before tokens are issued (LLD step 7). */
  isMfaRequired(user: Pick<AuthUserRow, 'mfa_enabled' | 'role_code'>): boolean {
    return user.mfa_enabled || MFA_MANDATORY_ROLES.has(user.role_code);
  }

  // ── POST /auth/login ──────────────────────────────────────────
  async login(username: string, password: string, ctx: AuthRequestContext): Promise<AuthOutcome> {
    const user = await this.repo.findUserByUsername(username);

    // (3) Unknown user → audit under the system actor, return the generic 401.
    if (!user) {
      await this.safeAudit({
        action: AuditAction.LOGIN_FAILED,
        actor_id: SYSTEM_USER_ID,
        org_id: DEFAULT_ORG_ID,
        entity_type: 'users',
        entity_id: null,
        detail: { reason: 'user_not_found' },
        ipDevice: this.ipDevice(ctx),
      });
      throw this.authRequired();
    }

    // (4) Lockout check — locked status with a live Redis flag blocks the attempt.
    if (user.status === UserStatus.LOCKED) {
      const ttl = await this.sessions.getLockoutTtl(user.user_id);
      await this.auditLoginFailed(user, { reason: 'account_locked' }, ctx);
      throw this.accountLocked(ttl);
    }

    // (5) Password verify.
    const ok = await this.verifyPassword(user.password_hash, password);
    if (!ok) {
      await this.handleFailedPassword(user, ctx);
      throw this.authRequired();
    }

    // (6) Reset the failure counter on success.
    await this.sessions.clearFailCount(user.user_id);

    // (7) MFA decision.
    if (this.isMfaRequired(user)) {
      const challenge = await this.tokens.signMfaChallenge(user.user_id);
      await this.sessions.setMfaChallenge(user.user_id);
      return {
        kind: 'challenge',
        body: { mfa_required: true, mfa_challenge_token: challenge, mfa_method: MFA_METHOD_TOTP },
      };
    }

    // (8/9) No MFA — issue tokens and audit the login.
    return this.issueTokensOutcome(user, ctx);
  }

  // ── POST /auth/mfa ────────────────────────────────────────────
  async verifyMfa(challengeToken: string, otp: string, ctx: AuthRequestContext): Promise<AuthOutcome> {
    // (3) Verify the challenge token.
    const claims = await this.tokens.verifyPurpose(challengeToken, 'mfa_challenge');
    if (!claims) {
      throw this.authRequired();
    }
    const userId = claims.sub;

    // (4) Single-use check — the Redis marker must still exist.
    if (!(await this.sessions.hasMfaChallenge(userId))) {
      throw this.authRequired();
    }

    const user = await this.repo.findUserById(userId);
    if (!user) {
      throw this.authRequired();
    }

    // (4b) Status guard — an account locked/deactivated between the password step
    // and this MFA step must not be able to complete MFA and mint tokens (mirrors
    // the `refresh()` ACTIVE check). Generic AUTH_REQUIRED, no enumeration.
    if (user.status !== UserStatus.ACTIVE) {
      await this.sessions.clearMfaChallenge(userId);
      throw this.authRequired();
    }

    // (5) TOTP verify.
    if (!this.totp.verify(otp, user.totp_secret_enc)) {
      const fails = await this.sessions.incrementMfaFailCount(userId);
      await this.safeAudit({
        action: AuditAction.MFA_FAILED,
        actor_id: user.user_id,
        org_id: user.org_id,
        entity_type: 'users',
        entity_id: user.user_id,
        detail: { reason: 'bad_otp' },
        ipDevice: this.ipDevice(ctx),
      });
      if (this.sessions.isAtLockoutThreshold(fails)) {
        await this.lockAccount(user, { reason: 'mfa_lockout_triggered' }, ctx);
        throw this.accountLocked(await this.sessions.getLockoutTtl(userId));
      }
      throw this.authRequired();
    }

    // (6) Invalidate the challenge to prevent replay.
    await this.sessions.clearMfaChallenge(userId);
    await this.sessions.clearMfaFailCount(userId);

    // (7/8) Issue tokens + audit.
    return this.issueTokensOutcome(user, ctx);
  }

  // ── POST /auth/refresh ────────────────────────────────────────
  async refresh(refreshToken: string | undefined, ctx: AuthRequestContext): Promise<AuthOutcome> {
    // (1) Cookie present?
    if (!refreshToken) {
      throw this.authRequired();
    }
    // (2) Resolve the token to a user.
    const userId = await this.sessions.getRefreshUser(refreshToken);
    if (!userId) {
      throw this.authRequired();
    }

    const user = await this.repo.findUserById(userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      await this.sessions.deleteRefreshToken(refreshToken);
      throw this.authRequired();
    }

    // (3) Idle-timeout check.
    if (this.isIdleExpired(user.last_login_at)) {
      await this.sessions.deleteRefreshToken(refreshToken);
      throw this.authRequired();
    }

    // (4) Rotate: invalidate the old token, issue a new one (done in issueTokensOutcome).
    await this.sessions.deleteRefreshToken(refreshToken);

    // (5/6/7) New access token + rotated refresh cookie. Refresh is not a fresh
    // login event; it updates last_login_at to extend the idle window but is not
    // audited as `login`.
    return this.issueTokensOutcome(user, ctx, { audit: false });
  }

  // ── POST /auth/reset ──────────────────────────────────────────
  async initiatePasswordReset(email: string, ctx: AuthRequestContext): Promise<void> {
    const user = await this.repo.findUserByEmail(email);

    // Always return success; only act for a confirmed active user (no enumeration).
    if (!user || user.status !== UserStatus.ACTIVE) {
      return;
    }

    const token = await this.tokens.signPasswordReset(user.user_id);
    await this.sessions.setPasswordReset(user.user_id, PW_RESET_TTL_SECONDS);

    const resetUrl = `${this.config.get('APP_BASE_URL')}/reset-password?token=${token}`;
    // Fire-and-forget: a provider failure must not surface to the caller.
    try {
      await this.notifier.send({
        channel: CommChannel.EMAIL,
        templateCode: 'pw_reset_link',
        recipient: user.email,
        variables: { reset_url: resetUrl, expires_in: '3 hours' },
      });
    } catch (err) {
      this.logger.warn({ err, user_id: user.user_id }, 'Password-reset email dispatch failed');
    }

    // Audit under `user_change` with a typed sub-action (LLD §reset step 5 / AMBIGUITIES A4).
    await this.safeAudit({
      action: AuditAction.USER_CHANGE,
      actor_id: user.user_id,
      org_id: user.org_id,
      entity_type: 'users',
      entity_id: user.user_id,
      detail: { sub_action: 'password_reset_requested' },
      ipDevice: this.ipDevice(ctx),
    });
  }

  /** Admin unlock entry point (referenced by FR-130): clears lock + reactivates. */
  async unlockUser(userId: string, actorId: string): Promise<void> {
    await this.repo.setStatus(userId, UserStatus.ACTIVE, actorId);
    await this.sessions.clearLockout(userId);
    await this.sessions.clearFailCount(userId);
  }

  // ── Internals ─────────────────────────────────────────────────

  /** Sign tokens, store + rotate the refresh token, stamp last_login_at, audit. */
  private async issueTokensOutcome(
    user: AuthUserRow,
    ctx: AuthRequestContext,
    opts: { audit?: boolean } = {},
  ): Promise<AuthOutcome> {
    const { token, expiresIn } = await this.tokens.signAccessToken({
      userId: user.user_id,
      orgId: user.org_id,
      role: user.role_code as RoleCode,
      scope: user.default_scope as DataScope,
    });

    const refreshToken = randomUUID();
    await this.sessions.storeRefreshToken(refreshToken, user.user_id);
    await this.repo.setLastLoginAt(user.user_id, new Date(), user.user_id);

    if (opts.audit !== false) {
      await this.safeAudit({
        action: AuditAction.LOGIN,
        actor_id: user.user_id,
        org_id: user.org_id,
        entity_type: 'users',
        entity_id: user.user_id,
        ipDevice: this.ipDevice(ctx),
      });
    }

    const body: TokenIssued = {
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      mfa_required: false,
    };
    return { kind: 'tokens', body, refreshToken };
  }

  private async verifyPassword(hash: string | null, password: string): Promise<boolean> {
    if (!hash) return false;
    try {
      return await argon2.verify(hash, password);
    } catch (err) {
      // A malformed hash is a data problem, not a valid login — log and deny.
      this.logger.error({ err }, 'argon2.verify failed');
      return false;
    }
  }

  private async handleFailedPassword(user: AuthUserRow, ctx: AuthRequestContext): Promise<void> {
    const count = await this.sessions.incrementFailCount(user.user_id);
    if (this.sessions.isAtLockoutThreshold(count)) {
      await this.lockAccount(user, { reason: 'lockout_triggered' }, ctx);
      return;
    }
    await this.auditLoginFailed(user, { reason: 'bad_password', attempt: count }, ctx);
  }

  private async lockAccount(
    user: AuthUserRow,
    detail: Record<string, unknown>,
    ctx: AuthRequestContext,
  ): Promise<void> {
    await this.repo.setStatus(user.user_id, UserStatus.LOCKED, SYSTEM_USER_ID);
    await this.sessions.setLockout(user.user_id);
    await this.auditLoginFailed(user, detail, ctx);
  }

  private isIdleExpired(lastLoginAt: Date | null): boolean {
    if (!lastLoginAt) return false;
    const idleMs = this.config.get('SESSION_IDLE_MINUTES') * 60_000;
    return Date.now() - new Date(lastLoginAt).getTime() > idleMs;
  }

  private async auditLoginFailed(
    user: Pick<AuthUserRow, 'user_id' | 'org_id'>,
    detail: Record<string, unknown>,
    ctx: AuthRequestContext,
  ): Promise<void> {
    await this.safeAudit({
      action: AuditAction.LOGIN_FAILED,
      actor_id: user.user_id,
      org_id: user.org_id,
      entity_type: 'users',
      entity_id: user.user_id,
      detail,
      ipDevice: this.ipDevice(ctx),
    });
  }

  /**
   * Append an audit row without letting an audit failure break the auth flow.
   * Per LLD §State Machine, the conservative direction (lock stands / login
   * proceeds) is safer than failing the request because the audit insert failed;
   * the failure is logged for follow-up. Errors are logged, never swallowed.
   */
  private async safeAudit(entry: Parameters<AuditAppender['append']>[0]): Promise<void> {
    try {
      await this.audit.append(entry);
    } catch (err) {
      this.logger.error({ err, action: entry.action }, 'Audit append failed during auth flow');
    }
  }

  private ipDevice(ctx: AuthRequestContext): { ip?: string; user_agent?: string } | null {
    if (!ctx.ip && !ctx.userAgent) return null;
    return { ip: ctx.ip, user_agent: ctx.userAgent };
  }

  private authRequired(): DomainException {
    return new DomainException(ERROR_CODES.AUTH_REQUIRED);
  }

  private accountLocked(retryAfterSeconds: number): DomainException {
    return new DomainException(ERROR_CODES.FORBIDDEN, undefined, {
      detail: { reason: 'ACCOUNT_LOCKED', retry_after_seconds: retryAfterSeconds },
    });
  }
}
