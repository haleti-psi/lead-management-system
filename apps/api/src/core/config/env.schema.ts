import { z } from 'zod';

/**
 * Single source of truth for environment variables.
 * Mirrors docs/contracts/environment-contract.md exactly — do NOT introduce a
 * variable that is not in that contract. Required vars have no default and the
 * app refuses to start without them (fail-fast); optional vars carry the
 * contract's documented defaults.
 */

const csvOrigins = z
  .string()
  .min(1)
  .transform((raw) => raw.split(',').map((o) => o.trim()).filter((o) => o.length > 0))
  .pipe(z.array(z.string().url()).min(1));

// Coerce numeric env strings, enforcing integer bounds where the contract states them.
const intFrom = (def: number, opts?: { min?: number; max?: number }): z.ZodDefault<z.ZodNumber> => {
  let schema = z.coerce.number().int();
  if (opts?.min !== undefined) schema = schema.min(opts.min);
  if (opts?.max !== undefined) schema = schema.max(opts.max);
  return schema.default(def);
};

export const envSchema = z.object({
  // ── Required (app will not start without these) ──────────────
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
  GCP_PROJECT: z.string().min(1),
  GCP_REGION: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GCS_BUCKET: z.string().min(1),
  PUBSUB_TOPIC_EVENTS: z.string().min(1),
  CLOUD_TASKS_QUEUE: z.string().min(1),
  CLOUD_TASKS_LOCATION: z.string().min(1),
  ALLOWED_ORIGINS: csvOrigins,
  APP_BASE_URL: z.string().url(),
  TOKENIZATION_KMS_KEY: z.string().min(1),

  // ── Optional (defaults apply — values per environment-contract.md) ──
  PORT: intFrom(8080, { min: 1, max: 65535 }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('7d'),
  SESSION_IDLE_MINUTES: intFrom(30, { min: 1 }),
  LOCKOUT_THRESHOLD: intFrom(5, { min: 1 }),
  LOCKOUT_MINUTES: intFrom(15, { min: 1 }),
  OTP_TTL_SECONDS: intFrom(300, { min: 1 }),
  OTP_LENGTH: intFrom(6, { min: 4, max: 10 }),
  MFA_ISSUER: z.string().default('LMS NBFC'),
  CUSTOMER_LINK_TTL_DAYS: intFrom(7, { min: 1 }),
  GCS_SIGNED_URL_TTL: intFrom(600, { min: 1 }),
  MAX_UPLOAD_MB: intFrom(10, { min: 1 }),
  DB_POOL_MIN: intFrom(2, { min: 0 }),
  DB_POOL_MAX: intFrom(10, { min: 1 }),
  RATE_LIMIT_AUTH: intFrom(10, { min: 1 }),
  RATE_LIMIT_MUTATION: intFrom(60, { min: 1 }),
  RATE_LIMIT_READ: intFrom(300, { min: 1 }),
  DEFAULT_PAGE_LIMIT: intFrom(25, { min: 1 }),
  MAX_PAGE_LIMIT: intFrom(100, { min: 1 }),
  BREAK_GLASS_MAX_WINDOW_HOURS: intFrom(48, { min: 1 }),
  MERGE_UNMERGE_WINDOW_HOURS: intFrom(24, { min: 1 }),
  DASHBOARD_CACHE_TTL_SECONDS: intFrom(60, { min: 1 }),

  // ── Provider variables (environment-contract.md §Provider variables) ──
  // Optional in the schema: required only where the real provider/inbound
  // webhook is enabled (prod). Dev/test run with mock adapters (LOS_MOCK=true)
  // and never read the HMAC secret. FR-140 IntegrationGateway / LosWebhookGuard.
  LOS_MOCK: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  LOS_WEBHOOK_HMAC_SECRET: z.string().min(1).optional(),
});

/** Fully-typed, validated environment. `ALLOWED_ORIGINS` is parsed to `string[]`. */
export type AppEnv = z.infer<typeof envSchema>;

/**
 * Validation hook for `@nestjs/config` `ConfigModule.forRoot({ validate })`.
 * Throws a clear, single-line error naming the first offending variable so the
 * process crashes at startup rather than failing late (architecture §6).
 */
export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const name = first?.path.join('.') ?? 'unknown';
    const reason = first?.message ?? 'invalid';
    throw new Error(`Missing/invalid required environment variable: ${name} (${reason})`);
  }
  return parsed.data;
}
