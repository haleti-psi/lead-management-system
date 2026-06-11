import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';

import { Capability, type AbacResource, type ApiEnvelope, type DataScope } from '@lms/shared';

import { CurrentUser, Requires } from '../../core/auth';
import { EFFECTIVE_SCOPE_KEY, type AbacRequestContext } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import { ZodValidationPipe, PaginationParams } from '../../core/common';
import { paginated, type HttpResponseLike } from '../../core/http';
import { IntegrationService, type IntegrationActor } from './integration.service';
import {
  IntegrationMonitorQuerySchema,
  toLogFilters,
  type IntegrationMonitorQueryDto,
} from './dto/integration-monitor-query.dto';
import { CreateWebhookSchema, type CreateWebhookDto } from './dto/create-webhook.dto';
import type { IntegrationLogResponse } from './dto/integration-log-response.dto';
import type { WebhookResponse } from './dto/webhook-response.dto';

/**
 * Fixes the ABAC resource type for the decision/audit. `configuration` is
 * org-wide config (auth-matrix `"scoped": false`); the per-endpoint scope-A
 * requirement (ADMIN/HEAD only) is enforced in the service from the effective
 * scope the guard binds — a scope-B holder (BM/KYC/DPO) is rejected 403.
 */
const configurationResource = (): AbacResource => ({ resourceType: 'configuration_versions' });

/**
 * FR-140 admin endpoints (M15 Integration & Events):
 *   - `GET  /api/v1/admin/integrations` — the integration monitor.
 *   - `GET  /api/v1/admin/webhooks`     — list webhook subscriptions.
 *   - `POST /api/v1/admin/webhooks`     — create a webhook subscription.
 *
 * All three are protected by the global {@link JwtAuthGuard} and gated by
 * `@Requires('configuration')` → {@link AbacGuard}. The guard binds the caller's
 * effective scope to the request; every handler requires scope A (ADMIN/HEAD),
 * so BM/KYC/DPO (scope B) get 403. The global interceptor wraps returns in the
 * uniform `{ data, meta, error }` envelope. `secret_ref` never appears in a payload.
 */
@Controller('admin')
@Requires(Capability.CONFIGURATION)
export class IntegrationController {
  constructor(private readonly service: IntegrationService) {}

  @Get('integrations')
  @Requires(Capability.CONFIGURATION, configurationResource)
  async listIntegrations(@Query() rawQuery: unknown, @Req() req: AbacRequestContext) {
    const query = new ZodValidationPipe(IntegrationMonitorQuerySchema).transform(
      rawQuery,
    ) as IntegrationMonitorQueryDto;
    const page: PaginationParams = { page: query.page, limit: query.limit };
    const { rows, total } = await this.service.listLogs(
      toLogFilters(query),
      page,
      query.sort,
      this.scope(req),
    );
    return paginated<IntegrationLogResponse[]>(rows, { page: page.page, limit: page.limit, total });
  }

  @Get('webhooks')
  @Requires(Capability.CONFIGURATION, configurationResource)
  async listWebhooks(@Query() rawQuery: unknown, @Req() req: AbacRequestContext) {
    const page = new ZodValidationPipe(PaginationParams).transform(rawQuery);
    const { rows, total } = await this.service.listWebhooks(page, this.scope(req));
    return paginated<WebhookResponse[]>(rows, { page: page.page, limit: page.limit, total });
  }

  @Post('webhooks')
  @HttpCode(201)
  @Requires(Capability.CONFIGURATION, configurationResource)
  async createWebhook(
    @Body() rawBody: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
    @Res({ passthrough: true }) res: HttpResponseLike,
  ): Promise<WebhookResponse | ApiEnvelope<WebhookResponse>> {
    const dto = new ZodValidationPipe(CreateWebhookSchema).transform(rawBody) as CreateWebhookDto;
    const outcome = await this.service.createWebhook(
      dto,
      idempotencyKey,
      this.actor(user),
      this.scope(req),
    );

    if (outcome.replay) {
      // Idempotent replay → HTTP 200 with the ORIGINAL row (CORRECTIONS.md):
      // { data:<original>, meta:{ reason:'IDEMPOTENT_REPLAY' }, error:null }.
      // correlation_id is back-filled by the ResponseEnvelopeInterceptor.
      res.status(200);
      return {
        data: outcome.webhook,
        meta: { correlation_id: '', reason: 'IDEMPOTENT_REPLAY' } as ApiEnvelope<WebhookResponse>['meta'],
        error: null,
      };
    }

    // Fresh creation → HTTP 201 (default from @HttpCode); interceptor wraps it.
    return outcome.webhook;
  }

  private actor(user: AuthUser): IntegrationActor {
    return { userId: user.userId, orgId: user.orgId };
  }

  private scope(req: AbacRequestContext): DataScope | undefined {
    return req[EFFECTIVE_SCOPE_KEY];
  }
}
