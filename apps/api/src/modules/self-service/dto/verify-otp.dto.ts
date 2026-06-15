import { z } from 'zod';

/** FR-060 — `POST /c/{token}/otp` body (LLD §3). Six numeric digits. */
export const VerifyOtpDto = z.object({
  otp: z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits.'),
});
export type VerifyOtpDto = z.infer<typeof VerifyOtpDto>;
