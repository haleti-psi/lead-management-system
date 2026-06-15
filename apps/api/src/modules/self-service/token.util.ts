import { createHash, randomBytes } from 'node:crypto';

/** Generate a URL-safe opaque customer-link token (256 bits of entropy). The raw
 * token is dispatched in the link only — never stored or logged (LLD §Summary). */
export function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex of the raw token — the only token artefact persisted
 * (`customer_links.token_hash`). */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
