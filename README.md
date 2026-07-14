# ContentGuard AI

ContentGuard AI（内容卫士 AI 审核平台）是一个面向品牌内容团队、代理商和创作者的营销内容合规工作台。

它把 Brief、规则、脚本、视频和人工审核串成一条可追踪的内容交付流程：AI 负责多模态预审，代理商负责初审，品牌方可以进行终审，创作者可以查看反馈并发起申诉。

> This repository is a personal portfolio adaptation. Production credentials, private endpoints, company identifiers, and deployment access are intentionally excluded.

## Core Workflow

```text
Project -> Brief -> Creator Task
                  -> Script AI Review
                  -> Agency Review
                  -> Optional Brand Review
                  -> Video Upload
                  -> Video AI Review
                  -> Agency Review
                  -> Optional Brand Review
                  -> Completed
```

The workflow preserves separate script and video stages. Rejected scripts return to script upload; rejected videos return to video upload. AI findings are surfaced to human reviewers instead of directly replacing the human decision.

## Role Model

- **Brand**: creates projects, manages agencies, configures Brief/rules/AI, and performs final review.
- **Agency**: manages creators, creates tasks, reviews AI findings, and coordinates delivery.
- **Creator**: uploads scripts and videos, reads review results, and submits appeals.
- **Operator**: works inside an isolated workspace for project, task, rule, AI, and XHS operations.

Authentication uses Logto JWTs. Tenant context is resolved by the backend and is used for AI configuration, compliance rules, and the XHS workspace.

## AI Review Pipeline

### Script review

The script reviewer combines the project Brief, platform rules, forbidden words, competitor data, and learned brand rules. The AI response is normalized into structured dimensions:

- legal compliance
- platform rules
- brand safety
- Brief selling-point coverage
- content quality
- brand exposure
- violations and suggested rewrites

### Video review

The video pipeline downloads the submitted file, extracts audio and keyframes, runs ASR and OCR, checks visual evidence, and merges the results into a structured report. Long-running work can run through Celery and Redis, while the API exposes progress through SSE notifications.

## XHS Batch Rewriting

The agency/operator workspace also contains a separate Xiaohongshu batch rewriting workflow:

```text
XHS Project -> Variants -> Directions -> Versioned Packs
             -> Trial/Full Batch -> AI Editor -> AI Verifier
             -> Retry / Safe Rewrite / Manual Decision
             -> Markdown or Feishu Export
```

Each note is tracked independently with source text, model metadata, verifier output, retry state, final copy, and export history.

## Architecture

```text
Browser
  -> Nginx
      -> Next.js frontend
          -> FastAPI API
              -> PostgreSQL / Alembic
              -> Redis / Celery
              -> TOS or local file storage
              -> OpenAI-compatible AI provider
```

The current codebase uses a monolithic FastAPI backend with worker processes. The design documents include future ideas such as independent AI services and vector retrieval; those ideas are not represented as shipped microservices unless the code says so.

## Repository Layout

```text
backend/       FastAPI API, SQLAlchemy models, Celery tasks, migrations, tests
frontend/      Next.js App Router application and Vitest tests
docs/          User, deployment, and feature documentation
nginx/         Reverse proxy configuration
scripts/       Local development and deployment helpers
```

## Local Development

Prerequisites:

- Python 3.11+
- Node.js 18+
- PostgreSQL 16+
- Redis 7+
- Docker Desktop (optional, for Compose)

Create local environment files from the examples and provide your own Logto, database, Redis, AI, and object-storage values. Do not commit those files.

```powershell
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env

Set-Location backend
uv sync --extra dev
uv run alembic upgrade head
uv run pytest -q

Set-Location ../frontend
npm ci
npm run lint
npx tsc --noEmit
npm test -- --run
```

The Compose files are deployment templates. They require the referenced environment files and external service credentials before they can start a complete authenticated environment.

## Configuration and Secrets

Required values depend on the environment:

- `LOGTO_ENDPOINT`, `LOGTO_APP_ID`, `LOGTO_APP_SECRET`, `LOGTO_COOKIE_SECRET`, `LOGTO_API_RESOURCE`
- `SECRET_KEY` and `OPERATOR_ACCESS_CODE`
- `DATABASE_URL` and `REDIS_URL`
- AI provider credentials or tenant-level encrypted AI configuration
- TOS credentials when object storage is enabled

CI examples expect these values from secret storage. The repository contains no production values.

## Current Scope and Limitations

- The main production-shaped workflow is `Project -> Brief -> Task`.
- A legacy standalone video review model remains in the backend for compatibility.
- AI quality depends on the configured provider and the quality of Brief/rule data.
- Local development can use the built-in async fallback; production should run the Celery workers.
- The repository is intended to demonstrate engineering and product architecture, not to provide a public production deployment.

## Portfolio

Repository: [github.com/PLKJ666/contentguard-ai](https://github.com/PLKJ666/contentguard-ai)

The project demonstrates multi-role workflow design, tenant-scoped configuration, asynchronous media processing, structured AI output handling, human-in-the-loop review, and an independent batch content-generation workflow.

