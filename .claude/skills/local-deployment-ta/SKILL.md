---
name: local-deployment-ta
description: "Local deployment verification for the ta-doc-parser FastAPI application. Verifies Python venv, installs dependencies, starts the uvicorn dev server, validates health and parse endpoints, and confirms the app is ready for manual testing. Use when the user says 'test ta-doc-parser locally', 'start the doc parser', 'verify the parser works', 'run local deployment for ta-doc-parser', or 'check ta-doc-parser is working'. Project-specific to ta-doc-parser at /Users/n15318/ta-doc-parser."
allowed-tools: Read Write Bash
---

# Local Deployment Verification — ta-doc-parser

End-to-end local dev environment validation for the TA Document Parser: verify Python venv, start FastAPI dev server, validate health/parse endpoints, report readiness.

## Purpose

Run this skill after developing a feature to verify the ta-doc-parser works end-to-end in the local dev environment before declaring it ready for manual testing.

## Scoping

No target app directory needed — this skill always targets `/Users/n15318/ta-doc-parser/ta_doc_parser`.

Optionally, the user can describe the feature being tested. If provided, Phase 6 will specifically validate that feature.

Options the user may append:
- `no-fix` — report findings only, do not fix issues
- `skip-rebuild` — skip venv/dependency install (use when you know packages are up to date)

## Operating Rules

- Evidence-first: cite exact files, line numbers, and command output for every finding.
- Fix issues in-place as you find them — do not defer fixes unless they depend on an earlier fix.
- After every fix, verify the fix works before moving on.
- **Max 3 fix-rebuild cycles** per phase. If still failing after 3 attempts, report the blocker and stop.
- Kill any stale processes on required ports before starting servers.
- Always verify end-to-end, not just startup — an app that starts but returns 500 on `/parse` is NOT working.

## Severity

- `P0` — App won't start or crashes immediately (BLOCKER — stop and fix before proceeding)
- `P1` — Feature broken at runtime (parse fails, health 500, endpoints 404/500)
- `P2` — Degraded behavior (slow response, missing fields in parse output)
- `P3` — Cosmetic or hardening issue

If a P0/P1 issue cannot be fixed in 3 cycles, escalate as BLOCKER in the readiness report and stop.

## Project Architecture

**ta-doc-parser** is a single-service FastAPI application:
- **Backend**: `app.py` — FastAPI served via `uvicorn app:app` on port **8000** (dev) or **8080** (Docker/Cloud Run)
- **Frontend**: Vanilla JS/HTML embedded in `app.py` (served at `/`)
- **Parsing Engine**: `ta_doc_parsing.py` — Google Document AI integration
- **Database**: None (stateless app)
- **Auth**: None enforced at API level (Google Cloud credentials for Document AI only)
- **Storage**: Optional GCS and Azure Blob push

### Key Files

| File | Purpose |
|------|---------|
| `app.py` | FastAPI app with embedded HTML/JS UI (~98 KB) |
| `ta_doc_parsing.py` | Document AI parsing logic (~43 KB) |
| `requirements.txt` | Python dependencies |
| `Dockerfile` | Cloud Run production image (Python 3.12-slim) |
| `.env.example` | Environment variables template |
| `credentials/` | Directory for GCP service account JSON key |

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | HTML UI |
| GET | `/health`, `/api/health` | Health check (returns config status) |
| POST | `/parse`, `/api/parse` | Parse uploaded PDF (multipart/form-data) |
| POST | `/push-combined-json`, `/api/push-combined-json` | Push JSON to GCS/Azure |

### Environment Variables

**Required for Document AI parsing:**
```
DOC_AI_PROJECT_ID=<gcp-project-id>
DOC_AI_LOCATION=eu
DOC_AI_PROCESSOR_ID=<document-ai-processor-id>
```

**Optional:**
```
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json  (not needed on Cloud Run with ADC)
DOC_AI_MIME_TYPE=application/pdf
DOC_AI_FIELD_MASK=text,entities,fund name, amount
MAX_PARSE_UPLOAD_BYTES=15728640
AZURE_STORAGE_CONNECTION_STRING=...
PORT=8080  (Docker/Cloud Run only)
```

### Env Loading

Uses `python-dotenv` via `load_dotenv()` in `ta_doc_parsing.py`. Reads from `.env` in the project root.

### Known Gotcha: GOOGLE_APPLICATION_CREDENTIALS in .zshrc

The user's `~/.zshrc` exports `GOOGLE_APPLICATION_CREDENTIALS` pointing to a non-existent service account key file. The app validates this path and will return 500 on `/health` if the file doesn't exist.

**Fix**: When starting the dev server, unset the env var so the app falls through to Application Default Credentials (ADC):

```bash
unset GOOGLE_APPLICATION_CREDENTIALS
uvicorn app:app --host 0.0.0.0 --port 8000 --reload &
```

**ADC setup**: Run `gcloud auth application-default login` with the `vinaykumarvk@gmail.com` account, then `gcloud auth application-default set-quota-project wealth-report`.

### GCP Project for Document AI

- **GCP Project**: `wealth-report` (account: `vinaykumarvk@gmail.com`)
- **Processor**: `70b690b94894b43` (CUSTOM_EXTRACTION_PROCESSOR, EU region)
- **ADC quota project**: `wealth-report`

---

## Phase 0: Preflight — Understand the Environment

### 0.1: Current State

```bash
cd /Users/n15318/ta-doc-parser/ta_doc_parser
git status --short
git log --oneline -3
```

Record branch, uncommitted changes, and recent commits for context.

### 0.2: Environment Configuration

```bash
# Check for .env file
ls -la .env .env.local .env.example 2>/dev/null

# Read active config
cat .env 2>/dev/null | grep -v "^#" | grep -v "^$"
```

Verify:
- `.env` file exists (copy from `.env.example` if not)
- `DOC_AI_PROJECT_ID`, `DOC_AI_LOCATION`, `DOC_AI_PROCESSOR_ID` are set
- `GOOGLE_APPLICATION_CREDENTIALS` points to a valid file (if set)

### 0.3: Credentials Check

```bash
# Check if credentials file exists (if GOOGLE_APPLICATION_CREDENTIALS is set)
CREDS=$(grep '^GOOGLE_APPLICATION_CREDENTIALS=' .env 2>/dev/null | cut -d= -f2-)
if [ -n "$CREDS" ]; then
  ls -la "$CREDS" 2>/dev/null && echo "Credentials file exists" || echo "WARN: Credentials file not found at $CREDS"
else
  echo "INFO: GOOGLE_APPLICATION_CREDENTIALS not set — will use ADC if available"
fi

# Check gcloud ADC
gcloud auth application-default print-access-token >/dev/null 2>&1 && echo "ADC: OK" || echo "ADC: Not configured"
```

---

## Phase 1: Python Environment Setup

### 1.1: Verify Python Version

```bash
python3 --version
# Must be Python 3.12+ (Dockerfile uses 3.12-slim)
```

### 1.2: Virtual Environment

```bash
cd /Users/n15318/ta-doc-parser/ta_doc_parser

# Create venv if it doesn't exist
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  echo "Created new virtual environment"
fi

# Activate and verify
source .venv/bin/activate
which python3
python3 --version
```

### 1.3: Install Dependencies

```bash
source .venv/bin/activate
pip install -r requirements.txt 2>&1 | tail -10
```

**Gate: All dependencies must install successfully. If pip fails, diagnose and fix.**

### 1.4: Verify Key Imports

```bash
source .venv/bin/activate
python3 -c "
import fastapi; print(f'fastapi {fastapi.__version__}')
import uvicorn; print(f'uvicorn OK')
from google.cloud import documentai; print('documentai OK')
from google.cloud import storage; print('gcs OK')
print('All imports OK')
" 2>&1
```

---

## Phase 2: Port Conflicts — Kill Stale Processes

```bash
# Kill anything on port 8000 (dev server)
PIDS=$(lsof -ti:8000 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "Killing stale processes on port 8000: $PIDS"
  echo "$PIDS" | xargs kill -9
fi

sleep 1
lsof -ti:8000 2>/dev/null && echo "8000 STILL IN USE" || echo "8000 FREE"
```

---

## Phase 3: Start Dev Server

### 3.1: Start FastAPI with Uvicorn

```bash
cd /Users/n15318/ta-doc-parser/ta_doc_parser
source .venv/bin/activate
uvicorn app:app --host 0.0.0.0 --port 8000 --reload &

# Wait for startup (up to 15 seconds)
for i in $(seq 1 15); do
  sleep 1
  if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    echo "FastAPI ready on port 8000"
    break
  fi
  if [ $i -eq 15 ]; then
    echo "API FAILED TO START — check logs above"
  fi
done
```

**Common startup failures:**

| Error | Root Cause | Fix |
|-------|-----------|-----|
| `EADDRINUSE` / `address already in use` | Port 8000 occupied | Kill stale process (Phase 2) |
| `ModuleNotFoundError` | Missing dependency | `pip install -r requirements.txt` |
| `ImportError` | Wrong Python / no venv | Activate venv, check Python version |
| App starts but `/health` returns error | Missing env vars | Check `.env` has DOC_AI_* vars |

---

## Phase 4: Health & Endpoint Verification

### 4.1: Health Check

```bash
curl -s http://localhost:8000/health | python3 -m json.tool
curl -s http://localhost:8000/api/health | python3 -m json.tool
```

Verify the response shows config status. Check for warnings about missing env vars.

### 4.2: UI Loads

```bash
# Verify the HTML UI is served
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/)
echo "GET / → $HTTP_CODE"
# Must be 200
```

### 4.3: Parse Endpoint (Smoke Test)

```bash
# Test parse endpoint with a small PDF if available
# This tests the multipart upload handling, not Document AI (which needs real credentials)
curl -s -X POST http://localhost:8000/api/parse \
  -F "file=@/dev/null;filename=test.pdf;type=application/pdf" \
  -w "\nHTTP %{http_code}\n" 2>&1 | tail -5
```

**Note:** A real parse requires valid Document AI credentials and a real PDF. The smoke test verifies the endpoint exists and accepts multipart uploads (expect a 400/422 for empty file or 500 for missing credentials — NOT a 404).

### 4.4: Push Endpoint (Smoke Test)

```bash
curl -s -X POST http://localhost:8000/api/push-combined-json \
  -H "Content-Type: application/json" \
  -d '{"provider":"gcs","target":"test","payload":{}}' \
  -w "\nHTTP %{http_code}\n" 2>&1 | tail -5
```

Expect 400/500 (no real storage configured) — NOT 404.

---

## Phase 5: Document AI Credentials Verification

### 5.1: Check Credentials Are Functional

```bash
source .venv/bin/activate
python3 -c "
import os
from dotenv import load_dotenv
load_dotenv()

project = os.getenv('DOC_AI_PROJECT_ID', '')
location = os.getenv('DOC_AI_LOCATION', '')
processor = os.getenv('DOC_AI_PROCESSOR_ID', '')

print(f'DOC_AI_PROJECT_ID:   {project or \"NOT SET\"}')
print(f'DOC_AI_LOCATION:     {location or \"NOT SET\"}')
print(f'DOC_AI_PROCESSOR_ID: {processor or \"NOT SET\"}')

creds = os.getenv('GOOGLE_APPLICATION_CREDENTIALS', '')
if creds:
    import os.path
    print(f'GOOGLE_APPLICATION_CREDENTIALS: {creds} (exists={os.path.isfile(creds)})')
else:
    print('GOOGLE_APPLICATION_CREDENTIALS: not set (using ADC)')

if not all([project, location, processor]):
    print('WARN: Document AI config incomplete — parsing will fail')
else:
    print('OK: Document AI config looks complete')
" 2>&1
```

If Document AI credentials are not configured, report as P1 (parsing won't work but app still starts and serves UI).

---

## Phase 6: Feature-Specific Verification

If the user specified a feature to test, validate it end-to-end.

### 6.1: Identify Feature Components

Based on the feature description, identify:
- New/modified API endpoints in `app.py`
- New/modified parsing logic in `ta_doc_parsing.py`
- New UI elements in the embedded HTML/JS
- New environment variables

### 6.2: Test Feature Endpoints

```bash
curl -s http://localhost:8000/<endpoint> -w "\nHTTP %{http_code}\n" | tail -10
```

### 6.3: Verify Feature in Source

```bash
# Check the feature exists in app.py routes
rg "def <feature_function>" app.py
rg "<route_path>" app.py
```

---

## Phase 7: Readiness Report

### 7.1: Summary

```text
LOCAL DEPLOYMENT VERIFICATION REPORT
=====================================

App:               ta-doc-parser
Feature:           <feature-description or "General">
Branch:            <git branch>
Commit:            <git commit hash>

CHECKS:
  Python venv:        [PASS | FAIL]
  Dependencies:       [PASS | FAIL — details]
  Environment vars:   [PASS | FAIL — details]
  Server startup:     [PASS | FAIL — details]
  Health endpoint:    [PASS | FAIL — details]
  UI served:          [PASS | FAIL — details]
  Parse endpoint:     [PASS | FAIL — details]
  Push endpoint:      [PASS | FAIL — details]
  Doc AI credentials: [PASS | WARN — details]

ISSUES FOUND & FIXED:  <count>
ISSUES REMAINING:      <count>

READY FOR TESTING:     [YES | NO — blockers listed]

ACCESS:
  App URL:        http://localhost:8000/
  Health:         http://localhost:8000/health
  API Parse:      POST http://localhost:8000/api/parse

NOTES:
  <Any caveats, limitations, or things to watch for during manual testing>
```

### 7.2: Cleanup Reminder

Remind the user:
- Dev server is running in the background with `--reload` (auto-reloads on code changes)
- How to stop it: `lsof -ti:8000 | xargs kill`
- Virtual environment: `source .venv/bin/activate` to re-enter

---

## Troubleshooting Quick Reference

| # | Issue | Root Cause | Fix |
|---|-------|-----------|-----|
| 1 | `address already in use :8000` | Previous server still running | `lsof -ti:8000 \| xargs kill -9` |
| 2 | `ModuleNotFoundError: fastapi` | Venv not activated or deps missing | `source .venv/bin/activate && pip install -r requirements.txt` |
| 3 | Parse returns 500 | Document AI credentials missing/invalid | Check `.env` has DOC_AI_* vars, check `GOOGLE_APPLICATION_CREDENTIALS` |
| 4 | Health returns incomplete config | Missing env vars | Copy `.env.example` to `.env` and fill in values |
| 5 | `/` returns 404 | Wrong working directory | `cd /Users/n15318/ta-doc-parser/ta_doc_parser` |
| 6 | `google.auth.exceptions` | GCP auth expired or missing | `gcloud auth application-default login` or set `GOOGLE_APPLICATION_CREDENTIALS` |
| 7 | Push endpoint fails | No storage config | Set `AZURE_STORAGE_CONNECTION_STRING` or configure GCS |
| 8 | Slow startup | Large dependencies installing | Use `skip-rebuild` option if deps are already installed |
| 9 | Python version mismatch | System Python too old | Use `python3.12` or install via `brew install python@3.12` |
| 10 | Import errors in parsing | google-cloud packages not installed | `pip install -r requirements.txt` |
| 11 | Health 500: "Credentials file not found" | `GOOGLE_APPLICATION_CREDENTIALS` in `~/.zshrc` points to missing file | `unset GOOGLE_APPLICATION_CREDENTIALS` before starting server |
| 12 | ADC quota error | ADC not set to wealth-report project | `gcloud auth application-default set-quota-project wealth-report` |
