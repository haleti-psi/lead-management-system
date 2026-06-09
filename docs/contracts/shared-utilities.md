# Shared Utilities Inventory
*Services, schemas, middleware, and components multiple FRs share. Agents MUST reuse these — never recreate. New shared utilities are added here first. Locations per `docs/architecture.md` §3.*

## Core services (`apps/api/src/core/*`) — cross-cutting, consumed by all modules
| Service | Location | Purpose | Used by |
|---|---|---|---|
| `EntitlementService.can(user, capability, resource)` | `core/auth/` | Single ABAC decision point (auth-matrix.json) | every protected endpoint |
| `UnitOfWork.run(fn(tx))` | `core/db/` | Request-scoped ambient transaction (nestjs-cls); owners enlist | every multi-entity write (§11) |
| `Db` (Kysely instance) + generated types | `core/db/` | Typed parameterised queries | all repositories |
| `AuditAppender` + `AuditChainConsumer` | `core/audit/` | Emit audit intent; single-writer hash chain | all sensitive actions |
| `OutboxService.emit(event, tx)` | `core/outbox/` | Transactional outbox write | all state-changing FRs |
| `IntegrationGateway.call(port, req, {idempotencyKey})` | `core/integration/` | Idempotency, retry, circuit breaker, IntegrationLog | all external calls (FR-140) |
| Ports: `LosPort`, `KycPort`, `NotificationChannelPort`, `TelephonyPort`, `AaPort`, `GstPort`, `AssetVerificationPort` | `core/integration/ports/` | External boundaries (+ mock adapters) | M8/M9/M11 |
| `BusinessCalendarService.resolve(branch?,region?)` + `SlaEngine` | `core/sla/` | One business-time clock; SLA due/breach | FR-104 + all timers |
| `MaskingService` / masking interceptor | `core/masking/` | Role-based PAN/mobile/Aadhaar masking; strictest on export | serialization, exports |
| `NotificationDispatchService.send(lead, template, channel)` | `modules/engagement/` | Consent/opt-out-gated dispatch | FR-101/103 + events |

## Domain services (sole writers of their entities — owner-writes §11)
| Service | Module | Mutators / purpose |
|---|---|---|
| `LeadService` | M2 | **sole writer of `leads`**: `create / transitionStage / assignOwner / setScore / setHotFlag / setKycStatus / setConsentStatus / recordEligibility / markHandedOff / merge` (each `expectedVersion`) |
| `StageGuardService` | M2 | evaluates §10.3 transition guards (single owner of the matrix) |
| `DuplicateService` | M3 | match rules + confidence (FR-020) |
| `ScoringService` | M4 | explainable lead score + hot rules (FR-011/031) |
| `AllocationService` | M4 | rule-ordered allocation (FR-030) |
| `RetentionEngine` | M12 | scheduled purge/anonymise respecting legal hold (FR-115) |
| `CodeGenerator` | M2/M12 | `lead_code` (`LD-{YYYY}-{seq6}`), `grievance_no`, `partner_code` |

## Shared Zod schemas (`packages/shared/src/...` & `apps/api/src/common/`)
| Schema | Shape | Used by |
|---|---|---|
| `PaginationParams` | `{ page=1, limit=25 (max 100), sort?, filter? }` | every list endpoint |
| `UUIDParam` | `{ id: uuid }` | every `/{id}` route |
| `MobileSchema` | `^[6-9]\d{9}$` | capture, identity |
| `PanSchema` / `GstinSchema` / `PinSchema` | format-validated | identity, product |
| `IdempotencyKey` | header string | state-creating POSTs |
| `DateRangeParam` | `{ from, to }` (IST) | reports |
| `ApiEnvelope<T>` / `ApiError` | `{ data, meta, error }` (§4.4 / error-taxonomy) | all responses |

## Shared guards / middleware / interceptors
| Item | Location | Applied to |
|---|---|---|
| `JwtAuthGuard` (global) + `@Public()` | `core/auth/` | all endpoints (public opt-out) |
| `AbacGuard` + `@Requires(capability, scopeResolver)` | `core/auth/` | protected endpoints |
| `CustomerLinkGuard` (token + OTP) | `modules/self-service/` | `/c/{token}/*` |
| `CorrelationMiddleware` | `core/http/` | all requests |
| `ResponseEnvelopeInterceptor` | `core/http/` | all responses |
| `AllExceptionsFilter` | `core/http/` | maps to error-taxonomy envelope |
| `ThrottlerGuard` (Redis) | `core/auth/` | auth/OTP/public/mutation/read tiers |

## Shared UI components (`apps/web/src/components/`) — do not recreate (BRD §4.5)
| Component | Purpose |
|---|---|
| `AppShell` | role-filtered nav, top bar (search/quick-create/notifications), mobile bottom nav |
| `DataTable` | server pagination/sort, column visibility, scope-aware bulk-select |
| `EntityForm` | RHF+Zod form; maps `VALIDATION_ERROR.fields` to inline errors |
| `Modal` / `Drawer` / `ConfirmDialog` | Radix dialogs; ConfirmDialog captures reason for destructive/audited actions |
| `Toast` | non-blocking mutation feedback |
| `StatusChip` | consent/KYC/document/SLA/duplicate/hand-off — consistent app-wide |
| `MaskedField` | PAN/mobile/Aadhaar masked display |
| `EmptyState` / `LoadingSkeleton` / `ErrorState` | mandatory view states |
| `PageHeader` | title + scoped actions |
| `apiClient` (`lib/api`) | typed fetch with envelope + correlation + auth cookie |

## Shared enums
`@shared/enums` — generated from BRD §5.5. The **only** source of enum values for both apps; never redefine an enum locally.
