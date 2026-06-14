import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';

import { Capability } from '@lms/shared';

import { CurrentUser, Requires } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { CreateTemplateDto } from './dto/create-template.dto';
import { ListTemplatesDto } from './dto/list-templates.dto';
import { TemplateService } from './template.service';

/**
 * FR-101 — Communication template management (ADMIN only).
 *
 * Both endpoints require JwtAuthGuard (global) + AbacGuard `configuration`
 * capability (ADMIN, scope A). No @Public() — must be authenticated.
 *
 * Scope resolver explicitly targets `communication_templates` so AbacGuard
 * does not default-resolve to `leads`.
 */
@Controller('admin/templates')
@Requires(Capability.CONFIGURATION, () => ({ resourceType: 'communication_templates' }))
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  /**
   * GET /api/v1/admin/templates — paginated, filterable template list.
   */
  @Get()
  async list(
    @Query(new ZodValidationPipe(ListTemplatesDto)) query: ListTemplatesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.templateService.list(query, user);
  }

  /**
   * POST /api/v1/admin/templates — create a new template (status=draft).
   */
  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(CreateTemplateDto)) dto: CreateTemplateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.templateService.create(dto, user);
  }
}
