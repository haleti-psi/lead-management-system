import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Selectable } from 'kysely';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { CommunicationTemplates } from '../../core/db/types.generated';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import type { CreateTemplateDto } from './dto/create-template.dto';
import type { ListTemplatesDto } from './dto/list-templates.dto';

export type TemplateRow = Selectable<CommunicationTemplates>;

export interface ListTemplateFilters {
  channel?: TemplateRow['channel'];
  language?: TemplateRow['language'];
  category?: TemplateRow['category'];
  status?: TemplateRow['status'];
  product_code?: TemplateRow['product_code'];
  page: number;
  limit: number;
}

/**
 * FR-101 — Repository for communication_templates (M11 sole writer).
 * All queries are scoped to ORG_ID_DEFAULT (single-tenant MVP).
 */
@Injectable()
export class TemplateRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  async list(filters: ListTemplateFilters): Promise<{ rows: TemplateRow[]; total: number }> {
    const orgId = ORG_ID_DEFAULT;
    const { page, limit, channel, language, category, status, product_code } = filters;

    // Build the base query with optional filters.
    const baseQuery = this.db
      .selectFrom('communication_templates')
      .where('org_id', '=', orgId)
      .$if(channel != null, (q) => q.where('channel', '=', channel!))
      .$if(language != null, (q) => q.where('language', '=', language!))
      .$if(category != null, (q) => q.where('category', '=', category!))
      .$if(status != null, (q) => q.where('status', '=', status!))
      .$if(product_code != null, (q) => q.where('product_code', '=', product_code!));

    // Count query (no LIMIT/OFFSET, no ORDER).
    const countResult = await baseQuery
      .select((eb) => eb.fn.count<string>('template_id').as('cnt'))
      .executeTakeFirst();
    const total = parseInt(countResult?.cnt ?? '0', 10);

    // Data query with ordering and pagination.
    const rows = await baseQuery
      .selectAll()
      .orderBy('code', 'asc')
      .orderBy('version', 'desc')
      .limit(limit)
      .offset((page - 1) * limit)
      .execute();

    return { rows, total };
  }

  async insert(dto: CreateTemplateDto, userId: string, tx?: DbTransaction): Promise<TemplateRow> {
    const db: KyselyDb = tx ?? this.db;
    return db
      .insertInto('communication_templates')
      .values({
        template_id: randomUUID(),
        org_id: ORG_ID_DEFAULT,
        code: dto.code,
        version: dto.version,
        channel: dto.channel,
        language: dto.language,
        category: dto.category,
        product_code: dto.product_code ?? null,
        body: dto.body,
        status: 'draft',
        created_by: userId,
        updated_by: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Fetch a single active template for dispatch validation.
   * Returns undefined if not found or not active.
   */
  async findActiveById(templateId: string): Promise<TemplateRow | undefined> {
    return this.db
      .selectFrom('communication_templates')
      .selectAll()
      .where('template_id', '=', templateId)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('status', '=', 'active')
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Fetch any template by id (regardless of status) — used for existence check.
   */
  async findById(templateId: string): Promise<TemplateRow | undefined> {
    return this.db
      .selectFrom('communication_templates')
      .selectAll()
      .where('template_id', '=', templateId)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .limit(1)
      .executeTakeFirst();
  }
}

/** Convert a ListTemplatesDto (controller-layer) to repo-layer filter shape. */
export function toListFilters(dto: ListTemplatesDto): ListTemplateFilters {
  return {
    page: dto.page,
    limit: dto.limit,
    channel: dto.channel,
    language: dto.language,
    category: dto.category,
    status: dto.status,
    product_code: dto.product_code,
  };
}
