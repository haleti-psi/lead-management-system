import {
  ERROR_CODES,
  KycCheckStatus,
  KycException,
  KycStatus,
  KycType,
  RoleCode,
} from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { DbTransaction, UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import type {
  IntegrationGateway,
  IntegrationLogRepository,
  KycPort,
} from '../../core/integration';
import type { OutboxService } from '../../core/outbox';
import type { LeadService } from '../capture/lead.service';
import { KycService, type KycActorContext } from './kyc.service';
import {
  KycVerificationRepository,
  type KycLeadContext,
  type KycVerificationRow,
} from './kyc-verification.repository';
import type { RunKycBody } from './dto/run-kyc.dto';

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD = 'b0000000-0000-0000-0000-00000000000b';
const KYCU = 'a0000000-0000-0000-0000-0000000000c1';
const IDENT = 'e0000000-0000-0000-0000-00000000000e';
const CONSENT = 'c0000000-0000-0000-0000-00000000000c';
const TX = { __tx: true } as unknown as DbTransaction;

function fakeUow(): UnitOfWork {
  return { run: jest.fn(async (fn: (tx: DbTransaction) => Promise<unknown>) => fn(TX)) } as unknown as UnitOfWork;
}
function fakeAudit(): { append: jest.Mock } {
  return { append: jest.fn(async () => undefined) };
}
function fakeOutbox(): { emit: jest.Mock } {
  return { emit: jest.fn(async () => undefined) };
}
function fakeLeads(): { setKycStatus: jest.Mock } {
  return { setKycStatus: jest.fn(async () => undefined) };
}
function fakeGateway(): { call: jest.Mock } {
  return { call: jest.fn() };
}
function fakeLogRepo(): { createLog: jest.Mock } {
  return { createLog: jest.fn(async () => ({ integration_log_id: 'log-1' })) };
}

function leadCtx(overrides: Partial<KycLeadContext> = {}): KycLeadContext {
  return {
    lead_id: LEAD,
    org_id: ORG,
    owner_id: KYCU,
    branch_id: 'b1',
    stage: 'kyc_in_progress',
    kyc_status: KycStatus.IN_PROGRESS,
    lead_identity_id: IDENT,
    ...overrides,
  };
}

function verifRow(overrides: Partial<KycVerificationRow> = {}): KycVerificationRow {
  return {
    kyc_verification_id: 'kv-1',
    org_id: ORG,
    lead_id: LEAD,
    kyc_type: KycType.PAN,
    provider: 'pan_provider',
    status: KycCheckStatus.SUCCESS,
    reference: null,
    masked_response: { panStatus: 'valid', nameMatch: true, maskedPan: 'ABCDE****F' },
    exception_type: null,
    exception_owner_id: null,
    exception_sla_due_at: null,
    resolution_code: null,
    integration_log_id: 'log-1',
    created_at: new Date('2026-06-09T10:30:00Z'),
    updated_at: new Date('2026-06-09T10:30:00Z'),
    created_by: KYCU,
    updated_by: KYCU,
    ...overrides,
  };
}

function actorCtx(overrides: Partial<KycActorContext> = {}): KycActorContext {
  return {
    userId: KYCU,
    orgId: ORG,
    role: RoleCode.KYC,
    predicate: { type: 'branch', branchId: 'b1' },
    correlationId: 'corr_x',
    ...overrides,
  };
}

function panBody(overrides: Partial<RunKycBody> = {}): RunKycBody {
  return { pan: 'ABCDE1234F', consentId: CONSENT, ...overrides };
}

interface Deps {
  service: KycService;
  repo: {
    getLeadForKyc: jest.Mock;
    getActiveKycConsentId: jest.Mock;
    findIntegrationLog: jest.Mock;
    getVerificationByLogId: jest.Mock;
    listByLead: jest.Mock;
    insertVerification: jest.Mock;
    updateLeadIdentity: jest.Mock;
    insertDataSharingLog: jest.Mock;
  };
  gateway: { call: jest.Mock };
  logRepo: { createLog: jest.Mock };
  leads: { setKycStatus: jest.Mock };
  audit: { append: jest.Mock };
  outbox: { emit: jest.Mock };
}

function build(): Deps {
  const repo = {
    getLeadForKyc: jest.fn(async () => leadCtx()),
    getActiveKycConsentId: jest.fn(async () => CONSENT),
    findIntegrationLog: jest.fn(async () => undefined),
    getVerificationByLogId: jest.fn(async () => undefined),
    listByLead: jest.fn(async () => [verifRow()]),
    insertVerification: jest.fn(async (input: { status: KycCheckStatus; exception_type: KycException | null }) =>
      verifRow({ status: input.status, exception_type: input.exception_type }),
    ),
    updateLeadIdentity: jest.fn(async () => undefined),
    insertDataSharingLog: jest.fn(async () => undefined),
  };
  const gateway = fakeGateway();
  const logRepo = fakeLogRepo();
  const leads = fakeLeads();
  const audit = fakeAudit();
  const outbox = fakeOutbox();
  const service = new KycService(
    fakeUow(),
    repo as unknown as KycVerificationRepository,
    leads as unknown as LeadService,
    audit as unknown as AuditAppender,
    outbox as unknown as OutboxService,
    gateway as unknown as IntegrationGateway,
    logRepo as unknown as IntegrationLogRepository,
    { call: jest.fn() } as unknown as KycPort,
  );
  return { service, repo, gateway, logRepo, leads, audit, outbox };
}

describe('KycService.runVerification', () => {
  it('TC-071-001 happy path: PAN success masks PAN, enriches identity, shares data, verifies', async () => {
    const d = build();
    d.gateway.call.mockResolvedValue({ httpStatus: 200, body: {}, idempotent: false });

    const result = await d.service.runVerification(LEAD, KycType.PAN, panBody(), actorCtx());

    expect(result.status).toBe(KycCheckStatus.SUCCESS);
    expect(result.maskedResponse).toMatchObject({ maskedPan: 'ABCDE****F' });
    expect(d.repo.updateLeadIdentity).toHaveBeenCalledWith(
      IDENT,
      ORG,
      expect.objectContaining({ pan_masked: 'ABCDE****F', pan_token: expect.stringMatching(/^pan_/) }),
      KYCU,
      TX,
    );
    expect(d.repo.insertDataSharingLog).toHaveBeenCalledWith(
      expect.objectContaining({ consent_id: CONSENT, lead_id: LEAD }),
      TX,
    );
    expect(d.leads.setKycStatus).toHaveBeenCalledWith(LEAD, KycStatus.VERIFIED, TX);
    // TC-071-017 — the response never carries the tokenised PAN.
    expect(result).not.toHaveProperty('pan_token');
    expect(JSON.stringify(result)).not.toContain('pan_token');
  });

  it('TC-071-002 mismatch → failed + exception, 200 (not 503), KYC_EXCEPTION emitted', async () => {
    const d = build();
    d.gateway.call.mockResolvedValue({
      httpStatus: 200,
      body: { outcome: 'mismatch', exceptionType: 'name_mismatch' },
      idempotent: false,
    });
    d.repo.listByLead.mockResolvedValue([verifRow({ status: KycCheckStatus.FAILED })]);

    const result = await d.service.runVerification(LEAD, KycType.PAN, panBody(), actorCtx());

    expect(result.status).toBe(KycCheckStatus.FAILED);
    expect(result.exceptionType).toBe(KycException.NAME_MISMATCH);
    expect(d.outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event_code: 'KYC_EXCEPTION' }),
      TX,
    );
    expect(d.leads.setKycStatus).toHaveBeenCalledWith(LEAD, KycStatus.EXCEPTION, TX);
  });

  it('TC-071-003 provider down → 503, exception row written, no data shared', async () => {
    const d = build();
    d.gateway.call.mockRejectedValue(new DomainException(ERROR_CODES.UPSTREAM_UNAVAILABLE));
    d.repo.listByLead.mockResolvedValue([verifRow({ status: KycCheckStatus.FAILED, exception_type: KycException.PROVIDER_DOWN })]);

    await expect(d.service.runVerification(LEAD, KycType.PAN, panBody(), actorCtx())).rejects.toMatchObject({
      code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
    });
    expect(d.repo.insertVerification).toHaveBeenCalledWith(
      expect.objectContaining({ status: KycCheckStatus.FAILED, exception_type: KycException.PROVIDER_DOWN }),
      TX,
    );
    expect(d.repo.insertDataSharingLog).not.toHaveBeenCalled();
    expect(d.outbox.emit).toHaveBeenCalledWith(expect.objectContaining({ event_code: 'KYC_EXCEPTION' }), TX);
  });

  it('TC-071-004 missing consent → FORBIDDEN CONSENT_MISSING, no verification', async () => {
    const d = build();
    d.repo.getActiveKycConsentId.mockResolvedValue(undefined);

    await expect(d.service.runVerification(LEAD, KycType.PAN, panBody(), actorCtx())).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
      detail: { reason: 'CONSENT_MISSING' },
    });
    expect(d.repo.insertVerification).not.toHaveBeenCalled();
  });

  it('TC-071-006 RM cannot run KYC orchestration → FORBIDDEN', async () => {
    const d = build();
    await expect(
      d.service.runVerification(LEAD, KycType.PAN, panBody(), actorCtx({ role: RoleCode.RM })),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    expect(d.repo.getLeadForKyc).not.toHaveBeenCalled();
  });

  it('TC-071-007 KYC user from another branch → FORBIDDEN', async () => {
    const d = build();
    await expect(
      d.service.runVerification(LEAD, KycType.PAN, panBody(), actorCtx({ predicate: { type: 'branch', branchId: 'b2' } })),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it('TC-071-008 lead not in kyc_in_progress → CONFLICT', async () => {
    const d = build();
    d.repo.getLeadForKyc.mockResolvedValue(leadCtx({ stage: 'documents_pending' }));
    await expect(d.service.runVerification(LEAD, KycType.PAN, panBody(), actorCtx())).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
    expect(d.repo.insertVerification).not.toHaveBeenCalled();
  });

  it('TC-071-009 lead not found → NOT_FOUND', async () => {
    const d = build();
    d.repo.getLeadForKyc.mockResolvedValue(undefined);
    await expect(d.service.runVerification(LEAD, KycType.PAN, panBody(), actorCtx())).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('TC-071-013 idempotency replay returns the original verification, no re-insert', async () => {
    const d = build();
    d.repo.findIntegrationLog.mockResolvedValue({ integration_log_id: 'log-1', status: 'success' });
    d.repo.getVerificationByLogId.mockResolvedValue(verifRow({ kyc_verification_id: 'kv-original' }));

    const result = await d.service.runVerification(
      LEAD,
      KycType.PAN,
      panBody({ idempotencyKey: 'idem_abc' }),
      actorCtx(),
    );

    expect(result.kycVerificationId).toBe('kv-original');
    expect(d.gateway.call).not.toHaveBeenCalled();
    expect(d.repo.insertVerification).not.toHaveBeenCalled();
  });

  it('TC-071-018 Aadhaar OTP stores an opaque ref token, never raw digits', async () => {
    const d = build();
    d.gateway.call.mockResolvedValue({ httpStatus: 200, body: {}, idempotent: false });
    d.repo.insertVerification.mockResolvedValue(verifRow({ kyc_type: KycType.AADHAAR_OTP }));

    await d.service.runVerification(
      LEAD,
      KycType.AADHAAR_OTP,
      { aadhaarOfflineXml: 'base64xml', consentId: CONSENT },
      actorCtx(),
    );

    const patch = d.repo.updateLeadIdentity.mock.calls[0][2] as { aadhaar_ref_token: string };
    expect(patch.aadhaar_ref_token).toMatch(/^aadhaar_/);
    expect(patch.aadhaar_ref_token).not.toMatch(/^\d{12}$/);
  });

  it('TC-071-019 all checks success → kyc_status verified', async () => {
    const d = build();
    d.gateway.call.mockResolvedValue({ httpStatus: 200, body: {}, idempotent: false });
    d.repo.listByLead.mockResolvedValue([
      verifRow({ status: KycCheckStatus.SUCCESS }),
      verifRow({ status: KycCheckStatus.SUCCESS, kyc_verification_id: 'kv-2' }),
    ]);

    await d.service.runVerification(LEAD, KycType.PAN, panBody(), actorCtx());
    expect(d.leads.setKycStatus).toHaveBeenCalledWith(LEAD, KycStatus.VERIFIED, TX);
  });

  it('TC-071-020 one failed check → kyc_status exception', async () => {
    const d = build();
    d.gateway.call.mockResolvedValue({ httpStatus: 200, body: {}, idempotent: false });
    d.repo.listByLead.mockResolvedValue([
      verifRow({ status: KycCheckStatus.SUCCESS }),
      verifRow({ status: KycCheckStatus.FAILED, kyc_verification_id: 'kv-2' }),
    ]);

    await d.service.runVerification(LEAD, KycType.PAN, panBody(), actorCtx());
    expect(d.leads.setKycStatus).toHaveBeenCalledWith(LEAD, KycStatus.EXCEPTION, TX);
  });

  it('TC-071-022 data_sharing_logs uses the active consent id and identity category', async () => {
    const d = build();
    d.gateway.call.mockResolvedValue({ httpStatus: 200, body: {}, idempotent: false });
    await d.service.runVerification(LEAD, KycType.PAN, panBody(), actorCtx());
    expect(d.repo.insertDataSharingLog).toHaveBeenCalledWith(
      expect.objectContaining({ consent_id: CONSENT, recipient: 'pan_provider' }),
      TX,
    );
  });

  it('TC-071-023 CKYC id written to lead_identities on success', async () => {
    const d = build();
    d.gateway.call.mockResolvedValue({ httpStatus: 200, body: { ckycId: '12345' }, idempotent: false });
    d.repo.insertVerification.mockResolvedValue(verifRow({ kyc_type: KycType.CKYC }));

    await d.service.runVerification(LEAD, KycType.CKYC, { consentId: CONSENT }, actorCtx());
    expect(d.repo.updateLeadIdentity).toHaveBeenCalledWith(
      IDENT,
      ORG,
      expect.objectContaining({ ckyc_id: '12345' }),
      KYCU,
      TX,
    );
  });

  it('TC-071-024 manual type skips the provider call', async () => {
    const d = build();
    d.repo.insertVerification.mockResolvedValue(verifRow({ kyc_type: KycType.MANUAL, provider: 'manual' }));

    const result = await d.service.runVerification(LEAD, KycType.MANUAL, { consentId: CONSENT }, actorCtx());

    expect(d.gateway.call).not.toHaveBeenCalled();
    expect(d.logRepo.createLog).not.toHaveBeenCalled();
    expect(d.repo.insertDataSharingLog).not.toHaveBeenCalled();
    expect(result.status).toBe(KycCheckStatus.SUCCESS);
    expect(d.audit.append).toHaveBeenCalled();
  });
});
