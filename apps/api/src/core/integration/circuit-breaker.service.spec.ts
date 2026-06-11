import { CircuitBreakerService } from './circuit-breaker.service';
import {
  CIRCUIT_BREAKER_THRESHOLD,
  REDIS_KEYS,
} from './integration.constants';
import { FakeRedis } from './integration.test-helpers';

/**
 * FR-140 unit tests for {@link CircuitBreakerService} (FR-140-tests.md T06–T08
 * at the service level). In-memory Redis fake — deterministic, no I/O.
 */
const KIND = 'los_handoff';

function make() {
  const redis = new FakeRedis();
  return { redis, breaker: new CircuitBreakerService(redis.asRedis()) };
}

describe('CircuitBreakerService', () => {
  it('reports closed (not open) when no state exists', async () => {
    const { breaker } = make();
    const decision = await breaker.check(KIND);
    expect(decision.open).toBe(false);
    expect(decision.state).toBeNull();
  });

  it('opens after the threshold of consecutive failures and reports open within the window', async () => {
    const { breaker } = make();
    let opened = false;
    for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i += 1) {
      opened = await breaker.recordFailure(KIND);
    }
    expect(opened).toBe(true);
    const decision = await breaker.check(KIND);
    expect(decision.open).toBe(true);
    expect(decision.state).toBe('open');
  });

  it('does not open before the threshold', async () => {
    const { breaker } = make();
    for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD - 1; i += 1) {
      const opened = await breaker.recordFailure(KIND);
      expect(opened).toBe(false);
    }
    expect((await breaker.check(KIND)).open).toBe(false);
  });

  it('transitions to half-open once the open window has elapsed', async () => {
    const { redis, breaker } = make();
    // Seed an open state whose window has already passed.
    redis.seed(REDIS_KEYS.circuitState(KIND), {
      state: 'open',
      opens_at: String(Date.now() - 1_000),
    });
    const decision = await breaker.check(KIND);
    expect(decision.open).toBe(false);
    expect(decision.state).toBe('half_open');
  });

  it('clears state and the failure counter on recordSuccess', async () => {
    const { redis, breaker } = make();
    redis.seed(REDIS_KEYS.circuitState(KIND), { state: 'open', opens_at: String(Date.now() + 1000) });
    redis.seedCounter(REDIS_KEYS.circuitFailures(KIND), 4);

    await breaker.recordSuccess(KIND);

    expect(redis.store.has(REDIS_KEYS.circuitState(KIND))).toBe(false);
    expect(redis.store.has(REDIS_KEYS.circuitFailures(KIND))).toBe(false);
  });
});
