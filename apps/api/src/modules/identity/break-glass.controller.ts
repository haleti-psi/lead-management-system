import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import type { AbacResource } from '@lms/shared';

import { CurrentUser, Requires } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { AppConfigService } from '../../core/config';
import {
  makeBreakGlassRequestSchema,
  type BreakGlassGrantResponse,
  type BreakGlassRequestDto,
  type BreakGlassTransitionResponse,
} from './break-glass.dto';
import { BreakGlassService, type BreakGlassActor } from './break-glass.service';

/** `{id}` path-param validator — a bare UUID, rejected as VALIDATION_ERROR. */
const GrantIdParam = z.string().uuid({ message: 'id must be a valid UUID' });

/** The scope resolver for every break-glass route (governs `break_glass_grants`). */
const breakGlassResource = (): AbacResource => ({ resourceType: 'break_glass_grants' });

/**
 * FR-003 break-glass endpoints (M1 Identity & Access). All three are protected
 * by the global {@link JwtAuthGuard} and gated by `@Requires('break_glass')` →
 * {@link AbacGuard}, so only ADMIN (scope A) and DPO (scope M) reach the handler
 * (auth-matrix.json). The global interceptor wraps the returned data in the
 * uniform `{ data, meta, error }` envelope; controllers return plain data.
 *
 * Four-eyes (approver ≠ grantee) and the access-window bound are enforced by the
 * request schema and {@link BreakGlassService}; see the service for the full
 * defence-in-depth chain.
 */
@Controller('admin/break-glass')
export class BreakGlassController {
  constructor(
    private readonly service: BreakGlassService,
    private readonly config: AppConfigService,
  ) {}

  @Post()
  @Requires('break_glass', breakGlassResource)
  async request(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<BreakGlassGrantResponse> {
    const dto = this.parseRequest(body);
    return this.service.request(this.actor(user), dto);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Requires('break_glass', breakGlassResource)
  async approve(
    @Param('id', new ZodValidationPipe(GrantIdParam)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<BreakGlassTransitionResponse> {
    return this.service.approve(this.actor(user), id);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @Requires('break_glass', breakGlassResource)
  async revoke(
    @Param('id', new ZodValidationPipe(GrantIdParam)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<BreakGlassTransitionResponse> {
    return this.service.revoke(this.actor(user), id);
  }

  /**
   * Validate the request body against the schema bound to the configured
   * maximum access window. Built per-request so a window-config change takes
   * effect without redeploying (the value is read from the validated env).
   */
  private parseRequest(body: unknown): BreakGlassRequestDto {
    const schema = makeBreakGlassRequestSchema(this.config.get('BREAK_GLASS_MAX_WINDOW_HOURS'));
    return new ZodValidationPipe(schema).transform(body);
  }

  private actor(user: AuthUser): BreakGlassActor {
    return { userId: user.userId, orgId: user.orgId };
  }
}
