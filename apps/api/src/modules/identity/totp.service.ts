import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';

import { AppConfigService } from '../../core/config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * TOTP enrolment + verification (otplib) with application-layer encryption of the
 * per-user secret at rest. The secret is stored in `users.totp_secret_enc` as
 * `iv:authTag:ciphertext` (base64), encrypted with a key derived from
 * `TOKENIZATION_KMS_KEY` (India-resident KMS material; environment-contract).
 * The raw base32 secret never leaves this service except inside the enrolment
 * `otpauth://` URI returned for QR rendering.
 */
@Injectable()
export class TotpService {
  constructor(private readonly config: AppConfigService) {}

  private key(): Buffer {
    // Derive a stable 32-byte key from the configured KMS key reference.
    return scryptSync(this.config.get('TOKENIZATION_KMS_KEY'), 'lms:totp', 32);
  }

  /** Generate a new base32 TOTP secret for enrolment. */
  generateSecret(): string {
    return authenticator.generateSecret();
  }

  /** Build the `otpauth://` URI for QR rendering during enrolment. */
  keyUri(secret: string, accountName: string): string {
    return authenticator.keyuri(accountName, this.config.get('MFA_ISSUER'), secret);
  }

  /**
   * Verify a 6-digit OTP against the stored encrypted secret. Returns `false`
   * (never throws) when the secret is absent or the code is wrong/expired.
   */
  verify(otp: string, encryptedSecret: string | null): boolean {
    if (!encryptedSecret) return false;
    let secret: string;
    try {
      secret = this.decrypt(encryptedSecret);
    } catch {
      return false;
    }
    return authenticator.verify({ token: otp, secret });
  }

  /** Encrypt a base32 secret for storage in `totp_secret_enc`. */
  encrypt(secret: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
  }

  /** Decrypt a stored secret; throws if the payload is malformed/tampered. */
  private decrypt(stored: string): string {
    const parts = stored.split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted secret');
    }
    const [ivB64, tagB64, dataB64] = parts as [string, string, string];
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error('Malformed encrypted secret');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  }
}
