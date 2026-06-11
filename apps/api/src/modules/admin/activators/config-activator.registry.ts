import { Injectable } from '@nestjs/common';

import type { ConfigActivatorPort } from './config-activator.port';

/**
 * FR-132 — resolves the {@link ConfigActivatorPort} for a `config_type`. A single
 * shared instance (provided by the `@Global` {@link ConfigActivatorModule}) into
 * which every owning module's activator self-registers from its `onModuleInit`
 * (NestJS multi-providers do NOT aggregate across module scopes, so cross-module
 * activators must converge on one registry instance rather than a multi-token).
 *
 * `config_type`s without a registered activator resolve to `undefined` (the
 * governance engine then performs status transitions only). A duplicate
 * `configType` registration is a wiring error and fails fast.
 */
@Injectable()
export class ConfigActivatorRegistry {
  private readonly byType = new Map<string, ConfigActivatorPort>();

  /**
   * Register an activator under its `configType`. Called once per activator from
   * the owning module's `onModuleInit`. A duplicate `configType` is a wiring
   * error and throws.
   */
  register(activator: ConfigActivatorPort): void {
    if (this.byType.has(activator.configType)) {
      throw new Error(`Duplicate ConfigActivatorPort registered for config_type "${activator.configType}".`);
    }
    this.byType.set(activator.configType, activator);
  }

  /** The activator for `configType`, or `undefined` when none is registered. */
  resolve(configType: string): ConfigActivatorPort | undefined {
    return this.byType.get(configType);
  }
}
