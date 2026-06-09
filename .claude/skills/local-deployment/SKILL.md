---
name: local-deployment
description: "Post-feature local deployment verification — auto-detects framework, starts dev servers, validates auth and database connectivity, tests new routes and feature endpoints, and confirms the app is ready for manual testing. Reads project.config.yaml for database credentials and test accounts. Use after developing a feature to verify it works end-to-end before declaring it ready for manual testing or cloud deployment. Trigger when the user says 'test this locally', 'verify the feature works', 'start the dev environment', 'run local deployment', 'check it works end to end', 'is it ready for testing', or 'spin up the local stack'. Run project-config-init first if project.config.yaml does not exist."
allowed-tools: Read Write Bash Glob
---

# Local Deployment Verification

End-to-end local dev environment validation: auto-detect framework → verify database → kill port conflicts → start servers → validate auth and routing → test the feature → report readiness.

Reads `project.config.yaml` for database config, proxy port, and test credentials. Auto-detects everything else from `package.json`, `pyproject.toml`, and `Dockerfile`.

## Scoping

```
/local-deployment <app-dir> [feature-description] [options]
```

- **`<app-dir>`** — required. E.g. `apps/web`, `apps/api`, `apps/admin`
- **`[feature-description]`** — optional. If provided, Phase 7 validates that specific feature
- **Options**: `no-fix` (report only), `api-only`, `ui-only`, `skip-rebuild`

If no target: ask which app.

## Operating Rules

- Evidence-first: cite files, line numbers, command output
- Fix issues in-place; verify each fix before continuing
- **Max 3 fix-rebuild cycles** per phase — if still failing, report blocker and stop
- Kill stale processes on required ports before starting servers
- Always verify end-to-end — an app that starts but returns 401/500 is NOT working

## Severity

- `P0` — App won't start or crashes immediately (BLOCKER)
- `P1` — Feature broken at runtime (auth fails, DB error, 404/500)
- `P2` — Degraded behavior (missing data, UI glitch)
- `P3` — Cosmetic or hardening issue

---

## Startup: Read Config and Auto-Detect

```bash
# Read project.config.yaml
python3 - << 'EOF'
import yaml, sys, os

cfg = yaml.safe_load(open('project.config.yaml')) if os.path.exists('project.config.yaml') else {}
local = cfg.get('local', {})
svc_dir = sys.argv[1] if len(sys.argv) > 1 else None

print("=== Config ===")
print(f"DB proxy port:   {local.get('db_proxy_port', '15432')}")
print(f"API port (cfg):  {local.get('api_port', 'auto-detect')}")
print(f"FE ports (cfg):  {local.get('frontend_ports', {})}")
creds = local.get('test_credentials', [])
if creds: print(f"Test user:       {creds[0].get('username')} / {creds[0].get('password')}")
EOF

# Auto-detect framework and ports
echo "=== Auto-detection ==="

# Framework
if [ -f "$APP_DIR/package.json" ]; then
  python3 -c "
import json
p = json.load(open('$APP_DIR/package.json'))
d = {**p.get('dependencies',{}), **p.get('devDependencies',{})}
fw = [x for x in ['next','express','fastify','vite','react'] if x in d]
scripts = p.get('scripts', {})
print(f'Framework: {fw}')
print(f'Dev script: {next((f\"npm run {k}\" for k in [\"dev\",\"start:dev\",\"develop\"] if k in scripts), \"unknown\")}')
"
elif [ -f "$APP_DIR/pyproject.toml" ] || [ -f "$APP_DIR/requirements.txt" ]; then
  echo "Framework: Python"
  grep "fastapi\|django\|flask\|uvicorn" $APP_DIR/requirements.txt $APP_DIR/pyproject.toml 2>/dev/null | head -3
fi

# Port from vite config
rg "port:" --glob "vite.config.*" $APP_DIR/ -n 2>/dev/null | head -3

# Port from source
rg "\.listen\(\|PORT" --glob "*.{ts,js,py}" $APP_DIR/src $APP_DIR/app $APP_DIR/ 2>/dev/null | grep -v test | head -5

# Port from Dockerfile EXPOSE
grep "EXPOSE" Dockerfile* 2>/dev/null | head -3

# Monorepo workspace packages this app depends on
python3 -c "
import json, os
f = '$APP_DIR/package.json'
if os.path.exists(f):
  p = json.load(open(f))
  ws_deps = [k for k in {**p.get('dependencies',{}), **p.get('devDependencies',{})} if k.startswith('@')]
  if ws_deps: print('Workspace deps:', ws_deps)
" 2>/dev/null

# Env file
for envfile in $APP_DIR/.env.local $APP_DIR/.env .env.local .env; do
  [ -f "$envfile" ] && echo "Env file found: $envfile" && break
done
```

Store resolved values. Output a config block:
```
App:         apps/[name]
Framework:   [Express/FastAPI/Vite/Next.js]
Dev command: [npm run dev / uvicorn app:app ...]
API port:    [auto-detected or from config]
FE port:     [auto-detected or from config]
DB proxy:    [port from config or 15432]
Test user:   [from config or ask]
```

---

## Phase 0: Preflight

```bash
git status --short
git log --oneline -3
```

Capture branch, uncommitted changes, and recent commits for context.

---

## Phase 1: Build Verification (skip if `skip-rebuild`)

```bash
# Build workspace packages first (monorepo)
python3 - << 'EOF'
import json, subprocess
try:
  pkg = json.load(open('package.json'))
  scripts = pkg.get('scripts', {})
  pkg_builds = [f"npm run {k}" for k in scripts if k.startswith('build:') and 'apps' not in scripts.get(k,'')]
  print("Package build commands:", pkg_builds)
except: pass
EOF

# Build the target app
npm run build 2>&1 | tail -20
# or: python3 -m py_compile $APP_DIR/app/*.py && echo "Syntax OK"
```

**Gate: Build must succeed.**

---

## Phase 2: Database Connectivity

### 2.1 Resolve Database Config

```bash
python3 - << 'EOF'
import yaml, os
cfg = yaml.safe_load(open('project.config.yaml')) if os.path.exists('project.config.yaml') else {}
local = cfg.get('local', {})
proxy_port = local.get('db_proxy_port', 15432)
env_file = local.get('db_url_env_file', '.env.local')
print(f"Expected DB proxy port: {proxy_port}")
print(f"Env file for DB URL:    {env_file}")

# Check the DATABASE_URL in env file
if os.path.exists(env_file):
    for line in open(env_file):
        if line.startswith('DATABASE_URL'):
            url = line.split('=',1)[1].strip()
            import re
            port_match = re.search(r':(\d+)/', url)
            if port_match:
                actual_port = port_match.group(1)
                if actual_port != str(proxy_port):
                    print(f"WARNING: DATABASE_URL uses port {actual_port}, expected {proxy_port}")
                else:
                    print(f"DATABASE_URL port: ✓ {actual_port}")
            break
EOF
```

### 2.2 Verify Database Proxy (if using Cloud SQL)

```bash
DB_PROXY_PORT=$(python3 -c "import yaml; cfg=yaml.safe_load(open('project.config.yaml')); print(cfg.get('local',{}).get('db_proxy_port',15432))" 2>/dev/null || echo "15432")

if pgrep -f "cloud-sql-proxy\|cloud_sql_proxy" >/dev/null 2>&1; then
  echo "✓ cloud-sql-proxy is running"
  lsof -ti:$DB_PROXY_PORT >/dev/null 2>&1 && echo "✓ Port $DB_PROXY_PORT is listening" || echo "✗ Port $DB_PROXY_PORT not listening"
else
  echo "✗ cloud-sql-proxy is NOT running"
  echo ""
  echo "Get the connection string from project.config.yaml → gcloud.cloud_sql.instances[].connection_string"
  echo "Then start it:"
  echo "  cloud-sql-proxy \"<connection_string>\" --port $DB_PROXY_PORT --gcloud-auth &"
fi
```

If cloud-sql-proxy is not running: report as **P0 BLOCKER** and stop. Provide the start command. The user must start it manually.

### 2.3 Test Database Connection

```bash
DB_URL=$(grep '^DATABASE_URL=' ${ENV_FILE} 2>/dev/null | head -1 | cut -d= -f2-)
if [ -n "$DB_URL" ]; then
  psql "$DB_URL" -c "SELECT 1 AS connected" 2>&1 | grep -q "connected" && echo "✓ DB connection OK" || echo "✗ DB connection failed"
fi
```

### 2.4 Schema Check

```bash
if [ -n "$DB_URL" ]; then
  psql "$DB_URL" -c "\dt" 2>&1 | head -20
  TABLE_COUNT=$(psql "$DB_URL" -c "\dt" 2>&1 | grep -c "public")
  echo "Tables found: $TABLE_COUNT"
  [ "$TABLE_COUNT" -lt 3 ] && echo "WARNING: Very few tables — schema may need to be applied"
fi
```

If schema is missing, run migrations:
```bash
# Node: npm run db:push / npx drizzle-kit push / npx prisma migrate dev
# Python: alembic upgrade head
```

**Gate: Database must be connectable and have required tables.**

---

## Phase 3: Kill Port Conflicts

```bash
# Kill anything on the API and frontend ports
for port in $API_PORT $FE_PORT; do
  PIDS=$(lsof -ti:$port 2>/dev/null)
  if [ -n "$PIDS" ]; then
    echo "Killing stale processes on port $port: $PIDS"
    echo "$PIDS" | xargs kill -9
  fi
done
sleep 2
lsof -ti:$API_PORT 2>/dev/null && echo "WARNING: Port $API_PORT still in use" || echo "✓ Port $API_PORT free"
lsof -ti:$FE_PORT 2>/dev/null  && echo "WARNING: Port $FE_PORT still in use"  || echo "✓ Port $FE_PORT free"
```

---

## Phase 4: Start Dev Servers

### 4.1 Start the API / Backend (skip if `ui-only`)

```bash
# Detect and run the appropriate dev command
if [ -f "$APP_DIR/package.json" ]; then
  # Node.js — find the dev script
  DEV_CMD=$(python3 -c "
import json
p = json.load(open('$APP_DIR/package.json'))
scripts = p.get('scripts', {})
cmd = next((scripts[k] for k in ['dev','start:dev','develop','start'] if k in scripts), None)
print(cmd or 'npm run dev')
")
  cd $(git rev-parse --show-toplevel) && $DEV_CMD &
elif [ -f "$APP_DIR/app.py" ] || [ -f "$APP_DIR/main.py" ]; then
  # FastAPI / Python
  source $APP_DIR/.venv/bin/activate 2>/dev/null || true
  unset GOOGLE_APPLICATION_CREDENTIALS  # prevent stale credentials from ~/.zshrc
  ENTRY=$([ -f "$APP_DIR/app.py" ] && echo "app:app" || echo "main:app")
  cd $APP_DIR && uvicorn $ENTRY --host 0.0.0.0 --port $API_PORT --reload &
fi

# Wait for startup (up to 20 seconds)
for i in $(seq 1 20); do
  sleep 1
  curl -sf http://localhost:$API_PORT/health >/dev/null 2>&1 && echo "✓ API ready on port $API_PORT" && break
  [ $i -eq 20 ] && echo "✗ API failed to start in 20s" && echo "Last 20 lines of output:" && jobs -l
done
```

**Common startup failures:**

| Error | Cause | Fix |
|-------|-------|-----|
| `EADDRINUSE` | Port in use | Phase 3 already killed it — check if another process restarted |
| `ECONNREFUSED` on DB | Proxy not running | Start cloud-sql-proxy (Phase 2) |
| `relation "X" does not exist` | Schema not applied | Run migrations (Phase 2.4) |
| `Missing required env var` | .env.local incomplete | Add the missing var |
| `ModuleNotFoundError` | Python venv not activated or deps missing | `pip install -r requirements.txt` |
| Python: `Credentials file not found` | Stale `GOOGLE_APPLICATION_CREDENTIALS` in shell | `unset GOOGLE_APPLICATION_CREDENTIALS` then restart |

### 4.2 Verify API Running (if `ui-only`)

```bash
curl -sf http://localhost:$API_PORT/health >/dev/null 2>&1 || {
  echo "BLOCKER: API not running on port $API_PORT"
  echo "Start the backend first, then re-run with ui-only"
  exit 1
}
```

### 4.3 Start Frontend Dev Server (skip if `api-only`)

```bash
# Find and run the frontend dev command
FE_DEV_CMD=$(python3 - << 'EOF'
import json, os, yaml

app_dir = '$APP_DIR'
cfg = yaml.safe_load(open('project.config.yaml')) if os.path.exists('project.config.yaml') else {}
fe_ports = cfg.get('local', {}).get('frontend_ports', {})
port = fe_ports.get(app_dir, '')

try:
  p = json.load(open(f'{app_dir}/package.json'))
  scripts = p.get('scripts', {})
  # Find the dev script for this specific app (monorepo pattern: dev:appname)
  app_name = app_dir.split('/')[-1]
  cmd = next((f"npm run {k}" for k in [f"dev:{app_name}", "dev", "start"] if k in scripts), "npm run dev")
  print(f"{cmd}" + (f" -- --port {port}" if port and "vite" in str(scripts.get('dev','')) else ""))
except:
  print(f"cd {app_dir} && npx vite" + (f" --port {port}" if port else ""))
EOF
)

cd $(git rev-parse --show-toplevel) && $FE_DEV_CMD &
sleep 5
# Vite may auto-increment port if the configured port is in use — detect actual port
ACTUAL_FE_PORT=$(lsof -i -P -n 2>/dev/null | grep LISTEN | grep -E "node|vite" | grep -oP ":\d+" | grep -oP "\d+" | tail -1)
echo "Frontend running on port: ${ACTUAL_FE_PORT:-$FE_PORT}"
```

---

## Phase 5: Authentication Verification

```bash
# Resolve test credentials from project.config.yaml
python3 - << 'EOF'
import yaml, os
cfg = yaml.safe_load(open('project.config.yaml')) if os.path.exists('project.config.yaml') else {}
creds = cfg.get('local', {}).get('test_credentials', [])
if creds:
    c = creds[0]
    print(f"TEST_USER={c.get('username','admin')}")
    print(f"TEST_PASS={c.get('password','password')}")
    print(f"TEST_ROLE={c.get('role','admin')}")
else:
    print("TEST_USER=admin")
    print("TEST_PASS=password")
    print("TEST_ROLE=admin")
EOF

# Auto-detect login field name from source
LOGIN_FIELD=$(rg "loginSchema\|LoginBody\|loginBody" $APP_DIR/src/ --glob '*.{ts,py}' 2>/dev/null | \
  head -5 | rg "username|login|email" | grep -oP "username|login|email" | head -1)
LOGIN_FIELD=${LOGIN_FIELD:-username}
echo "Login field: $LOGIN_FIELD"

# Test login
LOGIN_RESPONSE=$(curl -sv -c /tmp/local-test-cookies.txt http://localhost:$API_PORT/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"${LOGIN_FIELD}\":\"${TEST_USER}\",\"password\":\"${TEST_PASS}\"}" 2>&1)

# Extract token (handles both JWT body and cookie-based auth)
TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "
import json, sys, re
body = re.search(r'\{.*\}', sys.stdin.read(), re.DOTALL)
if body:
  try:
    data = json.loads(body.group())
    token = data.get('token', data.get('access_token', data.get('data', {}).get('token', '')))
    print(token)
  except: pass
" 2>/dev/null)

if [ -n "$TOKEN" ]; then
  echo "✓ Auth: PASS (JWT token obtained)"
else
  # Check for cookie-based auth
  grep -q "Set-Cookie\|session" <<< "$LOGIN_RESPONSE" && echo "✓ Auth: PASS (cookie-based)" || echo "✗ Auth: FAIL"
fi
```

---

## Phase 6: Route and Integration Verification

```bash
# Health
curl -sf http://localhost:$API_PORT/health && echo "✓ Health: OK"

# Authenticated endpoint
if [ -n "$TOKEN" ]; then
  curl -s http://localhost:$API_PORT/api/v1/auth/me \
    -H "Authorization: Bearer $TOKEN" | python3 -c "
import json,sys
try:
  d=json.load(sys.stdin)
  print('✓ Authenticated as:', d.get('username', d.get('email', d.get('id', 'unknown'))))
except: print('✗ /auth/me returned non-JSON')
" 2>/dev/null
fi

# Frontend-to-API integration (if not api-only)
if [ "$MODE" != "api-only" ]; then
  rg "proxy.*target\|proxy.*localhost" --glob "vite.config.*" $APP_DIR/ -A3 | head -10
  rg "credentials.*include\|withCredentials" --glob "*.{ts,tsx}" $APP_DIR/src | head -5
fi

# Check for runtime errors in API console output
# (handled by the background process output in terminal)
```

---

## Phase 7: Feature-Specific Verification

Only runs if a feature description was provided.

### 7.1 Identify Feature Components

Based on the feature description, find:

```bash
# New or modified routes
git diff --name-only HEAD~3 -- '*.ts' '*.py' | grep -E "route|controller|api"

# New or modified components
git diff --name-only HEAD~3 -- '*.tsx' '*.jsx'

# New or modified migrations
git diff --name-only HEAD~3 -- '*.sql' | head -10
```

### 7.2 Apply Pending Migrations (if any)

```bash
# Check for unapplied migrations
find . -name "*.sql" -newer docs/data-model/schema.sql 2>/dev/null | grep -i migrat | head -5

DB_URL=$(grep '^DATABASE_URL=' ${ENV_FILE} | head -1 | cut -d= -f2-)
# Apply if needed: psql "$DB_URL" -f migrations/NNNN_description.sql
```

### 7.3 Test Feature Endpoints

```bash
AUTH_HEADER="Authorization: Bearer $TOKEN"

# Test each new endpoint from the feature's LLD
# (adapt to the specific feature being tested)
for endpoint in $FEATURE_ENDPOINTS; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "$AUTH_HEADER" http://localhost:$API_PORT$endpoint)
  echo "GET $endpoint → HTTP $HTTP_CODE"
done
```

### 7.4 Verify Frontend Renders Feature

```bash
FE_URL="http://localhost:${ACTUAL_FE_PORT:-$FE_PORT}"

# Feature page loads
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $FE_URL$FEATURE_ROUTE 2>/dev/null)
SIZE=$(curl -s $FE_URL$FEATURE_ROUTE 2>/dev/null | wc -c)
echo "GET $FEATURE_ROUTE → HTTP $HTTP_CODE, ${SIZE}B"
[ "$HTTP_CODE" -eq 200 ] && [ "$SIZE" -gt 1000 ] && echo "✓ Page renders content" || echo "⚠ Page may be empty"
```

---

## Phase 8: Readiness Report

```
LOCAL DEPLOYMENT VERIFICATION REPORT
═════════════════════════════════════════════════════
App:               $APP_DIR
Feature:           ${FEATURE_DESCRIPTION:-General verification}
Branch:            $(git rev-parse --abbrev-ref HEAD)
Commit:            $(git rev-parse --short HEAD)
Framework:         $DETECTED_FRAMEWORK

CHECKS:
  Build:              [PASS | FAIL — details]
  DB proxy:           [PASS | FAIL — details]
  DB connection:      [PASS | FAIL — details]
  Schema applied:     [PASS | FAIL — details]
  API startup:        [PASS | FAIL — details]
  Frontend startup:   [PASS | FAIL | N/A]
  Authentication:     [PASS | FAIL — details]
  Feature endpoints:  [PASS | FAIL | N/A]

ISSUES FOUND & FIXED:  N
ISSUES REMAINING:      N

READY FOR TESTING:     [YES | NO — blockers listed]

ACCESS:
  API:           http://localhost:$API_PORT/
  Frontend:      http://localhost:${ACTUAL_FE_PORT:-$FE_PORT}/
  Credentials:   $TEST_USER / $TEST_PASS ($TEST_ROLE)
  Feature:       [path to the feature in the UI, if applicable]

STOP SERVERS WHEN DONE:
  lsof -ti:$API_PORT | xargs kill
  lsof -ti:${ACTUAL_FE_PORT:-$FE_PORT} | xargs kill
```

---

## Quality Checklist

- [ ] project.config.yaml read at startup (or gracefully defaulted)
- [ ] Framework auto-detected correctly
- [ ] DB proxy running and connection verified (not just assumed)
- [ ] Login field name auto-detected (not hardcoded)
- [ ] Auth test uses actual test credentials from config
- [ ] Feature endpoints verified with actual HTTP responses
- [ ] Report includes access credentials and stop-server instructions
