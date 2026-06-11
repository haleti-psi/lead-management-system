import type { ZodSchema } from 'zod';

import { ZodValidationPipe } from '../../core/common';
import { DomainException } from '../../core/http';
import { LoginDto, MfaDto, ResetDto } from './auth.dto';

/** Drive a value through the real validation pipe and capture the thrown error. */
function captureValidation<T>(schema: ZodSchema<T>, value: unknown): DomainException {
  try {
    new ZodValidationPipe(schema).transform(value);
    throw new Error('expected the pipe to reject');
  } catch (err) {
    expect(err).toBeInstanceOf(DomainException);
    return err as DomainException;
  }
}

describe('Auth DTOs (Zod validation)', () => {
  describe('LoginDto', () => {
    it('accepts a valid username + password', () => {
      const parsed = LoginDto.safeParse({ username: 'rm.delhi.001', password: 'S3cret!' });
      expect(parsed.success).toBe(true);
    });

    // T-020
    it('T-020: rejects a missing username and reports the `username` field', () => {
      const parsed = LoginDto.safeParse({ password: 'x' });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some((i) => i.path[0] === 'username')).toBe(true);
      }
    });

    it('rejects a missing password', () => {
      const parsed = LoginDto.safeParse({ username: 'rm' });
      expect(parsed.success).toBe(false);
    });

    it('rejects an over-long username (>150)', () => {
      expect(LoginDto.safeParse({ username: 'a'.repeat(151), password: 'x' }).success).toBe(false);
    });
  });

  describe('MfaDto', () => {
    it('accepts a 6-digit OTP with a challenge token', () => {
      expect(MfaDto.safeParse({ mfa_challenge_token: 't', otp: '482910' }).success).toBe(true);
    });

    // T-021
    it('T-021: rejects an OTP that is not 6 digits and reports the `otp` field', () => {
      const parsed = MfaDto.safeParse({ mfa_challenge_token: 't', otp: '1234' });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some((i) => i.path[0] === 'otp')).toBe(true);
      }
    });

    it('rejects a non-numeric OTP', () => {
      expect(MfaDto.safeParse({ mfa_challenge_token: 't', otp: 'abc123' }).success).toBe(false);
    });

    it('rejects a missing challenge token', () => {
      expect(MfaDto.safeParse({ otp: '123456' }).success).toBe(false);
    });
  });

  describe('ResetDto', () => {
    it('accepts a valid email', () => {
      expect(ResetDto.safeParse({ email: 'user@nbfc.in' }).success).toBe(true);
    });

    // T-022
    it('T-022: rejects an invalid email and reports the `email` field', () => {
      const parsed = ResetDto.safeParse({ email: 'not-an-email' });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some((i) => i.path[0] === 'email')).toBe(true);
      }
    });
  });

  // API-boundary half of T-020/021/022: the ZodValidationPipe (controller boundary)
  // turns each malformed body into a DomainException → VALIDATION_ERROR (400) with a
  // populated `fields[]` ({ field, issue }) that names the offending field. This is
  // the §8.4 envelope the AllExceptionsFilter renders for the client.
  describe('ZodValidationPipe → VALIDATION_ERROR envelope', () => {
    // T-020
    it('T-020: missing username → VALIDATION_ERROR (400) with `username` in fields[]', () => {
      const err = captureValidation(LoginDto, { password: 'x' });
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.httpStatus).toBe(400);
      expect(err.fields?.map((f) => f.field)).toContain('username');
      expect(err.fields?.every((f) => typeof f.issue === 'string')).toBe(true);
    });

    // T-021
    it('T-021: OTP not 6 digits → VALIDATION_ERROR (400) with `otp` in fields[]', () => {
      const err = captureValidation(MfaDto, { mfa_challenge_token: 't', otp: '1234' });
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.httpStatus).toBe(400);
      expect(err.fields?.map((f) => f.field)).toContain('otp');
    });

    // T-022
    it('T-022: invalid email on reset → VALIDATION_ERROR (400) with `email` in fields[]', () => {
      const err = captureValidation(ResetDto, { email: 'not-an-email' });
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.httpStatus).toBe(400);
      expect(err.fields?.map((f) => f.field)).toContain('email');
    });
  });
});
