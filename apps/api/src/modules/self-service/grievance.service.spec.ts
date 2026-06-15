import { GrievanceCategory } from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { DbTransaction, UnitOfWork } from '../../core/db';
import type { OutboxService } from '../../core/outbox';
import type { CodeGenerator } from '../capture/code-generator.service';
import type { ResolvedCustomerLink } from '../compliance/ports/customer-link.port';
import { GrievanceService } from './grievance.service';
import type { GrievanceRepository, GrievanceRow } from './grievance.repository';
import { CreateGrievanceDto } from './dto/create-grievance.dto';

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD = 'b0000000-0000-0000-0000-00000000000b';
const TX = { __tx: true } as unknown as DbTransaction;
const SYSTEM = '00000000-0000-0000-0000-000000000000';

function fakeUow(): UnitOfWork {
  return { run: jest.fn(async (fn: (tx: DbTransaction) => Promise<unknown>) => fn(TX)) } as unknown as UnitOfWork;
}
function link(): ResolvedCustomerLink {
  return { leadId: LEAD, orgId: ORG, customerProfileId: null, channel: 'api' };
}
function grievanceRow(overrides: Partial<GrievanceRow> = {}): GrievanceRow {
  return {
    grievance_id: 'g1',
    org_id: ORG,
    grievance_no: 'GRV-2026-00001',
    lead_id: LEAD,
    source: 'customer_link',
    category: GrievanceCategory.SERVICE_DELAY,
    description: 'pending 2 weeks',
    owner_id: null,
    sla_due_at: new Date('2026-06-12T13:00:00Z'),
    status: 'open',
    response: null,
    closure_proof_ref: null,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: SYSTEM,
    updated_by: SYSTEM,
    ...overrides,
  } as GrievanceRow;
}
function dto(over: Partial<CreateGrievanceDto> = {}): CreateGrievanceDto {
  return { category: GrievanceCategory.SERVICE_DELAY, description: 'My loan has been pending 2 weeks.', ...over };
}

interface Deps {
  service: GrievanceService;
  repo: { findGrievanceSlaThresholdMinutes: jest.Mock; insert: jest.Mock };
  codeGen: { nextGrievanceNo: jest.Mock };
  audit: { append: jest.Mock };
  outbox: { emit: jest.Mock };
}

function build(): Deps {
  const repo = {
    findGrievanceSlaThresholdMinutes: jest.fn(async () => 1440),
    insert: jest.fn(async () => grievanceRow()),
  };
  const codeGen = { nextGrievanceNo: jest.fn(async () => 'GRV-2026-00001') };
  const audit = { append: jest.fn(async () => undefined) };
  const outbox = { emit: jest.fn(async () => undefined) };
  const service = new GrievanceService(
    fakeUow(),
    repo as unknown as GrievanceRepository,
    codeGen as unknown as CodeGenerator,
    audit as unknown as AuditAppender,
    outbox as unknown as OutboxService,
  );
  return { service, repo, codeGen, audit, outbox };
}

describe('GrievanceService.createFromCustomerLink', () => {
  it('creates an open grievance with a number, SLA due-at, outbox + audit', async () => {
    const d = build();
    const result = await d.service.createFromCustomerLink(link(), dto());

    expect(result.grievanceNo).toBe('GRV-2026-00001');
    expect(result.status).toBe('open');
    expect(result.message).toContain('GRV-2026-00001');
    expect(d.codeGen.nextGrievanceNo).toHaveBeenCalledWith(TX, ORG);
    expect(d.repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: LEAD, category: GrievanceCategory.SERVICE_DELAY, actor_id: SYSTEM }),
      TX,
    );
    // SLA threshold 1440 → a due-at is computed.
    expect((d.repo.insert.mock.calls[0][0] as { sla_due_at: Date | null }).sla_due_at).toBeInstanceOf(Date);
    expect(d.outbox.emit).toHaveBeenCalledWith(expect.objectContaining({ event_code: 'GRIEVANCE_CREATED' }), TX);
    expect(d.audit.append).toHaveBeenCalledWith(expect.objectContaining({ entity_type: 'grievance' }), TX);
  });

  it('propagates a failure inside the transaction (rolls back)', async () => {
    const d = build();
    d.outbox.emit.mockRejectedValue(new Error('outbox down'));
    await expect(d.service.createFromCustomerLink(link(), dto())).rejects.toThrow();
  });

  it('leaves sla_due_at null when no active grievance SLA policy exists', async () => {
    const d = build();
    d.repo.findGrievanceSlaThresholdMinutes.mockResolvedValue(undefined);
    d.repo.insert.mockResolvedValue(grievanceRow({ sla_due_at: null }));

    const result = await d.service.createFromCustomerLink(link(), dto());

    expect((d.repo.insert.mock.calls[0][0] as { sla_due_at: Date | null }).sla_due_at).toBeNull();
    expect(result.sla_due_at).toBeNull();
  });
});

describe('CreateGrievanceDto', () => {
  it('rejects an invalid category', () => {
    expect(CreateGrievanceDto.safeParse({ category: 'nope', description: 'x' }).success).toBe(false);
  });
  it('rejects empty description', () => {
    expect(CreateGrievanceDto.safeParse({ category: 'service_delay', description: '' }).success).toBe(false);
  });
  it('rejects description over 2000 chars', () => {
    expect(
      CreateGrievanceDto.safeParse({ category: 'service_delay', description: 'a'.repeat(2001) }).success,
    ).toBe(false);
  });
  it('accepts a valid payload with optional attachmentNote', () => {
    expect(
      CreateGrievanceDto.safeParse({ category: 'other', description: 'issue', attachmentNote: 'REF-1' }).success,
    ).toBe(true);
  });
});
