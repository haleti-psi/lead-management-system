import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { CreationChannel, ERROR_CODES, JobStatus } from '@lms/shared';

import { KYSELY, UnitOfWork, type KyselyDb } from '../../core/db';
import { isDomainException } from '../../core/http';
import { IMPORT_FILE_PREFIX } from './capture.constants';
import { CaptureService, sniffImportFileKind } from './capture.service';
import { parseCsv, serializeCsv } from './csv.util';
import { CreateLeadDto } from './dto/create-lead.dto';
import { IMPORT_FILE_STORE_PORT, type ImportFileStorePort } from './ports/import-file-store.port';

/** One bulk-row failure, keyed exactly as the error CSV columns (LLD §bulk). */
interface RowError {
  row_number: number;
  column: string;
  code: string;
  message: string;
}

/**
 * CSV header → CreateLeadDto path. Unknown headers are ignored (template
 * tolerance); error rows report the DTO path (e.g. `identity.name`) so the
 * error CSV matches the API's field naming (test B-03).
 */
const HEADER_MAP: Readonly<Record<string, string>> = {
  product_code: 'product_code',
  name: 'identity.name',
  mobile: 'identity.mobile',
  email: 'identity.email',
  pan_token: 'identity.pan_token',
  pan_masked: 'identity.pan_masked',
  preferred_language: 'identity.preferred_language',
  source: 'source.source',
  sub_source: 'source.sub_source',
  partner_code: 'source.partner_code',
  campaign_code: 'source.campaign_code',
  branch_code: 'branch_code',
  pin_code: 'pin_code',
  requested_amount: 'requested_amount',
  customer_type: 'customer_type',
};

const ERROR_CSV_HEADER = ['row_number', 'column', 'code', 'message'] as const;

/**
 * FR-010 — async bulk-import processor (bulk flow §[Async] ImportProcessorJob).
 * Each VALID row is committed through the same `CaptureService.createLead`
 * pipeline in its OWN UnitOfWork transaction (partial-failure tolerant: valid
 * rows land, failed rows accumulate into the error CSV `(row, column, code,
 * message)`). Idempotent on re-delivery: only a `queued` job is processed.
 *
 * XLSX uploads are accepted at the boundary (api-contract) but no XLSX parser
 * is register-approved yet — such jobs fail LOUDLY with an explanatory error
 * file (see AMBIGUITY.md) instead of silently dropping rows.
 */
@Injectable()
export class ImportProcessorService {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    private readonly uow: UnitOfWork,
    private readonly capture: CaptureService,
    @Inject(IMPORT_FILE_STORE_PORT) private readonly files: ImportFileStorePort,
    @InjectPinoLogger(ImportProcessorService.name) private readonly logger: PinoLogger,
  ) {}

  async process(importJobId: string): Promise<void> {
    const job = await this.db
      .selectFrom('import_jobs')
      .select(['import_job_id', 'org_id', 'status', 'file_ref', 'created_by'])
      .where('import_job_id', '=', importJobId)
      .limit(1)
      .executeTakeFirst();
    if (!job) {
      this.logger.warn({ import_job_id: importJobId }, 'Import job not found; nothing to process');
      return;
    }
    if (job.status !== JobStatus.QUEUED) {
      this.logger.info(
        { import_job_id: importJobId, status: job.status },
        'Import job not queued; skipping (idempotent re-delivery)',
      );
      return;
    }

    await this.setStatus(importJobId, JobStatus.RUNNING);

    try {
      const buffer = await this.files.get(job.file_ref);
      const kind = sniffImportFileKind(buffer);

      if (kind === 'xlsx') {
        await this.failWithErrors(importJobId, 0, [
          {
            row_number: 0,
            column: 'file',
            code: ERROR_CODES.UNSUPPORTED_MEDIA,
            message:
              'XLSX parsing is not yet available (no register-approved parser); please upload CSV.',
          },
        ]);
        return;
      }
      if (kind !== 'csv') {
        await this.failWithErrors(importJobId, 0, [
          {
            row_number: 0,
            column: 'file',
            code: ERROR_CODES.UNSUPPORTED_MEDIA,
            message: 'Unsupported file type.',
          },
        ]);
        return;
      }

      const rows = parseCsv(buffer.toString('utf8'));
      if (rows.length < 2) {
        await this.failWithErrors(importJobId, 0, [
          {
            row_number: 0,
            column: 'file',
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'File has no data rows.',
          },
        ]);
        return;
      }

      const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
      const dataRows = rows.slice(1);
      const errors: RowError[] = [];
      let successRows = 0;

      for (const [index, cells] of dataRows.entries()) {
        const rowNumber = index + 2; // 1-based, counting the header as row 1
        const candidate = buildCandidate(header, cells);
        const parsed = CreateLeadDto.safeParse(candidate);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            errors.push({
              row_number: rowNumber,
              column: issue.path.length > 0 ? issue.path.join('.') : '_',
              code: ERROR_CODES.VALIDATION_ERROR,
              message: issue.message,
            });
          }
          continue;
        }

        try {
          // Each valid row commits in its own UnitOfWork (LLD: rows committed individually).
          await this.capture.createLead(parsed.data, {
            actorId: job.created_by,
            orgId: job.org_id,
            actorRole: null,
            channel: CreationChannel.BULK,
            requestMeta: {},
            importJobId,
          });
          successRows += 1;
        } catch (err: unknown) {
          if (isDomainException(err)) {
            const column =
              err.fields && err.fields.length > 0 && err.fields[0] ? err.fields[0].field : '_';
            const detailReason =
              typeof err.detail?.['reason'] === 'string' ? ` (${err.detail['reason'] as string})` : '';
            errors.push({
              row_number: rowNumber,
              column,
              code: err.code,
              message: `${err.fields?.[0]?.issue ?? err.message}${detailReason}`,
            });
          } else {
            this.logger.error({ err, import_job_id: importJobId, row: rowNumber }, 'Import row failed unexpectedly');
            errors.push({
              row_number: rowNumber,
              column: '_',
              code: ERROR_CODES.INTERNAL_ERROR,
              message: 'Row could not be processed.',
            });
          }
        }
      }

      const failedRowNumbers = new Set(errors.map((e) => e.row_number));
      const errorFileRef =
        errors.length > 0 ? await this.writeErrorCsv(importJobId, errors) : null;

      await this.uow.run(async (tx) => {
        await tx
          .updateTable('import_jobs')
          .set({
            status: JobStatus.COMPLETED,
            total_rows: dataRows.length,
            success_rows: successRows,
            failed_rows: failedRowNumbers.size,
            error_file_ref: errorFileRef,
            updated_at: new Date(),
          })
          .where('import_job_id', '=', importJobId)
          .execute();
      });
      this.logger.info(
        {
          import_job_id: importJobId,
          total: dataRows.length,
          success: successRows,
          failed: failedRowNumbers.size,
        },
        'Import job completed',
      );
    } catch (err: unknown) {
      this.logger.error({ err, import_job_id: importJobId }, 'Import job failed');
      await this.setStatus(importJobId, JobStatus.FAILED);
      throw err;
    }
  }

  private async setStatus(importJobId: string, status: JobStatus): Promise<void> {
    await this.uow.run(async (tx) => {
      await tx
        .updateTable('import_jobs')
        .set({ status, updated_at: new Date() })
        .where('import_job_id', '=', importJobId)
        .execute();
    });
  }

  /** Terminal failure with an explanatory error CSV (file-level problems). */
  private async failWithErrors(
    importJobId: string,
    totalRows: number,
    errors: RowError[],
  ): Promise<void> {
    const errorFileRef = await this.writeErrorCsv(importJobId, errors);
    await this.uow.run(async (tx) => {
      await tx
        .updateTable('import_jobs')
        .set({
          status: JobStatus.FAILED,
          total_rows: totalRows,
          success_rows: 0,
          failed_rows: errors.length,
          error_file_ref: errorFileRef,
          updated_at: new Date(),
        })
        .where('import_job_id', '=', importJobId)
        .execute();
    });
  }

  private writeErrorCsv(importJobId: string, errors: RowError[]): Promise<string> {
    const rows: string[][] = [
      [...ERROR_CSV_HEADER],
      ...errors.map((e) => [String(e.row_number), e.column, e.code, e.message]),
    ];
    return this.files.put(
      `${IMPORT_FILE_PREFIX}/${importJobId}/errors.csv`,
      Buffer.from(serializeCsv(rows), 'utf8'),
      'text/csv',
    );
  }
}

/** Build the nested CreateLeadDto candidate from one CSV row (empty cells omitted). */
function buildCandidate(header: string[], cells: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [col, name] of header.entries()) {
    const path = HEADER_MAP[name];
    if (!path) {
      continue; // unknown column — ignored
    }
    const raw = (cells[col] ?? '').trim();
    if (raw.length === 0) {
      continue;
    }
    const value: unknown = path === 'requested_amount' ? toNumberOrRaw(raw) : raw;
    setPath(out, path, value);
  }
  return out;
}

/** Parse a numeric cell; non-numeric text is passed through so Zod reports the field. */
function toNumberOrRaw(raw: string): unknown {
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i] as string;
    const next = cursor[key];
    if (typeof next !== 'object' || next === null) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1] as string] = value;
}
