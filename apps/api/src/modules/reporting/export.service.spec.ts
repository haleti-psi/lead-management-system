import {
  AuditAction,
  DataScope,
  ERROR_CODES,
  JobStatus,
  MaskingLevel,
  RoleCode,
} from '@lms/shared';
import type { Logger } from 'nestjs-pino';

import type { AuthUser } from '../../core/auth';
import type { EntitlementCacheService } from '../../core/auth';
import type { AuditAppender } from '../../core/audit';
import type { AppConfigService } from '../../core/config';
import type { DbTransaction, UnitOfWork } from '../../core/db';
import { isDomainException } from '../../core/http';
import type { MaskingService } from '../../core/masking';
import type { OutboxService } from '../../core/outbox';
import type { ExportJobRow, ExportRepository } from './export.repository';
import { ExportService } from './export.service';
import type { ExportTaskPort } from './ports/export-task.port';
import type { ExportStoragePort } from './ports/export-storage.port';
import type { ReportService } from './report.service';

const ORG = '00000000-0000-0000-0000-000000000001';
const USER_A = '00000000-0000-0000-0000-000000000011';
const USER_B = '00000000-0000-0000-0000-000000000012';
const BRANCH_A = '00000000-0000-0000-0000-000000000021';
const JOB_ID = '00000000-0000-0000-0000-000000000099';

function actor(role: RoleCode, scope: DataScope = DataScope.A, userId = USER_A): AuthUser {
  return { userId, orgId: ORG, role, scope, jti: 'jti-1' };
}

function makeJob(overrides: Partial<ExportJobRow> = {}): ExportJobRow {
  return {
    export_job_id: JOB_ID,
    org_id: ORG,
    requested_by: USER_A,
    report_code: 'funnel_conversion',
    filters: '{}',
    scope: DataScope.A,
    masking_level: MaskingLevel.PARTIAL,
    status: JobStatus.QUEUED,
    approver_id: null,
    artefact_ref: null,
    row_count: null,
    created_at: new Date('2026-06-01T10:00:00Z'),
    updated_at: new Date('2026-06-01T10:00:00Z'),
    created_by: USER_A,
    updated_by: USER_A,
    ...overrides,
  } as ExportJobRow;
}

function mockRepo(overrides: Partial<jest.Mocked<ExportRepository>> = {}): jest.Mocked<ExportRepository> {
  return {
    create: jest.fn().mockResolvedValue(makeJob()),
    findById: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    estimateRowCount: jest.fn().mockResolvedValue(100),
    ...overrides,
  } as unknown as jest.Mocked<ExportRepository>;
}

/** Build a minimal UoW stub with a tx that satisfies selectFrom chaining. */
function mockUow(): jest.Mocked<UnitOfWork> {
  const txStub = {
    selectFrom: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    executeTakeFirst: jest.fn().mockResolvedValue({ full_name: 'Test User', user_id: USER_A }),
  };
  return {
    run: jest.fn().mockImplementation((fn: (t: DbTransaction) => Promise<unknown>) => fn(txStub as unknown as DbTransaction)),
    tx: jest.fn().mockReturnValue(txStub),
    isActive: false,
  } as unknown as jest.Mocked<UnitOfWork>;
}

function mockAudit(): jest.Mocked<AuditAppender> {
  return { append: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<AuditAppender>;
}

function mockOutbox(): jest.Mocked<OutboxService> {
  return { emit: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<OutboxService>;
}

function mockEntitlement(
  scope: DataScope = DataScope.A,
  branchId: string | null = BRANCH_A,
  teamId: string | null = null,
): jest.Mocked<EntitlementCacheService> {
  return {
    loadActorEntitlement: jest.fn().mockResolvedValue({
      defaultScope: scope,
      branchId,
      teamId,
      regionId: null,
      partnerId: null,
    }),
    loadTeamMemberIds: jest.fn().mockResolvedValue([USER_A, USER_B]),
    loadRegionBranchIds: jest.fn().mockResolvedValue([BRANCH_A]),
    invalidateUser: jest.fn(),
    invalidateRole: jest.fn(),
  } as unknown as jest.Mocked<EntitlementCacheService>;
}

const TEAM_A = '00000000-0000-0000-0000-000000000031';

function mockReportService(rows: Record<string, unknown>[] = [], total = 0): jest.Mocked<ReportService> {
  return {
    fetchExportRows: jest.fn().mockResolvedValue({ rows, total }),
  } as unknown as jest.Mocked<ReportService>;
}

function mockMaskingService(): jest.Mocked<MaskingService> {
  return {
    mask: jest.fn().mockImplementation((_field: string, value: string | null | undefined) => value ?? null),
  } as unknown as jest.Mocked<MaskingService>;
}

function mockConfig(overrides: Partial<Record<string, unknown>> = {}): jest.Mocked<AppConfigService> {
  const defaults: Record<string, unknown> = {
    EXPORT_APPROVAL_ROW_THRESHOLD: 5000,
    EXPORT_REQUIRE_APPROVAL_ON_THRESHOLD: true,
    GCS_SIGNED_URL_TTL: 600,
    ...overrides,
  };
  return { get: jest.fn((k: string) => defaults[k]) } as unknown as jest.Mocked<AppConfigService>;
}

function mockTaskPort(): jest.Mocked<ExportTaskPort> {
  return { enqueue: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<ExportTaskPort>;
}

function mockStoragePort(): jest.Mocked<ExportStoragePort> {
  return {
    upload: jest.fn().mockResolvedValue(undefined),
    getSignedUrl: jest.fn().mockResolvedValue('https://storage.example.com/signed'),
  } as unknown as jest.Mocked<ExportStoragePort>;
}

function mockLogger(): jest.Mocked<Logger> {
  return {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function makeService(
  overrides: {
    repo?: Partial<jest.Mocked<ExportRepository>>;
    uow?: jest.Mocked<UnitOfWork>;
    config?: jest.Mocked<AppConfigService>;
    entitlement?: jest.Mocked<EntitlementCacheService>;
    taskPort?: jest.Mocked<ExportTaskPort>;
    storagePort?: jest.Mocked<ExportStoragePort>;
    reportService?: jest.Mocked<ReportService>;
    masking?: jest.Mocked<MaskingService>;
  } = {},
) {
  const repo = mockRepo(overrides.repo);
  const uow = overrides.uow ?? mockUow();
  const audit = mockAudit();
  const outbox = mockOutbox();
  const entitlement = overrides.entitlement ?? mockEntitlement();
  const config = overrides.config ?? mockConfig();
  const taskPort = overrides.taskPort ?? mockTaskPort();
  const storagePort = overrides.storagePort ?? mockStoragePort();
  const logger = mockLogger();
  const reportService = overrides.reportService ?? mockReportService();
  const masking = overrides.masking ?? mockMaskingService();

  const service = new ExportService(
    repo,
    uow,
    audit,
    outbox,
    entitlement,
    config,
    logger,
    taskPort,
    storagePort,
    reportService,
    masking,
  );

  return { service, repo, uow, audit, outbox, entitlement, config, taskPort, storagePort, reportService, masking };
}

const validDto = {
  report_code: 'funnel_conversion',
  filters: { date_from: '2026-05-01', date_to: '2026-05-31' },
  scope: DataScope.A,
  masking_level: MaskingLevel.PARTIAL,
  purpose: 'monthly_review',
};

// ── TC-01 / TC-05 / TC-06: Approval threshold gate ────────────────────────

describe('ExportService.create — approval threshold', () => {
  it('returns queued status when estimated rows < threshold (TC-01)', async () => {
    const { service, taskPort } = makeService({
      repo: {
        estimateRowCount: jest.fn().mockResolvedValue(100),
        create: jest.fn().mockResolvedValue(makeJob({ status: JobStatus.QUEUED })),
      },
    });

    const result = await service.create(validDto, actor(RoleCode.HEAD, DataScope.A));

    expect(result.requiresApproval).toBe(false);
    expect(result.job.status).toBe(JobStatus.QUEUED);
    expect(taskPort.enqueue).toHaveBeenCalledWith(JOB_ID);
  });

  it('sets awaiting_approval when estimated rows >= threshold (TC-06)', async () => {
    const { service, taskPort } = makeService({
      repo: {
        estimateRowCount: jest.fn().mockResolvedValue(6000),
        create: jest.fn().mockResolvedValue(makeJob({ status: JobStatus.AWAITING_APPROVAL })),
      },
    });

    const result = await service.create(validDto, actor(RoleCode.HEAD, DataScope.A));

    expect(result.requiresApproval).toBe(true);
    expect(result.job.status).toBe(JobStatus.AWAITING_APPROVAL);
    expect(taskPort.enqueue).not.toHaveBeenCalled();
  });

  it('sets awaiting_approval when masking_level is unmasked (TC-05)', async () => {
    const { service, taskPort } = makeService({
      repo: {
        estimateRowCount: jest.fn().mockResolvedValue(10),
        create: jest.fn().mockResolvedValue(makeJob({ status: JobStatus.AWAITING_APPROVAL, masking_level: MaskingLevel.UNMASKED })),
      },
    });

    const dpoDto = { ...validDto, masking_level: MaskingLevel.UNMASKED };
    const result = await service.create(dpoDto, actor(RoleCode.DPO, DataScope.A));

    expect(result.requiresApproval).toBe(true);
    expect(taskPort.enqueue).not.toHaveBeenCalled();
  });
});

// ── TC-12: Masking level enforcement ─────────────────────────────────────

describe('ExportService.create — masking level enforcement (TC-12)', () => {
  it('throws VALIDATION_ERROR when RM requests partial masking', async () => {
    const { service } = makeService();
    const dto = { ...validDto, masking_level: MaskingLevel.PARTIAL };
    try {
      await service.create(dto, actor(RoleCode.RM, DataScope.O));
      fail('should have thrown');
    } catch (err) {
      expect(isDomainException(err)).toBe(true);
      if (isDomainException(err)) {
        expect(err.code).toBe(ERROR_CODES.VALIDATION_ERROR);
        expect(err.fields?.[0]?.field).toBe('masking_level');
      }
    }
  });

  it('allows HEAD to request partial masking', async () => {
    const { service } = makeService();
    const dto = { ...validDto, masking_level: MaskingLevel.PARTIAL };
    const result = await service.create(dto, actor(RoleCode.HEAD, DataScope.A));
    expect(result).toBeDefined();
  });

  it('throws VALIDATION_ERROR when BM requests unmasked', async () => {
    const { service } = makeService({
      entitlement: mockEntitlement(DataScope.B),
    });
    const dto = { ...validDto, masking_level: MaskingLevel.UNMASKED, scope: DataScope.B };
    try {
      await service.create(dto, actor(RoleCode.BM, DataScope.B));
      fail('should have thrown');
    } catch (err) {
      expect(isDomainException(err)).toBe(true);
      if (isDomainException(err)) {
        expect(err.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      }
    }
  });

  it('allows DPO to request unmasked (triggers approval gate)', async () => {
    const { service } = makeService({
      repo: {
        estimateRowCount: jest.fn().mockResolvedValue(10),
        create: jest.fn().mockResolvedValue(makeJob({ status: JobStatus.AWAITING_APPROVAL, masking_level: MaskingLevel.UNMASKED })),
      },
    });
    const dto = { ...validDto, masking_level: MaskingLevel.UNMASKED };
    const result = await service.create(dto, actor(RoleCode.DPO, DataScope.A));
    expect(result.requiresApproval).toBe(true);
  });
});

// ── TC-13: Scope cross-check ──────────────────────────────────────────────

describe('ExportService.create — scope cross-check (TC-13)', () => {
  it('throws FORBIDDEN when RM (scope O) requests scope B', async () => {
    const { service } = makeService({
      entitlement: mockEntitlement(DataScope.O),
    });

    const dto = { ...validDto, scope: DataScope.B, masking_level: MaskingLevel.FULL };
    try {
      await service.create(dto, actor(RoleCode.RM, DataScope.O));
      fail('should have thrown');
    } catch (err) {
      expect(isDomainException(err)).toBe(true);
      if (isDomainException(err)) {
        expect(err.code).toBe(ERROR_CODES.FORBIDDEN);
      }
    }
  });

  it('allows HEAD (scope A) to request scope A', async () => {
    const { service } = makeService({
      entitlement: mockEntitlement(DataScope.A),
    });
    const dto = { ...validDto, scope: DataScope.A, masking_level: MaskingLevel.PARTIAL };
    const result = await service.create(dto, actor(RoleCode.HEAD, DataScope.A));
    expect(result).toBeDefined();
  });
});

// ── TC-07: Approval flow happy path ──────────────────────────────────────

describe('ExportService.approve — happy path (TC-07)', () => {
  it('transitions awaiting_approval to queued and enqueues task', async () => {
    const awaitingJob = makeJob({ status: JobStatus.AWAITING_APPROVAL, requested_by: USER_B, scope: DataScope.T });
    const queuedJob = makeJob({ status: JobStatus.QUEUED, requested_by: USER_B, approver_id: USER_A, scope: DataScope.T });

    const { service, taskPort } = makeService({
      repo: {
        findById: jest.fn()
          .mockResolvedValueOnce(awaitingJob)
          .mockResolvedValueOnce(queuedJob),
        updateStatus: jest.fn().mockResolvedValue(undefined),
      },
      entitlement: mockEntitlement(DataScope.A), // approver has broad scope
    });

    const result = await service.approve(JOB_ID, actor(RoleCode.HEAD, DataScope.A, USER_A));

    expect(result.status).toBe(JobStatus.QUEUED);
    expect(taskPort.enqueue).toHaveBeenCalledWith(JOB_ID);
  });
});

// ── TC-08: Self-approval blocked ─────────────────────────────────────────

describe('ExportService.approve — self-approval blocked (TC-08)', () => {
  it('throws FORBIDDEN when requester tries to approve own job', async () => {
    const awaitingJob = makeJob({ status: JobStatus.AWAITING_APPROVAL, requested_by: USER_A });
    const { service } = makeService({
      repo: { findById: jest.fn().mockResolvedValue(awaitingJob) },
    });

    try {
      await service.approve(JOB_ID, actor(RoleCode.HEAD, DataScope.A, USER_A));
      fail('should have thrown');
    } catch (err) {
      expect(isDomainException(err)).toBe(true);
      if (isDomainException(err)) {
        expect(err.code).toBe(ERROR_CODES.FORBIDDEN);
      }
    }
  });
});

// ── TC-09: Approving non-awaiting job ────────────────────────────────────

describe('ExportService.approve — non-awaiting_approval job (TC-09)', () => {
  it('throws CONFLICT when job is queued (not awaiting_approval)', async () => {
    const queuedJob = makeJob({ status: JobStatus.QUEUED, requested_by: USER_B });
    const { service } = makeService({
      repo: { findById: jest.fn().mockResolvedValue(queuedJob) },
    });

    try {
      await service.approve(JOB_ID, actor(RoleCode.HEAD, DataScope.A, USER_A));
      fail('should have thrown');
    } catch (err) {
      expect(isDomainException(err)).toBe(true);
      if (isDomainException(err)) {
        expect(err.code).toBe(ERROR_CODES.CONFLICT);
      }
    }
  });
});

// ── TC-04: Scoped list ────────────────────────────────────────────────────

describe('ExportService.list — scoped filtering', () => {
  it('lists own exports for RM role (TC-04)', async () => {
    const { service, repo } = makeService({
      repo: {
        list: jest.fn().mockResolvedValue({ rows: [makeJob()], total: 1 }),
      },
    });

    const result = await service.list(actor(RoleCode.RM, DataScope.O), 1, 25);

    expect(repo.list).toHaveBeenCalledWith(
      expect.objectContaining({ ownOnly: true, actorId: USER_A }),
    );
    expect(result.total).toBe(1);
  });

  it('lists all org exports for HEAD role (scope A)', async () => {
    const { service, repo } = makeService({
      repo: {
        list: jest.fn().mockResolvedValue({ rows: [makeJob()], total: 5 }),
      },
    });

    await service.list(actor(RoleCode.HEAD, DataScope.A), 1, 25);

    expect(repo.list).toHaveBeenCalledWith(
      expect.objectContaining({ ownOnly: false, branchId: undefined }),
    );
  });

  it('lists branch exports for BM role', async () => {
    const { service, repo } = makeService({
      repo: {
        list: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      },
      entitlement: mockEntitlement(DataScope.B, BRANCH_A),
    });

    await service.list(actor(RoleCode.BM, DataScope.B), 1, 25);

    expect(repo.list).toHaveBeenCalledWith(
      expect.objectContaining({ ownOnly: false, branchId: BRANCH_A }),
    );
  });
});

// ── TC-10: Authz negative — cross-scope read ─────────────────────────────

describe('ExportService.getById — authz (TC-10)', () => {
  it('throws FORBIDDEN when RM reads another user job (TC-10)', async () => {
    const job = makeJob({ requested_by: USER_B });
    const { service } = makeService({
      repo: { findById: jest.fn().mockResolvedValue(job) },
    });

    try {
      await service.getById(JOB_ID, actor(RoleCode.RM, DataScope.O, USER_A));
      fail('should have thrown');
    } catch (err) {
      expect(isDomainException(err)).toBe(true);
      if (isDomainException(err)) {
        expect(err.code).toBe(ERROR_CODES.FORBIDDEN);
      }
    }
  });

  it('throws NOT_FOUND when job does not exist', async () => {
    const { service } = makeService({
      repo: { findById: jest.fn().mockResolvedValue(undefined) },
    });

    try {
      await service.getById(JOB_ID, actor(RoleCode.HEAD, DataScope.A));
      fail('should have thrown');
    } catch (err) {
      expect(isDomainException(err)).toBe(true);
      if (isDomainException(err)) {
        expect(err.code).toBe(ERROR_CODES.NOT_FOUND);
      }
    }
  });

  it('returns download_url null when status is not completed', async () => {
    const job = makeJob({ status: JobStatus.QUEUED });
    const { service } = makeService({
      repo: { findById: jest.fn().mockResolvedValue(job) },
    });

    const result = await service.getById(JOB_ID, actor(RoleCode.HEAD, DataScope.A));

    expect(result.download_url).toBeNull();
    expect(result.download_url_expires_at).toBeNull();
  });

  it('returns signed URL when status is completed and artefact_ref is set (TC-03)', async () => {
    const job = makeJob({ status: JobStatus.COMPLETED, artefact_ref: `exports/${ORG}/${JOB_ID}.csv` });
    const storagePort = mockStoragePort();
    const { service } = makeService({
      repo: { findById: jest.fn().mockResolvedValue(job) },
      storagePort,
    });

    const result = await service.getById(JOB_ID, actor(RoleCode.HEAD, DataScope.A));

    expect(result.download_url).toBe('https://storage.example.com/signed');
    expect(storagePort.getSignedUrl).toHaveBeenCalledWith(`exports/${ORG}/${JOB_ID}.csv`, 600);
  });

  it('never exposes artefact_ref in the response (TC-03)', async () => {
    const job = makeJob({ status: JobStatus.COMPLETED, artefact_ref: `exports/${ORG}/${JOB_ID}.csv` });
    const { service } = makeService({
      repo: { findById: jest.fn().mockResolvedValue(job) },
    });

    const result = await service.getById(JOB_ID, actor(RoleCode.HEAD, DataScope.A));

    expect(result).not.toHaveProperty('artefact_ref');
  });
});

// ── TC-19: Worker — GCS failure marks job failed ─────────────────────────

describe('ExportService.generate — worker state transitions', () => {
  it('marks job failed on GCS upload error (TC-19)', async () => {
    const failingStorage: ExportStoragePort = {
      upload: jest.fn().mockRejectedValue(new Error('GCS unavailable')),
      getSignedUrl: jest.fn().mockResolvedValue(''),
    };
    const job = makeJob({ status: JobStatus.QUEUED });
    const repo = mockRepo({ findById: jest.fn().mockResolvedValue(job) });
    const uow = mockUow();
    // Override tx().selectFrom() to return org_id
    (uow.tx as jest.Mock).mockReturnValue({
      selectFrom: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockResolvedValue({ org_id: ORG, full_name: 'Test', user_id: USER_A }),
      }),
    });

    const service = new ExportService(
      repo,
      uow,
      mockAudit(),
      mockOutbox(),
      mockEntitlement(),
      mockConfig(),
      mockLogger(),
      mockTaskPort(),
      failingStorage,
      mockReportService(),
      mockMaskingService(),
    );

    await service.generate(JOB_ID);

    const updateStatusCalls = (repo.updateStatus as jest.Mock).mock.calls as unknown[][];
    // updateStatus(tx, jobId, orgId, status, updatedBy) — status is arg index 3
    const failCall = updateStatusCalls.find((c) => c[3] === JobStatus.FAILED);
    expect(failCall).toBeDefined();
  });
});

// ── Audit: no PII in detail ───────────────────────────────────────────────

describe('ExportService — audit detail does not contain PII (filter_keys only)', () => {
  it('audit detail contains filter_keys not filter values', async () => {
    const audit = mockAudit();
    // Re-create service with real audit mock to capture
    const svc = new ExportService(
      mockRepo({ estimateRowCount: jest.fn().mockResolvedValue(100), create: jest.fn().mockResolvedValue(makeJob()) }),
      mockUow(),
      audit,
      mockOutbox(),
      mockEntitlement(),
      mockConfig(),
      mockLogger(),
      mockTaskPort(),
      mockStoragePort(),
      mockReportService(),
      mockMaskingService(),
    );

    const dto = {
      ...validDto,
      filters: { date_from: '2026-05-01', mobile: '9876543210' },
    };

    await svc.create(dto, actor(RoleCode.HEAD, DataScope.A));

    const appendArg = (audit.append as jest.Mock).mock.calls[0]?.[0] as {
      action: AuditAction;
      detail: Record<string, unknown>;
    };

    expect(appendArg.action).toBe(AuditAction.EXPORT_GENERATE);
    expect(appendArg.detail['filter_keys']).toEqual(expect.arrayContaining(['date_from', 'mobile']));
    // Raw PII value must NOT appear
    const detailStr = JSON.stringify(appendArg.detail);
    expect(detailStr).not.toContain('9876543210');
  });
});

// ── TC-18: Worker watermark in generated file ─────────────────────────────

describe('ExportService.generate — watermark in generated file (TC-18)', () => {
  it('CSV first line contains watermark with user name and report_code', async () => {
    const job = makeJob({ status: JobStatus.QUEUED });
    const repo = mockRepo({ findById: jest.fn().mockResolvedValue(job) });
    const storagePort = mockStoragePort();
    const uow = mockUow();
    (uow.tx as jest.Mock).mockReturnValue({
      selectFrom: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockResolvedValue({ org_id: ORG, full_name: 'Test User', user_id: USER_A }),
      }),
    });

    const service = new ExportService(
      repo,
      uow,
      mockAudit(),
      mockOutbox(),
      mockEntitlement(),
      mockConfig(),
      mockLogger(),
      mockTaskPort(),
      storagePort,
      mockReportService([{ dimension: 'PL', captured: 5 }], 1),
      mockMaskingService(),
    );

    await service.generate(JOB_ID);

    const uploadCall = (storagePort.upload as jest.Mock).mock.calls[0] as [string, string];
    const csvContent = uploadCall?.[1] ?? '';
    // First line (after BOM) is the watermark
    const firstLine = csvContent.replace(/^﻿/, '').split('\n')[0] ?? '';
    expect(firstLine).toContain('# LMS Export');
    expect(firstLine).toContain('funnel_conversion');
    expect(firstLine).toContain('Test User');
  });
});

// ── Worker: real report rows ─────────────────────────────────────────────

describe('ExportService.generate — real report rows (FIX-1)', () => {
  function makeWorkerUow() {
    const uow = mockUow();
    (uow.tx as jest.Mock).mockReturnValue({
      selectFrom: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockResolvedValue({ org_id: ORG, full_name: 'Worker User', user_id: USER_A }),
      }),
    });
    return uow;
  }

  it('CSV contains real report rows from fetchExportRows (paged)', async () => {
    const row1 = { dimension: 'PL', captured: 10 };
    const row2 = { dimension: 'HL', captured: 5 };
    const reportSvc = {
      fetchExportRows: jest.fn()
        .mockResolvedValueOnce({ rows: [row1], total: 2 })
        .mockResolvedValueOnce({ rows: [row2], total: 2 }),
    } as unknown as jest.Mocked<ReportService>;
    const storagePort = mockStoragePort();
    const job = makeJob({ status: JobStatus.QUEUED });
    const repo = mockRepo({ findById: jest.fn().mockResolvedValue(job) });

    const service = new ExportService(
      repo,
      makeWorkerUow(),
      mockAudit(),
      mockOutbox(),
      mockEntitlement(DataScope.A),
      mockConfig(),
      mockLogger(),
      mockTaskPort(),
      storagePort,
      reportSvc,
      mockMaskingService(),
    );

    await service.generate(JOB_ID);

    // fetchExportRows called at least twice (once per page until total collected)
    expect(reportSvc.fetchExportRows).toHaveBeenCalledTimes(2);
    const csvContent = ((storagePort.upload as jest.Mock).mock.calls[0] as [string, string])[1] ?? '';
    expect(csvContent).toContain('PL');
    expect(csvContent).toContain('HL');
  });

  it('row_count reflects real data rows (not line count)', async () => {
    const rows = [{ dimension: 'PL', captured: 3 }, { dimension: 'HL', captured: 7 }];
    const reportSvc = mockReportService(rows, 2);
    const storagePort = mockStoragePort();
    const repo = mockRepo({ findById: jest.fn().mockResolvedValue(makeJob({ status: JobStatus.QUEUED })) });
    const mockUpdateStatus = jest.fn().mockResolvedValue(undefined);

    const service = new ExportService(
      { ...mockRepo(), findById: jest.fn().mockResolvedValue(makeJob({ status: JobStatus.QUEUED })), updateStatus: mockUpdateStatus } as unknown as jest.Mocked<ExportRepository>,
      makeWorkerUow(),
      mockAudit(),
      mockOutbox(),
      mockEntitlement(DataScope.A),
      mockConfig(),
      mockLogger(),
      mockTaskPort(),
      storagePort,
      reportSvc,
      mockMaskingService(),
    );
    void repo; // suppress unused

    await service.generate(JOB_ID);

    // Find the COMPLETED updateStatus call — arg index 3 is status, index 5 extra
    const completedCall = (mockUpdateStatus as jest.Mock).mock.calls.find(
      (c: unknown[]) => c[3] === JobStatus.COMPLETED,
    ) as [unknown, unknown, unknown, unknown, unknown, { rowCount?: number }] | undefined;
    expect(completedCall?.[5]?.rowCount).toBe(2);
  });

  it('terminates when a page returns no rows even if total is over-counted (no infinite loop)', async () => {
    // A report whose count query over-counts (total=999) but whose data runs out
    // after one page must NOT spin forever fetching empty pages.
    const reportSvc = {
      fetchExportRows: jest.fn()
        .mockResolvedValueOnce({ rows: [{ dimension: 'PL', captured: 3 }], total: 999 })
        .mockResolvedValue({ rows: [], total: 999 }),
    } as unknown as jest.Mocked<ReportService>;
    const storagePort = mockStoragePort();

    const service = new ExportService(
      mockRepo({ findById: jest.fn().mockResolvedValue(makeJob({ status: JobStatus.QUEUED })) }),
      makeWorkerUow(),
      mockAudit(),
      mockOutbox(),
      mockEntitlement(DataScope.A),
      mockConfig(),
      mockLogger(),
      mockTaskPort(),
      storagePort,
      reportSvc,
      mockMaskingService(),
    );

    await service.generate(JOB_ID);

    // Stops after the first empty page (page 1 rows + page 2 empty = 2 calls).
    expect(reportSvc.fetchExportRows).toHaveBeenCalledTimes(2);
    const csvContent = ((storagePort.upload as jest.Mock).mock.calls[0] as [string, string])[1] ?? '';
    expect(csvContent).toContain('PL');
  });

  it('applies masking for full/partial level (owner_name masked)', async () => {
    const rowWithName = { owner_name: 'Alice Johnson', captured: 5 };
    const reportSvc = mockReportService([rowWithName], 1);
    const maskingSvc = {
      mask: jest.fn().mockReturnValue('Alice'),
    } as unknown as jest.Mocked<MaskingService>;
    const storagePort = mockStoragePort();

    const service = new ExportService(
      mockRepo({ findById: jest.fn().mockResolvedValue(makeJob({ status: JobStatus.QUEUED, masking_level: MaskingLevel.FULL })) }),
      makeWorkerUow(),
      mockAudit(),
      mockOutbox(),
      mockEntitlement(DataScope.A),
      mockConfig(),
      mockLogger(),
      mockTaskPort(),
      storagePort,
      reportSvc,
      maskingSvc,
    );

    await service.generate(JOB_ID);

    // masking.mask should have been called for owner_name
    expect(maskingSvc.mask).toHaveBeenCalledWith('full_name', 'Alice Johnson', { strict: true });
    const csvContent = ((storagePort.upload as jest.Mock).mock.calls[0] as [string, string])[1] ?? '';
    expect(csvContent).toContain('Alice');
  });

  it('does NOT apply masking for unmasked level', async () => {
    const rowWithName = { owner_name: 'Alice Johnson', captured: 5 };
    const reportSvc = mockReportService([rowWithName], 1);
    const maskingSvc = {
      mask: jest.fn().mockReturnValue('[masked]'),
    } as unknown as jest.Mocked<MaskingService>;
    const storagePort = mockStoragePort();

    const service = new ExportService(
      mockRepo({ findById: jest.fn().mockResolvedValue(makeJob({ status: JobStatus.QUEUED, masking_level: MaskingLevel.UNMASKED })) }),
      makeWorkerUow(),
      mockAudit(),
      mockOutbox(),
      mockEntitlement(DataScope.A),
      mockConfig(),
      mockLogger(),
      mockTaskPort(),
      storagePort,
      reportSvc,
      maskingSvc,
    );

    await service.generate(JOB_ID);

    // masking.mask should NOT have been called for unmasked level
    expect(maskingSvc.mask).not.toHaveBeenCalled();
    const csvContent = ((storagePort.upload as jest.Mock).mock.calls[0] as [string, string])[1] ?? '';
    expect(csvContent).toContain('Alice Johnson');
  });
});

// ── FIX-2: SM list uses team member filter ───────────────────────────────

describe('ExportService.list — SM role uses teamMemberIds filter (FIX-2)', () => {
  it('passes teamMemberIds to repo.list for SM role', async () => {
    const smEntitlement = mockEntitlement(DataScope.T, BRANCH_A, TEAM_A);
    const { service, repo } = makeService({ entitlement: smEntitlement });

    await service.list(actor(RoleCode.SM, DataScope.T), 1, 25);

    expect(repo.list).toHaveBeenCalledWith(
      expect.objectContaining({
        ownOnly: false,
        teamMemberIds: expect.arrayContaining([USER_A, USER_B]),
      }),
    );
  });

  it('passes empty teamMemberIds when SM has no team', async () => {
    const smNoTeam = mockEntitlement(DataScope.T, BRANCH_A, null);
    const { service, repo } = makeService({ entitlement: smNoTeam });

    await service.list(actor(RoleCode.SM, DataScope.T), 1, 25);

    expect(repo.list).toHaveBeenCalledWith(
      expect.objectContaining({ teamMemberIds: [] }),
    );
  });
});

// ── FIX-3: updateStatus includes orgId ───────────────────────────────────

describe('ExportService — updateStatus passes orgId (FIX-3)', () => {
  it('approve passes orgId to updateStatus', async () => {
    const awaitingJob = makeJob({ status: JobStatus.AWAITING_APPROVAL, requested_by: USER_B, scope: DataScope.T });
    const queuedJob = makeJob({ status: JobStatus.QUEUED, requested_by: USER_B, approver_id: USER_A, scope: DataScope.T });
    const repo = mockRepo({
      findById: jest.fn()
        .mockResolvedValueOnce(awaitingJob)
        .mockResolvedValueOnce(queuedJob),
    });
    const { service } = makeService({
      repo,
      entitlement: mockEntitlement(DataScope.A),
    });

    await service.approve(JOB_ID, actor(RoleCode.HEAD, DataScope.A, USER_A));

    const updateCalls = (repo.updateStatus as jest.Mock).mock.calls as unknown[][];
    // updateStatus(tx, jobId, orgId, status, updatedBy, extra?)
    expect(updateCalls[0]?.[2]).toBe(ORG);
  });
});
