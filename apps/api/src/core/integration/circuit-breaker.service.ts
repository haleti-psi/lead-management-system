import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

import { REDIS } from '../redis';
import {
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_FAILURE_WINDOW_SECONDS,
  CIRCUIT_OPEN_TTL_SECONDS,
  CIRCUIT_STATE,
  REDIS_KEYS,
  type CircuitState,
} from './integration.constants';

/** Snapshot of a breaker's gate decision for one integration kind. */
export interface CircuitDecision {
  /** When true, the gateway must fast-fail (UPSTREAM_UNAVAILABLE) without calling. */
  open: boolean;
  /** The recorded state, for logging/observability (`open` / `half_open` / null). */
  state: CircuitState | null;
}

/**
 * FR-140 circuit breaker (LLD §Summary 3 / §Backend Flow steps 3,6,7), backed by
 * Redis so all Cloud Run instances share one view per `integration_kind`.
 *
 * Two keys per kind:
 *   - `cb:{kind}`          — a hash holding `state` (`open`/`half_open`) and
 *                            `opens_at` (epoch ms the open window ends).
 *   - `cb:{kind}:failures` — a rolling INCR counter with a TTL window.
 *
 * Lifecycle: each provider failure increments the counter; at the threshold the
 * state flips to `open` for {@link CIRCUIT_OPEN_TTL_SECONDS}. While open, calls
 * fast-fail. After the window the gateway probes (`half_open`); a success clears
 * both keys, a failure re-opens. All operations are parameterised Redis commands;
 * no secrets or PII are stored.
 */
@Injectable()
export class CircuitBreakerService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Gate check before dispatch. Returns `open` only while the open window is
   * still in the future; once it has elapsed the breaker is treated as
   * half-open (the caller proceeds with a single probe).
   */
  async check(kind: string): Promise<CircuitDecision> {
    const hash = await this.redis.hgetall(REDIS_KEYS.circuitState(kind));
    const state = hash.state;
    if (state === CIRCUIT_STATE.OPEN) {
      const opensAt = Number(hash.opens_at ?? 0);
      if (Number.isFinite(opensAt) && opensAt > Date.now()) {
        return { open: true, state: CIRCUIT_STATE.OPEN };
      }
      // Window elapsed → allow a half-open probe (state recorded for visibility).
      await this.redis.hset(REDIS_KEYS.circuitState(kind), 'state', CIRCUIT_STATE.HALF_OPEN);
      return { open: false, state: CIRCUIT_STATE.HALF_OPEN };
    }
    if (state === CIRCUIT_STATE.HALF_OPEN) {
      return { open: false, state: CIRCUIT_STATE.HALF_OPEN };
    }
    return { open: false, state: null };
  }

  /**
   * Record a provider failure. Increments the windowed counter and, on reaching
   * {@link CIRCUIT_BREAKER_THRESHOLD}, opens the circuit for the configured TTL.
   * Returns whether the circuit is now open.
   */
  async recordFailure(kind: string): Promise<boolean> {
    const failures = await this.redis.incr(REDIS_KEYS.circuitFailures(kind));
    if (failures === 1) {
      // First failure in a fresh window — bound the counter's lifetime.
      await this.redis.expire(REDIS_KEYS.circuitFailures(kind), CIRCUIT_FAILURE_WINDOW_SECONDS);
    }
    if (failures >= CIRCUIT_BREAKER_THRESHOLD) {
      const opensAt = Date.now() + CIRCUIT_OPEN_TTL_SECONDS * 1000;
      await this.redis.hset(REDIS_KEYS.circuitState(kind), {
        state: CIRCUIT_STATE.OPEN,
        opens_at: String(opensAt),
      });
      await this.redis.expire(REDIS_KEYS.circuitState(kind), CIRCUIT_OPEN_TTL_SECONDS);
      return true;
    }
    return false;
  }

  /** Record a provider success — clears the open state and the failure counter. */
  async recordSuccess(kind: string): Promise<void> {
    await this.redis.del(REDIS_KEYS.circuitState(kind), REDIS_KEYS.circuitFailures(kind));
  }
}
