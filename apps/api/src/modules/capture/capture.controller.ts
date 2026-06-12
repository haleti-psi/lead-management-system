import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';

import { Capability, CreationChannel } from '@lms/shared';

import { CurrentUser, Requires, type AuthUser } from '../../core/auth';
import type { RequestWithUser } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { readHeader, type HttpRequestLike, type HttpResponseLike } from '../../core/http';
import { LEADS_RESOURCE_TYPE } from './capture.constants';
import { CaptureService, type LeadCaptureData, type RequestMeta } from './capture.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import type { ImportJobResponseDto } from './dto/import-job-response.dto';
import type { UploadedFileLike } from './dto/uploaded-file.type';
import { IMPORT_DISPATCH_PORT, type ImportDispatchPort } from './ports/import-dispatch.port';

/** Pins the ABAC resource for capture endpoints (explicit — never the default). */
const leadsResource = () => ({ resourceType: LEADS_RESOURCE_TYPE });

/**
 * FR-010 — authenticated capture endpoints (api-contract `createLead`,
 * `importLeads`). Both are protected by the global `JwtAuthGuard` plus
 * `AbacGuard` via `@Requires` with an explicit scope resolver; row-level scoping
 * (RM owns own leads, PARTNER same-partner) is enforced in the service. The
 * mutation throttle tier (60/min, environment-contract `RATE_LIMIT_MUTATION`
 * default) overrides the stricter global auth tier.
 */
@Controller('leads')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class CaptureController {
  constructor(
    private readonly capture: CaptureService,
    @Inject(IMPORT_DISPATCH_PORT) private readonly importDispatch: ImportDispatchPort,
  ) {}

  /** POST /api/v1/leads — manual/API lead creation (201; 200 on idempotent replay). */
  @Post()
  @HttpCode(201)
  @Requires(Capability.CREATE_LEAD, leadsResource)
  async createLead(
    @Body(new ZodValidationPipe(CreateLeadDto)) dto: CreateLeadDto,
    @CurrentUser() user: AuthUser,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: HttpResponseLike,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<LeadCaptureData> {
    const result = await this.capture.createLead(dto, {
      actorId: user.userId,
      orgId: user.orgId,
      actorRole: user.role,
      channel: CreationChannel.MANUAL,
      idempotencyKey: idempotencyKey || undefined,
      requestMeta: requestMeta(req),
    });
    if (result.replayed) {
      // Transparent Idempotency-Key replay → 200 with the ORIGINAL payload
      // (error stays null; taxonomy sub-reason IDEMPOTENT_REPLAY).
      res.status(200);
    }
    return result.data;
  }

  /** POST /api/v1/leads/import — bulk CSV/XLSX import (202 Accepted). */
  @Post('import')
  @HttpCode(202)
  @Requires(Capability.BULK_ACTION, leadsResource)
  @UseInterceptors(FileInterceptor('file'))
  async importLeads(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: HttpResponseLike,
    @UploadedFile() file?: UploadedFileLike,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ImportJobResponseDto> {
    const result = await this.capture.acceptBulkImport(file, idempotencyKey || undefined, {
      actorId: user.userId,
      orgId: user.orgId,
    });
    if (result.replayed) {
      res.status(200);
      return result.job;
    }
    // Dispatch the async processor only for a newly accepted job (5e).
    await this.importDispatch.enqueue(result.job.import_job_id);
    return result.job;
  }
}

/** Client metadata recorded on audit/consent rows (AbacGuard convention). */
export function requestMeta(req: HttpRequestLike): RequestMeta {
  return {
    ip: readHeader(req, 'x-forwarded-for') ?? undefined,
    userAgent: readHeader(req, 'user-agent') ?? undefined,
  };
}
