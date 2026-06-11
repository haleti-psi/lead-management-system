import { Injectable } from '@nestjs/common';

import { ConfigChangeStatus } from '@lms/shared';

import type { DbTransaction } from '../../core/db';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import type { ConfigurationVersionRow } from './activators/config-activator.port';

/**
 * FR-132 — owner repository for the `configuration_versions` governance lifecycle
 * (M14, maker-checker). All queries are parameterised Kysely and org-scoped.
 * Every state-mutating UPDATE carries the expected-status in its WHERE clause as
 * an optimistic guard (a concurrent checker that already acted causes a zero-row
 * update, which the service maps to CONFLICT).
 */
@Injectable()
export class ConfigGovernanceRepository {
  /** Fetch a version by id within the org (inside the governance tx). */
  async findById(versionId: string, tx: DbTransaction): Promise<ConfigurationVersionRow | undefined> {
    return tx
      .selectFrom('configuration_versions')
      .selectAll()
      .where('configuration_version_id', '=', versionId)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .executeTakeFirst();
  }

  /**
   * Transition a `pending` version to `newStatus` (`active` | `approved` |
   * `rejected`), stamping the checker. Guarded by `status = 'pending'` in the
   * WHERE clause. Returns the number of rows updated (0 ⇒ concurrent change).
   */
  async transitionFromPending(
    versionId: string,
    newStatus: ConfigChangeStatus,
    checkerId: string,
    tx: DbTransaction,
  ): Promise<number> {
    const result = await tx
      .updateTable('configuration_versions')
      .set({
        status: newStatus,
        checker_id: checkerId,
        updated_at: new Date(),
        updated_by: checkerId,
      })
      .where('configuration_version_id', '=', versionId)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('status', '=', ConfigChangeStatus.PENDING)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  /**
   * Mark an `active` version `rolled_back`. Guarded by `status = 'active'`.
   * Returns the number of rows updated (0 ⇒ concurrent change).
   */
  async markRolledBack(versionId: string, actorId: string, tx: DbTransaction): Promise<number> {
    const result = await tx
      .updateTable('configuration_versions')
      .set({
        status: ConfigChangeStatus.ROLLED_BACK,
        updated_at: new Date(),
        updated_by: actorId,
      })
      .where('configuration_version_id', '=', versionId)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('status', '=', ConfigChangeStatus.ACTIVE)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  /** Re-activate the `rollback_ref` version (set `status = 'active'`), org-scoped. */
  async reactivate(versionId: string, actorId: string, tx: DbTransaction): Promise<ConfigurationVersionRow | undefined> {
    return tx
      .updateTable('configuration_versions')
      .set({
        status: ConfigChangeStatus.ACTIVE,
        updated_at: new Date(),
        updated_by: actorId,
      })
      .where('configuration_version_id', '=', versionId)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .returningAll()
      .executeTakeFirst();
  }
}
