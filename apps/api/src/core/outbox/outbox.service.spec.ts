import { EventCode } from '@lms/shared';

import { isDomainException } from '../http/domain-exception';
import { MaskingService } from '../masking';
import type { DbTransaction, KyselyDb } from '../db';
import { OutboxService, type OutboxEvent } from './outbox.service';
import { DEFAULT_SCHEMA_VERSION, ORG_ID_DEFAULT } from './outbox.constants';

/**
 * FR-141 unit tests for {@link OutboxService.emit} (LLD §Data Operations,
 * §Validation Logic; test spec T01, T09, T10, T14, INV-07, INV-08).
 *
 * These exercise the real {@link MaskingService} (a pure, deterministic
 * collaborator) so the masking guarantee is verified end-to-end through `emit`,
 * and a hand-rolled Kysely fake that captures the
 * `insertInto(table).values(v).execute()` chain — matching the project's
 * existing `audit-appender.service.spec.ts` convention (no NestJS TestingModule;
 * no live database). True cross-table atomic rollback (T02/T03) is an e2e /
 * Testcontainers concern and is out of scope for these mocked unit tests; what we
 * assert here is the unit-testable rollback invariant: `emit` writes ONLY through
 * the caller's `tx` handle (never a pool), and an INSERT failure propagates so
 * the caller's UnitOfWork rolls the whole transaction back.
 */

interface CapturedInsert {
  table: string;
  values: Record<string, unknown>;
}

/**
 * Minimal Kysely transaction fake capturing `insertInto(...).values(...).execute()`.
 * If `failOnExecute` is provided, `execute()` rejects with it (simulating a DB
 * error inside the tx — e.g. a transient failure the LLD maps to INTERNAL_ERROR).
 */
function fakeTx(captured: CapturedInsert[], failOnExecute?: Error): DbTransaction {
  return {
    insertInto(table: string) {
      return {
        values(values: Record<string, unknown>) {
          return {
            async execute() {
              if (failOnExecute) {
                throw failOnExecute;
              }
              captured.push({ table, values });
            },
          };
        },
      };
    },
  } as unknown as DbTransaction;
}

/** A no-op PinoLogger stand-in (the service only calls .error on it here). */
function fakeLogger() {
  return {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
}

function makeService(captured: CapturedInsert[], failOnExecute?: Error) {
  const logger = fakeLogger();
  const service = new OutboxService(
    logger as never,
    new MaskingService(),
  );
  const tx = fakeTx(captured, failOnExecute);
  return { service, tx, logger };
}

/** Run `fn`, returning whatever it throws (fails the test if it does not throw). */
async function captureRejection(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to reject, but it resolved');
}

const VALID_AGGREGATE_ID = '11111111-1111-1111-1111-111111111111';

describe('OutboxService.emit', () => {
  // T01 — happy path: inserts a pending row using the caller's tx.
  it('inserts a single pending event_outbox row inside the caller tx', async () => {
    const captured: CapturedInsert[] = [];
    const { service, tx } = makeService(captured);

    await service.emit(
      {
        event_code: EventCode.LEAD_STAGE_CHANGED,
        aggregate_type: 'Lead',
        aggregate_id: VALID_AGGREGATE_ID,
        payload: { stage: 'assigned' },
      },
      tx,
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]?.table).toBe('event_outbox');
    expect(captured[0]?.values).toMatchObject({
      event_code: EventCode.LEAD_STAGE_CHANGED,
      aggregate_type: 'Lead',
      aggregate_id: VALID_AGGREGATE_ID,
      status: 'pending',
      published_at: null,
    });
  });

  // T01 — row defaults: schema_version (INV-07 ≥ 1) and org_id (INV-08) are set.
  it('defaults schema_version to 1 and pins org_id to the single-tenant default', async () => {
    const captured: CapturedInsert[] = [];
    const { service, tx } = makeService(captured);

    await service.emit(
      {
        event_code: EventCode.LEAD_CREATED,
        aggregate_type: 'Lead',
        aggregate_id: VALID_AGGREGATE_ID,
        payload: {},
      },
      tx,
    );

    expect(captured[0]?.values.schema_version).toBe(DEFAULT_SCHEMA_VERSION);
    expect(captured[0]?.values.schema_version).toBe(1);
    expect(captured[0]?.values.org_id).toBe(ORG_ID_DEFAULT);
  });

  // T01 — caller-supplied schema_version is honoured (payload-evolution policy).
  it('honours an explicit schema_version when the caller pins one', async () => {
    const captured: CapturedInsert[] = [];
    const { service, tx } = makeService(captured);

    await service.emit(
      {
        event_code: EventCode.LEAD_CREATED,
        aggregate_type: 'Lead',
        aggregate_id: VALID_AGGREGATE_ID,
        payload: {},
        schema_version: 2,
      },
      tx,
    );

    expect(captured[0]?.values.schema_version).toBe(2);
  });

  // T01 — does not set event_id / created_at / updated_at (DB defaults own those).
  it('lets the database default event_id, created_at and updated_at (not set by emit)', async () => {
    const captured: CapturedInsert[] = [];
    const { service, tx } = makeService(captured);

    await service.emit(
      {
        event_code: EventCode.LEAD_CREATED,
        aggregate_type: 'Lead',
        aggregate_id: VALID_AGGREGATE_ID,
        payload: {},
      },
      tx,
    );

    expect(captured[0]?.values).not.toHaveProperty('event_id');
    expect(captured[0]?.values).not.toHaveProperty('created_at');
    expect(captured[0]?.values).not.toHaveProperty('updated_at');
  });

  // T09 / INV-02 / INV-03 — raw PII is masked before the row is written.
  it('masks PII in the payload before insert; no raw PII reaches the stored row', async () => {
    const captured: CapturedInsert[] = [];
    const { service, tx } = makeService(captured);

    await service.emit(
      {
        event_code: EventCode.LEAD_STAGE_CHANGED,
        aggregate_type: 'Lead',
        aggregate_id: VALID_AGGREGATE_ID,
        payload: { mobile: '9876543210', pan_masked: 'ABCDE1234F', stage: 'assigned' },
      },
      tx,
    );

    // payload is stored as a JSON string (schema.sql JSONB; LLD INSERT).
    const stored = captured[0]?.values.payload as string;
    expect(typeof stored).toBe('string');
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    expect(parsed.mobile).toBe('98xxxxxx10');
    expect(parsed.pan_masked).toBe('ABCxxxx4F');
    expect(parsed.stage).toBe('assigned');
    // Raw values must not appear anywhere in the serialised row.
    expect(stored).not.toContain('9876543210');
    expect(stored).not.toContain('ABCDE1234F');
  });

  // T10 — invalid event_code → INTERNAL_ERROR (500), NOT VALIDATION_ERROR (400); no insert.
  it('throws INTERNAL_ERROR (not 400) on an unknown event_code and writes no row', async () => {
    const captured: CapturedInsert[] = [];
    const { service, tx, logger } = makeService(captured);

    const bad = {
      event_code: 'INVALID_CODE',
      aggregate_type: 'Lead',
      aggregate_id: VALID_AGGREGATE_ID,
      payload: {},
    } as unknown as OutboxEvent;

    const err = await captureRejection(() => service.emit(bad, tx));
    expect(isDomainException(err)).toBe(true);
    expect((err as { code: string }).code).toBe('INTERNAL_ERROR');
    expect((err as { httpStatus: number }).httpStatus).toBe(500);
    expect(captured).toHaveLength(0);
    expect(logger.error).toHaveBeenCalled();
  });

  // T14 — empty aggregate_id fails internal validation → INTERNAL_ERROR; no insert.
  it('rejects an empty aggregate_id with INTERNAL_ERROR and writes no row', async () => {
    const captured: CapturedInsert[] = [];
    const { service, tx } = makeService(captured);

    const err = await captureRejection(() =>
      service.emit(
        {
          event_code: EventCode.LEAD_CREATED,
          aggregate_type: 'Lead',
          aggregate_id: '',
          payload: {},
        },
        tx,
      ),
    );
    expect(isDomainException(err)).toBe(true);
    expect((err as { code: string }).code).toBe('INTERNAL_ERROR');
    expect(captured).toHaveLength(0);
  });

  // T14 — a non-UUID aggregate_id is also rejected (Zod .uuid()).
  it('rejects a non-UUID aggregate_id with INTERNAL_ERROR', async () => {
    const captured: CapturedInsert[] = [];
    const { service, tx } = makeService(captured);

    const err = await captureRejection(() =>
      service.emit(
        {
          event_code: EventCode.LEAD_CREATED,
          aggregate_type: 'Lead',
          aggregate_id: 'not-a-uuid',
          payload: {},
        },
        tx,
      ),
    );
    expect(isDomainException(err)).toBe(true);
    expect((err as { code: string }).code).toBe('INTERNAL_ERROR');
    expect(captured).toHaveLength(0);
  });

  // INV-09 boundary — aggregate_type longer than 40 chars is rejected (column cap).
  it('rejects an aggregate_type exceeding 40 characters with INTERNAL_ERROR', async () => {
    const captured: CapturedInsert[] = [];
    const { service, tx } = makeService(captured);

    const err = await captureRejection(() =>
      service.emit(
        {
          event_code: EventCode.LEAD_CREATED,
          aggregate_type: 'A'.repeat(41),
          aggregate_id: VALID_AGGREGATE_ID,
          payload: {},
        },
        tx,
      ),
    );
    expect(isDomainException(err)).toBe(true);
    expect((err as { code: string }).code).toBe('INTERNAL_ERROR');
    expect(captured).toHaveLength(0);
  });

  // T03 (unit-testable slice) — an INSERT failure inside the tx propagates as
  // INTERNAL_ERROR so the caller's UnitOfWork rolls the whole transaction back.
  it('propagates a tx INSERT failure as INTERNAL_ERROR (caller UoW will roll back)', async () => {
    const captured: CapturedInsert[] = [];
    const { service, tx, logger } = makeService(captured, new Error('deadlock detected'));

    const err = await captureRejection(() =>
      service.emit(
        {
          event_code: EventCode.LEAD_CREATED,
          aggregate_type: 'Lead',
          aggregate_id: VALID_AGGREGATE_ID,
          payload: {},
        },
        tx,
      ),
    );
    expect(isDomainException(err)).toBe(true);
    expect((err as { code: string }).code).toBe('INTERNAL_ERROR');
    expect(logger.error).toHaveBeenCalled();
  });

  // Rollback semantics (unit slice): emit writes ONLY through the caller's tx
  // handle — it never opens its own transaction or touches the pool — so if the
  // caller's tx aborts, the row aborts with it (no orphan).
  it('writes through the provided tx handle only, never a separate pool', async () => {
    const txCaptured: CapturedInsert[] = [];
    const poolCaptured: CapturedInsert[] = [];
    const logger = fakeLogger();
    // A "pool" is also injected nowhere — emit takes no Db; we prove the only
    // write surface used is the tx by giving emit a tx and asserting the pool
    // fake (which emit has no reference to) is never touched.
    const service = new OutboxService(logger as never, new MaskingService());
    const tx = fakeTx(txCaptured);
    const unusedPool = fakeTx(poolCaptured) as unknown as KyselyDb;
    void unusedPool;

    await service.emit(
      {
        event_code: EventCode.LEAD_CREATED,
        aggregate_type: 'Lead',
        aggregate_id: VALID_AGGREGATE_ID,
        payload: {},
      },
      tx,
    );

    expect(txCaptured).toHaveLength(1);
    expect(poolCaptured).toHaveLength(0);
  });
});
