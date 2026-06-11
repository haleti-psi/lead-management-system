import { z } from 'zod';

/**
 * Shared Zod building blocks for the FR-131 master DTOs. A PATCH schema must
 * require at least one updatable key — {@link atLeastOneKey} enforces that with a
 * `refine` so an empty body maps to VALIDATION_ERROR (LLD §Validation Logic:
 * "at least one updatable field must be present").
 */

/** An IANA timezone string the host platform recognises (LLD BusinessCalendarDto). */
export function isValidTimezone(tz: string): boolean {
  try {
    // Throws RangeError for an unknown zone; the only side effect is validation.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A `YYYY-MM-DD` calendar date (Zod's `.date()` is for `Date` objects). */
export const isoDate = (message: string) =>
  z
    .string({ required_error: message })
    .regex(/^\d{4}-\d{2}-\d{2}$/, message);

/** A 6-digit Indian PIN code. */
export const pinCode = z.string().regex(/^\d{6}$/, 'Each pin code must be a 6-digit number.');

/**
 * Wrap a partial schema so an entirely empty object is rejected. Surfaces as a
 * single field error on `_` (no specific field), matching the envelope shape.
 */
export function atLeastOneKey<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided.',
  });
}
