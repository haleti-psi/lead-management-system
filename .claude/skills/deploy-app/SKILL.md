---
name: deploy-app
description: "Full deployment pipeline for Google Cloud Run projects — readiness audit, Dockerfile checks, env var verification, local Docker build and sanity test, Cloud Build image push, Cloud Run deploy, and cloud verification. Reads project.config.yaml for all project-specific values. Use whenever deploying any service, or when the user says 'deploy', 'ship it', 'push to cloud', 'deploy apps/api', 'deploy myapp', 'run the deploy pipeline', or 'release to production'. Supports docker-only, cloud-only, dry-run, and single-phase execution. Run project-config-init first if project.config.yaml does not exist."
allowed-tools: Read Write Bash Glob
---

# Deploy App — Google Cloud Run Deployment Pipeline

End-to-end deployment: readiness audit → code cleanup → Docker build → local sanity test → Cloud Build → Cloud Run deploy → cloud verification.

Reads all project-specific values from **`project.config.yaml`** at the repo root. Run `/project-config-init` to generate this file if it does not exist.

## Reference Files

Load when you reach the relevant phase:
- `references/troubleshooting.md` — T1–T12 Cloud Run failure patterns (load in Phase 7 if sanity fails)

## Scoping

```
/deploy-app <target> [phase] [options]
```

**`<target>`** — one of:
- A service directory: `apps/api`, `apps/web`
- An app group name from `project.config.yaml` `app_groups` (e.g. `myapp` → expands to `apps/api` + `apps/web`)
- Omit to be asked

**`[phase]`** — run only one phase: `preflight`, `readiness`, `build-verify`, `commit`, `docker-build`, `docker-test`, `cloud-deploy`, `cloud-test`

**`[options]`**:
- `docker-only` — stop after local Docker sanity (skip Cloud Run)
- `cloud-only` — skip local Docker, deploy straight to Cloud Run
- `no-commit` — fix issues but do not commit
- `no-cleanup` — skip code cleanup (Phase 2.8)
- `dry-run` — readiness check only, no fixes, no deploy
- `force` — skip confirmation prompts for non-destructive fixes

## Operating Rules

- Evidence-first: cite exact files, line numbers, command output for every finding
- Confirm vs. infer: mark each finding as `Confirmed` (direct evidence) or `Inferred`
- Never claim a check passed unless you ran it
- Fix in-place as you find issues; verify each fix before continuing
- **Max 3 fix-rebuild cycles** per phase — if still failing, report blocker and stop
- Save report to `docs/reviews/deploy-readiness-{slug}-{YYYY-MM-DD}.md`

---

## Startup: Read project.config.yaml

Before anything else:

```bash
# Verify config exists
[ -f project.config.yaml ] || { echo "ERROR: project.config.yaml not found. Run /project-config-init first."; exit 1; }

# Parse and display resolved config for this target
python3 - << 'EOF'
import yaml, sys
cfg = yaml.safe_load(open('project.config.yaml'))
target = sys.argv[1] if len(sys.argv) > 1 else None

# Resolve app_group expansion
groups = cfg.get('app_groups', {})
if target in groups:
    services = groups[target]
    print(f"App group '{target}' → {services}")
else:
    services = [target] if target else [s['app_dir'] for s in cfg['services']]

# Resolve each service
for svc_dir in services:
    svc = next((s for s in cfg['services'] if s['app_dir'] == svc_dir), None)
    if not svc:
        print(f"ERROR: {svc_dir} not found in project.config.yaml services list")
        continue
    proj_key = svc.get('gcp_project', 'default')
    project = cfg['gcloud']['projects'].get(proj_key, proj_key)
    region = cfg['gcloud']['region'] if svc.get('region') == 'default' else svc.get('region', cfg['gcloud']['region'])
    registry = cfg['gcloud']['artifact_registry']['default']
    print(f"\nService: {svc_dir}")
    print(f"  Type:           {svc['type']}")
    print(f"  Dockerfile:     {svc['dockerfile']}")
    print(f"  Cloud Run:      {svc['cloud_run_service']} ({project} / {region})")
    print(f"  Port:           {svc['port']}")
    print(f"  Image:          {registry}/{svc['cloud_run_service']}:latest")
    print(f"  Custom domain:  {svc.get('custom_domain') or 'none'}")
    print(f"  nginx proxy:    {svc.get('nginx_proxy', False)}")
    print(f"  Secrets:        {list(svc.get('secrets', {}).keys())}")
    sql = svc.get('cloud_sql_instance')
    if sql:
        inst = next((i for i in cfg['gcloud']['cloud_sql']['instances'] if i['name'] == sql), None)
        print(f"  Cloud SQL:      {inst['connection_string'] if inst else sql}")
EOF
```

Store the resolved values for all subsequent phases. Reference them as `$SERVICE_*` variables throughout.

---

## Phase 0: Preflight

```bash
# Git state
git log --oneline -3
git status --short
git rev-parse HEAD

# Docker daemon availability
docker ps 2>&1 | head -2
DOCKER_AVAILABLE=$([[ $? -eq 0 ]] && echo "yes" || echo "no")

# gcloud auth
gcloud auth list 2>&1 | grep ACTIVE
gcloud config get-value project

# Auto-detect tech stack per service
for svc_dir in $TARGET_DIRS; do
  echo "=== $svc_dir ==="
  # Node.js
  [ -f "$svc_dir/package.json" ] && cat "$svc_dir/package.json" | python3 -c "
import json,sys; p=json.load(sys.stdin)
d={**p.get('dependencies',{}),**p.get('devDependencies',{})}
fw=[x for x in ['next','fastapi','express','vite','react','fastify'] if x in d]
print('Framework:', ', '.join(fw) or 'unknown')
print('Scripts:', list(p.get('scripts',{}).keys()))
"
  # Python
  [ -f "$svc_dir/requirements.txt" ] && echo "Python service" && head -5 "$svc_dir/requirements.txt"
  [ -f "$svc_dir/pyproject.toml" ]   && echo "Python (pyproject)" && grep "fastapi\|django\|flask" "$svc_dir/pyproject.toml" | head -3
done

# Monorepo structure
cat package.json 2>/dev/null | python3 -c "import json,sys; ws=json.load(sys.stdin).get('workspaces',[]); print('Workspaces:', ws)" 2>/dev/null
```

Output a preflight block:
```
Target services:     [list]
App type:            [API | UI | Worker | Full-stack per service]
Tech stack:          [Node/TS | Python | etc. per service]
GCP project:         [resolved from config]
Region:              [resolved]
Current revision:    [from gcloud or NEW]
Commit:              [hash]
Docker available:    [yes / no — if no, will use cloud-only path]
Build order:         [dependency chain if monorepo]
```

---

## Phase 1: Environment Variable Audit

```bash
# Discover all env var reads in the service
rg "process\.env\.\w+|os\.environ\[|os\.getenv\(|import\.meta\.env\.\w+" \
  --glob '*.{ts,tsx,js,jsx,py}' $SVC_DIR/src $SVC_DIR/app 2>/dev/null | \
  grep -oP "(process\.env\.|os\.environ\[|os\.getenv\(|import\.meta\.env\.)(\w+)" | \
  grep -oP "\w+$" | sort -u

# Cross-reference against config sources
cat $SVC_DIR/.env 2>/dev/null
cat $SVC_DIR/.env.example 2>/dev/null
cat .env.example 2>/dev/null

# Check Dockerfile ENV/ARG
rg "^ARG |^ENV " $DOCKERFILE 2>/dev/null

# Check what Cloud Run currently has (if service exists)
gcloud run services describe $CLOUD_RUN_SERVICE \
  --platform managed --region $REGION --project $GCP_PROJECT \
  --format 'yaml(spec.template.spec.containers[0].env)' 2>/dev/null
```

**Secrets from project.config.yaml**: Every key in the service's `secrets` map must exist in Secret Manager with a valid IAM binding for the compute service account.

```bash
SA_EMAIL=$(python3 -c "import yaml; c=yaml.safe_load(open('project.config.yaml')); print(c['gcloud']['compute_service_account']['email'])")

for secret_name in $SECRET_NAMES; do
  gcloud secrets describe $secret_name --project $GCP_PROJECT 2>&1 | grep -q "name:" \
    && echo "✓ Secret exists: $secret_name" \
    || echo "✗ SECRET MISSING: $secret_name — create with: echo -n 'value' | gcloud secrets create $secret_name --data-file=- --project $GCP_PROJECT"
  
  gcloud secrets get-iam-policy $secret_name --project $GCP_PROJECT 2>&1 | grep -q "$SA_EMAIL" \
    && echo "  ✓ IAM binding OK" \
    || echo "  ✗ IAM binding missing — run: gcloud secrets add-iam-policy-binding $secret_name --member=serviceAccount:$SA_EMAIL --role=roles/secretmanager.secretAccessor --project $GCP_PROJECT"
done
```

Produce env var inventory table:
| Variable | Required | Source | Status |
|----------|----------|--------|--------|
| DATABASE_URL | Yes | Secret Manager | ✓ / ✗ |

**Gate: All required env vars must be accounted for before proceeding.**

---

## Phase 2: Deployment Readiness Checks

Run all 14 checks. For each: `PASS`, `FAIL (severity)`, or `N/A`.

### 2.1 Dependency Completeness
```bash
npm ls --depth=0 2>&1 | grep -E "ERR|missing|invalid" | head -10
# Python:
pip check 2>&1 || true
```

### 2.2 Dockerfile Audit

Read `$DOCKERFILE` and verify:
- Base image pinned (not `:latest`)
- COPY order: manifests before source (layer caching)
- Dependency install uses lockfile (`npm ci`, `pip install -r`)
- `--no-deps` flag absent (causes silent missing dependencies)
- Multi-stage build (build tools excluded from production image)
- Non-root `USER` directive
- `EXPOSE` matches `$SERVICE_PORT` from config
- CMD/ENTRYPOINT path matches build output location

```bash
rg "^FROM|^USER|^EXPOSE|^COPY|^RUN|^CMD|^ENTRYPOINT|--no-deps" $DOCKERFILE
```

**Critical**: `--no-deps` in pip install silently skips transitive dependencies. Any `|| true` or `2>/dev/null` on install commands hides errors.

### 2.3 Asset Availability
```bash
rg "\.(png|jpg|svg|ico|woff|woff2|pdf)" --glob '*.{ts,tsx,js,css}' $SVC_DIR/src | head -10
cat .dockerignore 2>/dev/null
```
Verify referenced assets are not excluded by `.dockerignore`.

### 2.4 Version Compatibility
```bash
# Check for known-bad combinations
node --version 2>/dev/null; python3 --version 2>/dev/null
rg '"openai"' $SVC_DIR/package.json 2>/dev/null  # openai <1.66 missing Responses API
```

### 2.5 Path Mapping Verification
```bash
# Build output dir
rg "outDir|build\.outDir" --glob 'vite.config.*' --glob 'tsconfig*.json' $SVC_DIR/ | head -5
# Dockerfile COPY from build stage
rg "COPY --from=build" $DOCKERFILE
# Runtime static file server root
rg "express\.static|sirv|serve-static|root:" --glob '*.{ts,js}' $SVC_DIR/src | head -5
```

### 2.6 Relative Path Handling
```bash
rg "readFileSync|path\.join|process\.cwd\(\)|__dirname" --glob '*.{ts,js}' $SVC_DIR/src | head -10
```
Verify paths work in Docker context (WORKDIR may differ from dev CWD).

### 2.7 Duplicate / Conflicting Config
```bash
python3 -c "
import json
for f in ['$SVC_DIR/package.json', '$SVC_DIR/tsconfig.json']:
  try:
    import os; data = open(f).read() if os.path.exists(f) else ''
    if data: json.loads(data); print(f'✓ {f}')
  except json.JSONDecodeError as e: print(f'✗ {f}: {e}')
"
```

### 2.8 Code Cleanup (skip if `no-cleanup`)
```bash
# Remove console.log from server code
rg -n "console\.log\(" --glob '*.{ts,js}' $SVC_DIR/src | grep -v test | head -20

# TypeScript unused locals
npx tsc --noEmit --noUnusedLocals --noUnusedParameters --project $SVC_DIR/tsconfig.json 2>&1 | head -30
```
Remove unused imports, `console.log`, dead code. Verify build after each removal.

### 2.9 Vite / Build Tool Production Issues
```bash
# vite must be devDependency only
python3 -c "
import json; p=json.load(open('$SVC_DIR/package.json'))
for t in ['vite','vitest','eslint','prettier']:
  if t in p.get('dependencies',{}): print(f'P0: {t} in dependencies (must be devDependencies)')
"
```

### 2.10 Cloud Run PORT Compliance
```bash
rg "process\.env\.PORT|os\.environ.*PORT|os\.getenv.*PORT" --glob '*.{ts,js,py}' $SVC_DIR/src
rg "\.listen\(" --glob '*.{ts,js}' $SVC_DIR/src -A 2
```
App MUST read `PORT` env var and default to `$SERVICE_PORT`. MUST bind to `0.0.0.0`, not `localhost`.

### 2.11 Docker Include/Exclude Audit
```bash
cat .dockerignore 2>/dev/null
# Runtime data files (JSON, YAML, SQL) referenced at startup must NOT be excluded
rg "readFileSync.*\.(json|yaml|yml|sql)" --glob '*.{ts,js,py}' $SVC_DIR/src | head -10
```

### 2.12 CORS Configuration
```bash
rg "cors|ALLOWED_ORIGINS|allowedOrigins" --glob '*.{ts,js,py}' $SVC_DIR/src
```

For UI services: verify `VITE_API_BASE_URL` build arg is set correctly.

**nginx proxy services** (where `nginx_proxy: true` in config):
- `VITE_API_BASE_URL` must be `""` (empty string)
- `apiBaseUrl` in source must use `??` not `||` (empty string is falsy with `||`)
- nginx config must have `/api/` location block proxying to the API service URL

```bash
if [ "$NGINX_PROXY" = "true" ]; then
  rg "VITE_API_BASE_URL.*\|\|" --glob '*.{ts,tsx,js}' $SVC_DIR/src && echo "WARNING: Use ?? not || for VITE_API_BASE_URL"
  grep -A5 "location /api/" $NGINX_CONFIG 2>/dev/null || echo "WARNING: No /api/ proxy block in $NGINX_CONFIG"
fi
```

### 2.13 Container Health Check
```bash
rg "HEALTHCHECK" $DOCKERFILE
rg "/health|/healthz|/ready" --glob '*.{ts,js,py}' $SVC_DIR/src
```

### 2.14 Local Build Verification
```bash
# Build upstream monorepo packages first (auto-detected from package.json workspaces)
python3 - << 'EOF'
import json, subprocess, sys
try:
    pkg = json.load(open('package.json'))
    scripts = pkg.get('scripts', {})
    # Find build scripts for packages (heuristic: build:packagename patterns)
    build_scripts = [k for k in scripts if k.startswith('build:') and 'apps' not in scripts[k]]
    print("Build order (packages first):", build_scripts)
except: pass
EOF

# Build the target service
npm run build:$(basename $SVC_DIR) 2>&1 | tail -20
# or for Python:
python3 -m pytest --co -q 2>&1 | tail -5  # just collect, not run
```

**Gate: Build must succeed. Max 3 attempts.**

---

## Phase 3: Readiness Scorecard

| Check | Severity | Status | Evidence |
|-------|----------|--------|----------|
| 1. Env vars | P0 | | |
| 2. Dockerfile | P0 | | |
| 3. Assets | P1 | | |
| 4. Versions | P1 | | |
| 5. Path mapping | P0 | | |
| 6. Relative paths | P1 | | |
| 7. Duplicate config | P1 | | |
| 8. Code cleanup | P2 | | |
| 9. Build tools | P0 | | |
| 10. PORT compliance | P0 | | |
| 11. Docker include/exclude | P1 | | |
| 12. CORS | P1 | | |
| 13. Health check | P1 | | |
| 14. Local build | P0 | | |

**Gate: All P0 and P1 findings must be fixed before proceeding.**

---

## Phase 4: Commit (skip if `no-commit`)

```bash
git diff --stat HEAD
git commit -m "$(cat <<'EOF'
Deployment readiness fixes for $(basename $SVC_DIR)

- [summary of fixes]
- Fixes: N P0, M P1, X P2 findings

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Local Docker Build (skip if `cloud-only` or Docker unavailable)

```bash
# Pre-build cleanup
docker stop ${SVC_SLUG}-test 2>/dev/null; docker rm ${SVC_SLUG}-test 2>/dev/null

# Build
docker build -f $DOCKERFILE -t ${SVC_SLUG}:local-test --progress=plain . 2>&1

# If build fails: diagnose (dependency? path? Dockerfile?) and fix. Max 3 attempts.
```

---

## Phase 6: Local Docker Sanity Test (skip if `cloud-only`)

```bash
# Start container
docker run -d \
  --name ${SVC_SLUG}-test \
  -p ${LOCAL_TEST_PORT}:${SERVICE_PORT} \
  -e PORT=${SERVICE_PORT} \
  -e NODE_ENV=production \
  $(for k in "${!ENV_VARS[@]}"; do echo "-e $k=${ENV_VARS[$k]}"; done) \
  ${SVC_SLUG}:local-test

# Wait for startup
for i in $(seq 1 15); do
  sleep 1
  curl -sf http://localhost:${LOCAL_TEST_PORT}/health >/dev/null 2>&1 && echo "Container ready" && break
  [ $i -eq 15 ] && echo "FAIL: Container did not start in 15s" && docker logs ${SVC_SLUG}-test | tail -30
done
```

Sanity tests (adapt by service type):

```bash
# Health
curl -sf http://localhost:${LOCAL_TEST_PORT}/health && echo "Health: OK"

# Auth (API services) — use test credentials from project.config.yaml
LOGIN_FIELD=$(rg "loginSchema\|LoginBody" $SVC_DIR/src -l | head -1 | xargs rg "username\|login" | head -1 | grep -oP "username|login")
curl -s http://localhost:${LOCAL_TEST_PORT}/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"${LOGIN_FIELD:-username}\":\"${TEST_USER}\",\"password\":\"${TEST_PASSWORD}\"}" | head -c 200

# Root page (UI services)
curl -sf -o /dev/null -w "Root: HTTP %{http_code}\n" http://localhost:${LOCAL_TEST_PORT}/

# 404 handling (should not crash)
curl -sf -o /dev/null -w "404 test: HTTP %{http_code}\n" http://localhost:${LOCAL_TEST_PORT}/nonexistent-path-99999

# Cleanup
docker stop ${SVC_SLUG}-test; docker rm ${SVC_SLUG}-test
```

**Gate: All sanity tests must pass before Cloud Run deploy.**

---

## Phase 7: Cloud Build + Deploy (skip if `docker-only`)

### 7.1 Pre-Deploy State

```bash
gcloud auth list 2>&1 | grep ACTIVE
gcloud config get-value project

# Record current revision for rollback
CURRENT_REV=$(gcloud run services describe $CLOUD_RUN_SERVICE \
  --platform managed --region $REGION --project $GCP_PROJECT \
  --format 'value(status.latestReadyRevisionName)' 2>/dev/null)
echo "Rollback target: ${CURRENT_REV:-NEW (first deploy)}"
```

### 7.2 Build Image with Cloud Build

**Note:** `gcloud builds submit --tag` does NOT support `--dockerfile`. For non-standard Dockerfile names, use a cloudbuild config:

```bash
DOCKERFILE_NAME=$DOCKERFILE
IMAGE="${REGISTRY}/${CLOUD_RUN_SERVICE}:latest"
COMMIT_SHA=$(git rev-parse --short HEAD)
GCS_STAGING=$(python3 -c "import yaml; print(yaml.safe_load(open('project.config.yaml'))['gcloud']['cloud_build']['gcs_staging'])")

cat > /tmp/cloudbuild-${SVC_SLUG}.yaml << EOF
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-f', '${DOCKERFILE_NAME}', '-t', '\$_IMAGE', '.']
    # For UI services with VITE_API_BASE_URL build arg:
    # args: ['build', '-f', '${DOCKERFILE_NAME}', '--build-arg', 'VITE_API_BASE_URL=\$_API_URL', '-t', '\$_IMAGE', '.']
images: ['\$_IMAGE']
EOF

gcloud builds submit \
  --config /tmp/cloudbuild-${SVC_SLUG}.yaml \
  --substitutions="_IMAGE=${IMAGE},COMMIT_SHA=${COMMIT_SHA}" \
  --project $GCP_PROJECT \
  --region $REGION \
  --gcs-source-staging-dir="${GCS_STAGING}" \
  . 2>&1
```

**For UI services with nginx proxy** (`nginx_proxy: true`):
1. Get the API service URL first: `API_URL=$(gcloud run services describe $API_SERVICE --format 'value(status.url)')`
2. Add `--build-arg VITE_API_BASE_URL=""` (empty — nginx handles routing)
3. Verify nginx config has the correct `/api/` proxy target

### 7.3 Deploy to Cloud Run

```bash
# Build the --set-secrets flag from project.config.yaml
SECRETS_FLAG=$(python3 - << 'EOF'
import yaml
cfg = yaml.safe_load(open('project.config.yaml'))
svc = next(s for s in cfg['services'] if s['app_dir'] == '$SVC_DIR')
secrets = svc.get('secrets', {})
if secrets:
    pairs = ','.join(f"{k}={v}:latest" for k,v in secrets.items())
    print(f"--set-secrets {pairs}")
EOF
)

# Build the --set-env-vars flag
ENV_VARS_FLAG=$(python3 - << 'EOF'
import yaml
cfg = yaml.safe_load(open('project.config.yaml'))
svc = next(s for s in cfg['services'] if s['app_dir'] == '$SVC_DIR')
ev = svc.get('env_vars', {})
if ev:
    # Use ^##^ delimiter for values that may contain commas
    pairs = ','.join(f"{k}={v}" for k,v in ev.items())
    print(f"--set-env-vars '^##^{pairs}'")
EOF
)

# Resolve Cloud SQL annotation (for API services)
SQL_FLAG=""
if [ -n "$CLOUD_SQL_CONNECTION" ]; then
  SQL_FLAG="--add-cloudsql-instances $CLOUD_SQL_CONNECTION"
  # Also include legacy instance if needed:
  # SQL_FLAG="--add-cloudsql-instances ${CLOUD_SQL_CONNECTION},${LEGACY_INSTANCE}"
fi

gcloud run deploy $CLOUD_RUN_SERVICE \
  --image "$IMAGE" \
  --project $GCP_PROJECT \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --port $SERVICE_PORT \
  --memory $MEMORY \
  --cpu $CPU \
  --min-instances $MIN_INSTANCES \
  --max-instances $MAX_INSTANCES \
  $SQL_FLAG \
  $SECRETS_FLAG \
  $ENV_VARS_FLAG \
  --cpu-boost \
  --quiet 2>&1

SERVICE_URL=$(gcloud run services describe $CLOUD_RUN_SERVICE \
  --platform managed --region $REGION --project $GCP_PROJECT \
  --format 'value(status.url)' 2>&1)
echo "Deployed to: $SERVICE_URL"
```

**CORS**: If this is an API service, `ALLOWED_ORIGINS` must include the UI service URL. Check after deploy:
```bash
gcloud run services describe $CLOUD_RUN_SERVICE \
  --platform managed --region $REGION --project $GCP_PROJECT \
  --format 'yaml(spec.template.spec.containers[0].env)' | grep -i origin
```

### 7.4 Rollback

```bash
# If sanity fails — rollback to previous revision
if [ -n "$CURRENT_REV" ]; then
  gcloud run services update-traffic $CLOUD_RUN_SERVICE \
    --to-revisions ${CURRENT_REV}=100 \
    --platform managed --region $REGION --project $GCP_PROJECT
  echo "Rolled back to: $CURRENT_REV"
else
  echo "First deploy — no rollback target. Fix forward or: gcloud run services delete $CLOUD_RUN_SERVICE --platform managed --region $REGION --project $GCP_PROJECT"
fi
```

---

## Phase 8: Cloud Sanity Check

```bash
# Cold start
time curl -sf -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" $SERVICE_URL/

# Health
curl -sf $SERVICE_URL/health && echo "Health: OK"

# Auth (API services)
LOGIN_RESPONSE=$(curl -s $SERVICE_URL/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"${LOGIN_FIELD:-username}\":\"${TEST_USER}\",\"password\":\"${TEST_PASSWORD}\"}")
TOKEN=$(echo $LOGIN_RESPONSE | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
[ -n "$TOKEN" ] && echo "Auth: PASS" || echo "Auth: FAIL — $LOGIN_RESPONSE"

# TLS
curl -sI $SERVICE_URL/ | grep -i "strict-transport"

# CORS headers
curl -sI -X OPTIONS "$SERVICE_URL/api/v1/auth/login" \
  -H "Origin: $UI_URL" -H "Access-Control-Request-Method: POST" | grep -i "access-control"

# 404 handling
curl -sf -o /dev/null -w "404 test: HTTP %{http_code}\n" $SERVICE_URL/nonexistent-99999

# Cloud logs (errors)
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=${CLOUD_RUN_SERVICE} AND severity>=ERROR" \
  --limit 5 --format json --project $GCP_PROJECT 2>&1 | python3 -c "
import json,sys
try:
  logs=json.load(sys.stdin)
  if logs: [print(l.get('textPayload','')[:200]) for l in logs[:5]]
  else: print('No errors in cloud logs')
except: print('Could not parse logs')
" 2>/dev/null
```

If sanity fails: load `references/troubleshooting.md` and follow the T1–T12 diagnostic guide.

---

## Final Report

```
Deployment Report: [service] — [date]
══════════════════════════════════════════
Preflight:          COMPLETE
Readiness:          X/14 PASS, Y FIXED, Z DEFERRED
Local Docker:       PASS / FAIL / SKIPPED
Cloud Build:        PASS / FAIL
Cloud Deploy:       SUCCESS / FAILED / SKIPPED
Cloud Sanity:       X/8 PASS
Cloud Logs:         CLEAN / X ERRORS
Rollback Target:    [revision or N/A]
Service URL:        [url]
Verdict:            DEPLOYED / DOCKER-VERIFIED / BLOCKED
```

Save full report to `docs/reviews/deploy-readiness-{slug}-{YYYY-MM-DD}.md`.

---

## Quality Checklist

- [ ] project.config.yaml read successfully at startup
- [ ] All secrets verified in Secret Manager with correct IAM bindings
- [ ] All P0/P1 readiness findings fixed
- [ ] Cloud Build used (not `gcloud run deploy --source`)
- [ ] ALLOWED_ORIGINS includes all consumer origins
- [ ] For nginx proxy services: VITE_API_BASE_URL="" and `??` operator used
- [ ] DATABASE_SSL=false set for Cloud SQL API services
- [ ] Cloud SQL instances annotation present for API services
- [ ] Rollback revision recorded before deploy
- [ ] Report saved
