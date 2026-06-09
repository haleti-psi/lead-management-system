# Dependency Register
*Approved libraries only. Agents must not introduce a library not listed here — add it here first (with justification).*

Derived from `docs/architecture.md` (§2, ADRs). Versions are minimums; pin exact versions in lockfiles.

## Backend (`apps/api` — NestJS)
| Concern | Library | Version | Notes |
|---|---|---|---|
| Framework | `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express` | ^10 | modular monolith |
| Config | `@nestjs/config` + `zod` | ^10 / ^3.23 | env validated at startup |
| DB query layer | `kysely` | ^0.27 | typed SQL builder (ADR-2) — **not** an ORM |
| DB types | `kysely-codegen` (dev) | latest | generate types from schema |
| DB driver | `pg` | ^8 | PostgreSQL |
| Migrations | Flyway (CLI, not npm) | 10.x | owns schema (`docs/data-model/migrations/`) |
| Transactions/CLS | `nestjs-cls` | ^4 | UnitOfWork ambient transaction (§11) |
| Validation | `zod` | ^3.23 | all DTOs/webhooks/forms |
| Auth — JWT | `@nestjs/jwt` | ^10 | access/refresh |
| Auth — password hash | `argon2` | ^0.40 | (or bcrypt) |
| Auth — MFA/TOTP | `otplib` | ^12 | |
| Rate limiting | `@nestjs/throttler` + `ioredis` | ^6 / ^5 | Redis-backed |
| Cache/idempotency | `ioredis` | ^5 | Memorystore |
| Logging | `nestjs-pino` + `pino` | ^4 / ^9 | structured JSON |
| HTTP hardening | `helmet` | ^7 | |
| GCP — storage | `@google-cloud/storage` | ^7 | GCS documents |
| GCP — queue | `@google-cloud/tasks` | ^5 | retries, SLA sweep |
| GCP — events | `@google-cloud/pubsub` | ^4 | outbox relay |
| GCP — secrets | `@google-cloud/secret-manager` | ^5 | |
| HTTP client (providers) | native `fetch` (undici) | built-in | behind IntegrationGateway ports; no axios |
| Testing | `jest`, `ts-jest`, `supertest` | latest | NestJS default unit + API |
| Test DB | `testcontainers` (`@testcontainers/postgresql`) | latest | isolated Postgres |

## Frontend (`apps/web` — React + Vite)
| Concern | Library | Version | Notes |
|---|---|---|---|
| UI runtime | `react`, `react-dom` | ^18 | |
| Build | `vite`, `@vitejs/plugin-react` | ^5 | |
| Styling | `tailwindcss` | ^3 | |
| Components | `shadcn/ui` (Radix primitives) | latest | |
| Icons | `lucide-react` | latest | |
| Server state | `@tanstack/react-query` | ^5 | |
| Forms | `react-hook-form` + `zod` + `@hookform/resolvers` | ^7 / ^3.23 | |
| Dates | `date-fns` + `date-fns-tz` | ^3 | IST formatting |
| Routing | `react-router-dom` | ^6 | |
| PWA | `vite-plugin-pwa` | latest | service worker |
| i18n | `i18next` + `react-i18next` | latest | |
| Unit test | `vitest` + `@testing-library/react` | latest | |
| E2E | `@playwright/test` | latest | shared with api |

## Shared (`packages/shared`)
`zod`, `typescript` ^5 (strict). Enums generated from BRD §5.5.

## Explicitly prohibited
| Library | Reason | Use instead |
|---|---|---|
| `prisma`, `drizzle-orm`, `typeorm` | ADR-2 chose Kysely; ORMs model the schema (enums/deferred-FK/hash-chain) poorly | `kysely` |
| any Postgres-RLS / policy lib | auth is app-level ABAC (ADR-3) | `EntitlementService` |
| `moment` | bundle/deprecated | `date-fns` |
| `lodash` | tree-shaking | native / `remeda` |
| `axios` | unnecessary wrapper | native `fetch` |
| `jquery` | not needed | React |
| `redux` | overkill | React Query + local state |

## Adding a dependency
1. Add a row here with justification. 2. Confirm no approved lib covers it. 3. Check bundle/security impact. 4. Reference in the PR. New deps that touch security/crypto/SQL require review.
