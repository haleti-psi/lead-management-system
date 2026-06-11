import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, map } from 'rxjs';

import type { ApiEnvelope, PaginationMeta } from '@lms/shared';

import { CORRELATION_HEADER } from './correlation.constants';
import { getCorrelationId, type CorrelatedRequest } from './correlation.middleware';
import { type HttpResponseLike, readHeader } from './http-types';

/**
 * A controller may return this shape to attach pagination meta; the interceptor
 * hoists `pagination` into `meta` and uses `data` as the envelope body. List
 * endpoints return `paginated(items, meta)`.
 */
export interface PaginatedResult<T> {
  data: T;
  pagination: PaginationMeta;
}

/** Helper for controllers to return a paginated payload. */
export function paginated<T>(data: T, pagination: PaginationMeta): PaginatedResult<T> {
  return { data, pagination };
}

function isPaginated<T>(value: unknown): value is PaginatedResult<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pagination' in value &&
    'data' in value &&
    typeof (value as { pagination: unknown }).pagination === 'object'
  );
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'meta' in value &&
    'error' in value
  );
}

/**
 * Wraps every successful controller return in the uniform envelope
 * (architecture §4 / BRD §4.4): `{ data, meta: { correlation_id, pagination? },
 * error: null }`. A `PaginatedResult` hoists its pagination into `meta`. A value
 * that is already a well-formed envelope is passed through (only its
 * correlation_id is back-filled), so handlers that build their own envelope —
 * or error envelopes from the filter — are not double-wrapped.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, ApiEnvelope<unknown>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<unknown>> {
    const http = context.switchToHttp();
    const req = http.getRequest<CorrelatedRequest>();
    const res = http.getResponse<HttpResponseLike>();
    const correlationId = getCorrelationId(req) ?? this.headerCorrelation(req, res);

    return next.handle().pipe(
      map((payload): ApiEnvelope<unknown> => {
        if (isEnvelope(payload)) {
          return {
            ...payload,
            meta: { ...payload.meta, correlation_id: payload.meta.correlation_id || correlationId },
          };
        }

        if (isPaginated(payload)) {
          return {
            data: payload.data,
            meta: { correlation_id: correlationId, pagination: payload.pagination },
            error: null,
          };
        }

        return {
          data: payload ?? null,
          meta: { correlation_id: correlationId },
          error: null,
        };
      }),
    );
  }

  private headerCorrelation(req: CorrelatedRequest, res: HttpResponseLike): string {
    const fromHeader = readHeader(req, CORRELATION_HEADER);
    const value = fromHeader && fromHeader.length > 0 ? fromHeader : 'corr_unknown';
    if (!res.getHeader(CORRELATION_HEADER)) res.setHeader(CORRELATION_HEADER, value);
    return value;
  }
}
