import { AuditAction } from '@lms/shared';

import { UnitOfWork } from '../../core/db';
import { FakeAudit } from './auth.test-helpers';
import { BreakGlassExpiryJob } from './break-glass-expiry.job';
import { BreakGlassRepository } from './break-glass.repository';
import { SYSTEM_USER_ID } from './identity.constants';

/**
 * FR-003 expiry-sweep tests (T15, T16). The job's `runOnce` is driven directly
 * (the interval is disabled under NODE_ENV=test); the repository and audit are
 * fakes and the UnitOfWork mock runs the callback with a sentinel tx so the
 * expire+audit grouping is asserted without a DB.
 */

function fakeUow(): UnitOfWork {
  return {
    run: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ __tx: true })),
  } as unknown as UnitOfWork;
}

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
}

interface Harness {
  job: BreakGlassExpiryJob;
  expireDue: jest.Mock;
  audit: FakeAudit;
}

function harness(dueIds: string[]): Harness {
  const expireDue = jest.fn(async () => dueIds);
  const repo = { expireDue } as unknown as BreakGlassRepository;
  const audit = new FakeAudit();
  const config = { get: jest.fn(() => 'test') } as never;
  const job = new BreakGlassExpiryJob(makeLogger(), repo, audit.asAppender(), fakeUow(), config);
  return { job, expireDue, audit };
}

describe('BreakGlassExpiryJob.runOnce', () => {
  it('expires due grants and audits grant_expired for each (T15)', async () => {
    const { job, expireDue, audit } = harness(['grant-a', 'grant-b']);

    const result = await job.runOnce();

    expect(result.expired).toBe(2);
    // Swept as the reserved system actor.
    expect(expireDue).toHaveBeenCalledWith(SYSTEM_USER_ID, expect.any(Date), { __tx: true });
    const audits = audit.ofAction(AuditAction.BREAK_GLASS_ACCESS);
    expect(audits).toHaveLength(2);
    expect(audits.map((e) => e.entity_id)).toEqual(['grant-a', 'grant-b']);
    expect(audits[0]?.detail).toMatchObject({ event: 'grant_expired' });
    expect(audits[0]?.actor_id).toBe(SYSTEM_USER_ID);
  });

  it('does nothing and writes no audit when no grants are due (T16)', async () => {
    const { job, audit } = harness([]);

    const result = await job.runOnce();

    expect(result.expired).toBe(0);
    expect(audit.entries).toHaveLength(0);
  });
});
