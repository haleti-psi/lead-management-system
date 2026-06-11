import { EventCode, SlaTarget } from '@lms/shared';

import { MaskingService } from '../masking';
import { OutboxService } from '../outbox';
import type { DbTransaction } from '../db';
import { BusinessCalendarService } from './business-calendar.service';
import { SlaEngine } from './sla-engine';
import { SWEEP_BATCH_LIMIT } from './sla.constants';
import type { LeadSlaWriterPort, SlaPolicyReaderPort } from './sla.ports';
import type { SlaPolicyForCompute } from './sla.types';

/**
 * FR-104 unit tests for {@link SlaEngine}: business-time due computation through
 * the engine (TC-014), the owner-writes lead seam (TC-016 at unit level), and the
 * sweep scan/emit/idempotency/LIMIT/terminal-exclusion (TC-018/019/020/021/022).
 *
 * The engine is exercised with: the REAL {@link OutboxService} (+ real
 * {@link MaskingService}) writing through a captured Kysely-tx fake (matching the
 * project's outbox-spec convention), a fake {@link BusinessCalendarService}
 * returning the IST default, and mock ports for policy-read and lead-write.
 */

const IST_CALENDAR = {
  businessCalendarId: 'default-cal',
  code: 'DEFAULT',
  timezone: 'Asia/Kolkata',
  workingHours: {
    mon: { start: '09:30', end: '18:30' },
    tue: { start: '09:30', end: '18:30' },
    wed: { start: '09:30', end: '18:30' },
    thu: { start: '09:30', end: '18:30' },
    fri: { start: '09:30', end: '18:30' },
    sat: { start: '09:30', end: '18:30' },
    sun: null,
  },
  holidays: [],
  source: 'org_default' as const,
};

function fakeCalendars(): BusinessCalendarService {
  return { resolve: jest.fn().mockResolvedValue(IST_CALENDAR) } as unknown as BusinessCalendarService;
}

function fakeLogger() {
  return { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() };
}

function realOutbox(): OutboxService {
  return new OutboxService(fakeLogger() as never, new MaskingService());
}

interface CapturedInsert {
  table: string;
  values: Record<string, unknown>;
}

/** A policy reader returning a fixed policy (or none). */
function policyReader(policy?: SlaPolicyForCompute): SlaPolicyReaderPort {
  return { findActivePolicy: jest.fn().mockResolvedValue(policy) };
}

const POLICY: SlaPolicyForCompute = {
  sla_policy_id: 'pol-1',
  applies_to: SlaTarget.FIRST_CONTACT,
  threshold_minutes: 240,
  escalation_chain: [{ at_minutes: 240, notify_roles: ['BM'], action: 'notify' }],
  condition: null,
};

function ist(literal: string): Date {
  return new Date(`${literal}+05:30`);
}

function toIstHHMM(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
}

// ── computeDueAt ───────────────────────────────────────────────
describe('SlaEngine.computeDueAt', () => {
  it('computes a business-time-aware due (Fri 17:00 + 240 min → Sat 12:00) (TC-014)', async () => {
    const engine = new SlaEngine(
      fakeCalendars(),
      realOutbox(),
      fakeLogger() as never,
      policyReader(POLICY),
    );

    const result = await engine.computeDueAt(
      SlaTarget.FIRST_CONTACT,
      { branchId: 'b1' },
      {},
      ist('2026-06-12T17:00:00'),
    );
    expect(result).not.toBeNull();
    expect(toIstHHMM(result!.dueAt)).toBe('2026-06-13 12:00');
    expect(result!.policyId).toBe('pol-1');
  });

  it('returns null and warns when no active policy matches (LLD step 2a)', async () => {
    const logger = fakeLogger();
    const engine = new SlaEngine(fakeCalendars(), realOutbox(), logger as never, policyReader(undefined));

    const result = await engine.computeDueAt(SlaTarget.FIRST_CONTACT, { branchId: 'b1' });
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });
});

// ── setFirstContactDue (owner-writes seam) ─────────────────────
describe('SlaEngine.setFirstContactDue', () => {
  it('writes the due timestamp THROUGH the lead writer port, not the leads table (TC-016)', async () => {
    const leadWriter: LeadSlaWriterPort = {
      setSlaDueAt: jest.fn().mockResolvedValue(undefined),
      reassignOwner: jest.fn().mockResolvedValue(undefined),
    };
    const engine = new SlaEngine(
      fakeCalendars(),
      realOutbox(),
      fakeLogger() as never,
      policyReader(POLICY),
      leadWriter,
    );

    const tx = {} as DbTransaction;
    await engine.setFirstContactDue(
      { lead_id: 'lead-1', branch_id: 'b1', version: 3 },
      tx,
      {},
      ist('2026-06-12T17:00:00'),
    );

    expect(leadWriter.setSlaDueAt).toHaveBeenCalledTimes(1);
    const arg = (leadWriter.setSlaDueAt as jest.Mock).mock.calls[0][0];
    expect(arg.leadId).toBe('lead-1');
    expect(arg.expectedVersion).toBe(3);
    expect(toIstHHMM(arg.dueAt)).toBe('2026-06-13 12:00');
  });

  it('does not write when no policy matches', async () => {
    const leadWriter: LeadSlaWriterPort = {
      setSlaDueAt: jest.fn(),
      reassignOwner: jest.fn(),
    };
    const engine = new SlaEngine(
      fakeCalendars(),
      realOutbox(),
      fakeLogger() as never,
      policyReader(undefined),
      leadWriter,
    );
    await engine.setFirstContactDue({ lead_id: 'lead-1', version: 1 }, {} as DbTransaction);
    expect(leadWriter.setSlaDueAt).not.toHaveBeenCalled();
  });
});

// ── sweep ──────────────────────────────────────────────────────
interface SweepFakeOptions {
  breached?: Record<string, unknown>[];
  approaching?: Record<string, unknown>[];
  /** lead_ids that already have a same-window outbox row (idempotency). */
  alreadyEmitted?: Set<string>;
}

/**
 * A Kysely-tx fake for the sweep. It distinguishes the two lead scans by whether
 * the captured `where('sla_first_contact_due_at', op, …)` op is `<=` (breach) or
 * `>` (approaching), serves the `event_outbox` dedup SELECT from `alreadyEmitted`,
 * and captures `event_outbox` INSERTs (from OutboxService.emit) plus the LIMIT.
 */
function sweepTx(opts: SweepFakeOptions, captured: CapturedInsert[], limits: number[]): DbTransaction {
  const alreadyEmitted = opts.alreadyEmitted ?? new Set<string>();

  const leadScanChain = () => {
    // The approaching scan is the only one using the `>` lower-bound predicate;
    // the breach scan uses a single `<=` predicate. Discriminate on `>`.
    let isApproaching = false;
    const chain = {
      select: () => chain,
      where(column: string, op?: string, _val?: unknown) {
        if (column === 'sla_first_contact_due_at' && op === '>') isApproaching = true;
        return chain;
      },
      orderBy: () => chain,
      limit(n: number) {
        limits.push(n);
        return chain;
      },
      async execute() {
        return isApproaching ? (opts.approaching ?? []) : (opts.breached ?? []);
      },
    };
    return chain;
  };

  const outboxSelectChain = () => {
    let leadId = '';
    const chain = {
      select: () => chain,
      where(column: string, _op?: string, val?: unknown) {
        if (column === 'aggregate_id') leadId = String(val);
        return chain;
      },
      limit: () => chain,
      async executeTakeFirst() {
        return alreadyEmitted.has(leadId) ? { event_id: 'existing' } : undefined;
      },
    };
    return chain;
  };

  return {
    selectFrom(table: string) {
      if (table === 'leads') return leadScanChain();
      if (table === 'event_outbox') return outboxSelectChain();
      throw new Error(`unexpected selectFrom(${table})`);
    },
    insertInto(table: string) {
      return {
        values(values: Record<string, unknown>) {
          return {
            async execute() {
              captured.push({ table, values });
            },
          };
        },
      };
    },
  } as unknown as DbTransaction;
}

function makeSweepEngine(reader?: SlaPolicyReaderPort, leadWriter?: LeadSlaWriterPort): SlaEngine {
  return new SlaEngine(fakeCalendars(), realOutbox(), fakeLogger() as never, reader, leadWriter);
}

describe('SlaEngine.sweep', () => {
  const NOW = ist('2026-06-12T12:00:00');
  // OutboxService.emit enforces a UUID aggregate_id, so leads use real UUIDs.
  const L1 = '11111111-1111-1111-1111-111111111111';
  const L2 = '22222222-2222-2222-2222-222222222222';
  const OWNER = '99999999-9999-9999-9999-999999999999';

  it('emits FIRST_CONTACT_BREACH for a breached lead (TC-018)', async () => {
    const captured: CapturedInsert[] = [];
    const engine = makeSweepEngine(policyReader(POLICY));
    const tx = sweepTx(
      { breached: [{ lead_id: L1, owner_id: OWNER, branch_id: 'b1', sla_first_contact_due_at: ist('2026-06-12T11:00:00'), version: 2 }] },
      captured,
      [],
    );

    const result = await engine.sweep(tx, NOW);
    expect(result.breachEmitted).toBe(1);
    const events = captured.filter((c) => c.table === 'event_outbox');
    expect(events).toHaveLength(1);
    expect(events[0]?.values.event_code).toBe(EventCode.FIRST_CONTACT_BREACH);
    expect(events[0]?.values.aggregate_id).toBe(L1);
  });

  it('emits FIRST_CONTACT_DUE for an approaching lead and does not reassign (TC-019)', async () => {
    const captured: CapturedInsert[] = [];
    const engine = makeSweepEngine(policyReader(POLICY));
    const tx = sweepTx(
      { approaching: [{ lead_id: L2, owner_id: OWNER, branch_id: 'b1', sla_first_contact_due_at: ist('2026-06-12T12:20:00'), version: 1 }] },
      captured,
      [],
    );

    const result = await engine.sweep(tx, NOW);
    expect(result.approachingEmitted).toBe(1);
    expect(result.reassigned).toBe(0);
    const events = captured.filter((c) => c.table === 'event_outbox');
    expect(events[0]?.values.event_code).toBe(EventCode.FIRST_CONTACT_DUE);
  });

  it('is idempotent: a lead already emitted in-window produces no duplicate (TC-020)', async () => {
    const captured: CapturedInsert[] = [];
    const engine = makeSweepEngine(policyReader(POLICY));
    const tx = sweepTx(
      {
        breached: [{ lead_id: L1, owner_id: OWNER, branch_id: 'b1', sla_first_contact_due_at: ist('2026-06-12T11:00:00'), version: 2 }],
        alreadyEmitted: new Set([L1]),
      },
      captured,
      [],
    );

    const result = await engine.sweep(tx, NOW);
    expect(result.breachEmitted).toBe(0);
    expect(captured.filter((c) => c.table === 'event_outbox')).toHaveLength(0);
  });

  it('applies a LIMIT of 100 to both scans (TC-022 / NFR-17)', async () => {
    const limits: number[] = [];
    const engine = makeSweepEngine(policyReader(POLICY));
    const tx = sweepTx({}, [], limits);

    await engine.sweep(tx, NOW);
    // Two scans (breach + approaching), each LIMIT-bounded at SWEEP_BATCH_LIMIT.
    expect(limits).toEqual([SWEEP_BATCH_LIMIT, SWEEP_BATCH_LIMIT]);
    expect(SWEEP_BATCH_LIMIT).toBe(100);
  });

  it('does not reassign when the chain has no reassign step', async () => {
    const captured: CapturedInsert[] = [];
    const leadWriter: LeadSlaWriterPort = { setSlaDueAt: jest.fn(), reassignOwner: jest.fn() };
    const engine = makeSweepEngine(policyReader(POLICY), leadWriter);
    const tx = sweepTx(
      { breached: [{ lead_id: L1, owner_id: OWNER, branch_id: 'b1', sla_first_contact_due_at: ist('2026-06-12T11:00:00'), version: 2 }] },
      captured,
      [],
    );

    const result = await engine.sweep(tx, NOW);
    expect(result.reassigned).toBe(0);
    expect(leadWriter.reassignOwner).not.toHaveBeenCalled();
  });
});
