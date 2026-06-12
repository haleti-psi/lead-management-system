import { Injectable } from '@nestjs/common';

import type { Lang } from '@lms/shared';

import type { DbTransaction } from '../../core/db';

/** Values written by {@link LeadIdentityRepository.insert} (FR-010 step E1). */
export interface InsertLeadIdentityValues {
  org_id: string;
  name: string;
  mobile: string;
  email: string | null;
  pan_token: string | null;
  pan_masked: string | null;
  preferred_language: Lang | null;
  created_by: string;
}

/**
 * FR-010 — Kysely writes for `lead_identities` (M2-owned, auth-matrix
 * `lead_identities … writer: M2/M5`). Insert-at-capture only; identity edits
 * belong to later FRs.
 */
@Injectable()
export class LeadIdentityRepository {
  async insert(values: InsertLeadIdentityValues, tx: DbTransaction): Promise<string> {
    const row = await tx
      .insertInto('lead_identities')
      .values({
        org_id: values.org_id,
        name: values.name,
        mobile: values.mobile,
        email: values.email,
        pan_token: values.pan_token,
        pan_masked: values.pan_masked,
        preferred_language: values.preferred_language,
        created_by: values.created_by,
        updated_by: values.created_by,
      })
      .returning('lead_identity_id')
      .executeTakeFirstOrThrow();
    return row.lead_identity_id;
  }
}
