import { Inject, Injectable, Optional } from '@nestjs/common';

import { CONFIG_ACTIVATORS, type ConfigActivatorPort } from './config-activator.port';

/**
 * FR-132 — resolves the {@link ConfigActivatorPort} for a `config_type`. Each
 * owning module registers its activator under the {@link CONFIG_ACTIVATORS}
 * multi-provider token; this registry indexes them by `configType` once at
 * construction. `config_type`s without a registered activator resolve to
 * `undefined` (the governance engine then performs status transitions only).
 *
 * A duplicate `configType` registration is a wiring error and fails fast.
 */
@Injectable()
export class ConfigActivatorRegistry {
  private readonly byType: ReadonlyMap<string, ConfigActivatorPort>;

  constructor(
    @Optional() @Inject(CONFIG_ACTIVATORS) activators: ConfigActivatorPort[] | null,
  ) {
    const map = new Map<string, ConfigActivatorPort>();
    for (const activator of activators ?? []) {
      if (map.has(activator.configType)) {
        throw new Error(`Duplicate ConfigActivatorPort registered for config_type "${activator.configType}".`);
      }
      map.set(activator.configType, activator);
    }
    this.byType = map;
  }

  /** The activator for `configType`, or `undefined` when none is registered. */
  resolve(configType: string): ConfigActivatorPort | undefined {
    return this.byType.get(configType);
  }
}
