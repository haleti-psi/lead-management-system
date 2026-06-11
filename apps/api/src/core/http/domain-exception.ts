import type { ApiFieldError, ErrorCode } from '@lms/shared';

import { CODE_TO_STATUS, DEFAULT_MESSAGE, isRetryable } from './error-code.map';

export interface DomainExceptionOptions {
  /** Field-level errors (VALIDATION_ERROR). */
  fields?: ApiFieldError[];
  /** Domain sub-reason payload, e.g. `{ reason: 'STAGE_GUARD_FAILED', failed_guards: [...] }`. */
  detail?: Record<string, unknown>;
  /** Original error for server-side logging (never serialized to the client). */
  cause?: unknown;
}

/**
 * The typed application error. FRs throw this with a code from the error
 * taxonomy; the global {@link AllExceptionsFilter} renders it into the uniform
 * envelope with the code's mandated HTTP status. Domain sub-reasons
 * (DUPLICATE_BLOCKED, STAGE_GUARD_FAILED, …) ride in `detail.reason` under the
 * parent code — never as new top-level codes.
 */
export class DomainException extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly fields?: ApiFieldError[];
  readonly detail?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, options?: DomainExceptionOptions) {
    super(message ?? DEFAULT_MESSAGE[code], options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'DomainException';
    this.code = code;
    this.httpStatus = CODE_TO_STATUS[code];
    this.retryable = isRetryable(code);
    this.fields = options?.fields;
    this.detail = options?.detail;
  }
}

export function isDomainException(err: unknown): err is DomainException {
  return err instanceof DomainException;
}
