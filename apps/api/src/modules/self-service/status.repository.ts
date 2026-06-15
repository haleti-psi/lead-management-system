import { Inject, Injectable } from '@nestjs/common';

import { Priority, TaskType } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';

/** Lead fields for the customer status view (LLD §Data Operations 1). */
export interface StatusLead {
  lead_id: string;
  lead_code: string;
  stage: string;
  owner_id: string | null;
  is_hot: boolean;
  los_application_id: string | null;
  customer_profile_id: string | null;
}

/** Lead fields for the callback write path (LLD §Data Operations 2). */
export interface CallbackLead {
  lead_id: string;
  stage: string;
  owner_id: string | null;
  is_hot: boolean;
}

/** Insert shape for a callback `tasks` row (FR-062). */
export interface NewCallbackTask {
  task_id: string;
  org_id: string;
  lead_id: string;
  owner_id: string;
  due_at: Date;
  result_note: string | null;
  actor_id: string;
}

/**
 * FR-062 — reads for the customer status view + the callback task write. Reads
 * over `leads`/`customer_profiles`/`documents` are permitted (owner-writes governs
 * writes only). The `tasks` insert is the de-facto first writer — M11/FR-100 owns
 * `tasks` long-term (AMBIGUITY FR-062-A1).
 */
@Injectable()
export class StatusRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  async getLeadStatus(leadId: string, orgId: string): Promise<StatusLead | undefined> {
    return this.db
      .selectFrom('leads')
      .select(['lead_id', 'lead_code', 'stage', 'owner_id', 'is_hot', 'los_application_id', 'customer_profile_id'])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  async getProfileName(customerProfileId: string, orgId: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom('customer_profiles')
      .select('display_name')
      .where('customer_profile_id', '=', customerProfileId)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();
    return row?.display_name;
  }

  /** Outstanding document types for the `documents_pending` stage (LLD §1; LIMIT 10). */
  async getPendingDocTypes(leadId: string, orgId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('documents')
      .select('doc_type')
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('status', 'in', ['pending', 'mismatch'])
      .where('deleted_at', 'is', null)
      .limit(10)
      .execute();
    return rows.map((r) => r.doc_type);
  }

  async getLeadForCallback(
    leadId: string,
    orgId: string,
    tx: DbTransaction,
  ): Promise<CallbackLead | undefined> {
    return tx
      .selectFrom('leads')
      .select(['lead_id', 'stage', 'owner_id', 'is_hot'])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /** Insert a high-priority callback task assigned to the lead's owner (LLD §2.3). */
  async insertCallbackTask(input: NewCallbackTask, tx: DbTransaction): Promise<string> {
    const row = await tx
      .insertInto('tasks')
      .values({
        task_id: input.task_id,
        org_id: input.org_id,
        lead_id: input.lead_id,
        type: TaskType.CALLBACK,
        owner_id: input.owner_id,
        due_at: input.due_at,
        priority: Priority.HIGH,
        status: 'open',
        result_note: input.result_note,
        created_by: input.actor_id,
        updated_by: input.actor_id,
      })
      .returning('task_id')
      .executeTakeFirstOrThrow();
    return row.task_id;
  }
}
