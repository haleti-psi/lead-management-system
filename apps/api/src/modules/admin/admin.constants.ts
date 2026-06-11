/**
 * FR-132 — M14 Administration (configuration governance) constants.
 */

/** `audit_logs.entity_type` for every configuration-governance audit row. */
export const CONFIGURATION_ENTITY_TYPE = 'configuration_versions';

/** ABAC resource type pinned on the governance handlers (auth-matrix `scoped:false`). */
export const CONFIGURATION_RESOURCE_TYPE = 'configuration_versions';

/** `configuration_versions.config_type` discriminator for SLA-policy changes (mirrors FR-104). */
export const SLA_POLICY_CONFIG_TYPE = 'sla_policy';
