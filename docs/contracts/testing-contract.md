# Testing Contract
*Test requirements every FR must meet. Aligns with architecture §8 and `coding.md`/`security.md`. Enforced by `full-review` and CI.*

## Test stack
| Layer | Tool | Location |
|---|---|---|
| Backend unit (services, guards, rules) | **Jest** + ts-jest | `*.spec.ts` adjacent to source |
| Backend API integration | **Jest + supertest** against the Nest app + **Testcontainers-Postgres** | `*.e2e-spec.ts` (`apps/api/test/`) |
| Frontend unit/component | **Vitest** + `@testing-library/react` | `*.test.tsx` adjacent |
| E2E (UI flows) | **Playwright** | `apps/web/e2e/*.spec.ts` |
| Schema | DDL load (`ON_ERROR_STOP`) | CI (already validated) |

## Required tests by FR tier
| Tier | Unit | API integration | State machine | External service | E2E |
|---|---|---|---|---|---|
| Simple (e.g. FR-042/054/103) | core logic | 1 happy path | n/a | n/a | optional |
| Moderate (e.g. FR-010/050/100/110) | logic + validation | all endpoints: happy + each error path | if it touches a status | mock port | key journey |
| Complex (e.g. FR-020/030/052/071/081/115/140) | all logic | all endpoints + boundary + idempotency | all transitions + invalid (409) | mock + timeout + retry + dedupe | full workflow |

Tier is taken from the FR's LLD (Stage 6).

## Mandatory coverage (every FR)
- **Every happy path AND every named error in `error-taxonomy.md`** that the FR can raise has a test.
- **Authorization negatives:** out-of-scope read/write denied (RM cannot see another RM's lead; PARTNER cannot see another partner's; ADMIN cannot read lead content without break-glass).
- **Masking:** PII masked in responses and exports per role.
- **Idempotency:** replayed `Idempotency-Key` returns the original result, creates no duplicate (FR-010/081/140).
- **Transactions:** a forced mid-write failure rolls back the whole unit of work (no partial Lead+audit+outbox).
- **Optimistic lock:** stale `expectedVersion` → `CONFLICT`.
- **Consent gates:** dispatch blocked without consent basis; stage gate blocked without granted purpose.
- **Rate limits:** auth/OTP/public endpoints enforce limits (`RATE_LIMITED`).
- **Append-only:** UPDATE/DELETE on `audit_logs`/`consent_records`/`stage_history` is rejected.

## Test data
- **Factories** in `apps/api/test/factories/` — each produces a complete valid entity with sensible defaults; override per test. Seed via Flyway + the bootstrap seed (org, roles, system user, default calendar).
- Isolated Postgres per run via Testcontainers; no shared mutable state between tests.

## Mocking external services
Use the test doubles in `integration-map.md` (mock adapters / `LosMockAdapter`). **Never call a real external provider** in unit or integration tests. Staging may use sandboxes.

## Definition of "passing" (merge gate)
A PR may not merge unless: all tests pass; no test was deleted to make others pass; new-code coverage does not decrease (target **≥ 80%**, and 100% of error-taxonomy paths the FR can raise); `tsc --noEmit` + ESLint clean.

## Naming
`describe('<unit>')` + `it('<does X> when <scenario>')`.
Example: `it('returns CONFLICT when handing off a lead with an open KYC exception')`.
