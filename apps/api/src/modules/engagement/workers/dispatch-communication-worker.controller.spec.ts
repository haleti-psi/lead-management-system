import 'reflect-metadata';

import { IS_PUBLIC_KEY } from '../../../core/auth';
import { DispatchCommunicationWorkerController } from './dispatch-communication-worker.controller';
import type { DispatchCommunicationWorker } from './dispatch-communication.worker';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMM_LOG_ID = '00000000-0000-0000-0004-000000000001';

function makeController() {
  const worker: Partial<DispatchCommunicationWorker> = {
    run: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new DispatchCommunicationWorkerController(
    worker as DispatchCommunicationWorker,
  );
  return { controller, worker };
}

// ── Metadata ──────────────────────────────────────────────────────────────────

describe('DispatchCommunicationWorkerController metadata', () => {
  it('is @Public (exempt from JwtAuthGuard — protected by InternalTaskGuard instead)', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, DispatchCommunicationWorkerController)).toBe(true);
  });
});

// ── Dispatch handler ──────────────────────────────────────────────────────────

describe('DispatchCommunicationWorkerController.dispatch', () => {
  it('delegates to worker.run and returns void', async () => {
    const { controller, worker } = makeController();

    const result = await controller.dispatch({ communication_log_id: COMM_LOG_ID });

    expect(worker.run).toHaveBeenCalledWith({ communication_log_id: COMM_LOG_ID });
    expect(result).toBeUndefined();
  });
});
