import { createHash } from 'node:crypto';

/**
 * The hash-chain (ADR-5 / architecture §8) is computed over a STABLE, canonical
 * serialisation of the auditable content of an `audit_logs` row — never the raw
 * JS object (key order, JSON formatting, and Date rendering must be
 * deterministic across processes so the same row always hashes identically).
 *
 * The canonical form covers exactly the immutable, content-bearing columns:
 * `audit_id, org_id, actor_id, action, entity_type, entity_id, lead_id, detail,
 * created_at`. The hash-chain columns themselves (`prev_audit_hash`,
 * `after_hash`, `before_hash`) and `updated_at` are excluded — they are the
 * chain's output, not its input. `ip_device` is forensic metadata and is also
 * excluded so it can never alter the tamper-evident digest of the business event.
 */
export interface CanonicalAuditRow {
  audit_id: string;
  org_id: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  lead_id: string | null;
  /** JSONB cell as stored: a string (from `pg`) or already-parsed value, or null. */
  detail: unknown;
  /** TIMESTAMPTZ — Date over `pg`, normalised to an ISO instant in the digest. */
  created_at: Date | string;
}

/**
 * Field separator (ASCII Unit Separator, 0x1F). Built from a char code rather
 * than embedded literally so the source file stays pure ASCII. It cannot occur
 * in a UUID, an enum literal, or the JSON-encoded `detail`/ISO `created_at`, so
 * it unambiguously delimits every field boundary in the canonical string.
 */
const FIELD_SEP = String.fromCharCode(0x1f);

/**
 * Deterministically serialise an arbitrary JSON value with object keys sorted,
 * so two structurally-equal payloads always produce the same string regardless
 * of key insertion order. `undefined` is normalised to `null`. The `detail` JSONB
 * may arrive as a string (already serialised by `pg`) — it is parsed first so the
 * digest is over the value, not its incidental text formatting.
 */
export function canonicalJson(value: unknown): string {
  return stableStringify(normalise(value));
}

function normalise(value: unknown): unknown {
  if (typeof value === 'string') {
    // A JSONB cell read back from pg is a JSON string; parse so equal documents
    // hash equally. Non-JSON strings (the common case for scalars) pass through.
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return value;
      }
    }
    return value;
  }
  return value;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',');
  return `{${body}}`;
}

/** Render `created_at` as a stable ISO-8601 instant (UTC). */
function isoInstant(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

/**
 * The canonical, order-stable string that is hashed for a row. Concatenates the
 * content columns with the {@link FIELD_SEP} delimiter so distinct rows can never
 * collide through field-boundary ambiguity.
 */
export function canonicalRow(row: CanonicalAuditRow): string {
  return [
    row.audit_id,
    row.org_id,
    row.actor_id,
    row.action,
    row.entity_type,
    row.entity_id ?? '',
    row.lead_id ?? '',
    canonicalJson(row.detail ?? null),
    isoInstant(row.created_at),
  ].join(FIELD_SEP);
}

/**
 * `after_hash = SHA-256( prev_audit_hash + '|' + canonicalRow(row) )` as a
 * lowercase hex digest (64 chars → fits `VARCHAR(64)`). The genesis row uses the
 * empty string for `prev_audit_hash`. This is the single definition of the chain
 * function used by BOTH the {@link AuditChainConsumer} (to seal) and the
 * integrity verifier (to detect tampering) — they can never drift.
 */
export function computeAfterHash(prevAuditHash: string, row: CanonicalAuditRow): string {
  return createHash('sha256').update(`${prevAuditHash}|${canonicalRow(row)}`).digest('hex');
}

/** The genesis sentinel for the first row's `prev_audit_hash`. */
export const GENESIS_PREV_HASH = '';
