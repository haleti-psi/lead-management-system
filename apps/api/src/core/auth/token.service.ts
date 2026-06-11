import { createHmac } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import type { DataScope, RoleCode } from '@lms/shared';

import { AppConfigService } from '../config';
import type { AuthUser } from './auth-user';
import {
  MFA_CHALLENGE_TTL_SECONDS,
  PW_RESET_TTL_SECONDS,
  TokenType,
} from './auth.constants';

/** Decoded access-token claims (signed with JWT_ACCESS_SECRET). */
export interface AccessTokenClaims {
  sub: string;
  org_id: string;
  role: RoleCode;
  scope: DataScope;
  jti: string;
  type: typeof TokenType.ACCESS;
}

/** Decoded short-lived purpose token (MFA challenge / password reset). */
export interface PurposeTokenClaims {
  sub: string;
  jti: string;
  type: typeof TokenType.MFA_CHALLENGE | typeof TokenType.PW_RESET;
}

interface IssuedAccessToken {
  token: string;
  jti: string;
  /** Seconds until the access token expires (for the `expires_in` field). */
  expiresIn: number;
}

/**
 * Single place that signs and verifies every JWT in the auth flow. The access
 * token is signed with `JWT_ACCESS_SECRET`; the two short-lived purpose tokens
 * (MFA challenge, password reset) are signed with purpose-namespaced
 * secrets derived from `JWT_REFRESH_SECRET` so each is cryptographically
 * separated from the access secret without introducing new env vars (the
 * environment contract defines only JWT_ACCESS_SECRET / JWT_REFRESH_SECRET).
 * Verification is `*Async` and returns `null` on any failure — callers map that
 * to AUTH_REQUIRED; this service never throws on an invalid/expired token.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  /** Access-token lifetime in seconds (from ACCESS_TOKEN_TTL, default 15m). */
  get accessTtlSeconds(): number {
    return parseDurationSeconds(this.config.get('ACCESS_TOKEN_TTL'));
  }

  private get accessSecret(): string {
    return this.config.get('JWT_ACCESS_SECRET');
  }

  /** Derive a stable, purpose-separated signing secret from the refresh secret. */
  private purposeSecret(purpose: PurposeTokenClaims['type']): string {
    return createHmac('sha256', this.config.get('JWT_REFRESH_SECRET'))
      .update(`lms:${purpose}`)
      .digest('hex');
  }

  async signAccessToken(user: {
    userId: string;
    orgId: string;
    role: RoleCode;
    scope: DataScope;
  }): Promise<IssuedAccessToken> {
    const jti = randomJti();
    const expiresIn = this.accessTtlSeconds;
    const claims: Omit<AccessTokenClaims, 'sub'> & { sub: string } = {
      sub: user.userId,
      org_id: user.orgId,
      role: user.role,
      scope: user.scope,
      jti,
      type: TokenType.ACCESS,
    };
    const token = await this.jwt.signAsync(claims, {
      secret: this.accessSecret,
      expiresIn,
    });
    return { token, jti, expiresIn };
  }

  /** Verify an access token; returns the {@link AuthUser} or `null` if invalid. */
  async verifyAccessToken(token: string): Promise<AuthUser | null> {
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.accessSecret,
      });
      if (claims.type !== TokenType.ACCESS) return null;
      return {
        userId: claims.sub,
        orgId: claims.org_id,
        role: claims.role,
        scope: claims.scope,
        jti: claims.jti,
      };
    } catch {
      return null;
    }
  }

  /** Sign a 5-minute MFA-challenge token carrying only the subject + type. */
  async signMfaChallenge(userId: string): Promise<string> {
    return this.signPurpose(userId, TokenType.MFA_CHALLENGE, MFA_CHALLENGE_TTL_SECONDS);
  }

  /** Sign a 3-hour single-use password-reset token. */
  async signPasswordReset(userId: string): Promise<string> {
    return this.signPurpose(userId, TokenType.PW_RESET, PW_RESET_TTL_SECONDS);
  }

  /** Verify a purpose token of the expected type; `null` on any failure/mismatch. */
  async verifyPurpose(
    token: string,
    expected: PurposeTokenClaims['type'],
  ): Promise<PurposeTokenClaims | null> {
    try {
      const claims = await this.jwt.verifyAsync<PurposeTokenClaims>(token, {
        secret: this.purposeSecret(expected),
      });
      return claims.type === expected ? claims : null;
    } catch {
      return null;
    }
  }

  private async signPurpose(
    userId: string,
    type: PurposeTokenClaims['type'],
    ttlSeconds: number,
  ): Promise<string> {
    const claims: PurposeTokenClaims = { sub: userId, jti: randomJti(), type };
    return this.jwt.signAsync(claims, {
      secret: this.purposeSecret(type),
      expiresIn: ttlSeconds,
    });
  }
}

function randomJti(): string {
  // crypto.randomUUID is available on Node 20.
  return globalThis.crypto.randomUUID();
}

/**
 * Parse a JWT-style duration (`"15m"`, `"30s"`, `"7d"`, `"2h"`, or a bare number
 * of seconds) into seconds. Used to compute `expires_in` consistently with the
 * token the JWT library signs.
 */
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };
  return amount * (multipliers[unit] ?? 1);
}
