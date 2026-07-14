# ContentGuard AI Portfolio Sanitization Design

## Goal

Convert the existing project into a publicly presentable personal-portfolio project named **ContentGuard AI**, while preserving the core content-compliance workflow, API contracts, data model, and user-facing capabilities.

## Public Identity

- Product name: `ContentGuard AI`
- Chinese product name: `内容卫士 AI 审核平台`
- Suggested repository name: `contentguard-ai`
- Generic backend package metadata: `contentguard-backend`
- Generic service/container prefix: `contentguard-*`
- Generic local storage/database defaults: `contentguard`
- Generic public support address: `support@example.com`

The original company/product names, internal organization names, internal domains, registry addresses, and deployment identifiers must not appear in public-facing source, documentation, examples, screenshots, or test fixtures unless they are unavoidable historical database identifiers. Historical Alembic revision filenames and database table names are not renamed because doing so would create unnecessary migration and upgrade risk.

## Scope

### Identity and metadata

Update visible product names and non-functional metadata in:

- application configuration and titles
- frontend metadata, layouts, theme storage keys, and upload route identifiers
- Python and JavaScript package metadata
- Docker Compose service/container names
- backup and local runtime naming
- README and portfolio-facing documentation
- tests and fixtures that assert the old display identity

### Infrastructure anonymization

Replace private infrastructure references with neutral, non-routable examples or empty environment values:

- internal repository URLs
- private Docker registry names
- private Logto endpoints and API resource URLs
- internal AI gateway URLs
- company support addresses
- enterprise notification endpoints
- deployment hostnames, usernames, and repository paths
- hardcoded credentials, access codes, and secret-like values

Public technology names such as Logto, PostgreSQL, Redis, Celery, TOS, FastAPI, Next.js, and SSE remain documented because they describe the implementation rather than the original organization.

### Portfolio documentation

Add a concise public README that explains:

- the product problem and target users
- the brand / agency / creator / operator roles
- the two-stage script and video review workflow
- AI review dimensions and asynchronous processing
- the separate XHS batch rewriting capability
- the current architecture and deployment prerequisites
- how to configure secrets without embedding them in source
- the distinction between implemented behavior and future design ideas

Internal deployment notes should be rewritten as generic operational examples. They must not imply access to a private production environment.

### Visual assets

Keep useful product screenshots and design assets only when they contain no company names, private URLs, real accounts, or operational data. Public-facing documentation must not link to an asset that exposes internal identity. Existing product behavior and UI layout are outside this sanitization scope.

## Behavior Preservation

The following must remain unchanged:

- the `Project -> Brief -> Task` domain model
- script and video task stages
- AI review to agency review to optional brand final review transitions
- appeal and force-pass semantics
- tenant-scoped AI configuration behavior
- TOS/local upload behavior
- Celery/Redis asynchronous processing and SSE notifications
- XHS project, pack, batch, retry, safe-rewrite, decision, and export flows
- API route paths and response contracts
- Alembic migration history and existing database table names

Changes to tests should update identity expectations only; they must not weaken behavioral assertions.

## Explicit Exclusions

- Do not redesign or rewrite the authentication system.
- Do not replace Logto or TOS with a new provider.
- Do not refactor the task state machine.
- Do not rename database tables or migration revisions.
- Do not add demo bypasses that allow unauthenticated production behavior.
- Do not claim that planned microservices, vector search, or WebSocket capabilities are already implemented when the current code uses the existing monolithic backend and SSE path.
- Do not publish real secret values, private hostnames, internal repository names, or production contact information.

## Acceptance Criteria

1. Public-facing identity consistently uses `ContentGuard AI` / `内容卫士 AI 审核平台`.
2. A repository-wide scan finds no original company/product identifiers or private infrastructure references outside explicitly preserved historical migration identifiers.
3. A secret-oriented scan finds no hardcoded credential assignments, access codes, private webhook URLs, or long secret-like tokens.
4. Environment examples use placeholders and explain which values are required for a real deployment.
5. README and deployment docs describe the current implementation accurately and contain no internal operational instructions.
6. Core backend and frontend behavior tests remain valid; only identity-dependent assertions are updated.
7. Python compilation, frontend type checking/lint, and the production build are rerun after the changes.
8. The sanitized project can be presented as an independent personal portfolio project without exposing the original organization or deployment environment.

## Verification Plan

- Scan source and documentation for the old identity and private domains.
- Scan CI, Compose, Dockerfiles, environment templates, and tests for secrets and internal endpoints.
- Run backend compile and targeted tests for auth, task workflow, upload, XHS, and AI configuration.
- Run frontend lint, TypeScript checking, identity-sensitive tests, and production build.
- Review the final diff for accidental business-logic changes and stale internal references.
