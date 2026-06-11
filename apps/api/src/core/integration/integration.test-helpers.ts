import type Redis from 'ioredis';

import type { DbTransaction } from '../db';
import type {
  IntegrationPort,
  IntegrationRequest,
} from './ports/integration-port';
import type { ProviderResponse } from './ports/provider-response';
import type {
  CreateLogParams,
  IntegrationLogRow,
  UpdateLogParams,
} from './integration-log.repository';
import type {
  DeadLetterTask,
  RetryQueuePort,
  RetryTask,
} from './retry-queue.port';

/**
 * Test-only doubles for the FR-140 integration framework. In-memory and fully
 * typed (no `any`), so the gateway/service/guard can be exercised without
 * Redis/Postgres/GCP — matching the project's `*.test-helpers.ts` convention
 * (see `auth.test-helpers.ts`). Never wired into the Nest container.
 */

/**
 * A minimal in-memory Redis supporting only the hash/counter/expire surface the
 * gateway and service use: `hgetall`, `hset` (object or field/value), `expire`,
 * `incr`, `del`. Enough to assert idempotency + circuit-breaker behaviour
 * deterministically.
 */
export class FakeRedis {
  store = new Map<string, Map<string, string>>();
  /** Records keys an `expire` TTL was set on (for assertions). */
  expiries = new Map<string, number>();

  private hash(key: string): Map<string, string> {
    let h = this.store.get(key);
    if (!h) {
      h = new Map<string, string>();
      this.store.set(key, h);
    }
    return h;
  }

  hgetall = jest.fn(async (key: string): Promise<Record<string, string>> => {
    const h = this.store.get(key);
    if (!h) return {};
    return Object.fromEntries(h.entries());
  });

  hset = jest.fn(
    async (key: string, fieldOrObj: string | Record<string, string>, value?: string): Promise<number> => {
      const h = this.hash(key);
      if (typeof fieldOrObj === 'string') {
        h.set(fieldOrObj, value ?? '');
      } else {
        for (const [k, v] of Object.entries(fieldOrObj)) {
          h.set(k, v);
        }
      }
      return 1;
    },
  );

  incr = jest.fn(async (key: string): Promise<number> => {
    const h = this.hash(key);
    const current = Number(h.get('__counter') ?? '0') + 1;
    h.set('__counter', String(current));
    return current;
  });

  expire = jest.fn(async (key: string, seconds: number): Promise<number> => {
    this.expiries.set(key, seconds);
    return 1;
  });

  del = jest.fn(async (...keys: string[]): Promise<number> => {
    let n = 0;
    for (const key of keys) {
      if (this.store.delete(key)) n += 1;
    }
    return n;
  });

  /** Directly seed a hash (for replay/circuit-open setups). */
  seed(key: string, fields: Record<string, string>): void {
    const h = this.hash(key);
    for (const [k, v] of Object.entries(fields)) h.set(k, v);
  }

  /** Seed an incr-style counter at a given value. */
  seedCounter(key: string, value: number): void {
    this.hash(key).set('__counter', String(value));
  }

  asRedis(): Redis {
    return this as unknown as Redis;
  }
}

/** In-memory {@link IntegrationLogRepository} fake recording every call. */
export class FakeIntegrationLogRepo {
  created: CreateLogParams[] = [];
  failFast: Array<{ params: CreateLogParams; errorCode: string }> = [];
  updates: Array<{ logId: string; params: UpdateLogParams }> = [];
  private seq = 0;

  createLog = jest.fn(async (params: CreateLogParams): Promise<IntegrationLogRow> => {
    this.created.push(params);
    this.seq += 1;
    return { integration_log_id: `log-${this.seq}` };
  });

  createFailFastLog = jest.fn(
    async (params: CreateLogParams, errorCode: string): Promise<IntegrationLogRow> => {
      this.failFast.push({ params, errorCode });
      this.seq += 1;
      return { integration_log_id: `log-ff-${this.seq}` };
    },
  );

  updateLogStatus = jest.fn(async (logId: string, params: UpdateLogParams): Promise<void> => {
    this.updates.push({ logId, params });
  });

  /** The last status written to a given log id (or undefined). */
  lastStatusFor(logId: string): UpdateLogParams | undefined {
    return [...this.updates].reverse().find((u) => u.logId === logId)?.params;
  }
}

/** In-memory {@link RetryQueuePort} fake capturing enqueues. */
export class FakeRetryQueue implements RetryQueuePort {
  retries: RetryTask[] = [];
  deadLetters: DeadLetterTask[] = [];

  enqueueRetry = jest.fn(async (task: RetryTask): Promise<void> => {
    this.retries.push(task);
  });
  enqueueDeadLetter = jest.fn(async (task: DeadLetterTask): Promise<void> => {
    this.deadLetters.push(task);
  });
}

/**
 * A programmable {@link IntegrationPort} test double. Configure it to return a
 * status, throw a {@link ProviderCallError}, or count its invocations.
 */
export class FakePort implements IntegrationPort {
  calls = 0;
  constructor(
    private readonly behaviour: {
      status?: number;
      body?: unknown;
      throwError?: Error;
    } = {},
  ) {}

  call = jest.fn(async (_request: IntegrationRequest): Promise<ProviderResponse> => {
    this.calls += 1;
    if (this.behaviour.throwError) {
      throw this.behaviour.throwError;
    }
    return { httpStatus: this.behaviour.status ?? 200, body: this.behaviour.body ?? { ok: true } };
  });
}

/** A no-op pino logger stand-in (gateway/service only call warn/error/debug). */
export function fakePinoLogger() {
  return {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
  };
}

/** A UnitOfWork double that runs the callback with a sentinel transaction. */
export function fakeUow() {
  return {
    run: jest.fn(async (fn: (tx: DbTransaction) => Promise<unknown>) =>
      fn({ __tx: true } as unknown as DbTransaction),
    ),
  };
}
