import type Redis from 'ioredis';

import { ERROR_CODES, LeadStage } from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { DbTransaction, UnitOfWork } from '../../core/db';
import type { ResolvedCustomerLink } from '../compliance/ports/customer-link.port';
import { StatusService } from './status.service';
import type { CallbackLead, StatusLead, StatusRepository } from './status.repository';
import type { CallbackRequestDto } from './dto/callback-request.dto';

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD = 'b0000000-0000-0000-0000-00000000000b';
const RM = 'a0000000-0000-0000-0000-0000000000a1';
const SYSTEM = '00000000-0000-0000-0000-000000000000';
const TX = { __tx: true } as unknown as DbTransaction;

function fakeUow(): UnitOfWork {
  return { run: jest.fn(async (fn: (tx: DbTransaction) => Promise<unknown>) => fn(TX)) } as unknown as UnitOfWork;
}
function fakeRedis(get: string | null = null): { redis: Redis; getMock: jest.Mock; setMock: jest.Mock } {
  const getMock = jest.fn(async () => get);
  const setMock = jest.fn(async () => 'OK');
  return { redis: { get: getMock, set: setMock } as unknown as Redis, getMock, setMock };
}
function link(): ResolvedCustomerLink {
  return { leadId: LEAD, orgId: ORG, customerProfileId: null, channel: 'api' };
}
function statusLead(overrides: Partial<StatusLead> = {}): StatusLead {
  return {
    lead_id: LEAD,
    lead_code: 'LD-2026-000123',
    stage: LeadStage.DOCUMENTS_PENDING,
    owner_id: RM,
    is_hot: false,
    los_application_id: null,
    customer_profile_id: 'cp-1',
    ...overrides,
  };
}
function callbackLead(overrides: Partial<CallbackLead> = {}): CallbackLead {
  return { lead_id: LEAD, stage: LeadStage.DOCUMENTS_PENDING, owner_id: RM, is_hot: false, ...overrides };
}
function dto(over: Partial<CallbackRequestDto> = {}): CallbackRequestDto {
  return { preferred_slot: '2026-06-12T10:00:00+05:30', ...over } as CallbackRequestDto;
}

interface Deps {
  service: StatusService;
  repo: {
    getLeadStatus: jest.Mock;
    getProfileName: jest.Mock;
    getPendingDocTypes: jest.Mock;
    getLeadForCallback: jest.Mock;
    insertCallbackTask: jest.Mock;
  };
  audit: { append: jest.Mock };
  getMock: jest.Mock;
  setMock: jest.Mock;
}

function build(redisGet: string | null = null): Deps {
  const repo = {
    getLeadStatus: jest.fn(async () => statusLead()),
    getProfileName: jest.fn(async () => 'Rajesh K.'),
    getPendingDocTypes: jest.fn(async () => ['pan', 'address']),
    getLeadForCallback: jest.fn(async () => callbackLead()),
    insertCallbackTask: jest.fn(async () => 'task-1'),
  };
  const audit = { append: jest.fn(async () => undefined) };
  const { redis, getMock, setMock } = fakeRedis(redisGet);
  const logger = { warn: jest.fn() };
  const service = new StatusService(
    fakeUow(),
    repo as unknown as StatusRepository,
    audit as unknown as AuditAppender,
    redis,
    logger as never,
  );
  return { service, repo, audit, getMock, setMock };
}

describe('StatusService.getStatus', () => {
  it('maps documents_pending to a customer-safe label + pending actions', async () => {
    const d = build();
    const result = await d.service.getStatus(link());
    expect(result.stage_label).toBe('Documents Required');
    expect(result.customer_name).toBe('Rajesh K.');
    expect(result.pending_actions).toEqual(['Upload Pan', 'Upload Address']);
    expect(result.is_handed_off).toBe(false);
    expect(d.audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'link_open' }));
  });

  it('flags handed_off and omits pending actions', async () => {
    const d = build();
    d.repo.getLeadStatus.mockResolvedValue(statusLead({ stage: LeadStage.HANDED_OFF }));
    const result = await d.service.getStatus(link());
    expect(result.stage_label).toBe('With Lending Team');
    expect(result.is_handed_off).toBe(true);
    expect(result.pending_actions).toEqual([]);
    expect(d.repo.getPendingDocTypes).not.toHaveBeenCalled();
  });

  it('lead not found → NOT_FOUND', async () => {
    const d = build();
    d.repo.getLeadStatus.mockResolvedValue(undefined);
    await expect(d.service.getStatus(link())).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });
});

describe('StatusService.requestCallback', () => {
  it('creates a high-priority callback task and caches idempotency', async () => {
    const d = build();
    const result = await d.service.requestCallback(link(), dto(), 'idem-1');
    expect(result.task_id).toBe('task-1');
    expect(d.repo.insertCallbackTask).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: RM, lead_id: LEAD }),
      TX,
    );
    expect(d.audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'comm_send', entity_type: 'task' }), TX);
    expect(d.setMock).toHaveBeenCalled();
  });

  it('replays an idempotent request without inserting a second task', async () => {
    const d = build(JSON.stringify({ task_id: 'task-original' }));
    const result = await d.service.requestCallback(link(), dto(), 'idem-1');
    expect(result.task_id).toBe('task-original');
    expect(d.repo.insertCallbackTask).not.toHaveBeenCalled();
  });

  it('rejects a callback for a handed_off lead with VALIDATION_ERROR', async () => {
    const d = build();
    d.repo.getLeadForCallback.mockResolvedValue(callbackLead({ stage: LeadStage.HANDED_OFF }));
    await expect(d.service.requestCallback(link(), dto(), 'idem-2')).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
    });
    expect(d.repo.insertCallbackTask).not.toHaveBeenCalled();
  });

  it('falls back to the system actor when the lead is unassigned', async () => {
    const d = build();
    d.repo.getLeadForCallback.mockResolvedValue(callbackLead({ owner_id: null }));
    await d.service.requestCallback(link(), dto(), 'idem-3');
    expect(d.repo.insertCallbackTask).toHaveBeenCalledWith(expect.objectContaining({ owner_id: SYSTEM }), TX);
  });
});
