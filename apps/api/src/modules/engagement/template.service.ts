import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { AuditAction } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import type { CreateTemplateDto } from './dto/create-template.dto';
import type { ListTemplatesDto } from './dto/list-templates.dto';
import { TemplateRepository, toListFilters } from './template.repository';
import type { TemplateRow } from './template.repository';

export interface TemplateListResult {
  data: TemplateRow[];
  meta: { page: number; limit: number; total: number };
}

/**
 * FR-101 — Template management service.
 * M11 is the SOLE writer of communication_templates.
 */
@Injectable()
export class TemplateService {
  constructor(
    private readonly repo: TemplateRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
    @InjectPinoLogger(TemplateService.name) private readonly logger: PinoLogger,
  ) {}

  async list(dto: ListTemplatesDto, _caller: AuthUser): Promise<TemplateListResult> {
    const filters = toListFilters(dto);
    const { rows, total } = await this.repo.list(filters);
    return {
      data: rows,
      meta: { page: filters.page, limit: filters.limit, total },
    };
  }

  async create(dto: CreateTemplateDto, caller: AuthUser): Promise<TemplateRow> {
    const runInsert = async (): Promise<TemplateRow> => {
      return this.uow.run(async (tx) => {
        const row = await this.repo.insert(dto, caller.userId, tx);

        await this.audit.append(
          {
            action: AuditAction.CONFIG_CHANGE,
            entity_type: 'communication_templates',
            entity_id: row.template_id,
            actor_id: caller.userId,
            org_id: ORG_ID_DEFAULT,
            detail: { sub_action: 'TEMPLATE_CREATED', code: dto.code, version: dto.version },
          },
          tx,
        );

        return row;
      });
    };

    let template: TemplateRow;
    try {
      template = await runInsert();
    } catch (err: unknown) {
      // Postgres unique_violation (23505): (org_id, code, channel, language, version) constraint.
      if (isUniqueViolation(err)) {
        throw new DomainException('CONFLICT', 'A template with this code, channel, language, and version already exists.');
      }
      throw err;
    }

    this.logger.info(
      { template_id: template.template_id, code: template.code },
      'FR-101 template created',
    );

    return template;
  }
}

/** Detect Postgres unique-violation error (code 23505). */
function isUniqueViolation(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  return e['code'] === '23505';
}
