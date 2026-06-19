/**
 * FR-115 — RetentionSweepController (autonomous Cloud Tasks sweep).
 *
 * The controller is thin: it generates a run id, delegates to
 * RetentionEngine.sweepAllOrgs, and returns the org count. Auth (InternalTaskGuard
 * + @Public) is covered by internal-task.guard.spec.ts; the all-orgs enumeration
 * + per-org resilience is covered in retention.engine.spec.ts.
 */
import type { PinoLogger } from 'nestjs-pino';

import type { CorrelatedRequest } from '../../core/http';
import { RetentionSweepController } from './retention-sweep.controller';
import type { RetentionEngine } from './retention.engine';

function buildController(sweep = jest.fn().mockResolvedValue({ orgsSwept: 3 })): {
  controller: RetentionSweepController;
  sweep: jest.Mock;
} {
  const engine = { sweepAllOrgs: sweep } as unknown as RetentionEngine;
  const logger = { info: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
  return { controller: new RetentionSweepController(engine, logger), sweep };
}

const REQ = { headers: {} } as unknown as CorrelatedRequest;

describe('RetentionSweepController', () => {
  it('delegates to the all-orgs sweep and returns the org count with a run id', async () => {
    const { controller, sweep } = buildController();

    const res = await controller.run(REQ);

    expect(sweep).toHaveBeenCalledTimes(1);
    expect(res.orgsSwept).toBe(3);
    expect(res.runId).toEqual(expect.any(String));
    // the generated run id is the one handed to the engine
    expect(sweep).toHaveBeenCalledWith(res.runId);
  });

  it('generates a distinct run id per invocation', async () => {
    const { controller } = buildController();

    const a = await controller.run(REQ);
    const b = await controller.run(REQ);

    expect(a.runId).not.toBe(b.runId);
  });
});
