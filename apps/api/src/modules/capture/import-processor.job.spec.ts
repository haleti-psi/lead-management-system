import { ERROR_CODES, JobStatus } from '@lms/shared';

import type { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { ImportProcessorService } from './import-processor.job';
import { parseCsv } from './csv.util';
import { InMemoryImportFileStoreAdapter } from './ports/in-memory-import-file-store.adapter';
import type { CaptureService } from './capture.service';

/**
 * FR-010 component tests for the bulk-import processor (B-01..B-03 analogues of
 * the deferred Testcontainers tier). The file store is the real in-memory
 * adapter; `CaptureService.createLead` and the job-table writes are mocked, so
 * the row loop, per-row UnitOfWork isolation, error-CSV contract
 * `(row_number, column, code, message)` and the counters are asserted.
 */

const JOB = 'c0000000-0000-0000-0000-00000000000c';
const ORG = '00000000-0000-0000-0000-000000000001';
const CREATOR = 'a0000000-0000-0000-0000-00000000000a';

interface Harness {
  processor: ImportProcessorService;
  store: InMemoryImportFileStoreAdapter;
  createLead: jest.Mock;
  jobUpdates: Array<Record<string, unknown>>;
}

function makeHarness(
  fileContent: Buffer,
  jobStatus: JobStatus = JobStatus.QUEUED,
  opts: { storeFile?: boolean } = {},
): Harness {
  const store = new InMemoryImportFileStoreAdapter();
  const jobUpdates: Array<Record<string, unknown>> = [];

  const jobRow = {
    import_job_id: JOB,
    org_id: ORG,
    status: jobStatus,
    file_ref: `imports/${JOB}/source.csv`,
    created_by: CREATOR,
  };

  // Read path (job lookup).
  interface SelectChainMock {
    select: jest.Mock;
    where: jest.Mock;
    limit: jest.Mock;
    executeTakeFirst: jest.Mock;
  }
  const selectChain: SelectChainMock = {
    select: jest.fn(() => selectChain),
    where: jest.fn(() => selectChain),
    limit: jest.fn(() => selectChain),
    executeTakeFirst: jest.fn(async () => jobRow),
  };
  const db = { selectFrom: jest.fn(() => selectChain) };

  // Write path (status/result updates) via uow.run(tx).
  interface UpdateChainMock {
    set: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  }
  const updateChain: UpdateChainMock = {
    set: jest.fn((patch: Record<string, unknown>) => {
      jobUpdates.push(patch);
      return updateChain;
    }),
    where: jest.fn(() => updateChain),
    execute: jest.fn(async () => undefined),
  };
  const tx = { updateTable: jest.fn(() => updateChain) };
  const uow = { run: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)) };

  const createLead = jest.fn().mockResolvedValue({ replayed: false, data: {} });
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };

  const processor = new ImportProcessorService(
    db as never,
    uow as unknown as UnitOfWork,
    { createLead } as unknown as CaptureService,
    store,
    logger as never,
  );

  if (opts.storeFile !== false) {
    void store.put(jobRow.file_ref, fileContent, 'text/csv');
  }
  return { processor, store, createLead, jobUpdates };
}

const HEADER = 'product_code,name,mobile,source,pin_code';

describe('ImportProcessorService.process', () => {
  it('B-01: commits all valid rows individually and records success counts', async () => {
    const csv = [
      HEADER,
      'CV,Asha Patel,9876543210,Branch,400001',
      'CAR,Vijay Rao,9123456780,Branch,560001',
      'TW,Meena Iyer,8899776655,Branch,600001',
    ].join('\n');
    const h = makeHarness(Buffer.from(csv, 'utf8'));

    await h.processor.process(JOB);

    // Three independent createLead calls — each runs its own UnitOfWork.
    expect(h.createLead).toHaveBeenCalledTimes(3);
    expect(h.createLead).toHaveBeenCalledWith(
      expect.objectContaining({ product_code: 'CV', identity: expect.objectContaining({ mobile: '9876543210' }) }),
      expect.objectContaining({ channel: 'bulk', importJobId: JOB, actorId: CREATOR, orgId: ORG }),
    );
    const final = h.jobUpdates.at(-1);
    expect(final).toMatchObject({
      status: JobStatus.COMPLETED,
      total_rows: 3,
      success_rows: 3,
      failed_rows: 0,
      error_file_ref: null,
    });
  });

  it('B-02: partial failure — valid rows commit, error CSV written, counters split', async () => {
    const csv = [
      HEADER,
      'CV,Asha Patel,9876543210,Branch,400001',
      'CV,Bad Mobile,1234567890,Branch,400001', // invalid: starts with 1
      'TW,Meena Iyer,8899776655,Branch,600001',
    ].join('\n');
    const h = makeHarness(Buffer.from(csv, 'utf8'));

    await h.processor.process(JOB);

    expect(h.createLead).toHaveBeenCalledTimes(2);
    const final = h.jobUpdates.at(-1);
    expect(final).toMatchObject({
      status: JobStatus.COMPLETED,
      total_rows: 3,
      success_rows: 2,
      failed_rows: 1,
    });
    expect(final?.['error_file_ref']).toEqual(expect.stringContaining(`imports/${JOB}/errors.csv`));

    const errorCsv = parseCsv((await h.store.get(`imports/${JOB}/errors.csv`)).toString('utf8'));
    expect(errorCsv[0]).toEqual(['row_number', 'column', 'code', 'message']);
    expect(errorCsv[1]?.[0]).toBe('3'); // row 3 (header is row 1)
    expect(errorCsv[1]?.[1]).toBe('identity.mobile');
    expect(errorCsv[1]?.[2]).toBe(ERROR_CODES.VALIDATION_ERROR);
  });

  it('B-03: error CSV row carries (row_number, column, code, message) for a missing name', async () => {
    const csv = [HEADER, 'CV,,9876543210,Branch,400001'].join('\n');
    const h = makeHarness(Buffer.from(csv, 'utf8'));

    await h.processor.process(JOB);

    const errorCsv = parseCsv((await h.store.get(`imports/${JOB}/errors.csv`)).toString('utf8'));
    expect(errorCsv[1]).toEqual(['2', 'identity.name', 'VALIDATION_ERROR', 'Name is required.']);
  });

  it('captures a domain failure from createLead (e.g. duplicate CONFLICT) as a row error', async () => {
    const csv = [HEADER, 'CV,Asha Patel,9876543210,Branch,400001'].join('\n');
    const h = makeHarness(Buffer.from(csv, 'utf8'));
    h.createLead.mockRejectedValue(
      new DomainException(ERROR_CODES.CONFLICT, undefined, { detail: { reason: 'DUPLICATE_BLOCKED' } }),
    );

    await h.processor.process(JOB);

    const final = h.jobUpdates.at(-1);
    expect(final).toMatchObject({ status: JobStatus.COMPLETED, success_rows: 0, failed_rows: 1 });
    const errorCsv = parseCsv((await h.store.get(`imports/${JOB}/errors.csv`)).toString('utf8'));
    expect(errorCsv[1]?.[2]).toBe(ERROR_CODES.CONFLICT);
    expect(errorCsv[1]?.[3]).toContain('DUPLICATE_BLOCKED');
  });

  it('is idempotent: a non-queued job is skipped (Cloud-Tasks re-delivery safety)', async () => {
    const h = makeHarness(Buffer.from(`${HEADER}\nCV,Asha,9876543210,Branch,400001`, 'utf8'), JobStatus.COMPLETED);
    await h.processor.process(JOB);
    expect(h.createLead).not.toHaveBeenCalled();
    expect(h.jobUpdates).toHaveLength(0);
  });

  it('fails an XLSX job loudly with an explanatory error file (no silent drop)', async () => {
    const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]);
    const h = makeHarness(xlsx);

    await h.processor.process(JOB);

    expect(h.createLead).not.toHaveBeenCalled();
    const final = h.jobUpdates.at(-1);
    expect(final).toMatchObject({ status: JobStatus.FAILED, failed_rows: 1 });
    const errorCsv = parseCsv((await h.store.get(`imports/${JOB}/errors.csv`)).toString('utf8'));
    expect(errorCsv[1]?.[2]).toBe(ERROR_CODES.UNSUPPORTED_MEDIA);
  });

  it('marks the job failed when the file is missing from the store', async () => {
    const h = makeHarness(Buffer.from(`${HEADER}\n`, 'utf8'), JobStatus.QUEUED, { storeFile: false });
    await expect(h.processor.process(JOB)).rejects.toBeDefined();
    expect(h.createLead).not.toHaveBeenCalled();
    expect(h.jobUpdates.at(-1)).toMatchObject({ status: JobStatus.FAILED });
  });
});
