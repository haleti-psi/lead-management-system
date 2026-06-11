import { Module, type FactoryProvider } from '@nestjs/common';

import { CONFIG_ACTIVATORS, type ConfigActivatorPort } from './activators/config-activator.port';
import { ConfigActivatorRegistry } from './activators/config-activator.registry';
import { SlaPolicyActivator } from './activators/sla-policy.activator';
import { ConfigGovernanceController } from './config-governance.controller';
import { ConfigGovernanceRepository } from './config-governance.repository';
import { ConfigGovernanceService } from './config-governance.service';

/**
 * M14 Administration — FR-132 configuration governance (maker-checker). Depends
 * on the global core modules (DB, audit, outbox, auth-core, config).
 *
 * The activation seam ({@link ConfigActivatorRegistry}) is populated via the
 * {@link CONFIG_ACTIVATORS} multi-provider token. This slice wires the
 * `sla_policy` activator ({@link SlaPolicyActivator}); other `config_type`s
 * (product_config, scheme, …) register their own activators against the same
 * token as those modules are built — no change to the governance engine.
 */
/**
 * Multi-provider registration for the `sla_policy` activator. The installed
 * `@nestjs/common` typings omit `multi` from the provider interfaces (it is a
 * supported runtime option), so we declare it as a `FactoryProvider` extended
 * with `multi` and resolve the instance through Nest DI.
 */
const slaPolicyActivatorProvider: FactoryProvider<ConfigActivatorPort> & { multi: true } = {
  provide: CONFIG_ACTIVATORS,
  useFactory: (activator: SlaPolicyActivator): ConfigActivatorPort => activator,
  inject: [SlaPolicyActivator],
  multi: true,
};

@Module({
  controllers: [ConfigGovernanceController],
  providers: [
    ConfigGovernanceService,
    ConfigGovernanceRepository,
    ConfigActivatorRegistry,
    SlaPolicyActivator,
    slaPolicyActivatorProvider,
  ],
  exports: [ConfigGovernanceService],
})
export class AdminModule {}
