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

/** KYC-resolved identity enrichment (only the columns a check produced are set). */
export interface LeadIdentityEnrichment {
  pan_token?: string;
  pan_masked?: string;
  ckyc_id?: string;
  aadhaar_ref_token?: string;
}

/**
 * FR-010 — Kysely writes for `lead_identities` (M2-owned, auth-matrix
 * `lead_identities … writer: M2/M5`). Insert-at-capture, plus {@link enrich} —
 * the owner-side mutator M8 KYC calls through the @Global CaptureModule seam so
 * the only code that writes `lead_identities` lives in its owning module
 * (owner-writes; cross-FR review H2).
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

  /**
   * Enrich an existing identity with KYC-resolved tokens/refs, inside the caller's
   * transaction. No-op for an empty patch. Org-scoped + parameterised.
   */
  async enrich(
    leadIdentityId: string,
    orgId: string,
    patch: LeadIdentityEnrichment,
    actorId: string,
    tx: DbTransaction,
  ): Promise<void> {
    if (Object.keys(patch).length === 0) return;
    await tx
      .updateTable('lead_identities')
      .set({ ...patch, updated_by: actorId, updated_at: new Date() })
      .where('lead_identity_id', '=', leadIdentityId)
      .where('org_id', '=', orgId)
      .execute();
  }
}
