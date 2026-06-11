import { Module } from '@nestjs/common';

import { ConfigActivatorModule } from '../admin/activators/config-activator.module';
import { ProductConfigActivator } from './product-config.activator';
import { ProductConfigController } from './product-config.controller';
import { ProductConfigRepository } from './product-config.repository';
import { ProductConfigService } from './product-config.service';
import { SchemeController } from './scheme.controller';
import { SchemeRepository } from './scheme.repository';
import { SchemeService } from './scheme.service';

/**
 * M5 Product Configuration — FR-040 (product configs) + FR-042 (schemes & offers).
 * Depends on the global core modules (DB, audit, outbox, auth-core, config) and
 * the `@Global` {@link ConfigActivatorModule}.
 *
 * FR-040: CRUD + maker-checker creation/edit/retire of `product_configs`. The
 * product-config activation seam plugs into FR-132: {@link ProductConfigActivator}
 * self-registers with the shared {@link ConfigActivatorRegistry} on init, so the
 * generic governance engine resolves it by `config_type='product_config'` when a
 * pending version is approved (or rolled back) and toggles the live `product_configs`
 * row inside the governance transaction.
 *
 * FR-042: scheme administration (`/admin/schemes`) — {@link SchemeController} /
 * {@link SchemeService} / {@link SchemeRepository}. Schemes are immediately active
 * (no draft/maker-checker, no config activator), so no activator is registered for
 * them. {@link SchemeService} is exported so the lead-capture FR can reuse its
 * `validateAndResolveScheme` rules when attaching a scheme to a lead.
 */
@Module({
  imports: [ConfigActivatorModule],
  controllers: [ProductConfigController, SchemeController],
  providers: [
    ProductConfigService,
    ProductConfigRepository,
    ProductConfigActivator,
    SchemeService,
    SchemeRepository,
  ],
  exports: [ProductConfigService, ProductConfigActivator, SchemeService],
})
export class ProductConfigModule {}
