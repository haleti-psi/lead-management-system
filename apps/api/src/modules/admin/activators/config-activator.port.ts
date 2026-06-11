import type { Selectable } from 'kysely';

import type { DbTransaction } from '../../../core/db';
import type { ConfigurationVersions } from '../../../core/db/types.generated';

/** The `configuration_versions` row a governance action operates on. */
export type ConfigurationVersionRow = Selectable<ConfigurationVersions>;

/**
 * FR-132 — pluggable activation seam. Activation of the *target* configuration
 * (e.g. flipping `sla_policies.is_active`) is specific to each `config_type` and
 * owned by the module that owns that config table (owner-writes rule). The
 * generic governance engine never touches another module's table directly; it
 * resolves the activator for `cv.config_type` from the {@link ConfigActivatorRegistry}
 * and delegates, passing the ambient transaction so the activation commits
 * atomically with the status change.
 *
 * A `config_type` with no registered activator means the version is governed
 * (status transitions) but has no live side effect to toggle — that is a valid
 * configuration (the registry returns `undefined` and the engine skips activation).
 */
export interface ConfigActivatorPort {
  /** The `configuration_versions.config_type` this activator handles. */
  readonly configType: string;

  /**
   * Make the target configuration live (called on `approve` when the version
   * becomes `active`, and on `rollback` when a `rollback_ref` version is
   * re-activated). Must be idempotent and operate inside the supplied `tx`.
   */
  activate(cv: ConfigurationVersionRow, tx: DbTransaction): Promise<void>;

  /**
   * Take the target configuration out of service (called on `rollback` for the
   * version being rolled back). Must operate inside the supplied `tx`.
   */
  deactivate(cv: ConfigurationVersionRow, tx: DbTransaction): Promise<void>;
}

/** Multi-provider DI token: every module contributing an activator binds to this. */
export const CONFIG_ACTIVATORS = Symbol('CONFIG_ACTIVATORS');
