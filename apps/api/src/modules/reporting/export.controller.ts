import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { Capability, ERROR_CODES, type PaginationMeta } from '@lms/shared';

import { CurrentUser, Requires, type AuthUser } from '../../core/auth';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, ZodValidationPipe } from '../../core/common';
import { DomainException } from '../../core/http';
import type { ExportJobDetailResponse, ExportJobResponse } from './export.service';
import { ExportService } from './export.service';
import { CreateExportDto } from './dto/create-export.dto';

const exportResource = () => ({ resourceType: 'export_jobs' });

const ListExportsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z
    .coerce.number().int().min(1)
    .max(MAX_PAGE_LIMIT, { message: `limit must be between 1 and ${MAX_PAGE_LIMIT}.` })
    .default(DEFAULT_PAGE_LIMIT),
  'filter[status]': z.string().optional(),
});

type ListExportsQuery = z.infer<typeof ListExportsQuery>;

const UuidParam = z.string().uuid({ message: 'id must be a valid UUID.' });

interface ExportCreateResponse {
  data: ExportJobResponse;
  meta: { correlation_id: string };
  error: null;
}

interface ExportListResponse {
  data: ExportJobResponse[];
  meta: {
    correlation_id: string;
    pagination: PaginationMeta;
  };
  error: null;
}

interface ExportDetailResponse {
  data: ExportJobDetailResponse;
  meta: { correlation_id: string };
  error: null;
}

interface ApproveResponse {
  data: ExportJobResponse;
  meta: { correlation_id: string };
  error: null;
}

/**
 * FR-122 — Export Governance controller.
 * All endpoints protected by JwtAuthGuard (global) + AbacGuard (Requires 'export').
 * None are @Public().
 */
@Controller('exports')
@Requires(Capability.EXPORT, exportResource)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class ExportController {
  constructor(private readonly service: ExportService) {}

  /** POST /api/v1/exports — create export job (202 or 409) */
  @Post()
  @HttpCode(202)
  async create(
    @Body(new ZodValidationPipe(CreateExportDto)) dto: CreateExportDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ExportCreateResponse> {
    const { job, requiresApproval } = await this.service.create(dto, actor);

    if (requiresApproval) {
      // Return 409 via DomainException with job_id in detail
      throw new DomainException(ERROR_CODES.CONFLICT, undefined, {
        detail: {
          reason: 'EXPORT_APPROVAL_REQUIRED',
          export_job_id: job.export_job_id,
        },
      });
    }

    return {
      data: {
        export_job_id: job.export_job_id,
        report_code: job.report_code,
        status: job.status as ExportJobResponse['status'],
        masking_level: job.masking_level as ExportJobResponse['masking_level'],
        scope: job.scope as ExportJobResponse['scope'],
        row_count: job.row_count,
        approver_id: job.approver_id,
        created_at: job.created_at as Date,
        updated_at: job.updated_at as Date,
      },
      meta: { correlation_id: '' },
      error: null,
    };
  }

  /** GET /api/v1/exports — list export jobs (scoped) */
  @Get()
  @HttpCode(200)
  async list(
    @Query(new ZodValidationPipe(ListExportsQuery)) query: ListExportsQuery,
    @CurrentUser() actor: AuthUser,
  ): Promise<ExportListResponse> {
    const filterStatus = query['filter[status]'] as ExportJobResponse['status'] | undefined;

    const { rows, total } = await this.service.list(
      actor,
      query.page,
      query.limit,
      filterStatus,
    );

    const data: ExportJobResponse[] = rows.map((j) => ({
      export_job_id: j.export_job_id,
      report_code: j.report_code,
      status: j.status as ExportJobResponse['status'],
      masking_level: j.masking_level as ExportJobResponse['masking_level'],
      scope: j.scope as ExportJobResponse['scope'],
      row_count: j.row_count,
      approver_id: j.approver_id,
      created_at: j.created_at as Date,
      updated_at: j.updated_at as Date,
    }));

    return {
      data,
      meta: {
        correlation_id: '',
        pagination: { page: query.page, limit: query.limit, total },
      },
      error: null,
    };
  }

  /** GET /api/v1/exports/{id} — get export job + signed URL */
  @Get(':id')
  @HttpCode(200)
  async getById(
    @Param('id') rawId: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<ExportDetailResponse> {
    const idResult = UuidParam.safeParse(rawId);
    if (!idResult.success) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'id must be a valid UUID.', {
        fields: [{ field: 'id', issue: 'id must be a valid UUID.' }],
      });
    }

    const detail = await this.service.getById(idResult.data, actor);

    return {
      data: detail,
      meta: { correlation_id: '' },
      error: null,
    };
  }

  /** POST /api/v1/exports/{id}/approve — approve awaiting export */
  @Post(':id/approve')
  @HttpCode(200)
  async approve(
    @Param('id') rawId: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<ApproveResponse> {
    const idResult = UuidParam.safeParse(rawId);
    if (!idResult.success) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'id must be a valid UUID.', {
        fields: [{ field: 'id', issue: 'id must be a valid UUID.' }],
      });
    }

    const updated = await this.service.approve(idResult.data, actor);

    return {
      data: updated,
      meta: { correlation_id: '' },
      error: null,
    };
  }
}
