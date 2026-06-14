import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import type { ScopePredicate } from '@lms/shared';

import type { AuthUser, MaskingLevel } from '../../core/auth';
import { MaskingService } from '../../core/masking';
import type { LeadSearchRow } from './repositories/lead-search.repository';
import { LeadSearchRepository } from './repositories/lead-search.repository';
import { PartnerSearchRepository } from './repositories/partner-search.repository';
import type { PartnerSearchRow } from './repositories/partner-search.repository';
import { TaskSearchRepository } from './repositories/task-search.repository';
import type { TaskSearchRow } from './repositories/task-search.repository';

/** Contract shape for a masked lead search result (FR-054 LLD §Response). */
export interface LeadSearchResult {
  lead_id: string;
  lead_code: string;
  stage: string;
  product_code: string;
  applicant_name: string | null;
  mobile: string | null;
  pan_masked: string | null;
  owner_id: string;
  branch_id: string | null;
  created_at: Date;
}

/** Contract shape for a partner search result. */
export type PartnerSearchResult = PartnerSearchRow;

/** Contract shape for a task search result. */
export type TaskSearchResult = TaskSearchRow;

export interface SearchResult {
  leads: LeadSearchResult[];
  partners: PartnerSearchResult[];
  tasks: TaskSearchResult[];
}

const TOP_N = 5;

/**
 * FR-054 — orchestrates the parallel three-entity global search, applies
 * PII masking to lead results (mobile always masked; name strictly masked for
 * DPO). If any individual sub-query rejects, logs the error and returns [] for
 * that bucket — the response is still 200 with the other buckets populated.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly leadRepo: LeadSearchRepository,
    private readonly partnerRepo: PartnerSearchRepository,
    private readonly taskRepo: TaskSearchRepository,
    private readonly masking: MaskingService,
    @InjectPinoLogger(SearchService.name) private readonly logger: PinoLogger,
  ) {}

  async search(
    q: string,
    user: AuthUser,
    predicate: ScopePredicate | undefined,
    maskingLevel: MaskingLevel | undefined,
  ): Promise<SearchResult> {
    const strict = maskingLevel === 'strict';

    const [leadRows, partnerRows, taskRows] = await Promise.all([
      this.leadRepo.search(q, predicate, user.orgId).catch((err: unknown) => {
        this.logger.error({ err, userId: user.userId }, 'lead search sub-query failed');
        return [] as LeadSearchRow[];
      }),
      this.partnerRepo.search(q, predicate, user.orgId).catch((err: unknown) => {
        this.logger.error({ err, userId: user.userId }, 'partner search sub-query failed');
        return [] as PartnerSearchRow[];
      }),
      this.taskRepo.search(q, predicate, user.orgId).catch((err: unknown) => {
        this.logger.error({ err, userId: user.userId }, 'task search sub-query failed');
        return [] as TaskSearchRow[];
      }),
    ]);

    const leads: LeadSearchResult[] = leadRows.map((row) => ({
      lead_id: row.lead_id,
      lead_code: row.lead_code,
      stage: row.stage,
      product_code: row.product_code,
      // mobile is always masked for all roles (MaskedField contract)
      mobile: this.masking.mask('mobile', row.mobile),
      // name is strictly masked for DPO (M scope); partial for all others
      applicant_name: this.masking.mask('full_name', row.applicant_name, { strict }),
      // pan_masked comes pre-masked from DB; pass through as-is
      pan_masked: row.pan_masked ?? null,
      owner_id: row.owner_id,
      branch_id: row.branch_id,
      created_at: row.created_at,
    }));

    return {
      leads,
      partners: partnerRows,
      tasks: taskRows,
    };
  }

  get topN(): number {
    return TOP_N;
  }
}
