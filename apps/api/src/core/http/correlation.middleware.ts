import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';

import { CORRELATION_HEADER, CORRELATION_ID_KEY } from './correlation.constants';
import { type HttpRequestLike, type HttpResponseLike, readHeader } from './http-types';

/** Request augmented with the resolved correlation id (no `any`). */
export interface CorrelatedRequest extends HttpRequestLike {
  [CORRELATION_ID_KEY]?: string;
}

/** Reads the correlation id off a request, if middleware has run. */
export function getCorrelationId(req: Partial<CorrelatedRequest> | undefined): string | undefined {
  return req?.[CORRELATION_ID_KEY] ?? req?.id;
}

/**
 * Correlation middleware (architecture §5; applied to all routes). Reads an
 * inbound `X-Correlation-Id`, or generates one, then attaches it to the request
 * (for the logger + downstream handlers) and echoes it on the response so the
 * client and every log line share the same id.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: CorrelatedRequest, res: HttpResponseLike, next: (err?: unknown) => void): void {
    const inbound = readHeader(req, CORRELATION_HEADER);
    const correlationId =
      inbound && inbound.trim().length > 0 ? inbound.trim() : `corr_${randomUUID()}`;

    req[CORRELATION_ID_KEY] = correlationId;
    req.id = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);

    next();
  }
}
