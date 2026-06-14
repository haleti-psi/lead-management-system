import type { ExecutionContext } from '@nestjs/common';

import { ERROR_CODES } from '@lms/shared';

import { CUSTOMER_LINK_KEY, CustomerLinkGuard, type CustomerLinkRequest } from './customer-link.guard';
import type { CustomerLinkRepository, CustomerLinkRow } from './customer-link.repository';

const LINK = 'l0000000-0000-0000-0000-00000000000l';

function linkRow(overrides: Partial<CustomerLinkRow> = {}): CustomerLinkRow {
  return {
    customer_link_id: LINK,
    org_id: '00000000-0000-0000-0000-000000000001',
    lead_id: 'b0000000-0000-0000-0000-00000000000b',
    token_hash: 'hash',
    purpose: ['upload'],
    status: 'active',
    otp_verified_at: null,
    expires_at: new Date(Date.now() + 86_400_000),
    opened_at: null,
    revoked_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: 'x',
    updated_by: 'x',
    ...overrides,
  } as CustomerLinkRow;
}

function ctxWithToken(
  token: string | undefined,
  req: CustomerLinkRequest = { headers: {}, params: { token } },
): {
  context: ExecutionContext;
  req: CustomerLinkRequest;
} {
  req.params = { token };
  const context = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { context, req };
}

function build(row: CustomerLinkRow | undefined): { guard: CustomerLinkGuard; markExpired: jest.Mock } {
  const markExpired = jest.fn(async () => undefined);
  const repo = {
    findActiveByTokenHash: jest.fn(async () => row),
    markExpired,
  } as unknown as CustomerLinkRepository;
  return { guard: new CustomerLinkGuard(repo), markExpired };
}

describe('CustomerLinkGuard', () => {
  it('passes a valid token and attaches the link to the request', async () => {
    const { guard } = build(linkRow());
    const { context, req } = ctxWithToken('raw-token');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req[CUSTOMER_LINK_KEY]?.customer_link_id).toBe(LINK);
  });

  it('rejects a missing token with NOT_FOUND', async () => {
    const { guard } = build(undefined);
    const { context } = ctxWithToken(undefined);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });

  it('rejects an unknown token with NOT_FOUND', async () => {
    const { guard } = build(undefined);
    const { context } = ctxWithToken('raw-token');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });

  it('lazily expires a past-due link and rejects with NOT_FOUND', async () => {
    const { guard, markExpired } = build(linkRow({ expires_at: new Date(Date.now() - 1000) }));
    const { context } = ctxWithToken('raw-token');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    expect(markExpired).toHaveBeenCalledWith(LINK);
  });
});
