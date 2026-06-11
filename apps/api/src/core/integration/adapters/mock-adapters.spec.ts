import { IntegrationKind } from '@lms/shared';

import { ProviderCallError } from '../ports/provider-response';
import { KycMockAdapter } from './kyc-mock.adapter';
import { LosMockAdapter } from './los-mock.adapter';

/**
 * FR-140 unit tests for the mock provider adapters (integration-map.md test
 * doubles). They make no network calls and are steerable via the `__mock`
 * payload directive, so the gateway suite can drive success/failure deterministically.
 */
describe('LosMockAdapter', () => {
  it('returns 201 by default with an echo body', async () => {
    const adapter = new LosMockAdapter();
    const res = await adapter.call({ integration: IntegrationKind.LOS_HANDOFF, payload: {} });
    expect(res.httpStatus).toBe(201);
  });

  it('honours a __mock.status directive', async () => {
    const adapter = new LosMockAdapter();
    const res = await adapter.call({
      integration: IntegrationKind.LOS_ELIGIBILITY,
      payload: { __mock: { status: 200 } },
    });
    expect(res.httpStatus).toBe(200);
  });

  it('throws a ProviderCallError when __mock.fail is set (transport fault)', async () => {
    const adapter = new LosMockAdapter();
    await expect(
      adapter.call({ integration: IntegrationKind.LOS_HANDOFF, payload: { __mock: { fail: true } } }),
    ).rejects.toBeInstanceOf(ProviderCallError);
  });
});

describe('KycMockAdapter', () => {
  it('returns 200 by default', async () => {
    const adapter = new KycMockAdapter();
    const res = await adapter.call({ integration: IntegrationKind.PAN, payload: {} });
    expect(res.httpStatus).toBe(200);
  });

  it('throws a ProviderCallError when __mock.fail is set', async () => {
    const adapter = new KycMockAdapter();
    await expect(
      adapter.call({ integration: IntegrationKind.PAN, payload: { __mock: { fail: true } } }),
    ).rejects.toBeInstanceOf(ProviderCallError);
  });
});
