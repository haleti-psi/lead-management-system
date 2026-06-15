import {
  ApplicantScope,
  DocStatus,
  DocType,
  ERROR_CODES,
  KycStatus,
  RoleCode,
  ScanStatus,
  UploadChannel,
} from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { AppConfigService } from '../../core/config';
import type { DbTransaction, UnitOfWork } from '../../core/db';
import type { EntitlementService } from '../../core/auth';
import { GcsMockAdapter } from '../../core/integration/adapters/gcs-mock.adapter';
import { VirusScanMockAdapter } from '../../core/integration/adapters/virus-scan-mock.adapter';
import type { OutboxService } from '../../core/outbox';
import type { LeadService } from '../capture/lead.service';
import { DocumentRepository, type DocumentRow, type LeadChecklistContext } from './document.repository';
import { DocumentService, type DocumentActorContext } from './document.service';
import type { ChecklistDefinitionItem } from './dto/document-checklist.dto';
import type { UploadInitiateDto } from './dto/upload-initiate.dto';
import type { WaiverDto } from './dto/waiver.dto';

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD = 'b0000000-0000-0000-0000-00000000000b';
const RM = 'a0000000-0000-0000-0000-0000000000a1';
const KYC = 'a0000000-0000-0000-0000-0000000000c1';
const DOC = 'd0000000-0000-0000-0000-00000000000d';
const TX = { __tx: true } as unknown as DbTransaction;

/** A UnitOfWork double whose `run` invokes the callback with a fake tx. */
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
function fakeConfig(overrides: Record<string, number> = {}): AppConfigService {
  const values: Record<string, number> = { MAX_UPLOAD_MB: 10, GCS_SIGNED_URL_TTL: 600, ...overrides };
  return { get: (k: string) => values[k], isProduction: false } as unknown as AppConfigService;
}
function fakeEntitlements(granted: boolean): EntitlementService {
  return {
    can: jest.fn(async () => (granted ? { granted: true, scope: 'B', scopePredicate: { type: 'branch', branchId: 'b1' } } : { granted: false, reason: 'NO_CAPABILITY' })),
  } as unknown as EntitlementService;
}

function checklist(items: Partial<ChecklistDefinitionItem>[] = []): ChecklistDefinitionItem[] {
  return items.map((i) => ({
    doc_type: i.doc_type ?? DocType.PAN,
    applicant_scope: i.applicant_scope ?? ApplicantScope.APPLICANT,
    label: i.label ?? 'Doc',
    mandatory: i.mandatory ?? true,
  }));
}

function leadCtx(overrides: Partial<LeadChecklistContext> = {}): LeadChecklistContext {
  return {
    lead_id: LEAD,
    org_id: ORG,
    owner_id: RM,
    branch_id: 'b1',
    partner_id: null,
    kyc_status: KycStatus.NOT_STARTED,
    version: 1,
    document_checklist: [
      { doc_type: DocType.PAN, applicant_scope: ApplicantScope.APPLICANT, label: 'PAN', mandatory: true },
      { doc_type: DocType.ADDRESS, applicant_scope: ApplicantScope.APPLICANT, label: 'Address', mandatory: true },
    ],
    ...overrides,
  };
}

function docRow(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    document_id: DOC,
    org_id: ORG,
    lead_id: LEAD,
    doc_type: DocType.PAN,
    applicant_scope: ApplicantScope.APPLICANT,
    status: DocStatus.PENDING,
    storage_ref: null,
    file_type: 'application/pdf',
    file_size_kb: 200,
    version: 1,
    uploaded_via: UploadChannel.RM,
    verified_by: null,
    waiver_reason: null,
    classification: 'pii',
    virus_scan_status: ScanStatus.PENDING,
    expires_at: null,
    deleted_at: null,
    created_at: new Date('2026-06-01T00:00:00Z'),
    updated_at: new Date('2026-06-01T00:00:00Z'),
    created_by: RM,
    updated_by: RM,
    ...overrides,
  } as DocumentRow;
}

function actorCtx(overrides: Partial<DocumentActorContext> = {}): DocumentActorContext {
  return {
    userId: RM,
    orgId: ORG,
    role: RoleCode.RM,
    predicate: { type: 'own', userId: RM },
    requestMeta: { ip: '10.0.0.1', userAgent: 'jest' },
    ...overrides,
  };
}

interface Deps {
  service: DocumentService;
  repo: jest.Mocked<Pick<DocumentRepository, 'getLeadChecklistContext' | 'listByLead' | 'maxVersion' | 'insert' | 'getById' | 'getByIdUnscoped' | 'confirmUpload' | 'markUnderReview' | 'setScanStatus' | 'rejectInfected' | 'waiveDocument'>> & { latestPerType: DocumentRepository['latestPerType'] };
  gcs: GcsMockAdapter;
  scan: VirusScanMockAdapter;
  leads: { setKycStatus: jest.Mock };
  audit: { append: jest.Mock };
  outbox: { emit: jest.Mock };
}

function build(granted = false): Deps {
  const real = new DocumentRepository({} as never);
  const repo = {
    getLeadChecklistContext: jest.fn(),
    listByLead: jest.fn(async () => []),
    maxVersion: jest.fn(async () => 0),
    insert: jest.fn(async () => docRow()),
    getById: jest.fn(),
    getByIdUnscoped: jest.fn(),
    confirmUpload: jest.fn(async () => undefined),
    markUnderReview: jest.fn(async () => undefined),
    setScanStatus: jest.fn(async () => undefined),
    rejectInfected: jest.fn(async () => undefined),
    waiveDocument: jest.fn(async () => undefined),
    latestPerType: real.latestPerType.bind(real),
  } as unknown as Deps['repo'];
  const gcs = new GcsMockAdapter();
  const scan = new VirusScanMockAdapter();
  const leads = fakeLeads();
  const audit = fakeAudit();
  const outbox = fakeOutbox();
  const service = new DocumentService(
    fakeUow(),
    repo as unknown as DocumentRepository,
    leads as unknown as LeadService,
    audit as unknown as AuditAppender,
    outbox as unknown as OutboxService,
    fakeEntitlements(granted),
    fakeConfig(),
    gcs,
    scan,
  );
  return { service, repo, gcs, scan, leads, audit, outbox };
}

// ─────────────────────────────────────────────── deriveKycStatus (TC-001..003) ──

describe('DocumentService.deriveKycStatus', () => {
  const { service } = build();
  const list = checklist([
    { doc_type: DocType.PAN, applicant_scope: ApplicantScope.APPLICANT },
    { doc_type: DocType.ADDRESS, applicant_scope: ApplicantScope.APPLICANT },
  ]);

  it('TC-001 returns not_started when no docs exist', () => {
    expect(service.deriveKycStatus(list, [])).toBe(KycStatus.NOT_STARTED);
  });

  it('TC-002 returns in_progress when a mandatory doc is uploaded but not verified', () => {
    const docs = [docRow({ doc_type: DocType.PAN, status: DocStatus.UPLOADED })];
    expect(service.deriveKycStatus(list, docs)).toBe(KycStatus.IN_PROGRESS);
  });

  it('TC-003 returns verified when all mandatory docs are verified or waived', () => {
    const docs = [
      docRow({ doc_type: DocType.PAN, status: DocStatus.VERIFIED }),
      docRow({ document_id: 'd2', doc_type: DocType.ADDRESS, status: DocStatus.WAIVED }),
    ];
    expect(service.deriveKycStatus(list, docs)).toBe(KycStatus.VERIFIED);
  });

  it('treats not_required mandatory items as done', () => {
    const docs = [
      docRow({ doc_type: DocType.PAN, status: DocStatus.NOT_REQUIRED }),
      docRow({ document_id: 'd2', doc_type: DocType.ADDRESS, status: DocStatus.WAIVED }),
    ];
    expect(service.deriveKycStatus(list, docs)).toBe(KycStatus.VERIFIED);
  });
});

// ─────────────────────────────────────────────── initiateUpload (TC-004) ──

function initiateDto(overrides: Partial<UploadInitiateDto> = {}): UploadInitiateDto {
  return {
    doc_type: DocType.PAN,
    applicant_scope: ApplicantScope.APPLICANT,
    file_name: 'pan.pdf',
    file_type: 'application/pdf',
    file_size_kb: 200,
    ...overrides,
  };
}

describe('DocumentService.initiateUpload', () => {
  it('TC-004 rejects a doc_type not in the product checklist (VALIDATION_ERROR)', async () => {
    const d = build();
    d.repo.getLeadChecklistContext.mockResolvedValue(
      leadCtx({ document_checklist: [{ doc_type: DocType.PAN, applicant_scope: ApplicantScope.APPLICANT, label: 'PAN', mandatory: true }] }),
    );
    await expect(
      d.service.initiateUpload(LEAD, initiateDto({ doc_type: DocType.PHOTO }), actorCtx()),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_ERROR });
  });

  it('rejects an unsupported file type (415 UNSUPPORTED_MEDIA) before any DB work', async () => {
    const d = build();
    await expect(
      d.service.initiateUpload(LEAD, initiateDto({ file_type: 'application/zip' }), actorCtx()),
    ).rejects.toMatchObject({ code: ERROR_CODES.UNSUPPORTED_MEDIA });
    expect(d.repo.insert).not.toHaveBeenCalled();
  });

  it('rejects an oversize file (413 PAYLOAD_TOO_LARGE)', async () => {
    const d = build();
    await expect(
      d.service.initiateUpload(LEAD, initiateDto({ file_size_kb: 10 * 1024 + 1 }), actorCtx()),
    ).rejects.toMatchObject({ code: ERROR_CODES.PAYLOAD_TOO_LARGE });
  });

  it('happy path: inserts pending row, signs URL, audits, increments version', async () => {
    const d = build();
    d.repo.getLeadChecklistContext.mockResolvedValue(leadCtx());
    d.repo.maxVersion.mockResolvedValue(1);
    d.repo.insert.mockResolvedValue(docRow({ status: DocStatus.PENDING, version: 2 }));

    const result = await d.service.initiateUpload(LEAD, initiateDto(), actorCtx());

    expect(result.status).toBe(DocStatus.PENDING);
    expect(result.upload_url).toContain('storage.googleapis.com');
    expect(d.repo.insert).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }), TX);
    expect(d.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'doc_upload', entity_type: 'documents' }),
      TX,
    );
  });

  it('out-of-scope lead → FORBIDDEN', async () => {
    const d = build();
    d.repo.getLeadChecklistContext.mockResolvedValue(leadCtx({ owner_id: 'someone-else' }));
    await expect(d.service.initiateUpload(LEAD, initiateDto(), actorCtx())).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });

  it('absent lead → NOT_FOUND', async () => {
    const d = build();
    d.repo.getLeadChecklistContext.mockResolvedValue(undefined);
    await expect(d.service.initiateUpload(LEAD, initiateDto(), actorCtx())).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('customer token path is token-scoped: no predicate, yet NOT FORBIDDEN', async () => {
    const d = build();
    d.repo.getLeadChecklistContext.mockResolvedValue(leadCtx({ owner_id: 'someone-else' }));
    d.repo.insert.mockResolvedValue(
      docRow({ status: DocStatus.PENDING, uploaded_via: UploadChannel.CUSTOMER_LINK }),
    );

    const result = await d.service.initiateCustomerUpload(initiateDto(), {
      leadId: LEAD,
      orgId: ORG,
      requestMeta: { ip: '10.0.0.1', userAgent: 'jest' },
    });

    expect(result.status).toBe(DocStatus.PENDING);
    expect(result.upload_url).toContain('storage.googleapis.com');
    expect(d.repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ uploaded_via: UploadChannel.CUSTOMER_LINK }),
      TX,
    );
  });
});

// ─────────────────────────────────────────────── confirmUpload (TC-007) ──

describe('DocumentService.confirmUpload', () => {
  it('TC-007 MIME mismatch → VALIDATION_ERROR + GCS deletion, status stays pending', async () => {
    const d = build();
    d.repo.getLeadChecklistContext.mockResolvedValue(leadCtx());
    d.repo.getById.mockResolvedValue(docRow({ status: DocStatus.PENDING, file_type: 'application/pdf' }));
    // Object stored as jpeg though declared pdf.
    d.gcs.setObjectMetadata(`leads/${LEAD}/${DocType.PAN}/${ApplicantScope.APPLICANT}/${DOC}`, {
      contentType: 'image/jpeg',
      sizeBytes: 10,
    });

    await expect(
      d.service.confirmUpload(LEAD, { action: 'confirm', document_id: DOC }, actorCtx()),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_ERROR });

    expect(d.gcs.deletedPaths()).toContain(`leads/${LEAD}/${DocType.PAN}/${ApplicantScope.APPLICANT}/${DOC}`);
    expect(d.repo.confirmUpload).not.toHaveBeenCalled();
  });

  it('happy path: confirms, enqueues scan, re-derives kyc, emits outbox + audit', async () => {
    const d = build();
    d.repo.getLeadChecklistContext.mockResolvedValue(leadCtx());
    d.repo.getById.mockResolvedValue(docRow({ status: DocStatus.PENDING }));
    d.gcs.setObjectMetadata(`leads/${LEAD}/${DocType.PAN}/${ApplicantScope.APPLICANT}/${DOC}`, {
      contentType: 'application/pdf',
      sizeBytes: 10,
    });

    const result = await d.service.confirmUpload(LEAD, { action: 'confirm', document_id: DOC }, actorCtx());

    expect(result.status).toBe(DocStatus.UPLOADED);
    expect(d.repo.confirmUpload).toHaveBeenCalled();
    expect(d.scan.enqueuedScans()).toHaveLength(1);
    expect(d.leads.setKycStatus).toHaveBeenCalled();
    expect(d.outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event_code: 'DOC_UPLOADED', aggregate_type: 'documents' }),
      TX,
    );
  });

  it('unknown/non-pending document → NOT_FOUND', async () => {
    const d = build();
    d.repo.getLeadChecklistContext.mockResolvedValue(leadCtx());
    d.repo.getById.mockResolvedValue(undefined);
    await expect(
      d.service.confirmUpload(LEAD, { action: 'confirm', document_id: DOC }, actorCtx()),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });
});

// ─────────────────────────────────────────────── waiveDocument (TC-005, TC-006) ──

function waiverDto(overrides: Partial<WaiverDto> = {}): WaiverDto {
  return { reason: 'Flood victim; compliance approved EX-2026-00123', ...overrides } as WaiverDto;
}

describe('DocumentService.waiveDocument', () => {
  it('TC-005 RM (no verify_doc) → FORBIDDEN', async () => {
    const d = build(false);
    d.repo.getLeadChecklistContext.mockResolvedValue(leadCtx());
    await expect(
      d.service.waiveDocument(LEAD, DOC, waiverDto(), actorCtx({ role: RoleCode.RM })),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it('TC-006 already-waived document → CONFLICT', async () => {
    const d = build(true);
    d.repo.getLeadChecklistContext.mockResolvedValue(leadCtx());
    d.repo.getById.mockResolvedValue(docRow({ status: DocStatus.WAIVED }));
    await expect(
      d.service.waiveDocument(LEAD, DOC, waiverDto(), actorCtx({ role: RoleCode.KYC, userId: KYC })),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it('happy path (KYC): waives, re-derives kyc, audits doc_waive, emits outbox', async () => {
    const d = build(true);
    d.repo.getLeadChecklistContext.mockResolvedValue(leadCtx());
    d.repo.getById.mockResolvedValue(docRow({ status: DocStatus.UPLOADED }));

    const result = await d.service.waiveDocument(LEAD, DOC, waiverDto(), actorCtx({ role: RoleCode.KYC, userId: KYC }));

    expect(result.status).toBe(DocStatus.WAIVED);
    expect(d.repo.waiveDocument).toHaveBeenCalled();
    expect(d.leads.setKycStatus).toHaveBeenCalled();
    expect(d.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'doc_waive' }),
      TX,
    );
    expect(d.outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event_code: 'DOC_UPLOADED' }),
      TX,
    );
  });
});

// ─────────────────────────────────────────────── handleScanResult (TC-020) ──

describe('DocumentService.handleScanResult', () => {
  it('TC-020 infected → reject doc, delete GCS object, audit + outbox', async () => {
    const d = build();
    d.repo.getByIdUnscoped.mockResolvedValue(
      docRow({ status: DocStatus.UPLOADED, virus_scan_status: ScanStatus.PENDING, storage_ref: 'leads/x/obj' }),
    );

    await d.service.handleScanResult(DOC, 'infected');

    expect(d.repo.rejectInfected).toHaveBeenCalledWith(DOC, ORG, TX);
    expect(d.gcs.deletedPaths()).toContain('leads/x/obj');
    expect(d.audit.append).toHaveBeenCalled();
    expect(d.outbox.emit).toHaveBeenCalled();
    // kyc derivation is NOT advanced on rejection.
    expect(d.leads.setKycStatus).not.toHaveBeenCalled();
  });

  it('clean → mark under_review, re-derive kyc, audit + outbox', async () => {
    const d = build();
    d.repo.getByIdUnscoped.mockResolvedValue(
      docRow({ status: DocStatus.UPLOADED, virus_scan_status: ScanStatus.PENDING, storage_ref: 'leads/x/obj' }),
    );
    d.repo.getLeadChecklistContext.mockResolvedValue(leadCtx());

    await d.service.handleScanResult(DOC, 'clean');

    expect(d.repo.setScanStatus).toHaveBeenCalledWith(DOC, 'clean', ORG, TX);
    expect(d.repo.markUnderReview).toHaveBeenCalledWith(DOC, ORG, TX);
    expect(d.leads.setKycStatus).toHaveBeenCalled();
    expect(d.gcs.deletedPaths()).not.toContain('leads/x/obj');
  });

  it('unknown document → NOT_FOUND', async () => {
    const d = build();
    d.repo.getByIdUnscoped.mockResolvedValue(undefined);
    await expect(d.service.handleScanResult(DOC, 'clean')).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });
});

// ─────────────────────────────────────────────── listChecklist (TC-008 analogue) ──

describe('DocumentService.listChecklist', () => {
  it('merges checklist with docs; mandatory_complete=false when one is pending', async () => {
    const d = build();
    d.repo.getLeadChecklistContext.mockResolvedValue(leadCtx({ kyc_status: KycStatus.IN_PROGRESS }));
    d.repo.listByLead.mockResolvedValue([docRow({ doc_type: DocType.PAN, status: DocStatus.UPLOADED })]);

    const result = await d.service.listChecklist(LEAD, actorCtx());

    expect(result.checklist).toHaveLength(2);
    expect(result.kyc_status).toBe(KycStatus.IN_PROGRESS);
    expect(result.mandatory_complete).toBe(false);
    const pan = result.checklist.find((i) => i.doc_type === DocType.PAN);
    const addr = result.checklist.find((i) => i.doc_type === DocType.ADDRESS);
    expect(pan?.status).toBe(DocStatus.UPLOADED);
    expect(addr?.status).toBe(DocStatus.PENDING);
  });
});
