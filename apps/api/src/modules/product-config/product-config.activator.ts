import { Injectable, type OnModuleInit } from '@nestjs/common';

import type {
  ConfigActivatorPort,
  ConfigurationVersionRow,
} from '../admin/activators/config-activator.port';
import { ConfigActivatorRegistry } from '../admin/activators/config-activator.registry';
import type { DbTransaction } from '../../core/db';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import { PRODUCT_CONFIG_CONFIG_TYPE } from './product-config.constants';

/**
 * FR-040 — activator for `config_type = 'product_config'`, which self-registers
 * with the shared FR-132 {@link ConfigActivatorRegistry} on init. The create/edit path
 * (this module's service) writes the `product_configs` row as `draft` and the
 * paired `configuration_versions(status='pending')`; FR-132's generic governance
 * engine then drives approve/rollback and, when the version becomes `active`,
 * resolves THIS activator by `config_type` and delegates the live-config toggle —
 * all inside the same governance transaction, so the status flip and the version
 * transition commit atomically. FR-040 therefore adds NO approve endpoint.
 *
 * Schema note: `product_configs` has no `is_active` boolean (the FR-132 dispatch
 * brief's shorthand); its live state is the `status` enum (`draft`→`active`→
 * `retired`). "Activate" maps to `status='active'`; to preserve INV-01 (at most
 * one active config per `(org, product_code)`) activation first retires any other
 * currently-active config for the same product_code. "Deactivate" (rollback) maps
 * to `status='retired'`. All writes are parameterised and org-scoped.
 */
@Injectable()
export class ProductConfigActivator implements ConfigActivatorPort, OnModuleInit {
  readonly configType = PRODUCT_CONFIG_CONFIG_TYPE;

  constructor(private readonly registry: ConfigActivatorRegistry) {}

  /** Self-register with the shared activation seam (FR-132 cross-module wiring). */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * Make the referenced draft config live. Idempotent: re-running on an
   * already-active row is a no-op status write. Retires any sibling active config
   * for the same `product_code` first so exactly one stays active.
   */
  async activate(cv: ConfigurationVersionRow, tx: DbTransaction): Promise<void> {
    if (cv.config_ref == null) return;
    const target = await tx
      .selectFrom('product_configs')
      .select(['product_config_id', 'product_code'])
      .where('product_config_id', '=', cv.config_ref)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .executeTakeFirst();
    if (target == null) return;

    // Retire the previously-active config for this product_code (if a different row).
    await tx
      .updateTable('product_configs')
      .set({ status: 'retired', updated_at: new Date(), updated_by: cv.updated_by })
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('product_code', '=', target.product_code)
      .where('status', '=', 'active')
      .where('product_config_id', '!=', cv.config_ref)
      .execute();

    // Promote the new version to active.
    await tx
      .updateTable('product_configs')
      .set({ status: 'active', updated_at: new Date(), updated_by: cv.updated_by })
      .where('product_config_id', '=', cv.config_ref)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .execute();
  }

  /**
   * Take the referenced config out of service on rollback. `status='retired'`;
   * in-flight leads pinned to it keep their FK (no `leads` write). When
   * `config_ref` is null the action is a no-op.
   */
  async deactivate(cv: ConfigurationVersionRow, tx: DbTransaction): Promise<void> {
    if (cv.config_ref == null) return;
    await tx
      .updateTable('product_configs')
      .set({ status: 'retired', updated_at: new Date(), updated_by: cv.updated_by })
      .where('product_config_id', '=', cv.config_ref)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .execute();
  }
}
