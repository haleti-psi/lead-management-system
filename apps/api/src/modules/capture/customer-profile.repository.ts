import { Injectable } from '@nestjs/common';

import type { CustomerType } from '@lms/shared';

import type { DbTransaction } from '../../core/db';

/**
 * FR-010 — `customer_profiles` upsert (step E2). Match key is
 * `(org_id, primary_mobile)` (`uq_customer_profiles_mobile`); on conflict the
 * EXISTING profile is linked, never updated (ON CONFLICT DO NOTHING per the LLD
 * — first-seen display name wins; profile maintenance is a later FR).
 */
@Injectable()
export class CustomerProfileRepository {
  /** Insert-if-absent, then return the profile id for the mobile (always present after the upsert). */
  async upsertByMobile(
    args: {
      org_id: string;
      primary_mobile: string;
      display_name: string;
      customer_type: CustomerType;
      created_by: string;
    },
    tx: DbTransaction,
  ): Promise<string | null> {
    await tx
      .insertInto('customer_profiles')
      .values({
        org_id: args.org_id,
        primary_mobile: args.primary_mobile,
        display_name: args.display_name,
        customer_type: args.customer_type,
        created_by: args.created_by,
        updated_by: args.created_by,
      })
      .onConflict((oc) => oc.constraint('uq_customer_profiles_mobile').doNothing())
      .execute();

    const row = await tx
      .selectFrom('customer_profiles')
      .where('org_id', '=', args.org_id)
      .where('primary_mobile', '=', args.primary_mobile)
      .select('customer_profile_id')
      .limit(1)
      .executeTakeFirst();
    return row?.customer_profile_id ?? null;
  }
}
