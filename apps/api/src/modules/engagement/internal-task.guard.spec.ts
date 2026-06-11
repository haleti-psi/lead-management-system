import type { ExecutionContext } from '@nestjs/common';

import { AppConfigService } from '../../core/config';
import { isDomainException } from '../../core/http';
import { CLOUD_TASKS_QUEUE_HEADER, InternalTaskGuard } from './internal-task.guard';

/**
 * FR-104 unit tests for {@link InternalTaskGuard} (TC-026): the internal sweep
 * endpoint accepts ONLY requests bearing the configured Cloud Tasks queue header.
 * A request with a user JWT (no queue header) is rejected — and rejected as
 * NOT_FOUND so the route is not discoverable.
 */

const QUEUE = 'sla-sweep-queue';

function config(): AppConfigService {
  return { get: (key: string) => (key === 'CLOUD_TASKS_QUEUE' ? QUEUE : undefined) } as unknown as AppConfigService;
}

function ctxWithHeaders(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('InternalTaskGuard', () => {
  it('allows a request carrying the matching Cloud Tasks queue header', () => {
    const guard = new InternalTaskGuard(config());
    expect(guard.canActivate(ctxWithHeaders({ [CLOUD_TASKS_QUEUE_HEADER]: QUEUE }))).toBe(true);
  });

  it('rejects a request without the queue header (e.g. a user JWT call) as NOT_FOUND (TC-026)', () => {
    const guard = new InternalTaskGuard(config());
    try {
      guard.canActivate(ctxWithHeaders({ authorization: 'Bearer user.jwt.token' }));
      fail('expected rejection');
    } catch (err) {
      expect(isDomainException(err) && err.code).toBe('NOT_FOUND');
    }
  });

  it('rejects a request whose queue header does not match the configured queue', () => {
    const guard = new InternalTaskGuard(config());
    expect(() => guard.canActivate(ctxWithHeaders({ [CLOUD_TASKS_QUEUE_HEADER]: 'wrong-queue' }))).toThrow();
  });
});
