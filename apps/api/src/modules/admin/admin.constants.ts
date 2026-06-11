/**
 * FR-132 — M14 Administration (configuration governance) constants.
 */

/** `audit_logs.entity_type` for every configuration-governance audit row. */
export const CONFIGURATION_ENTITY_TYPE = 'configuration_versions';

/** ABAC resource type pinned on the governance handlers (auth-matrix `scoped:false`). */
export const CONFIGURATION_RESOURCE_TYPE = 'configuration_versions';

/** `configuration_versions.config_type` discriminator for SLA-policy changes (mirrors FR-104). */
export const SLA_POLICY_CONFIG_TYPE = 'sla_policy';

/**
 * FR-130 — M14 user/role/team administration constants.
 */

/** ABAC resource type pinned on the user/role/team admin handlers (auth-matrix `scoped:false`). */
export const USERS_RESOURCE_TYPE = 'users';

/** `audit_logs.entity_type` for a user-lifecycle audit row. */
export const USER_ENTITY_TYPE = 'user';

/** `audit_logs.entity_type` for a role / role_permissions audit row. */
export const ROLE_ENTITY_TYPE = 'role';

/** `audit_logs.entity_type` for a team audit row (team writes log `user_change`). */
export const TEAM_ENTITY_TYPE = 'team';

/**
 * Terminal lead stages excluded from the "open leads" count and from bulk
 * reassignment (LLD Assumption A-2). A lead in one of these stages is no longer
 * actively owned, so deactivating its owner needs no reassignment.
 */
export const TERMINAL_LEAD_STAGES = ['handed_off', 'rejected'] as const;
