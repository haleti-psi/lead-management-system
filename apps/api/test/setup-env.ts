/**
 * Jest global setup: provide the required environment variables (per
 * docs/contracts/environment-contract.md) so that importing modules which wire
 * `ConfigModule.forRoot({ validate })` — which validates eagerly — does not
 * crash during test collection. These are inert dev/test placeholders; no real
 * secret is used. Individual unit tests still inject their own AppConfigService
 * fakes where they need specific values.
 */
const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  GCP_PROJECT: 'lms-test',
  GCP_REGION: 'asia-south1',
  DATABASE_URL: 'postgresql://app:app@localhost:5432/lms_test',
  JWT_ACCESS_SECRET: 'test-access-secret-0000000000000000',
  JWT_REFRESH_SECRET: 'test-refresh-secret-000000000000000',
  REDIS_URL: 'redis://localhost:6379',
  GCS_BUCKET: 'lms-test-docs',
  PUBSUB_TOPIC_EVENTS: 'lms-domain-events',
  CLOUD_TASKS_QUEUE: 'lms-integration',
  CLOUD_TASKS_LOCATION: 'asia-south1',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  APP_BASE_URL: 'http://localhost:5173',
  TOKENIZATION_KMS_KEY: 'test-local-key',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
