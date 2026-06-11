/**
 * FR-042 — M5 Scheme & Offer constants.
 *
 * Schemes are an immediately-active master record (the `schemes` table has no
 * `config_status`/`version`/`configuration_versions` governance, unlike
 * `product_configs`/`sla_policies`). Per the FR-042 LLD (§Backend Flow A,
 * §Transaction Boundaries) creation is a single-table insert with `is_active=true`
 * plus an `audit_logs(config_change)` intent — NO maker-checker, NO config
 * activator, NO outbox event. The generic FR-131 master comment that pencils a
 * `config_type 'scheme'` is therefore not used: FR-042 owns the concrete
 * `/admin/schemes` controller and writes the table directly (owner-writes).
 */

/** `audit_logs.entity_type` for every scheme audit row. */
export const SCHEME_ENTITY_TYPE = 'schemes';

/** ABAC resource type pinned on the handlers (auth-matrix `scoped:false`). */
export const SCHEME_RESOURCE_TYPE = 'schemes';
