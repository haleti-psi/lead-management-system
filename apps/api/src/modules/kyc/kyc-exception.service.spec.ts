import { ERROR_CODES, KycCheckStatus, KycException, KycStatus, KycType, RoleCode } from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { DbTransaction, UnitOfWork } from '../../core/db';
import type { OutboxService } from '../../core/outbox';
import type { LeadService } from '../capture/lead.service';
import { KycExceptionService, type KycExceptionActorContext } from './kyc-exception.service';
import {
  KycVerificationRepository,
  type KycLeadContext,
  type KycVerificationRow,
} from './kyc-verification.repository';
import { ResolveKycExceptionDto } from './dto/resolve-kyc-exception.dto';

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD = 'b0000000-0000-0000-0000-00000000000b';
const KYCU = 'a0000000-0000-0000-0000-0000000000c1';
const KID = 'f0000000-0000-0000-0000-00000000000f';
const PCFG = 'p0000000-0000-0000-0000-00000000000p';
const TX = { __tx: true } as unknown as DbTransaction;

function fakeUow(): UnitOfWork {
  return { run: jest.fn(async (fn: (tx: DbTransaction) => Promise<unknown>) => fn(TX)) } as unknown as UnitOfWork;
}

function leadCtx(overrides: Partial<KycLeadContext> = {}): KycLeadContext {
  return {
    lead_id: LEAD,
    org_id: ORG,
    owner_id: KYCU,
    branch_id: 'b1',
    stage: 'kyc_in_progress',
    kyc_status: KycStatus.EXCEPTION,
    lead_identity_id: 'e0000000-0000-0000-0000-00000000000e',
    product_config_id: PCFG,
    ...overrides,
  };
}

function verifRow(overrides: Partial<KycVerificationRow> = {}): KycVerificationRow {
  return {
    kyc_verification_id: KID,
    org_id: ORG,
    lead_id: LEAD,
    kyc_type: KycType.PAN,
    provider: 'pan_provider',
    status: KycCheckStatus.FAILED,
    reference: null,
    masked_response: null,
    exception_type: KycException.NAME_MISMATCH,
    exception_owner_id: null,
    exception_sla_due_at: null,
    resolution_code: null,
    integration_log_id: 'log-1',
    created_at: new Date('2026-06-09T10:00:00Z'),
    updated_at: new Date('2026-06-09T10:00:00Z'),
    created_by: KYCU,
    updated_by: KYCU,
    ...overrides,
  };
}

function actorCtx(overrides: Partial<KycExceptionActorContext> = {}): KycExceptionActorContext {
  return {
    userId: KYCU,
    orgId: ORG,
    role: RoleCode.KYC,
    predicate: { type: 'branch', branchId: 'b1' },
    ...overrides,
  };
}

interface Deps {
  service: KycExceptionService;
  repo: {
    getLeadForKyc: jest.Mock;
    getById: jest.Mock;
    resolveException: jest.Mock;
    listByLead: jest.Mock;
    isManualFallbackEnabled: jest.Mock;
  };
  leads: { setKycStatus: jest.Mock };
  audit: { append: jest.Mock };
  outbox: { emit: jest.Mock };
}

function build(): Deps {
  const repo = {
    getLeadForKyc: jest.fn(async () => leadCtx()),
    getById: jest.fn(async () => verifRow()),
    resolveException: jest.fn(async () => 1),
    listByLead: jest.fn(async () => [verifRow({ status: KycCheckStatus.SUCCESS, resolution_code: 're_verified' })]),
    isManualFallbackEnabled: jest.fn(async () => false),
  };
  const leads = { setKycStatus: jest.fn(async () => undefined) };
  const audit = { append: jest.fn(async () => undefined) };
  const outbox = { emit: jest.fn(async () => undefined) };
  const service = new KycExceptionService(
    fakeUow(),
    repo as unknown as KycVerificationRepository,
    leads as unknown as LeadService,
    audit as unknown as AuditAppender,
    outbox as unknown as OutboxService,
  );
  return { service, repo, leads, audit, outbox };
}

function dto(over: Partial<ResolveKycExceptionDto> = {}): ResolveKycExceptionDto {
  return { resolutionCode: 're_verified', remarks: 'PAN re-checked', ...over } as ResolveKycExceptionDto;
}

describe('KycExceptionService.resolve', () => {
  it('T-01 re_verified → status success, recompute verified, outbox + audit', async () => {
    const d = build();
    const result = await d.service.resolve(LEAD, KID, dto(), actorCtx());

    expect(result.status).toBe(KycCheckStatus.SUCCESS);
    expect(result.resolutionCode).toBe('re_verified');
    expect(d.repo.resolveException).toHaveBeenCalledWith(
      expect.objectContaining({ new_status: KycCheckStatus.SUCCESS, resolution_code: 're_verified' }),
      TX,
    );
    expect(d.leads.setKycStatus).toHaveBeenCalledWith(LEAD, KycStatus.VERIFIED, TX);
    expect(d.outbox.emit).toHaveBeenCalledWith(expect.objectContaining({ event_code: 'KYC_EXCEPTION' }), TX);
    expect(d.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'kyc_exception', entity_type: 'kyc_verifications' }),
      TX,
    );
  });

  it('T-02 waiver → status waived', async () => {
    const d = build();
    d.repo.listByLead.mockResolvedValue([verifRow({ status: KycCheckStatus.WAIVED, resolution_code: 'waiver' })]);
    const result = await d.service.resolve(LEAD, KID, dto({ resolutionCode: 'waiver', evidenceRef: 'gcs://ev/1' }), actorCtx());
    expect(result.status).toBe(KycCheckStatus.WAIVED);
    expect(d.leads.setKycStatus).toHaveBeenCalledWith(LEAD, KycStatus.WAIVED, TX);
  });

  it('T-04 RM (no kyc_signoff orchestration) → FORBIDDEN', async () => {
    const d = build();
    await expect(d.service.resolve(LEAD, KID, dto(), actorCtx({ role: RoleCode.RM }))).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
    expect(d.repo.getLeadForKyc).not.toHaveBeenCalled();
  });

  it('T-05 out-of-scope branch → FORBIDDEN', async () => {
    const d = build();
    await expect(
      d.service.resolve(LEAD, KID, dto(), actorCtx({ predicate: { type: 'branch', branchId: 'b2' } })),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it('T-06 provider_down_manual without compliance flag → FORBIDDEN', async () => {
    const d = build();
    d.repo.isManualFallbackEnabled.mockResolvedValue(false);
    await expect(
      d.service.resolve(LEAD, KID, dto({ resolutionCode: 'provider_down_manual', evidenceRef: 'gcs://ev/2' }), actorCtx()),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    expect(d.repo.resolveException).not.toHaveBeenCalled();
  });

  it('T-07 provider_down_manual with compliance flag → success', async () => {
    const d = build();
    d.repo.isManualFallbackEnabled.mockResolvedValue(true);
    const result = await d.service.resolve(
      LEAD,
      KID,
      dto({ resolutionCode: 'provider_down_manual', evidenceRef: 'gcs://ev/2' }),
      actorCtx(),
    );
    expect(result.status).toBe(KycCheckStatus.SUCCESS);
  });

  it('T-08 lead not found → NOT_FOUND', async () => {
    const d = build();
    d.repo.getLeadForKyc.mockResolvedValue(undefined);
    await expect(d.service.resolve(LEAD, KID, dto(), actorCtx())).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('T-09 verification not found → NOT_FOUND', async () => {
    const d = build();
    d.repo.getById.mockResolvedValue(undefined);
    await expect(d.service.resolve(LEAD, KID, dto(), actorCtx())).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('T-10 already resolved → CONFLICT', async () => {
    const d = build();
    d.repo.getById.mockResolvedValue(verifRow({ status: KycCheckStatus.SUCCESS, resolution_code: 're_verified' }));
    await expect(d.service.resolve(LEAD, KID, dto(), actorCtx())).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });

  it('T-11 success state (no exception) → CONFLICT', async () => {
    const d = build();
    d.repo.getById.mockResolvedValue(verifRow({ status: KycCheckStatus.SUCCESS, resolution_code: null, exception_type: null }));
    await expect(d.service.resolve(LEAD, KID, dto(), actorCtx())).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });

  it('concurrency: zero rows updated → CONFLICT', async () => {
    const d = build();
    d.repo.resolveException.mockResolvedValue(0);
    await expect(d.service.resolve(LEAD, KID, dto(), actorCtx())).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });

  it('T-15 rollback: outbox failure propagates (tx rolls back)', async () => {
    const d = build();
    d.outbox.emit.mockRejectedValue(new Error('outbox down'));
    await expect(d.service.resolve(LEAD, KID, dto(), actorCtx())).rejects.toThrow();
  });

  it('T-16 kyc_status stays exception while another exception remains', async () => {
    const d = build();
    d.repo.listByLead.mockResolvedValue([
      verifRow({ status: KycCheckStatus.SUCCESS, resolution_code: 're_verified' }),
      verifRow({ kyc_verification_id: 'kv-2', status: KycCheckStatus.FAILED, resolution_code: null }),
    ]);
    await d.service.resolve(LEAD, KID, dto(), actorCtx());
    expect(d.leads.setKycStatus).toHaveBeenCalledWith(LEAD, KycStatus.EXCEPTION, TX);
  });
});

describe('ResolveKycExceptionDto', () => {
  it('T-12 rejects an invalid resolutionCode', () => {
    const r = ResolveKycExceptionDto.safeParse({ resolutionCode: 'unknown_code', remarks: 'x' });
    expect(r.success).toBe(false);
  });

  it('T-13 requires evidenceRef for waiver', () => {
    const r = ResolveKycExceptionDto.safeParse({ resolutionCode: 'waiver', remarks: 'x' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toContain('evidenceRef');
  });

  it('T-14 rejects empty remarks', () => {
    const r = ResolveKycExceptionDto.safeParse({ resolutionCode: 're_verified', remarks: '' });
    expect(r.success).toBe(false);
  });
});
