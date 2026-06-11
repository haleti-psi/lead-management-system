import { Module, type FactoryProvider } from '@nestjs/common';

import {
  CONFIG_ACTIVATORS,
  type ConfigActivatorPort,
} from '../admin/activators/config-activator.port';
import { ProductConfigActivator } from './product-config.activator';
import { ProductConfigController } from './product-config.controller';
import { ProductConfigRepository } from './product-config.repository';
import { ProductConfigService } from './product-config.service';

/**
 * M5 Product Configuration — FR-040. CRUD + maker-checker creation/edit/retire of
 * `product_configs`. Depends on the global core modules (DB, audit, outbox,
 * auth-core, config), so it imports none directly.
 *
 * The product-config activation seam plugs into FR-132: {@link ProductConfigActivator}
 * is registered against the {@link CONFIG_ACTIVATORS} multi-provider token, so the
 * generic governance engine resolves it by `config_type='product_config'` when a
 * pending version is approved (or rolled back) and toggles the live `product_configs`
 * row inside the governance transaction. The activator is also exported so the
 * application orchestrator can compose the providers when wiring the module.
 */
/**
 * Multi-provider registration for the `product_config` activator. The installed
 * `@nestjs/common` typings omit `multi` from the provider interfaces (a supported
 * runtime option), so we declare it as a `FactoryProvider` extended with `multi`
 * and resolve the instance through Nest DI — mirroring `AdminModule`'s SLA wiring.
 */
const productConfigActivatorProvider: FactoryProvider<ConfigActivatorPort> & { multi: true } = {
  provide: CONFIG_ACTIVATORS,
  useFactory: (activator: ProductConfigActivator): ConfigActivatorPort => activator,
  inject: [ProductConfigActivator],
  multi: true,
};

@Module({
  controllers: [ProductConfigController],
  providers: [
    ProductConfigService,
    ProductConfigRepository,
    ProductConfigActivator,
    productConfigActivatorProvider,
  ],
  exports: [ProductConfigService, ProductConfigActivator],
})
export class ProductConfigModule {}
