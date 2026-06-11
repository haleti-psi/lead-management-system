import { OutboxPublisherService } from './outbox-publisher.service';
import { MAX_PUBLISH_RETRIES, PUBLISHER_BATCH_SIZE } from './outbox.constants';
import type { EventPublisherPort, OutboxMessage } from './event-publisher.port';
import type { KyselyDb } from '../db';
import type { AppConfigService } from '../config';

/**
 * FR-141 unit tests for {@link OutboxPublisherService.runOnce} (LLD Path B; test
 * spec T04–T08, T11–T13). A live broker is never used — the
 * {@link EventPublisherPort} is a Jest mock (per integration-map.md). A small
 * in-memory `event_outbox` store backs a hand-rolled Kysely fake so that the
 * guarded `pending → published / failed` UPDATEs actually transition rows and the
 * `WHERE status='pending'` guard is honoured (needed for the at-least-once,
 * skip-non-pending, and concurrent-mark assertions).
 */

type OutboxStatus = 'pending' | 'published' | 'failed';

interface OutboxRow {
  event_id: string;
  event_code: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  schema_version: number;
  org_id: string;
  created_at: Date;
  status: OutboxStatus;
  published_at: Date | null;
  updated_at: Date;
}

let rowSeq = 0;
function seedRow(over: Partial<OutboxRow> = {}): OutboxRow {
  rowSeq += 1;
  return {
    event_id: `evt-${rowSeq}`,
    event_code: 'LEAD_CREATED',
    aggregate_type: 'Lead',
    aggregate_id: `agg-${rowSeq}`,
    payload: { k: 'v' },
    schema_version: 1,
    org_id: '00000000-0000-0000-0000-000000000001',
    created_at: new Date(Date.now() + rowSeq), // stable asc order by insertion
    status: 'pending',
    published_at: null,
    updated_at: new Date(),
    ...over,
  };
}

/**
 * In-memory Kysely fake supporting exactly the two query shapes the publisher
 * issues: the pending-rows SELECT (with status filter, asc order, LIMIT) and the
 * guarded status UPDATE (set + where event_id + where status). Returns the live
 * row objects so UPDATEs mutate the same store the next SELECT reads.
 */
function fakeDb(
  store: OutboxRow[],
  opts: { failFirstUpdate?: boolean } = {},
): { db: KyselyDb; selectLimits: number[] } {
  const selectLimits: number[] = [];
  let failNextUpdate = opts.failFirstUpdate ?? false;

  const db = {
    selectFrom(_table: string) {
      const filters: Array<(r: OutboxRow) => boolean> = [];
      let limit = Infinity;
      const builder = {
        select() {
          return builder;
        },
        where(column: keyof OutboxRow, _op: string, value: unknown) {
          filters.push((r) => r[column] === value);
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit(n: number) {
          limit = n;
          selectLimits.push(n);
          return builder;
        },
        async execute() {
          const matched = store
            .filter((r) => filters.every((f) => f(r)))
            .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
          return matched.slice(0, limit).map((r) => ({ ...r }));
        },
      };
      return builder;
    },
    updateTable(_table: string) {
      // Simulate a crash between publish and mark (at-least-once, T08): the first
      // UPDATE issued throws; later UPDATEs behave normally.
      const failThis = failNextUpdate;
      failNextUpdate = false;
      let patch: Partial<OutboxRow> = {};
      const guards: Array<(r: OutboxRow) => boolean> = [];
      const builder = {
        set(values: Partial<OutboxRow>) {
          patch = values;
          return builder;
        },
        where(column: keyof OutboxRow, _op: string, value: unknown) {
          guards.push((r) => r[column] === value);
          return builder;
        },
        async execute() {
          if (failThis) {
            throw new Error('connection reset');
          }
          let affected = 0;
          for (const r of store) {
            if (guards.every((g) => g(r))) {
              Object.assign(r, patch);
              affected += 1;
            }
          }
          return [{ numUpdatedRows: BigInt(affected) }];
        },
      };
      return builder;
    },
  } as unknown as KyselyDb;

  return { db, selectLimits };
}

/** A Jest-mock EventPublisherPort. */
function mockPublisher(): jest.Mocked<EventPublisherPort> {
  return { publish: jest.fn<Promise<void>, [OutboxMessage]>().mockResolvedValue(undefined) };
}

function fakeLogger() {
  return { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
}

/** NODE_ENV=test config so the bootstrap timer never starts (tests drive runOnce). */
const fakeConfig = { get: () => 'test', isProduction: false } as unknown as AppConfigService;

function makeService(store: OutboxRow[], publisher: EventPublisherPort) {
  const { db, selectLimits } = fakeDb(store);
  const service = new OutboxPublisherService(fakeLogger() as never, db, publisher, fakeConfig);
  return { service, selectLimits };
}

beforeEach(() => {
  rowSeq = 0;
});

describe('OutboxPublisherService.runOnce', () => {
  // T04 — polls pending rows and publishes each exactly once; all marked published.
  it('publishes every pending row and marks them published', async () => {
    const store = [seedRow(), seedRow(), seedRow()];
    const publisher = mockPublisher();
    const { service } = makeService(store, publisher);

    const result = await service.runOnce();

    expect(publisher.publish).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ published: 3, failed: 0, rescheduled: 0 });
    expect(store.every((r) => r.status === 'published')).toBe(true);
    expect(store.every((r) => r.published_at instanceof Date)).toBe(true);
    expect(service.publishedCount).toBe(3);
  });

  // T05 — pending → published transition: published_at set, status advanced.
  it('transitions a pending row to published with published_at set', async () => {
    const store = [seedRow()];
    const publisher = mockPublisher();
    const { service } = makeService(store, publisher);

    await service.runOnce();

    expect(store[0]?.status).toBe('published');
    expect(store[0]?.published_at).toBeInstanceOf(Date);
  });

  // T04 — the published Pub/Sub message carries the FR-141 wire shape + dedup key.
  it('builds a message keyed by event_id with the wire envelope and attributes', async () => {
    const store = [seedRow({ event_id: 'evt-X', event_code: 'LEAD_STAGE_CHANGED', schema_version: 1 })];
    const publisher = mockPublisher();
    const { service } = makeService(store, publisher);

    await service.runOnce();

    const msg = publisher.publish.mock.calls[0]?.[0] as OutboxMessage;
    expect(msg.eventId).toBe('evt-X');
    expect(msg.data.event_id).toBe('evt-X');
    expect(msg.data.event_code).toBe('LEAD_STAGE_CHANGED');
    expect(typeof msg.data.created_at).toBe('string'); // ISO-serialised
    expect(msg.attributes).toEqual({
      event_code: 'LEAD_STAGE_CHANGED',
      aggregate_type: 'Lead',
      schema_version: '1',
    });
  });

  // T06 — exhausted retries: pending → failed; dead-letter counter increments.
  it('marks a row failed after MAX_PUBLISH_RETRIES and increments the dead-letter counter', async () => {
    const store = [seedRow()];
    const publisher = mockPublisher();
    publisher.publish.mockRejectedValue(new Error('pubsub 503'));
    const { service } = makeService(store, publisher);

    // Each runOnce is one attempt per row (LLD: one attempt per cycle).
    for (let i = 0; i < MAX_PUBLISH_RETRIES - 1; i += 1) {
      const r = await service.runOnce();
      expect(r).toEqual({ published: 0, failed: 0, rescheduled: 1 });
      expect(store[0]?.status).toBe('pending'); // below threshold ⇒ stays pending
    }

    const last = await service.runOnce();
    expect(last).toEqual({ published: 0, failed: 1, rescheduled: 0 });
    expect(store[0]?.status).toBe('failed');
    expect(service.deadLetterCount).toBe(1);
  });

  // T06 — once failed, the row is NOT re-attempted on the next cycle.
  it('does not re-attempt a row once it is failed', async () => {
    const store = [seedRow()];
    const publisher = mockPublisher();
    publisher.publish.mockRejectedValue(new Error('pubsub 503'));
    const { service } = makeService(store, publisher);

    for (let i = 0; i < MAX_PUBLISH_RETRIES; i += 1) {
      await service.runOnce();
    }
    const callsAtFailure = publisher.publish.mock.calls.length;
    expect(store[0]?.status).toBe('failed');

    await service.runOnce(); // row is now 'failed' → not selected
    expect(publisher.publish).toHaveBeenCalledTimes(callsAtFailure);
  });

  // T07 — transient failure leaves the row pending; next cycle succeeds → published.
  it('leaves a row pending after a transient failure, then publishes it next cycle', async () => {
    const store = [seedRow()];
    const publisher = mockPublisher();
    publisher.publish.mockRejectedValueOnce(new Error('transient timeout'));
    const { service } = makeService(store, publisher);

    const first = await service.runOnce();
    expect(first).toEqual({ published: 0, failed: 0, rescheduled: 1 });
    expect(store[0]?.status).toBe('pending');
    expect(store[0]?.published_at).toBeNull();

    const second = await service.runOnce();
    expect(second).toEqual({ published: 1, failed: 0, rescheduled: 0 });
    expect(store[0]?.status).toBe('published');
  });

  // T08 — at-least-once: crash (markPublished throws) after a successful publish
  // leaves the row pending, so the next cycle re-publishes; it eventually marks published.
  it('re-publishes on the next cycle when markPublished fails (at-least-once)', async () => {
    const store = [seedRow()];
    const publisher = mockPublisher(); // publish always succeeds

    // First UPDATE (the markPublished) throws — simulating a crash between a
    // successful publish and the status write. Later cycles mark normally.
    const { db } = fakeDb(store, { failFirstUpdate: true });
    const service = new OutboxPublisherService(fakeLogger() as never, db, publisher, fakeConfig);

    // Cycle 1: publish ok but mark throws → relay error bubbles; row still pending.
    await expect(service.runOnce()).rejects.toThrow('connection reset');
    expect(store[0]?.status).toBe('pending');
    expect(publisher.publish).toHaveBeenCalledTimes(1);

    // Cycle 2: same row re-selected and re-published (duplicate — consumer dedups
    // on event_id), and this time the mark succeeds.
    const second = await service.runOnce();
    expect(publisher.publish).toHaveBeenCalledTimes(2);
    expect(second.published).toBe(1);
    expect(store[0]?.status).toBe('published');
  });

  // T11 — LIMIT is applied to the SELECT (NFR list-query rule + batch size).
  it('selects at most PUBLISHER_BATCH_SIZE rows; the rest stay pending', async () => {
    const store = Array.from({ length: PUBLISHER_BATCH_SIZE + 100 }, () => seedRow());
    const publisher = mockPublisher();
    const { service, selectLimits } = makeService(store, publisher);

    const result = await service.runOnce();

    expect(selectLimits).toContain(PUBLISHER_BATCH_SIZE);
    expect(publisher.publish).toHaveBeenCalledTimes(PUBLISHER_BATCH_SIZE);
    expect(result.published).toBe(PUBLISHER_BATCH_SIZE);
    const stillPending = store.filter((r) => r.status === 'pending').length;
    expect(stillPending).toBe(100);
  });

  // T12 — only pending rows are processed (published / failed are skipped).
  it('processes only pending rows and leaves published/failed rows untouched', async () => {
    const published = seedRow({ status: 'published', published_at: new Date() });
    const failed = seedRow({ status: 'failed' });
    const pending = seedRow();
    const store = [published, failed, pending];
    const publisher = mockPublisher();
    const { service } = makeService(store, publisher);

    await service.runOnce();

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const msg = publisher.publish.mock.calls[0]?.[0] as OutboxMessage;
    expect(msg.eventId).toBe(pending.event_id);
    expect(published.status).toBe('published');
    expect(failed.status).toBe('failed');
    expect(pending.status).toBe('published');
  });

  // T13 — markPublished is guarded by WHERE status='pending': a second concurrent
  // mark on an already-published row affects 0 rows (no double-mark / clobber).
  it('guards markPublished with WHERE status=pending so a second mark affects no row', async () => {
    const store = [seedRow()];
    const publisher = mockPublisher();
    const { service } = makeService(store, publisher);

    // First publisher instance wins the row.
    await service.runOnce();
    expect(store[0]?.status).toBe('published');
    const firstPublishedAt = store[0]?.published_at;

    // A second instance over the same store re-runs; the row is no longer pending,
    // so it is not even selected — and were a stale mark to fire, the WHERE guard
    // would match 0 rows. Either way: no re-publish, published_at unchanged.
    const second = makeService(store, publisher).service;
    const result = await second.runOnce();
    expect(result).toEqual({ published: 0, failed: 0, rescheduled: 0 });
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(store[0]?.published_at).toBe(firstPublishedAt);
  });

  // Path B step 1 — an empty queue is a no-op (no publish, zeroed counters).
  it('is a no-op when there are no pending rows', async () => {
    const store: OutboxRow[] = [];
    const publisher = mockPublisher();
    const { service } = makeService(store, publisher);

    const result = await service.runOnce();

    expect(publisher.publish).not.toHaveBeenCalled();
    expect(result).toEqual({ published: 0, failed: 0, rescheduled: 0 });
  });
});
