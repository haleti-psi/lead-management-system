import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import {
  ERROR_CODES,
  type ApiEnvelope,
  type ApiError,
  type ApiFieldError,
  type ErrorCode,
} from '@lms/shared';

import { getCorrelationId, type CorrelatedRequest } from './correlation.middleware';
import { codeForStatus, DEFAULT_MESSAGE, isRetryable } from './error-code.map';
import { isDomainException } from './domain-exception';
import type { HttpResponseLike } from './http-types';

interface ResolvedError {
  status: number;
  body: ApiError;
  /** True when the underlying error is unexpected and must be logged at error level with its stack. */
  unexpected: boolean;
}

/**
 * Global exception filter (architecture §5 / error-taxonomy.md). Renders every
 * thrown error into the uniform envelope `{ data: null, meta, error }` using
 * ONLY taxonomy codes and their mandated HTTP status. Unknown/unhandled errors
 * become INTERNAL_ERROR (500) and are logged server-side with the correlation
 * id and stack — but the response NEVER contains a stack trace, SQL, internal
 * id, or filesystem path.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<CorrelatedRequest>();
    const res = http.getResponse<HttpResponseLike>();
    const correlationId = getCorrelationId(req) ?? 'corr_unknown';

    const resolved = this.resolve(exception);

    if (resolved.unexpected) {
      // Full detail server-side only (pino redacts PII); never to the client.
      this.logger.error(
        { err: exception, correlation_id: correlationId, status: resolved.status },
        'Unhandled exception',
      );
    }

    const envelope: ApiEnvelope<null> = {
      data: null,
      meta: { correlation_id: correlationId },
      error: resolved.body,
    };

    res.status(resolved.status).json(envelope);
  }

  private resolve(exception: unknown): ResolvedError {
    if (isDomainException(exception)) {
      return {
        status: exception.httpStatus,
        body: {
          code: exception.code,
          message: exception.message,
          retryable: exception.retryable,
          ...(exception.fields ? { fields: exception.fields } : {}),
          ...(exception.detail ? { detail: exception.detail } : {}),
        },
        // 5xx domain errors are still worth logging; 4xx are expected client errors.
        unexpected: exception.httpStatus >= 500,
      };
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    // Truly unknown — do not leak anything about it.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: DEFAULT_MESSAGE.INTERNAL_ERROR,
        retryable: false,
      },
      unexpected: true,
    };
  }

  private fromHttpException(exception: HttpException): ResolvedError {
    const status = exception.getStatus();
    const code = codeForStatus(status);
    const payload = exception.getResponse();
    const { message, fields, detail } = this.extract(payload, code);

    return {
      status: code === ERROR_CODES.INTERNAL_ERROR ? HttpStatus.INTERNAL_SERVER_ERROR : status,
      body: {
        code,
        // For 500s use the generic message — never echo internal exception text.
        message: code === ERROR_CODES.INTERNAL_ERROR ? DEFAULT_MESSAGE.INTERNAL_ERROR : message,
        retryable: isRetryable(code),
        ...(fields ? { fields } : {}),
        ...(detail ? { detail } : {}),
      },
      unexpected: status >= 500,
    };
  }

  /** Safely pull a client-safe message + optional fields/detail from a Nest exception body. */
  private extract(
    payload: string | object,
    code: ErrorCode,
  ): { message: string; fields?: ApiFieldError[]; detail?: Record<string, unknown> } {
    const fallback = DEFAULT_MESSAGE[code];
    if (typeof payload === 'string') {
      return { message: payload };
    }

    const obj = payload as Record<string, unknown>;
    const rawMessage = obj['message'];
    const message =
      typeof rawMessage === 'string'
        ? rawMessage
        : Array.isArray(rawMessage)
          ? fallback // array messages come from class-validator; expose them as fields, not a leaky string
          : fallback;

    const fields = this.toFields(rawMessage, obj['fields']);
    const detail = this.toDetail(obj['detail']);

    return { message, ...(fields ? { fields } : {}), ...(detail ? { detail } : {}) };
  }

  private toFields(rawMessage: unknown, rawFields: unknown): ApiFieldError[] | undefined {
    if (Array.isArray(rawFields)) {
      const ok = rawFields.filter(
        (f): f is ApiFieldError =>
          typeof f === 'object' &&
          f !== null &&
          typeof (f as ApiFieldError).field === 'string' &&
          typeof (f as ApiFieldError).issue === 'string',
      );
      if (ok.length > 0) return ok;
    }
    if (Array.isArray(rawMessage)) {
      return rawMessage
        .filter((m): m is string => typeof m === 'string')
        .map((issue) => ({ field: '_', issue }));
    }
    return undefined;
  }

  private toDetail(rawDetail: unknown): Record<string, unknown> | undefined {
    return typeof rawDetail === 'object' && rawDetail !== null
      ? (rawDetail as Record<string, unknown>)
      : undefined;
  }
}
