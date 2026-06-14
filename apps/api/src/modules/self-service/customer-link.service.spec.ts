import { ERROR_CODES, RoleCode } from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { AppConfigService } from '../../core/config';
import type { DbTransaction, UnitOfWork } from '../../core/db';
import type { NotificationChannelPort } from '../../core/integration';
import type { OutboxService } from '../../core/outbox';
import { CustomerLinkService, type CustomerLinkActorContext } from './customer-link.service';
import type { CustomerLinkRepository, CustomerLinkRow, LinkLeadContext } from './customer-link.repository';
import type { OtpService } from './otp.service';
import { CreateCustomerLinkDto } from './dto/create-customer-link.dto';

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD = 'b0000000-0000-0000-0000-00000000000b';
const RM = 'a0000000-0000-0000-0000-0000000000a1';
const TX = { __tx: true } as unknown as DbTransaction;

function fakeUow(): UnitOfWork {
  return { run: jest.fn(async (fn: (tx: DbTransaction) => Promise<unknown>) => fn(TX)) } as unknown as UnitOfWork;
}
function leadCtx(overrides: Partial<LinkLeadContext> = {}): LinkLeadContext {
  return { lead_id: LEAD, org_id: ORG, owner_id: RM, branch_id: 'b1', partner_id: null, stage: 'documents_pending', product_code: 'CV_LOAN', mobile: '9876543210', ...overrides };
}
function linkRow(): CustomerLinkRow {
  return {
    customer_link_id: 'l1', org_id: ORG, lead_id: LEAD, token_hash: 'h', purpose: ['upload', 'consent'],
    status: 'active', otp_verified_at: null, expires_at: new Date(Date.now() + 7 * 86_400_000), opened_at: null,
    revoked_by: null, created_at: new Date(), updated_at: new Date(), created_by: RM, updated_by: RM,
  } as CustomerLinkRow;
}
function actorCtx(overrides: Partial<CustomerLinkActorContext> = {}): CustomerLinkActorContext {
  return { userId: RM, orgId: ORG, role: RoleCode.RM, predicate: { type: 'own', userId: RM }, ...overrides };
}
function dto(over: Partial<CreateCustomerLinkDto> = {}): CreateCustomerLinkDto {
  return { purpose: ['upload', 'consent'], channel: 'whatsapp', ...over } as CreateCustomerLinkDto;
}

interface Deps {
  service: CustomerLinkService;
  repo: { getLeadForLink: jest.Mock; revokeActiveForLead: jest.Mock; insert: jest.Mock; markOpened: jest.Mock; getLeadDisplay: jest.Mock };
  otp: { generateAndStore: jest.Mock; hasValidSession: jest.Mock };
  audit: { append: jest.Mock };
  outbox: { emit: jest.Mock };
  notifier: { send: jest.Mock };
}

function build(): Deps {
  const repo = {
    getLeadForLink: jest.fn(async () => leadCtx()),
    revokeActiveForLead: jest.fn(async () => undefined),
    insert: jest.fn(async () => linkRow()),
    markOpened: jest.fn(async () => undefined),
    getLeadDisplay: jest.fn(async () => ({ stage: 'documents_pending', product_code: 'CV_LOAN' })),
  };
  const otp = { generateAndStore: jest.fn(async () => '123456'), hasValidSession: jest.fn(async () => false) };
  const audit = { append: jest.fn(async () => undefined) };
  const outbox = { emit: jest.fn(async () => undefined) };
  const notifier = { send: jest.fn(async () => undefined) };
  const config = { get: (k: string) => (k === 'APP_BASE_URL' ? 'https://lms.test' : 7) } as unknown as AppConfigService;
  const logger = { warn: jest.fn() };
  const service = new CustomerLinkService(
    fakeUow(),
    repo as unknown as CustomerLinkRepository,
    otp as unknown as OtpService,
    audit as unknown as AuditAppender,
    outbox as unknown as OutboxService,
    config,
    notifier as unknown as NotificationChannelPort,
    logger as never,
  );
  return { service, repo, otp, audit, outbox, notifier };
}

describe('CustomerLinkService.create', () => {
  it('revokes prior links, inserts, audits, emits, and dispatches the URL', async () => {
    const d = build();
    const result = await d.service.create(LEAD, dto(), actorCtx());

    expect(result.status).toBe('active');
    expect(result.channel_dispatched).toBe('whatsapp');
    expect(d.repo.revokeActiveForLead).toHaveBeenCalledWith(LEAD, ORG, RM, TX);
    expect(d.repo.insert).toHaveBeenCalledWith(expect.objectContaining({ lead_id: LEAD, purpose: ['upload', 'consent'] }), TX);
    expect(d.audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'link_create' }), TX);
    expect(d.outbox.emit).toHaveBeenCalledWith(expect.objectContaining({ event_code: 'DOC_REQUEST' }), TX);
    expect(d.otp.generateAndStore).toHaveBeenCalled();
    expect(d.notifier.send).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'whatsapp', templateCode: 'customer_link_send', recipient: '9876543210' }),
    );
  });

  it('never returns the raw token', async () => {
    const d = build();
    const result = await d.service.create(LEAD, dto(), actorCtx());
    expect(JSON.stringify(result)).not.toContain('token');
  });

  it('lead not found → NOT_FOUND', async () => {
    const d = build();
    d.repo.getLeadForLink.mockResolvedValue(undefined);
    await expect(d.service.create(LEAD, dto(), actorCtx())).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });

  it('out-of-scope lead → FORBIDDEN', async () => {
    const d = build();
    d.repo.getLeadForLink.mockResolvedValue(leadCtx({ owner_id: 'someone-else' }));
    await expect(d.service.create(LEAD, dto(), actorCtx())).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it('dispatch failure does not roll back the link', async () => {
    const d = build();
    d.notifier.send.mockRejectedValue(new Error('sms down'));
    const result = await d.service.create(LEAD, dto(), actorCtx());
    expect(result.status).toBe('active'); // link still created
  });
});

describe('CustomerLinkService.open', () => {
  it('records the open, audits, and returns purpose + otp state + display', async () => {
    const d = build();
    d.otp.hasValidSession.mockResolvedValue(false);
    const result = await d.service.open(linkRow());

    expect(d.repo.markOpened).toHaveBeenCalledWith('l1');
    expect(d.audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'link_open' }));
    expect(result.otp_required).toBe(true);
    expect(result.otp_verified).toBe(false);
    expect(result.purpose).toEqual(['upload', 'consent']);
    expect(result.lead_display.status_label).toBe('Documents Pending');
  });
});
