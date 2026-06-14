import type { ZodSchema } from 'zod';

import { ERROR_CODES } from '@lms/shared';

import { DomainException } from '../../core/http';

/**
 * Validate a request body against a Zod schema, throwing the same
 * `VALIDATION_ERROR` (400) envelope the `ZodValidationPipe` would. Used for the
 * two-phase upload body, where the schema (initiate vs. confirm) is chosen at
 * runtime from the body shape and so cannot be a `@Body()` pipe.
 */
export function parseUploadBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Please correct the highlighted fields.', {
      fields: result.error.issues.map((issue) => ({
        field: issue.path.length > 0 ? issue.path.join('.') : '_',
        issue: issue.message,
      })),
    });
  }
  return result.data;
}
