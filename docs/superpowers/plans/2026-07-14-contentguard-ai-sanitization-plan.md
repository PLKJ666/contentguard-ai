# ContentGuard AI Portfolio Sanitization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Publish a sanitized personal-portfolio version of the project as `PLKJ666/contentguard-ai` while preserving the existing content-compliance and XHS workflows.

**Architecture:** Apply a metadata and infrastructure identity layer over the existing monolithic FastAPI + Next.js application. Replace original organization identifiers, private endpoints, and committed credential values with neutral portfolio values; keep API paths, database tables, migration history, task stages, and asynchronous processing behavior intact.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, PostgreSQL, Redis, Celery, Next.js, React, TypeScript, Logto, TOS, Nginx, Docker Compose, Drone/GitLab CI.

---

## Task 1: Establish the public identity map and baseline

**Files:**
- Read: `docs/superpowers/specs/2026-07-14-contentguard-ai-sanitization-design.md`
- Read: `.env.example`, `backend/.env.example`, `.drone.yml`, `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.local-prod.yml`
- Read: `backend/app/config.py`, `frontend/app/layout.tsx`, `frontend/lib/api.ts`, `frontend/lib/signIn.ts`

- [ ] **Step 1: Record the approved identity map before edits**

Use these exact public values:

```text
Product: ContentGuard AI
Chinese product: 内容卫士 AI 审核平台
Repository: https://github.com/PLKJ666/contentguard-ai
Python package metadata: contentguard-backend
Frontend package metadata: contentguard-frontend
Runtime prefix: contentguard
Database default: contentguard
Support address: support@example.com
Generic API host: https://api.example.com
Generic auth host: https://auth.example.com
Generic AI host: https://ai.example.com/v1
Generic registry host: registry.example.com
```

- [ ] **Step 2: Capture the current verification baseline**

Run:

```powershell
Set-Location <repo-root>\backend
python -m compileall -q app tests
Set-Location ..\frontend
npx tsc --noEmit
```

Expected: both commands exit with code `0`. The prior full-suite results are recorded in `ECC_AUDIT_REPORT.md`; later verification must distinguish identity-only failures from pre-existing behavior failures.

## Task 2: Replace application and package identity

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/pyproject.toml`
- Modify: `backend/app/celery_app.py`
- Modify: `backend/Dockerfile`
- Modify: `backend/scripts/entrypoint.sh`
- Modify: `backend/scripts/backup.sh`
- Modify: `frontend/package.json`
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/components/ThemeProvider.tsx`
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/lib/signIn.ts`
- Modify: `frontend/app/api/upload-proxy-form/route.ts`
- Modify: `frontend/app/changelog/page.tsx`
- Modify: `frontend/app/creator/help/page.tsx`
- Modify: `frontend/app/agency/help/page.tsx`
- Modify: `frontend/app/brand/ai-config/page.tsx`
- Test: matching frontend identity assertions and backend configuration tests

- [ ] **Step 1: Update non-functional application metadata**

Change only display and metadata values:

```python
# backend/app/config.py
APP_NAME: str = "ContentGuard AI"
DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/contentguard"
TOS_BUCKET_NAME: str = "contentguard-files"
SMTP_FROM_NAME: str = "ContentGuard AI"
```

Set `OPERATOR_ACCESS_CODE` to an empty default so a production deployment must explicitly configure it. Do not change the onboarding comparison or role behavior.

- [ ] **Step 2: Update package and worker metadata**

Change package descriptions and the Celery application name to `contentguard-backend` / `ContentGuard AI` without changing task names, queues, import paths, or route names. Keep `app` as the Python import package because changing it would require a broad migration.

- [ ] **Step 3: Update frontend identity and storage prefixes**

Use `contentguard_` for the active theme, tenant, legacy-token cleanup, and forced-sign-in localStorage keys. Update page metadata, upload message source, changelog product copy, help contact copy, and the AI configuration example URL to `https://ai.example.com/v1`.

- [ ] **Step 4: Update identity-dependent tests**

Replace expected display strings and storage keys in tests. Do not remove tests or loosen assertions. Keep test-only email addresses under `example.com`.

- [ ] **Step 5: Run focused checks**

Run:

```powershell
Set-Location <repo-root>\frontend
npx vitest run lib/api.test.ts lib/logtoBaseUrl.test.ts lib/taskDisplay.test.ts
npx tsc --noEmit
```

Expected: identity tests and TypeScript checking pass, or any failure is a concrete pre-existing behavior issue documented before continuing.

## Task 3: Remove private infrastructure and credential exposure

**Files:**
- Modify: `.drone.yml`
- Modify: `.gitlab-ci.yml`
- Modify: `.env.example`
- Modify: `backend/.env.example`
- Modify: `frontend/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.prod.yml`
- Modify: `docker-compose.local-prod.yml`
- Modify: `backend/Dockerfile`
- Modify: `scripts/deploy-remote.sh`
- Modify: `scripts/deploy-remote.sh` references in deployment docs
- Modify: `nginx/conf.d/default.conf` comments when they expose private topology

- [ ] **Step 1: Remove committed CI credential values**

In `.drone.yml`, replace literal Logto values with Drone secret references or empty required variables. The build must receive values only from CI secret injection; no `LOGTO_APP_SECRET`, `LOGTO_COOKIE_SECRET`, access code, private URL, or production App ID may be assigned as a literal.

Use generic secret names already supported by the pipeline:

```yaml
environment:
  NEXT_PUBLIC_BASE_URL:
    from_secret: public_base_url
  LOGTO_ENDPOINT:
    from_secret: logto_endpoint
  LOGTO_APP_ID:
    from_secret: logto_app_id
  LOGTO_APP_SECRET:
    from_secret: logto_app_secret
  LOGTO_COOKIE_SECRET:
    from_secret: logto_cookie_secret
  LOGTO_API_RESOURCE:
    from_secret: logto_api_resource
```

Keep the existing Docker build flow, but use `registry.example.com/library/` as the documented default and make deployment steps clearly optional for a portfolio checkout.

- [ ] **Step 2: Sanitize environment templates**

Use `contentguard` for database names and remove the known operator code. Use empty or explicit placeholder values for secrets, for example `replace-with-a-local-secret` only where the file is clearly an example. Add comments that real Logto, database, Redis, TOS, AI, and SMTP values must be supplied outside version control.

- [ ] **Step 3: Remove private hostnames and paths from Compose, Docker, and deploy scripts**

Replace internal registry names, internal deployment directories, private service names, and original container prefixes with generic values. Do not remove health checks, service dependencies, worker commands, or volume behavior.

- [ ] **Step 4: Sanitize backup naming**

Use `contentguard` in backup directories, container defaults, file names, and log examples. Keep backup retention and optional TOS upload behavior unchanged.

- [ ] **Step 5: Run a secret and endpoint scan**

Run:

```powershell
Set-Location <repo-root>
rg -n -i --glob '!frontend/node_modules/**' --glob '!backend/uv.lock' --glob '!frontend/package-lock.json' '(LOGTO_(APP_SECRET|COOKIE_SECRET)\s*=\s*[^$\s#]+|OPERATOR_ACCESS_CODE\s*=\s*[^$\s#]+|https?://[^\s]+\.(internal|private)(/|$))' .
```

Expected: no original internal identifiers or literal secret assignments. Generic variable names such as `LOGTO_APP_SECRET` may remain; only values must be injected externally.

## Task 4: Rewrite public portfolio documentation

**Files:**
- Create: `README.md`
- Modify: `CLAUDE.md`
- Modify: `CONVENTIONS.md`
- Modify: `PRD.md`
- Modify: `RequirementsDoc.md`
- Modify: `FeatureSummary.md`
- Modify: `DevelopmentPlan.md`
- Modify: `User_Role_Interfaces.md`
- Modify: `AIProviderConfig.md`
- Modify: `DocumentContradictions.md`
- Modify: `docs/deployment-guide.md`
- Modify: `docs/cicd_integration.md`
- Modify: `docs/UserManual.md`
- Modify: XHS feature documents under `docs/feature-batch-xhs-*`

- [ ] **Step 1: Add a portfolio README**

The README must include these sections:

```markdown
# ContentGuard AI
## Overview
## Core Workflow
## Role Model
## AI Review Pipeline
## XHS Batch Rewriting
## Architecture
## Local Development
## Configuration and Secrets
## Current Scope and Limitations
## License / Portfolio Note
```

Describe the current monolithic FastAPI + Next.js architecture accurately. State that the repository is a portfolio adaptation and that production credentials and private deployment settings are intentionally excluded.

- [ ] **Step 2: Replace original identity in documentation**

Use the approved public name and repository URL. Replace internal repository instructions with GitHub instructions for `PLKJ666/contentguard-ai`. Remove company-specific deployment paths, private registry instructions, internal support contacts, and private operational procedures.

- [ ] **Step 3: Correct stale public claims while editing**

Where documentation currently describes planned microservices, WebSocket infrastructure, vector search, or old OSS/JWT behavior, label it as planned or update it to match the current implementation. Keep product requirements intact, but do not present plans as shipped features.

- [ ] **Step 4: Check visual assets and public links**

Review `docs/images` and `pencil-new.pen` references. Keep only assets that do not reveal original organization names, private URLs, real accounts, or production data. Remove internal links from documentation rather than modifying business UI screenshots unless an asset is necessary for the public README.

## Task 5: Update fixtures and clean public examples

**Files:**
- Modify: `backend/tests/test_xhs_api.py`
- Modify: `frontend/lib/taskDisplay.test.ts`
- Modify: `frontend/lib/logtoBaseUrl.test.ts`
- Modify: `frontend/app/brand/ai-config/page.test.tsx`
- Modify: any test or fixture found by the identity scan
- Modify: `ai-config-demo.html`
- Modify: `frontend/data/changelog.json` only for public identity and private-link cleanup

- [ ] **Step 1: Replace identity fixtures**

Use generic names such as `ContentGuard`, `contentguard.example`, and `portfolio@example.com`. For operator onboarding tests, set `settings.OPERATOR_ACCESS_CODE` explicitly to a test-only value through the fixture or monkeypatch; do not restore a default secret in application configuration.

- [ ] **Step 2: Sanitize the AI configuration demo**

Replace the private AI gateway URL with `https://ai.example.com/v1`, keep the API key masked/example-only, and label the page as a portfolio configuration example.

- [ ] **Step 3: Verify no business logic changed**

Review the diff for changes outside identity, documentation, configuration defaults, secret injection, and examples. Revert any accidental edits to task transitions, API payloads, SQL models, migration files, or AI prompt logic.

## Task 6: Full verification and portfolio readiness review

**Files:**
- Review: all modified files
- Review: `docs/superpowers/specs/2026-07-14-contentguard-ai-sanitization-design.md`

- [ ] **Step 1: Run repository identity scan**

Run:

```powershell
Set-Location <repo-root>
rg -n -i --glob '!frontend/node_modules/**' --glob '!backend/uv.lock' --glob '!frontend/package-lock.json' '(https?://[^\s]+\.(internal|private)(/|$)|\b(?:10|192\.168|172\.(?:1[6-9]|2[0-9]|3[0-1]))\.[0-9.]+\b)' .
```

Expected: zero public-facing matches, with any retained historical migration identifiers explicitly reviewed.

- [ ] **Step 2: Run backend checks**

```powershell
Set-Location <repo-root>\backend
python -m compileall -q app tests
uv lock --check
uv run --extra dev pytest tests/test_auth_logto_api.py tests/test_tasks_api.py tests/test_upload_api.py tests/test_xhs_api.py tests/test_ai_config_api.py -q --tb=short
```

Expected: compilation and lock checks pass; targeted behavior tests either pass or retain the previously documented environment-sensitive failures without new identity-related failures.

- [ ] **Step 3: Run frontend checks**

```powershell
Set-Location <repo-root>\frontend
npm run lint
npx tsc --noEmit
npm test -- --run
npm run build
```

Expected: lint, typecheck, and build pass. The existing full Vitest failures must be reported separately from sanitization regressions.

- [ ] **Step 4: Validate Compose and Docker examples**

Run `docker compose -f docker-compose.yml config --quiet` and inspect the rendered configuration for `contentguard-*`, generic hosts, and no committed secret values. A clean checkout may still require local env files; report that prerequisite rather than adding fake production credentials.

- [ ] **Step 5: Final review**

Confirm:

- README presents `ContentGuard AI` as an independent portfolio project.
- no original company or internal infrastructure appears in public files.
- no credentials or access codes are committed.
- API paths, data models, migrations, review stages, XHS flows, and tests retain their intended behavior.
- the final summary states exactly what was changed and what remains dependent on external Logto/AI/TOS configuration.
