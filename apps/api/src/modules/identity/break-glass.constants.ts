/**
 * FR-003 break-glass runtime constants. The only configurable knob is
 * `BREAK_GLASS_MAX_WINDOW_HOURS` (environment-contract.md, read via
 * AppConfigService); these are fixed per the LLD.
 */

/**
 * Roles that hold the `break_glass` capability (auth-matrix.json): only an
 * ADMIN or DPO may be nominated as the approver of a grant. Enforced by the
 * service after looking up the nominee's role; the AbacGuard already gates the
 * endpoint itself to these two roles.
 */
export const BREAK_GLASS_CAPABLE_ROLE_CODES: ReadonlySet<string> = new Set(['ADMIN', 'DPO']);

/**
 * Max rows the expiry sweep flips per cycle — also the NFR-17 list LIMIT guard.
 * A backlog larger than this drains over successive cycles (the job is
 * idempotent and re-runnable).
 */
export const BREAK_GLASS_EXPIRY_BATCH_SIZE = 100;

/** Expiry-sweep poll interval (ms). The BRD leaves cadence open; 60s is sane. */
export const BREAK_GLASS_EXPIRY_INTERVAL_MS = 60_000;
