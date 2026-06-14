import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import type { ScopePredicate } from '@lms/shared';

import { KYSELY, type KyselyDb } from '../../../core/db';
import type { Priority, TaskStatus, TaskType } from '../../../core/db/types.generated';

/** Top-N cap per entity type. */
const SEARCH_LIMIT = 5;

function escapeLike(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export interface TaskSearchRow {
  task_id: string;
  type: TaskType;
  lead_id: string;
  lead_code: string;
  due_at: Date;
  status: TaskStatus;
  priority: Priority;
}

/**
 * FR-054 — Kysely query for the task bucket in global search.
 * Searches via lead_code prefix match or identity lookup on the associated lead.
 * Tasks with lead_id IS NULL (standalone system tasks) are excluded.
 * Scope applied identically to lead scope (owner_id / branch_id via lead).
 */
@Injectable()
export class TaskSearchRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  async search(
    q: string,
    predicate: ScopePredicate | undefined,
    orgId: string,
  ): Promise<TaskSearchRow[]> {
    const prefix = `${escapeLike(q)}%`;

    let qb = this.db
      .selectFrom('tasks as t')
      .innerJoin('leads as l', 'l.lead_id', 't.lead_id')
      .innerJoin('lead_identities as li', 'li.lead_identity_id', 'l.lead_identity_id')
      .innerJoin(
        'source_attributions as sa',
        'sa.source_attribution_id',
        'l.source_attribution_id',
      )
      .leftJoin('partners as p', 'p.partner_id', 'sa.partner_id')
      .where('t.org_id', '=', orgId)
      .where('t.lead_id', 'is not', null)
      .where('l.deleted_at', 'is', null)
      .where((eb) =>
        eb.or([
          eb('l.lead_code', 'ilike', prefix),
          eb(sql`similarity(li.name, ${q})`, '>', sql`0.3`),
          eb('li.mobile', '=', q),
        ]),
      )
      .select([
        't.task_id',
        't.type',
        't.lead_id',
        'l.lead_code',
        't.due_at',
        't.status',
        't.priority',
      ])
      .limit(SEARCH_LIMIT);

    // Apply the same scope predicate as leads — scope is on the ASSOCIATED LEAD row
    // (l.owner_id / l.branch_id), NOT the task's own columns (t.owner_id / t.assignee).
    // A task whose assignee differs from the lead owner must follow the lead's scope.
    if (predicate) {
      switch (predicate.type) {
        case 'own':
          qb = qb.where('l.owner_id', '=', predicate.userId);
          break;
        case 'team':
          if (predicate.userIds.length > 0) {
            qb = qb.where('l.owner_id', 'in', [...predicate.userIds]);
          } else {
            qb = qb.where((eb) => eb.val(false));
          }
          break;
        case 'branch':
          qb = qb.where('l.branch_id', '=', predicate.branchId);
          break;
        case 'region':
          if (predicate.branchIds.length > 0) {
            qb = qb.where('l.branch_id', 'in', [...predicate.branchIds]);
          } else {
            qb = qb.where((eb) => eb.val(false));
          }
          break;
        case 'all':
        case 'masked':
          // No additional row predicate; org filter already applied above.
          break;
        case 'partner':
          qb = qb.where('sa.partner_id', '=', predicate.partnerId);
          break;
        default:
          qb = qb.where((eb) => eb.val(false));
      }
    } else {
      // deny-by-default on missing predicate
      qb = qb.where((eb) => eb.val(false));
    }

    return qb.execute() as Promise<TaskSearchRow[]>;
  }
}
