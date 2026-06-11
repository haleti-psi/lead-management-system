import type Redis from 'ioredis';

import { RedisThrottlerStorage } from './redis-throttler.storage';

function storageWithEval(result: [number, number, number, number]): {
  storage: RedisThrottlerStorage;
  evalMock: jest.Mock;
} {
  const evalMock = jest.fn(async () => result);
  const redis = { eval: evalMock } as unknown as Redis;
  return { storage: new RedisThrottlerStorage(redis), evalMock };
}

describe('RedisThrottlerStorage', () => {
  it('maps the Lua reply to a ThrottlerStorageRecord (under limit)', async () => {
    // hits=3, ttl=40000ms, not blocked.
    const { storage, evalMock } = storageWithEval([3, 40_000, 0, 0]);

    const record = await storage.increment('1.2.3.4', 60_000, 10, 60_000, 'default');

    expect(record).toEqual({
      totalHits: 3,
      timeToExpire: 40, // ms → s
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    // Keys are namespaced by throttler name.
    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'throttle:default:1.2.3.4',
      'throttle-block:default:1.2.3.4',
      '60000',
      '10',
      '60000',
    );
  });

  it('reports blocked with a positive block-expire when over the limit', async () => {
    const { storage } = storageWithEval([11, 5_000, 1, 5_000]);

    const record = await storage.increment('1.2.3.4', 60_000, 10, 60_000, 'default');

    expect(record.isBlocked).toBe(true);
    expect(record.totalHits).toBe(11);
    expect(record.timeToBlockExpire).toBe(5);
  });
});
