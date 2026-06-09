---
name: project-config-init
description: "Scaffold a project.config.yaml file at the repo root by auto-detecting the project structure and asking targeted questions. Use this skill whenever setting up a new project to use the deploy-app or local-deployment skills, or when the user says 'initialise the project config', 'set up deployment config', 'create project.config.yaml', 'configure deployment for this project', or 'prepare this project for the deploy skills'. Run this once per project — the generated file is committed to the repo and used by all deployment skills."
allowed-tools: Read Write Bash Glob
---

# Project Config Init

Scaffold `project.config.yaml` at the repo root by auto-detecting everything possible, then asking targeted questions for what cannot be inferred.

## Process

### Step 1: Auto-Detect Project Structure

```bash
# Project type
ls apps/ packages/ services/ 2>/dev/null && echo "monorepo" || echo "single-service"

# Deployable services (directories with a Dockerfile)
find . -name "Dockerfile*" -not -path "*/node_modules/*" -not -path "*/.git/*" | sort

# Frameworks per service
for dir in $(find . -name "package.json" -maxdepth 3 -not -path "*/node_modules/*" | xargs -I{} dirname {}); do
  echo "$dir: $(cat $dir/package.json | python3 -c "import json,sys; p=json.load(sys.stdin); d={**p.get('dependencies',{}),**p.get('devDependencies',{})}; fw=[x for x in ['next','fastapi','express','vite','react'] if x in d]; print(','.join(fw) or 'unknown')" 2>/dev/null)"
done

# Python services
find . -name "pyproject.toml" -o -name "requirements.txt" -maxdepth 3 | grep -v node_modules

# Existing gcloud config
gcloud config get-value project 2>/dev/null
gcloud config get-value run/region 2>/dev/null

# Existing .env files for hints
find . -name ".env.example" -o -name ".env.sample" -maxdepth 3 | head -5

# Existing Cloud SQL proxy usage
rg "cloud-sql-proxy\|cloud_sql_proxy\|CLOUD_SQL" . --glob "*.{sh,md,yml,yaml,json}" -l 2>/dev/null | head -5

# Secret Manager usage
rg "secretmanager\|set-secrets\|SECRET" . --glob "*.{sh,yml,yaml}" -l 2>/dev/null | head -5

# nginx configs
find . -name "nginx*.conf" -not -path "*/node_modules/*" | head -5

# Existing deploy scripts for hints
find . -name "deploy*.sh" -o -name "cloudbuild*.yaml" -maxdepth 3 | head -10
```

### Step 2: Build What You Know

From the auto-detection, fill in every field you can determine with confidence:
- Project type (monorepo / single-service)
- Service list with app_dir and type (api/ui) from Dockerfile naming patterns
- Framework per service from package.json
- GCP project ID from `gcloud config`
- Region from `gcloud config`
- nginx proxy services (those with nginx*.conf files)
- Local ports from existing `.env.example` or vite.config files

```bash
# Detect local ports from vite configs
rg "port:" --glob "vite.config.*" -n | head -10

# Detect API port from source
rg "listen\(|PORT" --glob "*.{ts,js,py}" --glob "!*.test.*" -n | head -10

# Detect Cloud SQL instance from existing scripts/configs
rg "asia-southeast1|cloud-sql\|policing-db\|cloudsql" . --glob "*.{sh,yaml,yml,json,md}" -n | head -20

# Detect secret names from existing deploy scripts
rg "set-secrets\|--set-secrets" . --glob "*.{sh,yaml}" -n | head -20

# Detect compute service account number
gcloud projects describe $(gcloud config get-value project 2>/dev/null) --format="value(projectNumber)" 2>/dev/null
```

### Step 3: Ask Only What Cannot Be Inferred

Present what was detected and ask only the gaps. Keep it to one focused block:

```
I've detected the following for [project-name]:

Services found:
  ✓ apps/api     → API (Express/FastAPI/etc.), Dockerfile: [name]
  ✓ apps/web     → UI (Vite+React), Dockerfile: [name]
  ✓ GCP project: [detected or unknown]
  ✓ Region:      [detected or unknown]

I need a few values I couldn't detect automatically:

1. Cloud SQL instance connection string (format: project:region:instance-name)
   [or "none" if not using Cloud SQL]

2. Artifact Registry base path (format: region-docker.pkg.dev/project/repo-name)
   [or "gcr.io/project" for Container Registry]

3. For each service, the Secret Manager secret names for DATABASE_URL and JWT_SECRET:
   apps/api DATABASE_URL secret name: [e.g. myapp-database-url]
   apps/api JWT_SECRET secret name: [e.g. myapp-jwt-secret]

4. Local proxy port for Cloud SQL (default: 15432, or 15435 if that's your convention)

5. Test credentials from seed data:
   Admin username and password: [e.g. admin / password]
```

Ask in one message — not one question at a time.

### Step 4: Generate project.config.yaml

Using the detected values + user answers, write a complete, populated `project.config.yaml`. Do not use placeholders — every field should have a real value or be explicitly set to `null`.

```bash
# After writing, verify it's valid YAML
python3 -c "import yaml; yaml.safe_load(open('project.config.yaml')); print('✓ Valid YAML')"
```

### Step 5: Report

Tell the user:
- What was auto-detected vs. what was provided manually
- What to verify before first use (especially Secret Manager secret names and Cloud SQL connection string)
- That this file should be committed to the repo: `git add project.config.yaml && git commit -m "chore: add deployment config"`
- That sensitive values (passwords, keys) must NOT go in this file — they belong in Secret Manager

## Output

`project.config.yaml` at the repo root.

## Notes

- `project.config.yaml` is safe to commit — it contains service names and structure, not secrets
- Secrets live in Secret Manager; `project.config.yaml` only stores the *names* of those secrets
- Run this once per project; update the file manually when adding new services
