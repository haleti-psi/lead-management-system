import { z } from 'zod';

/**
 * Zod DTOs for the FR-001 auth endpoints (LLD §Validation Logic). Validation
 * runs at the controller boundary via {@link ZodValidationPipe}; every failure
 * becomes `VALIDATION_ERROR` (400) with field-level issues. Unknown keys are
 * stripped by Zod's default object parsing.
 */

export const LoginDto = z.object({
  username: z.string({ required_error: 'Username is required.' }).min(1, 'Username is required.').max(150),
  password: z.string({ required_error: 'Password is required.' }).min(1, 'Password is required.').max(255),
});
export type LoginDto = z.infer<typeof LoginDto>;

export const MfaDto = z.object({
  mfa_challenge_token: z
    .string({ required_error: 'MFA challenge token is required.' })
    .min(1, 'MFA challenge token is required.'),
  otp: z
    .string({ required_error: 'OTP must be 6 digits.' })
    .regex(/^\d{6}$/, 'OTP must be 6 digits.'),
});
export type MfaDto = z.infer<typeof MfaDto>;

export const ResetDto = z.object({
  email: z.string({ required_error: 'A valid email address is required.' }).email('A valid email address is required.'),
});
export type ResetDto = z.infer<typeof ResetDto>;
