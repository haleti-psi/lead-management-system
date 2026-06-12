# AMBIGUITY — FR-010 (Omnichannel Lead Capture)

## 1. Bulk-import XLSX parsing has no register-approved library

**The gap (precise):** `docs/lld/FR-010.md` requires `POST /leads/import` to accept
and process **CSV and XLSX** files ("Parse CSV/XLSX row by row"; error case 415
only for files that are *neither*). `docs/contracts/dependency-register.md`
contains **no XLSX/spreadsheet parsing library** (and no CSV library either), and
the hard rule is "only dependency-register libraries". CSV is hand-parseable
within the standard library (implemented — `csv.util.ts`, RFC-4180 subset), but
XLSX is a ZIP-of-XML container that cannot reasonably be parsed without a
library (e.g. `exceljs`).

**What was built (no silent failure):**
- Upload boundary accepts both CSV and XLSX per the api-contract (content-sniffed:
  ZIP magic → xlsx, clean UTF-8 text → csv, anything else → 415 `UNSUPPORTED_MEDIA`).
- CSV imports are fully processed end-to-end (per-row validation, per-row
  UnitOfWork commits, error CSV `(row_number, column, code, message)`, job counters).
- An XLSX job is marked `status='failed'` with an explanatory `error_file_ref`
  row ("XLSX parsing is not yet available …") — loud, durable, auditable; never a
  silent drop. See `apps/api/src/modules/capture/import-processor.job.ts`.

**Needed decision (Dev 1 / contracts owner):** add an XLSX parser (suggest
`exceljs`, security-reviewed) to `dependency-register.md`, then implement the
XLSX branch of `ImportProcessorService` — or amend FR-010/api-contract to CSV-only
for MVP.

---

*Note (not an ambiguity, resolved in-code):* the LLD's "Dispatch ImportProcessorJob
via Cloud Tasks" needs an HTTP worker endpoint that is not in `api-contract.yaml`.
Until that endpoint is contracted, dispatch is behind `ImportDispatchPort` with an
in-process post-commit adapter (`ports/import-dispatch.port.ts` documents the swap).
Captcha (former open item C3) is resolved per AMBIGUITIES.md: `CaptchaService` +
port + mock adapter in `core/integration`; the real vendor adapter (OD-08) will
consume `CAPTCHA_SECRET` from the environment contract.
