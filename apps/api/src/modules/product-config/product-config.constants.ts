/**
 * FR-040 — M5 Product Configuration constants.
 */

/**
 * `configuration_versions.config_type` discriminator for product-config changes.
 * The {@link ProductConfigActivator} registers under this value, so FR-132's
 * approve/rollback resolves it and toggles the live `product_configs` row.
 */
export const PRODUCT_CONFIG_CONFIG_TYPE = 'product_config';

/** `audit_logs.entity_type` for every product-config audit row. */
export const PRODUCT_CONFIG_ENTITY_TYPE = 'product_config';

/** `event_outbox.aggregate_type` for product-config CONFIG_CHANGED events. */
export const PRODUCT_CONFIG_AGGREGATE_TYPE = 'product_config';

/** ABAC resource type pinned on the handlers (auth-matrix `scoped:false`). */
export const PRODUCT_CONFIG_RESOURCE_TYPE = 'product_configs';
