import { Injectable, type OnModuleInit } from '@nestjs/common';

import type { DbTransaction } from '../../../core/db';
import { ORG_ID_DEFAULT } from '../../../core/outbox/outbox.constants';
import { SLA_POLICY_CONFIG_TYPE } from '../admin.constants';
import { ConfigActivatorRegistry } from './config-activator.registry';
import type { ConfigActivatorPort, ConfigurationVersionRow } from './config-activator.port';

/**
 * FR-132 — activator for `config_type = 'sla_policy'` (the only activator wired in
 * this slice; FR-104 creates the paired `configuration_versions` row with
 * `config_ref = sla_policy_id` and the policy `is_active = false`).
 *
 * Activation flips `sla_policies.is_active` for the policy referenced by
 * `cv.config_ref`, inside the governance transaction so the toggle and the
 * `configuration_versions` status change commit atomically. The update is keyed
 * by `(sla_policy_id, org_id)` and parameterised. When `config_ref` is null
 * (no target row) the activation is a no-op.
 *
 * Seam note: `sla_policies` is owned by M11 (engagement, FR-104), but the
 * foundation FR-104 service exposes no `activate` method to delegate to. Per the
 * FR-132 dispatch brief this activator is registered here and performs the
 * single-column `is_active` toggle within the ambient `tx`; when M11 later
 * exposes an owner mutator this class is the one place to delegate it.
 */
@Injectable()
export class SlaPolicyActivator implements ConfigActivatorPort, OnModuleInit {
  readonly configType = SLA_POLICY_CONFIG_TYPE;

  constructor(private readonly registry: ConfigActivatorRegistry) {}

  /** Self-register with the shared activation seam (FR-132 cross-module wiring). */
  onModuleInit(): void {
    this.registry.register(this);
  }

  async activate(cv: ConfigurationVersionRow, tx: DbTransaction): Promise<void> {
    await this.setActive(cv, tx, true);
  }

  async deactivate(cv: ConfigurationVersionRow, tx: DbTransaction): Promise<void> {
    await this.setActive(cv, tx, false);
  }

  private async setActive(
    cv: ConfigurationVersionRow,
    tx: DbTransaction,
    isActive: boolean,
  ): Promise<void> {
    if (cv.config_ref == null) return;
    await tx
      .updateTable('sla_policies')
      .set({ is_active: isActive, updated_at: new Date(), updated_by: cv.updated_by })
      .where('sla_policy_id', '=', cv.config_ref)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .execute();
  }
}
