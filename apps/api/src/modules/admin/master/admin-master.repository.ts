import { Inject, Injectable } from '@nestjs/common';

import { ConfigChangeStatus } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../../core/db';
import { ORG_ID_DEFAULT } from '../../../core/outbox/outbox.constants';

/**
 * FR-131 — the master module's data seam. The per-resource SQL lives in the
 * descriptors (owner-writes, table-literal typed); this repository exposes the
 * shared Kysely handle the service hands to those descriptors for reads, and owns
 * the one cross-resource write the module makes itself: the paired
 * `configuration_versions` row that records every create/update for the FR-132
 * audit/rollback trail.
 */
@Injectable()
export class AdminMasterRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** The connection pool handle, for descriptor list/read operations. */
  get reader(): KyselyDb {
    return this.db;
  }

  /**
   * Insert the paired `configuration_versions` row in the caller's transaction.
   *
   * Per the FR-131 LLD lifecycle, every master this FR owns is created/updated
   * ACTIVE immediately — the `configuration_versions` row is an audit/rollback
   * record, not an approval gate. None of these `config_type`s has an FR-132
   * `ConfigActivator` registered, so writing `status='pending'` here would strand
   * the row forever (no actor ever moves it to `active`). We therefore record it
   * already `active`, with `effective_at=now()` to mark when the change went live.
   * `checker_id` stays null (no maker-checker for these low-impact masters; the
   * `ck_config_maker_checker` CHECK only constrains a non-null checker).
   *
   * Returns the new id.
   */
  async insertConfigVersion(
    tx: DbTransaction,
    configType: string,
    configRef: string,
    version: number,
    diff: Record<string, unknown>,
    actorId: string,
  ): Promise<string> {
    const row = await tx
      .insertInto('configuration_versions')
      .values({
        org_id: ORG_ID_DEFAULT,
        config_type: configType,
        config_ref: configRef,
        version,
        maker_id: actorId,
        checker_id: null,
        status: ConfigChangeStatus.ACTIVE,
        effective_at: new Date(),
        rollback_ref: null,
        diff: JSON.stringify(diff),
        created_by: actorId,
        updated_by: actorId,
      })
      .returning('configuration_version_id')
      .executeTakeFirstOrThrow();
    return row.configuration_version_id;
  }
}
