/**
 * pino redaction paths. Censors auth material and PII so nothing in
 * coding.md/security.md's "never log" list ever reaches a log sink — even at
 * debug level. Covers request headers, and both top-level and `req.body`-nested
 * occurrences of sensitive keys. pino redact does not support deep recursion, so
 * the common carriers (root, `*`, `req.body.*`, `req.query.*`) are enumerated.
 */

const SENSITIVE_KEYS = [
  // auth material / secrets
  'password',
  'token',
  'refresh_token',
  'refreshToken',
  'accessToken',
  'otp',
  'secret',
  'password_hash',
  'totp_secret_enc',
  // PII (security.md)
  'name',
  'full_name',
  'mobile',
  'email',
  'pan_token',
  'pan_masked',
  'aadhaar_ref_token',
  'ckyc_id',
  'gstin',
  'dob',
  'address',
  'ip_device',
] as const;

function expand(key: string): string[] {
  return [key, `*.${key}`, `req.body.${key}`, `req.query.${key}`, `res.body.${key}`];
}

export const REDACT_PATHS: string[] = [
  // request/response auth headers (case-insensitive header keys are lower-cased by node)
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap(expand),
];
