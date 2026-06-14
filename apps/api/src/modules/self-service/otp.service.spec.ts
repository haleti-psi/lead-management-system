import type Redis from 'ioredis';

import { ERROR_CODES } from '@lms/shared';

import { OtpService } from './otp.service';

const LINK = 'l0000000-0000-0000-0000-00000000000l';

function fakeRedis(overrides: Partial<Record<keyof Redis, unknown>> = {}): Redis {
  return {
    incr: jest.fn(async () => 1),
    expire: jest.fn(async () => 1),
    get: jest.fn(async () => null),
    del: jest.fn(async () => 1),
    set: jest.fn(async () => 'OK'),
    exists: jest.fn(async () => 0),
    ...overrides,
  } as unknown as Redis;
}

describe('OtpService', () => {
  it('generateAndStore returns a 6-digit code and stores it with a TTL', async () => {
    const redis = fakeRedis();
    const otp = await new OtpService(redis).generateAndStore(LINK);
    expect(otp).toMatch(/^\d{6}$/);
    expect(redis.set).toHaveBeenCalledWith(`otp:${LINK}`, otp, 'EX', 600);
  });

  it('verify succeeds on a match, consumes the OTP, and opens a session', async () => {
    const redis = fakeRedis({ get: jest.fn(async () => '123456'), incr: jest.fn(async () => 1) });
    const result = await new OtpService(redis).verify(LINK, '123456');
    expect(result.sessionExpiresAt).toBeInstanceOf(Date);
    expect(redis.del).toHaveBeenCalledWith(`otp:${LINK}`);
    expect(redis.set).toHaveBeenCalledWith(`clsession:${LINK}`, '1', 'EX', 1800);
  });

  it('verify rejects a wrong OTP with AUTH_REQUIRED', async () => {
    const redis = fakeRedis({ get: jest.fn(async () => '123456'), incr: jest.fn(async () => 2) });
    await expect(new OtpService(redis).verify(LINK, '000000')).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_REQUIRED,
    });
  });

  it('verify rejects when no OTP is stored (expired) with AUTH_REQUIRED', async () => {
    const redis = fakeRedis({ get: jest.fn(async () => null), incr: jest.fn(async () => 1) });
    await expect(new OtpService(redis).verify(LINK, '123456')).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_REQUIRED,
    });
  });

  it('verify rejects past the attempt cap with RATE_LIMITED', async () => {
    const redis = fakeRedis({ incr: jest.fn(async () => 11) });
    await expect(new OtpService(redis).verify(LINK, '123456')).rejects.toMatchObject({
      code: ERROR_CODES.RATE_LIMITED,
    });
  });

  it('hasValidSession reflects the session key presence', async () => {
    expect(await new OtpService(fakeRedis({ exists: jest.fn(async () => 1) })).hasValidSession(LINK)).toBe(true);
    expect(await new OtpService(fakeRedis({ exists: jest.fn(async () => 0) })).hasValidSession(LINK)).toBe(false);
  });
});
