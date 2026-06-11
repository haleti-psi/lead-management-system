import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import type { Logger } from 'nestjs-pino';

import type { ApiEnvelope } from '@lms/shared';

import { AllExceptionsFilter } from './all-exceptions.filter';
import { CORRELATION_ID_KEY } from './correlation.constants';
import { DomainException } from './domain-exception';

interface Captured {
  status: number;
  body: ApiEnvelope<null>;
}

function invoke(filter: AllExceptionsFilter, exception: unknown, correlationId = 'corr_abc'): Captured {
  const captured: Partial<Captured> = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: ApiEnvelope<null>) {
      captured.body = body;
      return this;
    },
    setHeader: (): void => undefined,
    getHeader: (): undefined => undefined,
  };
  const req = { [CORRELATION_ID_KEY]: correlationId, headers: {} };
  const host = {
    switchToHttp: () => ({
      getRequest: <T>(): T => req as T,
      getResponse: <T>(): T => res as T,
    }),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test host is a structural stub
  filter.catch(exception, host as any);
  return captured as Captured;
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let errorSpy: jest.Mock;

  beforeEach(() => {
    errorSpy = jest.fn();
    const logger = { error: errorSpy } as unknown as Logger;
    filter = new AllExceptionsFilter(logger);
  });

  it('maps a 403 HttpException to the FORBIDDEN taxonomy code with correct status', () => {
    const { status, body } = invoke(filter, new ForbiddenException());
    expect(status).toBe(HttpStatus.FORBIDDEN);
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(body.error?.retryable).toBe(false);
    expect(body.data).toBeNull();
    expect(body.meta.correlation_id).toBe('corr_abc');
  });

  it('renders a DomainException with its code, status, retryable flag and detail', () => {
    const exception = new DomainException('CONFLICT', 'Strong duplicate', {
      detail: { reason: 'DUPLICATE_BLOCKED' },
    });
    const { status, body } = invoke(filter, exception);
    expect(status).toBe(HttpStatus.CONFLICT);
    expect(body.error).toMatchObject({
      code: 'CONFLICT',
      message: 'Strong duplicate',
      retryable: false,
      detail: { reason: 'DUPLICATE_BLOCKED' },
    });
  });

  it('marks UPSTREAM_UNAVAILABLE as retryable', () => {
    const { status, body } = invoke(filter, new DomainException('UPSTREAM_UNAVAILABLE'));
    expect(status).toBe(503);
    expect(body.error?.retryable).toBe(true);
  });

  it('maps a VALIDATION_ERROR DomainException to 400 with fields', () => {
    const { status, body } = invoke(
      filter,
      new DomainException('VALIDATION_ERROR', undefined, {
        fields: [{ field: 'mobile', issue: 'invalid' }],
      }),
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(body.error?.fields).toEqual([{ field: 'mobile', issue: 'invalid' }]);
  });

  it('maps an unknown error to INTERNAL_ERROR/500, logs it, and leaks no stack/message', () => {
    const { status, body } = invoke(filter, new Error('connect ECONNREFUSED 10.0.0.3:5432 at Pool.query'));
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.error?.code).toBe('INTERNAL_ERROR');
    expect(body.error?.message).toBe("Something went wrong. We're on it.");
    // No raw error text, stack, SQL, or host:port in the client payload.
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(body)).not.toContain('5432');
    // Unexpected errors are logged server-side with the correlation id.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({ correlation_id: 'corr_abc' });
  });

  it('does not echo internal text for a 500 HttpException', () => {
    const { status, body } = invoke(
      filter,
      new HttpException('Internal pool name lms-prod-instance', HttpStatus.INTERNAL_SERVER_ERROR),
    );
    expect(status).toBe(500);
    expect(body.error?.code).toBe('INTERNAL_ERROR');
    expect(body.error?.message).toBe("Something went wrong. We're on it.");
    expect(JSON.stringify(body)).not.toContain('lms-prod-instance');
  });
});
