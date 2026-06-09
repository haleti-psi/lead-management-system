# Performance Guidelines
*Updated: 2026-06-08 | SLA source: BRD §9 NFR-02/03/05/17*

Thresholds are the BRD's actual NFRs — **not** generic defaults. If a generated endpoint cannot meet them, flag it in the LLD for review.

## API response-time targets (BRD NFR-02; p95, excludes external-provider latency)
| Endpoint type | p95 target |
|---|---|
| Read (single / list, paginated) | **≤ 500 ms** |
| Write (create/update) | **≤ 800 ms** |
| Dashboard / list page load | ≤ 2.5 s |
| Global search | ≤ 1.5 s |
| Complex report / aggregation | run **async** as an `ExportJob` (do not block the request) |

- **External provider calls (LOS/KYC/comms) are excluded** from these targets and must go through the `IntegrationGateway` (retry/circuit-breaker) — never inline on the request path. Map provider downtime to `UPSTREAM_UNAVAILABLE` (503) + queue.

## Pagination (mandatory on every list endpoint)
- Default page size **25**, **max 100** (BRD §4.4). Uniform envelope:
  `{ "data": [...], "meta": { "correlation_id": "…", "pagination": { "page": N, "limit": N, "total": N } }, "error": null }`
- Offset-based for admin/operational tables; cursor-based for high-volume feeds where needed.

## Query constraints (mandatory — NFR-17)
- **Every list query has a server-enforced LIMIT (≤ 100).** Unbounded `SELECT … ` without WHERE + LIMIT is forbidden.
- All queries parameterised via Kysely (see security.md). Reads use read replicas where available (reporting).

## N+1 prevention
- Never query inside a loop over rows. Batch with `WHERE col = ANY($ids)` / Kysely joins. List endpoints fetch related data in one query, not per-row.

## Index usage (cross-ref `docs/data-model/schema.sql`)
- WHERE/ORDER-BY columns must be indexed; the schema already provides FK, composite, partial (`WHERE deleted_at IS NULL`), and GIN (`score_reasons`, `attributes`, `pin_codes`, trigram on `name`) indexes. If a new query needs an index, add it via a Flyway migration — do not ship a sequential scan on a large table.

## Caching (Redis / Memorystore)
- Cache reference/master data (products, sources, SLA policies, business calendars, role permissions) with TTL + invalidate on config change (`CONFIG_CHANGED`).
- Idempotency keys and rate-limit counters in Redis.
- **Never cache lead/customer data in a shared cache without scoping the key by `org_id` + scope.** No cross-tenant/cross-scope cache bleed.

## Concurrency & transactions
- One DB connection per request via the `UnitOfWork`; multi-entity writes in a single transaction (architecture §11). Optimistic locking on `leads.version` — handle `CONFLICT` (409) with a refresh-and-retry UX.

## Background jobs (Cloud Tasks; outbox → Pub/Sub)
- Anything > 500 ms or any external call runs async (bulk import, KYC/LOS calls, comms send, report/export generation, retention purge, SLA sweep, outbox publish).
- Jobs are **idempotent**; retry with exponential backoff (max 3); poison messages → dead-letter. Job max runtime 5 min then timeout+retry.
- Transactional outbox: events written in the state-change tx; publisher relays at-least-once (idempotent consumers).

## Database connection pooling
- Shared pool (Cloud SQL connector / pgBouncer where used): start min 2 / max 10 per instance (tune to Cloud SQL `max_connections` and Cloud Run concurrency). Connection timeout 5 s. **Never open a connection per request** outside the pool.

## Frontend performance
- Route-level code splitting: `React.lazy()` + `Suspense` for every page. Per-route bundle ≤ **250 KB gzipped**. No barrel `export *` that defeats tree-shaking.
- Images: `loading="lazy"`, WebP, compressed on upload (mobile). TanStack Query for caching/dedup of server state; respect low-bandwidth mode (defer charts, reduce payloads).

## Capacity (NFR-03/05)
- Design for **3× initial volume** without redesign. App tier stateless and horizontally autoscaled (Cloud Run); integrations queue-based so spikes don't exhaust the request tier.
