import { Global, Module } from '@nestjs/common';

import { ConfigActivatorRegistry } from './config-activator.registry';

/**
 * FR-132 — the cross-module activation seam. `@Global` so the SINGLE
 * {@link ConfigActivatorRegistry} instance is injectable by every module without
 * re-importing (architecture §3: shared seams as global modules). The governance
 * engine (M14) injects it to resolve activators; each owning module's activator
 * (M14 `sla_policy`, M5 `product_config`, …) injects the same instance and
 * self-registers from its `onModuleInit`. Holding the registry here — rather than
 * inside `AdminModule` — keeps governance independent of the config-owning
 * modules (no circular dependency).
 */
@Global()
@Module({
  providers: [ConfigActivatorRegistry],
  exports: [ConfigActivatorRegistry],
})
export class ConfigActivatorModule {}
