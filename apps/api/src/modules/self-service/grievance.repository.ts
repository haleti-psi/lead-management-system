import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';

import type { GrievanceCategory } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { Grievances } from '../../core/db/types.generated';

export type GrievanceRow = Selectable<Grievances>;

/** Insert shape for a customer-intake `grievances` row (FR-061). */
export interface NewGrievance {
  grievance_id: string;
  org_id: string;
  grievance_no: string;
  lead_id: string;
  category: GrievanceCategory;
  description: string;
  sla_due_at: Date | null;
  actor_id: string;
}

/**
 * FR-061 — repository for customer grievance intake. Inserts `grievances` and
 * reads the active grievance SLA policy. All queries parameterised; reads
 * LIMIT-bounded.
 */
@Injectable()
export class GrievanceRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** Active grievance SLA threshold (minutes), or undefined when none configured. */
  async findGrievanceSlaThresholdMinutes(
    orgId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<number | undefined> {
    const row = await executor
      .selectFrom('sla_policies')
      .select('threshold_minutes')
      .where('org_id', '=', orgId)
      .where('applies_to', '=', 'grievance')
      .where('is_active', '=', true)
      .limit(1)
      .executeTakeFirst();
    return row?.threshold_minutes;
  }

  /** Insert a grievance at intake (status defaults to 'open'; source customer_link). */
  async insert(input: NewGrievance, tx: DbTransaction): Promise<GrievanceRow> {
    return tx
      .insertInto('grievances')
      .values({
        grievance_id: input.grievance_id,
        org_id: input.org_id,
        grievance_no: input.grievance_no,
        lead_id: input.lead_id,
        source: 'customer_link',
        category: input.category,
        description: input.description,
        status: 'open',
        sla_due_at: input.sla_due_at,
        created_by: input.actor_id,
        updated_by: input.actor_id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
