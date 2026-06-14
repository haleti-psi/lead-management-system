import { Inject, Injectable } from '@nestjs/common';

import type { CommChannel, ConsentPurpose, SubjectType } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';

export interface PreferenceRow {
  notification_preference_id: string;
  channel: CommChannel;
  purpose: ConsentPurpose;
  opted_in: boolean;
  updated_at: Date;
}

/**
 * FR-103 — M11 sole writer of `notification_preferences`.
 *
 * `upsertBatch` is intentionally an internal helper called only by
 * {@link PreferenceService} inside a `UnitOfWork` transaction.
 * `findBySubject` is used by the GET endpoint and by FR-101's
 * {@link NotificationPreferenceService.isAllowed} seam.
 */
@Injectable()
export class PreferenceRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /**
   * Upsert a single preference item, returning the persisted row.
   * Must be called inside an active `UnitOfWork` transaction — pass `tx`.
   */
  async upsertOne(
    orgId: string,
    subjectType: SubjectType,
    subjectRef: string,
    channel: CommChannel,
    purpose: ConsentPurpose,
    optedIn: boolean,
    actorUserId: string,
    tx: DbTransaction,
  ): Promise<PreferenceRow> {
    const row = await tx
      .insertInto('notification_preferences')
      .values({
        org_id: orgId,
        subject_type: subjectType,
        subject_ref: subjectRef,
        channel,
        purpose,
        opted_in: optedIn,
        created_by: actorUserId,
        updated_by: actorUserId,
      })
      .onConflict((oc) =>
        oc.constraint('uq_notif_pref').doUpdateSet((eb) => ({
          opted_in: eb.ref('excluded.opted_in'),
          updated_by: actorUserId,
          updated_at: new Date(),
        })),
      )
      .returning([
        'notification_preference_id',
        'channel',
        'purpose',
        'opted_in',
        'updated_at',
      ])
      .executeTakeFirstOrThrow();

    return row as PreferenceRow;
  }

  /**
   * List all preferences for a subject (for GET /preferences and isAllowed).
   * LIMIT 100 — a subject can have at most 4 channels × 11 purposes = 44 rows.
   */
  async findBySubject(
    orgId: string,
    subjectType: SubjectType,
    subjectRef: string,
  ): Promise<PreferenceRow[]> {
    const rows = await this.db
      .selectFrom('notification_preferences')
      .select([
        'notification_preference_id',
        'channel',
        'purpose',
        'opted_in',
        'updated_at',
      ])
      .where('org_id', '=', orgId)
      .where('subject_type', '=', subjectType)
      .where('subject_ref', '=', subjectRef)
      .limit(100)
      .execute();

    return rows as PreferenceRow[];
  }

  /**
   * Single-row lookup for a specific (subject, channel, purpose) combination.
   * Returns `undefined` if no explicit preference row exists.
   * Used by `NotificationPreferenceService.isAllowed`.
   */
  async findOne(
    orgId: string,
    subjectRef: string,
    channel: CommChannel,
    purpose: ConsentPurpose,
  ): Promise<Pick<PreferenceRow, 'opted_in'> | undefined> {
    const row = await this.db
      .selectFrom('notification_preferences')
      .select(['opted_in'])
      .where('org_id', '=', orgId)
      .where('subject_ref', '=', subjectRef)
      .where('channel', '=', channel)
      .where('purpose', '=', purpose)
      .limit(1)
      .executeTakeFirst();

    return row;
  }
}
