// Shared Zod field schemas — docs/contracts/shared-utilities.md §Shared Zod schemas.
// The single source of format validation for identity fields used by both apps.
// Only the schemas a built FR consumes are defined; Pan/Gstin land with their
// consumer FRs (identity/KYC) per the same contract entry.
import { z } from 'zod';

/** Indian mobile number — 10 digits, first digit 6–9 (shared-utilities.md). */
export const MobileSchema = z
  .string()
  .regex(/^[6-9]\d{9}$/, 'Must be a valid 10-digit Indian mobile number.');

/** Indian postal PIN code — exactly 6 digits. */
export const PinSchema = z.string().regex(/^[0-9]{6}$/, 'Invalid pin code format.');
