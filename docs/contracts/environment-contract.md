# Environment Contract
*All environment variables. Agents must not introduce a var not listed here — add it first. App validates required vars at startup (Zod) and crashes with a clear message if missing — never a silent late failure. Secrets come from Secret Manager (injected as env at deploy), never committed.*

## Required (app will not start without these)
| Variable | Example | Description | Used by |
|---|---|---|---|
| `NODE_ENV` | `production` | Environment name | all |
| `GCP_PROJECT` | `lms-prod` | GCP project id | GCP clients |
| `GCP_REGION` | `asia-south1` | Region (India residency) | deploy/clients |
| `DATABASE_URL` | `postgresql://app:***@/lms?host=/cloudsql/<inst>` | Cloud SQL connection (or `INSTANCE_CONNECTION_NAME`+`DB_USER`/`DB_PASS`/`DB_NAME`) | Kysely/pg |
| `JWT_ACCESS_SECRET` | `<base64 32B>` | Access-token signing secret | auth |
| `JWT_REFRESH_SECRET` | `<base64 32B>` | Refresh-token signing secret | auth |
| `REDIS_URL` | `redis://10.0.0.3:6379` | Memorystore (cache, rate-limit, idempotency) | rate-limit, cache, IntegrationGateway |
| `GCS_BUCKET` | `lms-prod-docs` | Document storage bucket | M8 documents |
| `PUBSUB_TOPIC_EVENTS` | `lms-domain-events` | Outbox relay topic | M15 outbox publisher |
| `CLOUD_TASKS_QUEUE` | `lms-integration` | Retry/escalation queue | IntegrationGateway, SLA |
| `CLOUD_TASKS_LOCATION` | `asia-south1` | Tasks queue location | M15 |
| `ALLOWED_ORIGINS` | `https://lms.nbfc.in` | CSV CORS origins (credentials: true) | CORS |
| `APP_BASE_URL` | `https://lms.nbfc.in` | Base for customer links | M7 |
| `TOKENIZATION_KMS_KEY` | `projects/…/cryptoKeys/pii` | Field-level tokenisation key (PAN/Aadhaar/CKYC) — India-resident | masking/tokenisation |

## Optional (defaults apply)
| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP port (Cloud Run) |
| `LOG_LEVEL` | `info` | pino level |
| `ACCESS_TOKEN_TTL` | `15m` | JWT access lifetime |
| `REFRESH_TOKEN_TTL` | `7d` | Refresh lifetime |
| `SESSION_IDLE_MINUTES` | `30` | Idle timeout |
| `LOCKOUT_THRESHOLD` | `5` | Failed logins before lock |
| `LOCKOUT_MINUTES` | `15` | Lock duration |
| `OTP_TTL_SECONDS` | `300` | Customer/MFA OTP validity |
| `OTP_LENGTH` | `6` | OTP digits |
| `MFA_ISSUER` | `LMS NBFC` | TOTP issuer label |
| `CUSTOMER_LINK_TTL_DAYS` | `7` | Tokenised link expiry |
| `GCS_SIGNED_URL_TTL` | `600` | Signed URL seconds |
| `MAX_UPLOAD_MB` | `10` | Upload size cap |
| `DB_POOL_MIN` / `DB_POOL_MAX` | `2` / `10` | Connection pool |
| `RATE_LIMIT_AUTH` / `_MUTATION` / `_READ` | `10` / `60` / `300` per min | Throttler |
| `DEFAULT_PAGE_LIMIT` / `MAX_PAGE_LIMIT` | `25` / `100` | Pagination |

## Provider variables (production; vendors open per OD-08/OD-17; all calls go through ports/IntegrationGateway)
| Variable | Required in | Description |
|---|---|---|
| `LOS_BASE_URL`, `LOS_API_KEY`, `LOS_WEBHOOK_HMAC_SECRET` | Prod (real LOS) | LosPort http adapter; HMAC verifies inbound status webhook |
| `LOS_MOCK` | Dev/Test | `true` → LosMockAdapter (build/test without real LOS) |
| `PAN_PROVIDER_URL`, `PAN_PROVIDER_KEY` | Prod | PAN verification (KycPort) |
| `CKYC_URL`, `CKYC_KEY` / `DIGILOCKER_*` / `AADHAAR_*` | Phase 1.5 | KYC providers (KycPort) |
| `SMS_PROVIDER_URL`, `SMS_PROVIDER_KEY`, `SMS_SENDER_ID` | Prod | SMS (NotificationChannelPort) |
| `WHATSAPP_BSP_URL`, `WHATSAPP_BSP_KEY`, `WHATSAPP_WABA_ID` | Prod | WhatsApp (per-template approved) |
| `EMAIL_PROVIDER_URL`, `EMAIL_PROVIDER_KEY`, `EMAIL_FROM` | Prod | Email |
| `TRAI_DLT_ENTITY_ID` | Prod (India) | DLT principal-entity id (OD-17) |
| `CAPTCHA_SECRET` | Prod | Public capture endpoint anti-abuse |
| `AA_*`, `GST_*`, `VAHAN_*`, `CTI_*` | Phase 1.5 | AA/GST/asset/telephony ports |

## Startup validation
The app reads and Zod-validates all required vars at boot. Missing/invalid → immediate exit:
```
Error: Missing/invalid required environment variable: JWT_ACCESS_SECRET
```

## Local development
```bash
cp .env.example .env.local
# DATABASE_URL: Cloud SQL Auth Proxy or local Postgres 15 (lms_dev)
# JWT_ACCESS_SECRET / JWT_REFRESH_SECRET: openssl rand -base64 32
# REDIS_URL: local redis; LOS_MOCK=true; provider keys: sandbox or stub
```
