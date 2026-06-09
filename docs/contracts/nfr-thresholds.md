# NFR Thresholds
*Concrete requirements (not guidelines). Derived from BRD §9 (NFR-01..22) and §4.6. Every FR must meet these.*

## Performance (BRD NFR-02/03/17; p95, excludes external-provider latency)
| Metric | Threshold | Measurement |
|---|---|---|
| Read endpoint (single/list, paginated) p95 | **≤ 500 ms** | Cloud Monitoring |
| Write endpoint (create/update) p95 | **≤ 800 ms** | Cloud Monitoring |
| Dashboard / list page load | ≤ 2.5 s | RUM |
| Global search | ≤ 1.5 s | Cloud Monitoring |
| Complex report/aggregation | run **async** as `ExportJob` (not on request path) | — |
| Max rows per unpaginated query | **100** | enforced in DB queries (NFR-17) |
| Default page size | **25** | API default (§4.4) |
| Maximum page size | **100** | API maximum |
| Max file upload size | 10 MB (configurable) | validated at upload |
| Capacity headroom | design for **3× initial volume** w/o redesign | NFR-03 |

## Availability & DR (NFR-04/11)
| Metric | Threshold |
|---|---|
| Business-hours availability | **≥ 99.5%**, graceful degradation when LOS/KYC/comms down |
| RPO | ≤ 24 h |
| RTO | ≤ 4 h |
| Backups | daily minimum (Cloud SQL automated + PITR) |

## Security (NFR-06/07; §4.6)
| Requirement | Value |
|---|---|
| Session idle timeout | 30 min (configurable); logout invalidates immediately |
| Access token TTL | 15 min; rotating refresh token (httpOnly cookie) |
| Password minimum | 10 chars, upper/lower/digit/symbol; history + expiry per IT policy |
| Account lockout | 5 failed attempts → 15-min lock |
| MFA | mandatory for ADMIN, DPO, HEAD, PARTNER; configurable others |
| Rate limit — auth/OTP | 10 / min per IP |
| Rate limit — mutations | 60 / min per user |
| Rate limit — reads | 300 / min per user |
| Encryption | TLS in transit; at rest; field-level tokenisation for PAN/Aadhaar/CKYC |
| Raw Aadhaar/biometrics | never stored |

## Privacy & data residency (NFR-09/10)
| Requirement | Value |
|---|---|
| Production data residency | **India** (asia-south1); cross-border only if legally approved + logged |
| Consent | purpose-wise ledger; stage gated on granted consent |
| Retention | per `RetentionPolicy` (category × outcome); legal-hold exempt from purge |
| Audit | append-only, tamper-evident (hash chain); retention per policy |

## Accessibility (NFR-13)
| Standard | Level |
|---|---|
| WCAG | **2.1 AA** for core flows |
| Keyboard | all interactive elements reachable |
| Reduced motion | `prefers-reduced-motion` respected |

## Browser/device support (NFR-01; §7.1)
| Category | Target |
|---|---|
| Desktop | current Chrome, Edge, Safari, Firefox |
| Mobile | current iOS Safari, Chrome Android; **mobile-first PWA** |
| Min viewport | 360px |
| Localisation | INR, IST, `dd-MM-yyyy`, pin/branch hierarchy; English + regional templates |

## Observability (NFR-14)
Structured JSON logs with `correlation_id`/`user_id`/`module`; metrics for API p95, error rate, queue depth, integration-failure rate, SLA breaches, outbox lag; `/health` + `/ready`.
