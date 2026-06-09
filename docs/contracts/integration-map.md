# Integration Map
*Every external service (BRD §8.7). All calls go through the `IntegrationGateway` (FR-140: idempotency, retry via Cloud Tasks, circuit breaker, `IntegrationLog`) behind a hexagonal **port**. No module calls a provider SDK directly. Vendors are open (OD-08/OD-17) — ports/env are fixed; adapters swap.*

Common failure handling (all ports): provider error/timeout → `UPSTREAM_UNAVAILABLE` (503) + `IntegrationLog(status=failed/retrying)` + Cloud Tasks retry (exp backoff, max 3) → circuit-breaker open on repeated failure → operational queue. Idempotency-Key dedupes; replays return the original result.

## LOS — eligibility / hand-off / status  (MVP-Must)
- **Port:** `LosPort` → `LosHttpAdapter` (prod) / `LosMockAdapter` (`LOS_MOCK=true`, dev/test). **Build now against the mock; swap real adapter last (ADR-4).**
- **Transport:** REST/JSON; outbound auth `LOS_API_KEY`; inbound status webhook (`POST /los/webhooks/status`) HMAC-verified with `LOS_WEBHOOK_HMAC_SECRET`.
- **Env:** `LOS_BASE_URL`, `LOS_API_KEY`, `LOS_WEBHOOK_HMAC_SECRET`, `LOS_MOCK`.
- **LMS stores:** `eligibility_snapshots`, `los_application_mirrors`, `data_sharing_logs`, `integration_logs` (idempotency_key on hand-off).

| Failure | Detection | Response |
|---|---|---|
| Eligibility timeout | >Ns no response | snapshot `status=pending` + retry; never block lead workflow |
| Hand-off 5xx/timeout | HTTP/timeout | `UPSTREAM_UNAVAILABLE` + Handoff-Failed queue; idempotent retry (no duplicate LOS app) |
| Mapping missing | pre-call validation | `VALIDATION_ERROR` (config) — block with clear message |
| Webhook bad signature | HMAC mismatch | `FORBIDDEN`; ignore + log |
| Missed webhook | reconciliation | scheduled poll backfills status |

**Test double:** `LosMockAdapter` (versioned `los-mock.openapi.yaml`) in dev/test; contract tests assert idempotency, guard failures, out-of-order/duplicate webhooks.

## KYC providers — PAN / CKYC / DigiLocker / Aadhaar / V-CIP  (PAN MVP-Must; rest MVP-Should/Phase 1.5)
- **Port:** `KycPort` (+ per-type adapters: `PanAdapter`, `CkycAdapter`, `DigiLockerAdapter`, `AadhaarAdapter`, `VcipAdapter`).
- **Env:** `PAN_PROVIDER_URL/KEY`, `CKYC_URL/KEY`, `DIGILOCKER_*`, `AADHAAR_*` (vendor TBD, OD-08).
- **LMS stores:** `kyc_verifications` (masked_response only; **no raw Aadhaar/biometrics**), `integration_logs`, `data_sharing_logs`.

| Failure | Detection | Response |
|---|---|---|
| Provider down | 5xx/timeout | exception(`provider_down`) + manual fallback if compliance-enabled; `UPSTREAM_UNAVAILABLE` |
| Mismatch | provider result | `kyc_verifications.exception_type` (pan/name/address mismatch) → exception queue (FR-072) |
| CKYC unavailable | provider | exception(`ckyc_unavailable`); manual capture |

**Test double:** mock KYC adapters returning success/mismatch/timeout fixtures; never call a real KYC provider in unit/integration tests.

## Communication — SMS / WhatsApp / Email  (MVP-Must)
- **Port:** `NotificationChannelPort` (+ `SmsAdapter`, `WhatsappAdapter`, `EmailAdapter`).
- **India gating (OD-17):** SMS requires `TRAI_DLT_ENTITY_ID` + registered sender header + pre-approved content template; WhatsApp requires `WHATSAPP_WABA_ID` (BSP) + per-template Meta approval. **Messages must use pre-approved templates, not free-form text.**
- **Env:** `SMS_PROVIDER_URL/KEY/SENDER_ID`, `WHATSAPP_BSP_URL/KEY/WABA_ID`, `EMAIL_PROVIDER_URL/KEY/FROM`, `TRAI_DLT_ENTITY_ID`.
- **Gates:** dispatch checks `NotificationPreference` + `consent_basis` before send; transactional ≠ marketing. **LMS stores:** `communication_logs` (delivery status, template version, masked recipient).

| Failure | Detection | Response |
|---|---|---|
| Send failure | provider 4xx/5xx | retry/failover per policy; `communication_logs.status=failed` + reason |
| Missing consent/opt-out | pre-send check | block; `CONSENT_MISSING` (transactional reminder may warn) |
| Unapproved template | provider reject | log; no free-form fallback |

**Test double:** `MockChannelAdapter` capturing sends; assert consent/opt-out gating and template usage.

## Telephony / CTI  (Phase 1.5)
- **Port:** `TelephonyPort`. Env `CTI_*`. Click-to-call + disposition sync; recording only where legally/contractually permitted. Failure → manual disposition. Test: mock CTI.

## Account Aggregator / GST / VAHAN-RTO  (Phase 1.5)
- **Ports:** `AaPort`, `GstPort`, `AssetVerificationPort`. Env `AA_*`, `GST_*`, `VAHAN_*`. Consent-bound (AA consent artefact ref); store summaries/refs only. Failure → `UPSTREAM_UNAVAILABLE` + queue. Test: sandbox/mock.

## Bureau (via LOS)  (Phase 1.5/2)
- Routed LMS→LOS→bureau; LMS stores only the LOS-returned summary flag (no raw bureau report). Governed by compliance approval.

## Campaign / marketing source  (MVP-Should, inbound)
- Inbound UTM/campaign metadata on lead intake (`source_attributions.utm`). No outbound call; validate + attribute.

## Test-double summary
| Env | Strategy |
|---|---|
| Development | mock adapters (`*_MOCK=true`); LOS via `LosMockAdapter` |
| Test (unit/integration) | Jest mocks of each port; **never** real providers |
| Staging | provider sandboxes where available; otherwise mock servers at `TEST_<SERVICE>_URL` |
| Production | real adapters; vendors per OD-08/OD-17 |
