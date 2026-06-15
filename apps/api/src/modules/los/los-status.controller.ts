import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';

import { MirrorSource } from '@lms/shared';

import { Public } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { getCorrelationId } from '../../core/http';
import type { CorrelatedRequest } from '../../core/http/correlation.middleware';
import { LosWebhookGuard } from '../../core/integration/guards/los-webhook.guard';
import { LosStatusWebhookSchema, type LosStatusWebhookDto } from './dto/los-status-webhook.dto';
import { LosStatusService } from './los-status.service';

/**
 * FR-082 — LOS Application Status Mirror controller.
 *
 * POST /api/v1/los/webhooks/status — receives signed LOS status push events.
 *   - @Public(): exempt from JwtAuthGuard (no user JWT; service-to-service only).
 *   - LosWebhookGuard: HMAC-SHA256 verification (constant-time; 403 on mismatch).
 *   - ZodValidationPipe: body parsed against LosStatusWebhookSchema (400 on error).
 *   - Returns 200 Empty on success (idempotent — replayed events also return 200).
 *
 * POST /api/v1/internal/los/reconcile — Cloud Scheduler reconciliation trigger.
 *   - @Public(): no user JWT; Cloud Scheduler uses OIDC/service-account auth that
 *     is enforced at the Cloud Run ingress level (internal-only path prefix).
 *   - Returns 200 with { processed, failed } summary counts.
 */
@Controller()
export class LosStatusController {
  constructor(private readonly statusService: LosStatusService) {}

  /**
   * POST /los/webhooks/status
   *
   * Signed by the LOS using HMAC-SHA256 (X-LOS-Signature: sha256=<hex>).
   * HMAC verification runs BEFORE Zod parse — bad signature → 403, not 400.
   * Success response is 200 Empty (`{ data: null, meta: { correlation_id }, error: null }`).
   *
   * Idempotency: duplicate event_id → 200 (no re-processing).
   * Out-of-order: older status_date → 200 (upsert WHERE skips the update).
   */
  @Post('los/webhooks/status')
  @Public()
  @UseGuards(LosWebhookGuard)
  @HttpCode(200)
  async receiveStatus(
    @Body(new ZodValidationPipe(LosStatusWebhookSchema)) dto: LosStatusWebhookDto,
    @Req() req: CorrelatedRequest,
  ): Promise<{ data: null; meta: { correlation_id: string }; error: null }> {
    const correlationId = getCorrelationId(req) ?? 'corr_system';

    await this.statusService.processStatusUpdate(dto, MirrorSource.WEBHOOK, correlationId);

    return { data: null, meta: { correlation_id: correlationId }, error: null };
  }

  /**
   * POST /internal/los/reconcile
   *
   * Called by Cloud Scheduler every 15 minutes (configurable). Protected at the
   * Cloud Run ingress level (internal-only path); @Public() exempts it from
   * JwtAuthGuard (no user session; service-account OIDC verified by infra).
   *
   * Processes up to 100 stale mirrors per run. Batch errors are non-fatal; the
   * response always includes the processed/failed summary.
   */
  @Post('internal/los/reconcile')
  @Public()
  @HttpCode(200)
  async reconcile(
    @Req() req: CorrelatedRequest,
  ): Promise<{ data: { processed: number; failed: number }; meta: { correlation_id: string }; error: null }> {
    const correlationId = getCorrelationId(req) ?? 'corr_system';
    const result = await this.statusService.reconcile();

    return {
      data: result,
      meta: { correlation_id: correlationId },
      error: null,
    };
  }
}
