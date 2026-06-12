import { Body, Controller, Headers, HttpCode, Post, Query, Req, Res } from '@nestjs/common';

import { CreationChannel } from '@lms/shared';

import { Public } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import type { HttpRequestLike, HttpResponseLike } from '../../core/http';
import { CaptchaService } from '../../core/integration';
import { ORG_ID_DEFAULT, SYSTEM_ACTOR_ID } from './capture.constants';
import { requestMeta } from './capture.controller';
import { CaptureService, type LeadCaptureData } from './capture.service';
import { PublicChannelParam, PublicCreateLeadDto } from './dto/public-create-lead.dto';

/**
 * FR-010 — `POST /api/v1/public/leads` (api-contract `publicCreateLead`;
 * auth-matrix `public_endpoints` + "captcha + per-IP rate limit").
 *
 * `@Public()` bypasses the JWT guard; protection is the global per-IP throttle
 * (default tier 10/min — the LLD's public rate) plus a mandatory
 * `X-Captcha-Token` verified through {@link CaptchaService} BEFORE any
 * processing. `channel_created_by` is forced from `?channel=qr|website`; the
 * actor recorded on all rows is the reserved system actor (no session).
 */
@Controller('public')
@Public()
export class PublicCaptureController {
  constructor(
    private readonly capture: CaptureService,
    private readonly captchaService: CaptchaService,
  ) {}

  @Post('leads')
  @HttpCode(201)
  async publicCreateLead(
    @Body(new ZodValidationPipe(PublicCreateLeadDto)) dto: PublicCreateLeadDto,
    @Query('channel', new ZodValidationPipe(PublicChannelParam)) channel: PublicChannelParam,
    @Req() req: HttpRequestLike,
    @Res({ passthrough: true }) res: HttpResponseLike,
    @Headers('x-captcha-token') captchaToken?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<LeadCaptureData> {
    // Captcha gate first — invalid/missing → FORBIDDEN (403), nothing processed.
    await this.captchaService.verify(captchaToken);

    const result = await this.capture.createLead(dto, {
      actorId: SYSTEM_ACTOR_ID,
      orgId: ORG_ID_DEFAULT,
      actorRole: null,
      channel: channel === 'qr' ? CreationChannel.QR : CreationChannel.WEBSITE,
      idempotencyKey: idempotencyKey || undefined,
      requestMeta: requestMeta(req),
      routeBranchByPin: true,
    });
    if (result.replayed) {
      res.status(200);
    }
    return result.data;
  }
}
