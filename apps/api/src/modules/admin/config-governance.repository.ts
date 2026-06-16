import { Inject, Injectable } from '@nestjs/common';

import { ConfigChangeStatus } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import type { ConfigurationVersionRow } from './activators/config-activator.port';

/** Filters for {@link ConfigGovernanceRepository.listPending}. */
export interface ListPendingArgs {
  configType?: string;
  page: number;
  limit: number;
}

/** A pending `configuration_versions` summary row (for the review queue). */
export interface PendingConfigVersionRow {
  configuration_version_id: string;
  maker_id: string;
  config_type: string;
  config_ref: string | null;
  status: ConfigChangeStatus;
  created_at: Date;
  diff: unknown;
}

/** A page of pending versions plus the unfiltered-by-page total for the query. */
export interface PendingConfigVersionsPage {
  rows: PendingConfigVersionRow[];
  total: number;
}

/**
 * FR-132 — owner repository for the `configuration_versions` governance lifecycle
 * (M14, maker-checker). All queries are parameterised Kysely and org-scoped.
 * Every state-mutating UPDATE carries the expected-status in its WHERE clause as
 * an optimistic guard (a concurrent checker that already acted causes a zero-row
 * update, which the service maps to CONFLICT).
 */
@Injectable()
export class ConfigGovernanceRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /**
   * List `pending` versions for the org, newest-first, optionally narrowed to one
   * `config_type`. Paginated and always LIMIT-bounded (NFR-17); returns the page
   * rows and the total count of pending rows matching the filter. Reads the
   * summary columns only (no full row), via parameterised Kysely.
   */
  async listPending(args: ListPendingArgs): Promise<PendingConfigVersionsPage> {
    let rowsQuery = this.db
      .selectFrom('configuration_versions')
      .select([
        'configuration_version_id',
        'maker_id',
        'config_type',
        'config_ref',
        'status',
        'created_at',
        'diff',
      ])
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('status', '=', ConfigChangeStatus.PENDING);
    if (args.configType !== undefined) {
      rowsQuery = rowsQuery.where('config_type', '=', args.configType);
    }
    const rows = await rowsQuery
      .orderBy('created_at', 'desc')
      .limit(args.limit)
      .offset((args.page - 1) * args.limit)
      .execute();

    let countQuery = this.db
      .selectFrom('configuration_versions')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('status', '=', ConfigChangeStatus.PENDING);
    if (args.configType !== undefined) {
      countQuery = countQuery.where('config_type', '=', args.configType);
    }
    const { count } = await countQuery.executeTakeFirstOrThrow();

    return {
      rows: rows.map((r) => ({
        configuration_version_id: r.configuration_version_id,
        maker_id: r.maker_id,
        config_type: r.config_type,
        config_ref: r.config_ref,
        status: r.status,
        created_at: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
        diff: r.diff ?? null,
      })),
      total: Number(count),
    };
  }

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
