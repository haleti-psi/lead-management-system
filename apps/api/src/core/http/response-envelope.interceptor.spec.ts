import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import type { ApiEnvelope } from '@lms/shared';

import { CORRELATION_ID_KEY } from './correlation.constants';
import {
  ResponseEnvelopeInterceptor,
  paginated,
} from './response-envelope.interceptor';

function contextWithCorrelation(correlationId: string): ExecutionContext {
  const req = { [CORRELATION_ID_KEY]: correlationId, headers: {} };
  const res = {
    getHeader: (): undefined => undefined,
    setHeader: (): void => undefined,
    status: () => res,
    json: () => res,
  };
  return {
    switchToHttp: () => ({
      getRequest: <T>(): T => req as T,
      getResponse: <T>(): T => res as T,
    }),
  } as unknown as ExecutionContext;
}

function handlerOf<T>(value: T): CallHandler<T> {
  return { handle: () => of(value) };
}

async function run<T>(value: T, correlationId = 'corr_test'): Promise<ApiEnvelope<unknown>> {
  const interceptor = new ResponseEnvelopeInterceptor<T>();
  const result$ = interceptor.intercept(contextWithCorrelation(correlationId), handlerOf(value));
  return firstValueFrom(result$);
}

describe('ResponseEnvelopeInterceptor', () => {
  it('wraps a plain resource in the uniform envelope with the correlation id', async () => {
    const envelope = await run({ id: 'lead-1' });
    expect(envelope).toEqual({
      data: { id: 'lead-1' },
      meta: { correlation_id: 'corr_test' },
      error: null,
    });
  });

  it('maps null/undefined returns to data: null (no pagination)', async () => {
    const envelope = await run(undefined);
    expect(envelope.data).toBeNull();
    expect(envelope.error).toBeNull();
    expect(envelope.meta.pagination).toBeUndefined();
  });

  it('hoists pagination from a PaginatedResult into meta', async () => {
    const envelope = await run(paginated([{ id: 'a' }], { page: 2, limit: 25, total: 134 }));
    expect(envelope.data).toEqual([{ id: 'a' }]);
    expect(envelope.meta).toEqual({
      correlation_id: 'corr_test',
      pagination: { page: 2, limit: 25, total: 134 },
    });
    expect(envelope.error).toBeNull();
  });

  it('passes an already-formed envelope through and back-fills the correlation id', async () => {
    const prebuilt: ApiEnvelope<{ ok: true }> = {
      data: { ok: true },
      meta: { correlation_id: '' },
      error: null,
    };
    const envelope = await run(preBuiltClone(prebuilt));
    expect(envelope.data).toEqual({ ok: true });
    expect(envelope.meta.correlation_id).toBe('corr_test');
  });
});

function preBuiltClone<T>(env: ApiEnvelope<T>): ApiEnvelope<T> {
  return { ...env, meta: { ...env.meta } };
}
