import { Module } from '@nestjs/common';

import { ConfigActivatorModule } from '../admin/activators/config-activator.module';
import { ProductConfigActivator } from './product-config.activator';
import { ProductConfigController } from './product-config.controller';
import { ProductConfigRepository } from './product-config.repository';
import { ProductConfigService } from './product-config.service';

/**
 * M5 Product Configuration — FR-040. CRUD + maker-checker creation/edit/retire of
 * `product_configs`. Depends on the global core modules (DB, audit, outbox,
 * auth-core, config) and the `@Global` {@link ConfigActivatorModule}.
 *
 * The product-config activation seam plugs into FR-132: {@link ProductConfigActivator}
 * self-registers with the shared {@link ConfigActivatorRegistry} on init, so the
 * generic governance engine resolves it by `config_type='product_config'` when a
 * pending version is approved (or rolled back) and toggles the live `product_configs`
 * row inside the governance transaction.
 */
@Module({
  imports: [ConfigActivatorModule],
  controllers: [ProductConfigController],
  providers: [ProductConfigService, ProductConfigRepository, ProductConfigActivator],
  exports: [ProductConfigService, ProductConfigActivator],
})
export class ProductConfigModule {}
