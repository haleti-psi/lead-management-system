import { MFA_METHOD_TOTP } from './identity.constants';

/** Request context carried into the service for auditing (no PII beyond IP/UA). */
export interface AuthRequestContext {
  ip?: string;
  userAgent?: string;
}

/** Body for a successful token issuance (access token + MFA-not-required). */
export interface TokenIssued {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  mfa_required: false;
}

/** Body when login needs an MFA challenge before issuing tokens. */
export interface MfaChallengeIssued {
  mfa_required: true;
  mfa_challenge_token: string;
  mfa_method: typeof MFA_METHOD_TOTP;
}

/** A login/mfa/refresh outcome the controller turns into an HTTP response. */
export type AuthOutcome =
  | { kind: 'tokens'; body: TokenIssued; refreshToken: string }
  | { kind: 'challenge'; body: MfaChallengeIssued };
