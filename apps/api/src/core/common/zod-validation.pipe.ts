import { type PipeTransform } from '@nestjs/common';
import type { ZodError, ZodSchema, ZodTypeDef } from 'zod';

import { ERROR_CODES, type ApiFieldError } from '@lms/shared';

import { DomainException } from '../http';

/**
 * Validates and parses an inbound value against a Zod schema at the controller
 * boundary (security.md: validate before the service sees data). On failure it
 * throws a {@link DomainException} with `VALIDATION_ERROR` (400) and a
 * `fields[]` array mapped from Zod issues — matching the §8.4 error envelope.
 *
 * Usage: `@Query(new ZodValidationPipe(PaginationParams)) q: PaginationParams`.
 */
export class ZodValidationPipe<TOut, TDef extends ZodTypeDef = ZodTypeDef, TIn = unknown>
  implements PipeTransform<unknown, TOut>
{
  constructor(private readonly schema: ZodSchema<TOut, TDef, TIn>) {}

  transform(value: unknown): TOut {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Please correct the highlighted fields.', {
        fields: toFieldErrors(result.error),
      });
    }
    return result.data;
  }
}

function toFieldErrors(error: ZodError): ApiFieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '_',
    issue: issue.message,
  }));
}
