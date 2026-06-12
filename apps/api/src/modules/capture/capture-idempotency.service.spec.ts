import { CaptureIdempotencyService } from './capture-idempotency.service';

/**
 * FR-010 — Redis idempotency cache (LLD steps A/G): key shape
 * `idempotency:<scope>:<key>`, JSON round-trip, 24 h TTL on writes.
 */
describe('CaptureIdempotencyService', () => {
  it('get returns undefined on a miss and the parsed payload on a hit', async () => {
    const redis = {
      get: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(JSON.stringify({ lead_id: 'l1' })),
      set: jest.fn(),
    };
    const service = new CaptureIdempotencyService(redis as never);

    await expect(service.get('create_lead', 'k1')).resolves.toBeUndefined();
    await expect(service.get('create_lead', 'k1')).resolves.toEqual({ lead_id: 'l1' });
    expect(redis.get).toHaveBeenCalledWith('idempotency:create_lead:k1');
  });

  it('set stores JSON under the scoped key with the 24h TTL', async () => {
    const redis = { get: jest.fn(), set: jest.fn().mockResolvedValue('OK') };
    const service = new CaptureIdempotencyService(redis as never);

    await service.set('import_leads', 'k2', { import_job_id: 'j1' });

    expect(redis.set).toHaveBeenCalledWith(
      'idempotency:import_leads:k2',
      JSON.stringify({ import_job_id: 'j1' }),
      'EX',
      86_400,
    );
  });
});
