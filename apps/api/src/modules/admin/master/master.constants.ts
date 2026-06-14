/**
 * FR-131 — Master Configuration constants.
 *
 * The generic `/admin/{masterResource}` handler dispatches to one of the master
 * entities below. The allow-list deliberately EXCLUDES every resource that an
 * already-committed FR owns with its own concrete controller, to avoid a route
 * collision and respect the owner-writes rule (architecture §11.2):
 *
 *  - `users` / `roles` / `teams`      → FR-130  (`/admin/users`, `/admin/roles`, `/admin/teams`)
 *  - `product-configs`                → FR-040  (`/admin/products`, config_type `product_config`)
 *  - `sla-policies`                   → FR-104  (`/admin/sla-policies`, config_type `sla_policy`)
 *  - `schemes`                        → FR-042  (config_type `scheme`)
 *  - `allocation-rules`               → FR-030  (`/admin/allocation-rules`, M4 owner-writes)
 *  - `webhook-subscriptions`          → FR-140  (`/admin/webhooks`)
 *  - `break-glass`                    → FR-003  (`/admin/break-glass`)
 *
 * Each resource still funnels its create/update through the FR-132 governance
 * trail: the master row is written, a paired `configuration_versions(status='pending')`
 * row is created (maker-checker), a `CONFIG_CHANGED` outbox event is emitted, and
 * a `config_change` audit intent is appended — all in ONE UnitOfWork transaction.
 */

/** ABAC resource type pinned on the generic master handlers (auth-matrix `scoped:false`). */
export const MASTER_RESOURCE_TYPE = 'configuration_versions';

/** `event_outbox.aggregate_type` for every master CONFIG_CHANGED event (the governance row). */
export const MASTER_AGGREGATE_TYPE = 'configuration_versions';

/**
 * The allow-listed `{masterResource}` slugs FR-131 owns. This is the SINGLE
 * source of truth for both the registry (dispatch) and the controller route
 * pattern (collision avoidance). It deliberately excludes every resource owned by
 * a concrete controller in another FR (see file header).
 */
// NOTE: ownership of partners/communication-templates/retention is pending
// cross-FR review (other modules may claim these); left here as-is.
// `allocation-rules` was claimed by FR-030 (M4 owns allocation_rules).
// `dla-registry` is owned by M12 FR-113 /compliance/dla — claimed out, like allocation_rules/FR-030.
export const MASTER_SLUGS = [
  'regions',
  'branches',
  'rejection-reasons',
  'business-calendars',
  'retention-policies',
  'partners',
  'communication-templates',
] as const;

export type MasterSlug = (typeof MASTER_SLUGS)[number];

/**
 * Express/path-to-regexp param pattern constraining `:masterResource` to the
 * allow-list. Because the route layer only matches these exact slugs, a request
 * to a concrete sibling path owned by another FR (`/admin/users`,
 * `/admin/products`, `/admin/integrations`, …) never matches the generic handler
 * and correctly falls through to that FR's controller — regardless of module
 * registration order. An unknown slug matches no route → 404 NOT_FOUND (the
 * route-ownership contract for an unknown/disallowed master resource).
 */
export const MASTER_RESOURCE_ROUTE = `:masterResource(${MASTER_SLUGS.join('|')})`;

