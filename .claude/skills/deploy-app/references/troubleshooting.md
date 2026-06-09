# Deployment Troubleshooting Guide
*Cloud Run + Cloud SQL + Vite + nginx — common failure patterns*

Load this file when Phase 8 (Cloud Sanity) fails.

---

## Quick Diagnostic — Start Here

Check Cloud Run logs first. They tell you which T-code applies:

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=SERVICE AND severity>=WARNING" \
  --limit 20 --format json --project PROJECT | \
  python3 -c "import json,sys; [print(l.get('textPayload',l.get('jsonPayload',{}).get('message',''))[:300]) for l in sorted(json.load(sys.stdin), key=lambda x: x.get('timestamp',''))]"
```

Match the log output to the T-code below.

---

## T1: UI Cannot Reach API

**Symptoms:** Frontend loads but all API calls fail. Browser console shows network errors, CORS errors, or "Failed to fetch".

**Decision tree:**
```
1. Open DevTools → Network → reload the dashboard
   ├─ API calls return 401? → session cookie not sent → T1c (credentials) or T7 (third-party cookie)
   ├─ API calls return CORS error? → T1b (CORS)
   ├─ API calls go to wrong URL (localhost, old domain)? → T1a (URL baked wrong)
   ├─ No API calls at all? → T1d (API URL empty with wrong operator) → T8
   └─ API calls return data but UI shows empty? → JS error → check Console tab
```

**T1a: Wrong API URL baked at build time**
```bash
# Inspect what URL is in the built JS
curl -s $UI_URL/ | grep -oP 'https://[^"]+' | sort -u
# Should show your API URL, not localhost
```
Fix: Rebuild UI with correct `--build-arg VITE_API_BASE_URL=<url>`. For nginx proxy apps, use `""` (empty).

**T1b: CORS blocking API responses**
```bash
curl -sI -X OPTIONS "$API_URL/api/v1/auth/login" \
  -H "Origin: $UI_URL" -H "Access-Control-Request-Method: POST" | grep -i access-control
```
Fix: Add UI URL to `ALLOWED_ORIGINS` env var on the API service. Redeploy API.

**T1c: Session cookie not sent**
All `fetch` calls to the API must include `credentials: "include"` (or the axios equivalent). Verify in source:
```bash
rg "credentials.*include|withCredentials" $SVC_DIR/src --glob '*.{ts,tsx}'
```

**T1d: API URL defaults to localhost despite VITE_API_BASE_URL=""`**
See T8 — this is the `||` vs `??` operator bug.

---

## T2: Login Returns 400 or "Invalid Credentials"

**Possible causes:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `"body must have required property 'username'"` | Wrong field name in request | Check auth schema for the correct field name: `rg "loginSchema\|LoginBody" src/` |
| `{"error":"INVALID_CREDENTIALS"}` | Wrong password | Check seed data for the actual password |
| 404 on login endpoint | Route not registered | Check app entry point registers auth routes |
| Token missing from response | Wrong response field | Check if token is in `data.token`, `token`, or a cookie `Set-Cookie` header |

```bash
# Find the correct field name
rg "username\|login\|email" src/ --glob '*.ts' | grep -i "schema\|body\|interface" | head -5

# Test with correct field
curl -sv $SERVICE_URL/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}' 2>&1 | grep -E "< HTTP|Set-Cookie|token"
```

---

## T3: Login Succeeds But Data Is Empty

**Decision tree:**
```
After login, all list/dashboard endpoints return empty:
1. curl $API_URL/api/v1/[resource] -H "Authorization: Bearer $TOKEN" — does it return data?
   YES → data exists in API but UI doesn't show it → JS rendering bug
   NO → 401? → cookie not sent from browser → T7 (cross-origin cookie)
       → 403? → wrong role → check seed data role assignment
       → 200 + empty? → database not seeded
```

```bash
# Verify data exists in DB via Cloud SQL proxy
cloud-sql-proxy "$CLOUD_SQL_CONNECTION" --port $LOCAL_PROXY_PORT --gcloud-auth &
sleep 3
psql "postgresql://$DB_USER:$DB_PASS@127.0.0.1:$LOCAL_PROXY_PORT/$DB_NAME" \
  -c "SELECT COUNT(*) FROM [main_table]"
# Expected: > 0. If 0, run seed scripts.
kill %1
```

---

## T4: Container Crash — Cloud SQL SSL Error

**Log signature:** `"The server does not support SSL connections"` or `"ECONNREFUSED /cloudsql/..."`

**Cause A: `DATABASE_SSL` not set**
Cloud SQL Unix sockets do not use SSL, but many DB clients default to requiring it.
Fix: Add `DATABASE_SSL=false` to service `env_vars` in `project.config.yaml`, redeploy.

**Cause B: Cloud SQL instances annotation missing**
The Unix socket path (`/cloudsql/project:region:instance`) only exists if the annotation is present.
Fix: Verify `cloud_sql_instance` is set in `project.config.yaml` for this service. The deploy script will include `--add-cloudsql-instances`.

```bash
# Verify annotation on deployed service
gcloud run services describe $CLOUD_RUN_SERVICE \
  --platform managed --region $REGION --project $PROJECT \
  --format 'yaml(spec.template.spec.containers[0].env)' | grep -i "DATABASE_SSL\|DATABASE_URL"

gcloud run services describe $CLOUD_RUN_SERVICE \
  --platform managed --region $REGION --project $PROJECT \
  --format 'yaml(spec.template.metadata.annotations)' | grep cloudsql
```

---

## T5: Deploy Fails — "Permission Denied on Secret"

**Log:** `PERMISSION_DENIED: Permission 'secretmanager.versions.access' denied`

**Cause:** Secret doesn't exist OR compute service account lacks IAM binding.

```bash
# Check if secret exists
gcloud secrets describe $SECRET_NAME --project $PROJECT 2>&1

# Create if missing
echo -n "value" | gcloud secrets create $SECRET_NAME --data-file=- --project $PROJECT

# Check IAM binding
gcloud secrets get-iam-policy $SECRET_NAME --project $PROJECT | grep $SA_EMAIL

# Grant if missing
gcloud secrets add-iam-policy-binding $SECRET_NAME \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/secretmanager.secretAccessor" \
  --project $PROJECT
```

The compute service account email is in `project.config.yaml` → `gcloud.compute_service_account.email`.

---

## T6: Container Crash — Missing ALLOWED_ORIGINS

**Log:** `FATAL: ALLOWED_ORIGINS must be set in production`

API services crash on startup if `ALLOWED_ORIGINS` is unset and the app validates it.

Fix: Add to `env_vars` in `project.config.yaml`:
```yaml
env_vars:
  ALLOWED_ORIGINS: "https://your-ui-service-url.run.app"
```
For multiple origins: `"https://url1,https://url2"` — the deploy script uses the `^##^` delimiter escape automatically.

---

## T7: Cross-Origin Cookie Blocking (Third-Party Cookie Problem)

**Symptoms:** Login works (response body has user data) but all subsequent API calls return 401. Happens in Chrome Incognito or browsers with strict cookie settings.

**Root cause:** Frontend is on domain A, API on domain B. The auth cookie is set for domain B. Modern browsers block this as a third-party cookie.

**The fix — nginx reverse proxy:**
Apps with a custom domain or cross-origin cookie issues need nginx to proxy `/api/` requests, making them same-origin.

1. Ensure `nginx_proxy: true` in `project.config.yaml` for this UI service
2. Verify the nginx config has the `/api/` location block:
```nginx
location /api/ {
    proxy_pass https://your-api-service.run.app;
    proxy_set_header Host your-api-service.run.app;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_ssl_server_name on;
}
```
3. Rebuild the UI with `VITE_API_BASE_URL=""` (empty string)
4. Verify `apiBaseUrl` uses `??` not `||` (see T8)

**Verify the proxy is working:**
```bash
curl -s "https://your-custom-domain.com/api/v1/health" | head -c 100
# Should return the API's health response, not a 404
```

---

## T8: API URL Defaults to localhost Despite Empty Build Arg

**Symptom:** UI deployed with `VITE_API_BASE_URL=""` but browser DevTools shows calls going to `http://localhost:3001`.

**Root cause:** JavaScript `||` treats empty string as falsy:
```typescript
// BUG — empty string "" is falsy, falls back to localhost
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

// FIX — nullish coalescing only falls back on null/undefined
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
```

```bash
# Find all instances
rg "VITE_API_BASE_URL.*\|\|" --glob '*.{ts,tsx,js}' src/
# Any matches: change || to ??
```

---

## T9: Docker Build Fails — Missing Workspace Package

**Symptom:** `npm ERR! missing: @scope/package` or `Cannot find module '@scope/package'`

**Cause:** A new workspace package was added to the app's `package.json` but not added to all three Dockerfile stages (deps, build, production).

```bash
# Compare app's workspace deps vs Dockerfile COPY commands
rg '"@scope/' $SVC_DIR/package.json | grep -oP '@scope/[\w-]+'
rg "COPY packages/" $DOCKERFILE
# Any package in the first set missing from the second = bug
```

Fix: Add the missing package to all three stages in the Dockerfile:
- Stage 1 (deps): `COPY packages/new-pkg/package.json`
- Stage 2 (build): `COPY packages/new-pkg/src/`
- Stage 3 (production): `COPY --from=build packages/new-pkg/dist/`

---

## T10: Cloud Build $COMMIT_SHA Empty

**Symptom:** Image tag ends with `:` — no SHA. Caused by empty `$COMMIT_SHA` substitution.

**Root cause:** `$COMMIT_SHA` is auto-populated only for trigger-based builds, not manual `gcloud builds submit`.

Fix: Always pass `--substitutions=COMMIT_SHA=$(git rev-parse --short HEAD)` in the deploy script. The deploy-app skill does this automatically.

---

## T11: Cloud Build Service Account Lacks Cloud Run Permission

**Symptom:** Cloud Build steps 0–1 (build + push) succeed but step 2 (deploy) fails with `PERMISSION_DENIED: Permission 'run.services.get' denied`.

**Workaround:** Use Cloud Build for the image push only, then deploy directly:
```bash
# Let Cloud Build complete (it will fail at the deploy step — that's OK, image is pushed)
# Then deploy directly with your own auth:
gcloud run deploy $SERVICE \
  --image "$REGISTRY/$SERVICE:latest" \
  --region $REGION --project $PROJECT ...
```

**Permanent fix:**
```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/run.admin"
```

---

## T12: Wrong GCP Project Context

**Symptom:** `gcloud run services list` shows services from a different project, or deploy creates the service in the wrong project.

```bash
# Always verify before deploying
gcloud config get-value project
# Should match what's in project.config.yaml for this service

# Correct it if wrong
gcloud config set project CORRECT_PROJECT_ID
```

The deploy script reads `gcp_project` from `project.config.yaml` and passes `--project` explicitly to every `gcloud` command, so misconfigured `gcloud config` should not affect the deploy. But verify output shows the correct project.

---

## Quick Reference Checklist Before Marking Deployment Complete

```
□ UI→API connectivity: frontend calls the correct API URL; CORS allows UI origin
□ Authentication: correct login field + password; token returned
□ Data visible: at least one list endpoint returns > 0 items
□ Cloud SQL SSL: DATABASE_SSL=false set; Cloud SQL instances annotation present
□ Secrets: all Secret Manager references exist with IAM bindings
□ ALLOWED_ORIGINS: set to include UI service URL
□ nginx proxy (if applicable): /api/ location block proxies to API; SameSite=Strict on cookie
□ VITE_API_BASE_URL: uses ?? operator if empty string; correct URL if direct
□ Cloud logs: no ERROR entries in first 5 minutes after deploy
```
