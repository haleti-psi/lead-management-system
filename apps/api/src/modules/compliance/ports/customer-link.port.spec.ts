import type { PinoLogger } from 'nestjs-pino';

import { UnavailableCustomerLinkAdapter } from './customer-link.port';

describe('UnavailableCustomerLinkAdapter (FR-060 seam placeholder)', () => {
  it('resolves NO token (→ 404 at the controller) and warns loudly without logging the token', async () => {
    const warn = jest.fn();
    const adapter = new UnavailableCustomerLinkAdapter({ warn } as unknown as PinoLogger);

    await expect(adapter.resolveForConsent('secret-token')).resolves.toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    const args = JSON.stringify(warn.mock.calls[0]);
    expect(args).toContain('FR-060');
    expect(args).not.toContain('secret-token'); // opaque credential never logged
  });
});
