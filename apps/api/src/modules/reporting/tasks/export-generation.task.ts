import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';

import { Public } from '../../../core/auth';
import { ZodValidationPipe } from '../../../core/common';
import { InternalTaskGuard } from '../../engagement/internal-task.guard';
import { ExportService } from '../export.service';

const ExportGenerateBody = z.object({
  export_job_id: z.string().uuid(),
});

type ExportGenerateBody = z.infer<typeof ExportGenerateBody>;

/**
 * FR-122 — internal export generation task endpoint.
 * Driven by Cloud Tasks, NOT by a user. `@Public()` exempts from JwtAuthGuard;
 * `InternalTaskGuard` requires the Cloud Tasks queue header.
 * Pattern mirrors `apps/api/src/modules/engagement/sla-sweep.controller.ts`.
 */
@Controller('internal/exports')
@Public()
@SkipThrottle()
@UseGuards(InternalTaskGuard)
export class ExportGenerationTask {
  constructor(private readonly service: ExportService) {}

  @Post('generate')
  @HttpCode(200)
  async generate(
    @Body(new ZodValidationPipe(ExportGenerateBody)) body: ExportGenerateBody,
  ): Promise<{ ok: boolean }> {
    await this.service.generate(body.export_job_id);
    return { ok: true };
  }
}
