import { CustomerLinkAdapter } from './customer-link.adapter';
import type { CustomerLinkRepository, CustomerLinkRow } from './customer-link.repository';
import type { OtpService } from './otp.service';

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD = 'b0000000-0000-0000-0000-00000000000b';
const LINK = 'l0000000-0000-0000-0000-00000000000l';

function linkRow(overrides: Partial<CustomerLinkRow> = {}): CustomerLinkRow {
  return {
    customer_link_id: LINK,
    org_id: ORG,
    lead_id: LEAD,
    token_hash: 'hash',
    purpose: ['upload', 'consent'],
    status: 'active',
    otp_verified_at: null,
    expires_at: new Date(Date.now() + 86_400_000),
    opened_at: null,
    revoked_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: LEAD,
    updated_by: LEAD,
    ...overrides,
  } as CustomerLinkRow;
}

function build(row: CustomerLinkRow | undefined, hasSession: boolean): CustomerLinkAdapter {
  const repo = { findActiveByTokenHash: jest.fn(async () => row) } as unknown as CustomerLinkRepository;
  const otp = { hasValidSession: jest.fn(async () => hasSession) } as unknown as OtpService;
  return new CustomerLinkAdapter(repo, otp);
}

describe('CustomerLinkAdapter (port rebind)', () => {
  it('resolves an active link with a valid OTP session and the right purpose', async () => {
    const resolved = await build(linkRow(), true).resolveForDocument('tok');
    expect(resolved).toEqual({ leadId: LEAD, orgId: ORG, customerProfileId: null, channel: 'api' });
  });

  it('returns null for an unknown token', async () => {
    expect(await build(undefined, true).resolveForDocument('tok')).toBeNull();
  });

  it('returns null when the link has expired', async () => {
    const expired = linkRow({ expires_at: new Date(Date.now() - 1000) });
    expect(await build(expired, true).resolveForDocument('tok')).toBeNull();
  });

  it('returns null without a verified OTP session', async () => {
    expect(await build(linkRow(), false).resolveForDocument('tok')).toBeNull();
  });

  it('returns null when the purpose does not permit the action', async () => {
    const consentOnly = linkRow({ purpose: ['consent'] });
    expect(await build(consentOnly, true).resolveForDocument('tok')).toBeNull();
  });

  it('resolveForConsent gates on the consent purpose', async () => {
    const uploadOnly = linkRow({ purpose: ['upload'] });
    expect(await build(uploadOnly, true).resolveForConsent('tok')).toBeNull();
    expect(await build(linkRow({ purpose: ['consent'] }), true).resolveForConsent('tok')).not.toBeNull();
  });
});
