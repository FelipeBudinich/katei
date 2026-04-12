# 過程 (katei)

Deliver as one.

Katei is a board-scoped workflow platform that coordinates collaboration among humans and agents.

Complete complex work faster and more reliably in one governed system that unifies process control, accountability, and coordination.

## Product positioning

Katei ships in this repository as a Node + Express web app in an npm workspaces monorepo. The implemented product is a board-centric workspace with Google sign-in, server-owned workspace persistence, board collaboration roles/invites, locale-aware card content, and board-scoped AI helpers for localization and stage-prompt generation.

A super-admin portfolio surface is also implemented for cross-workspace summaries, board search, workspace creation/title management, localization review queues, and board self-role assignment.

## Current implemented scope

### Monorepo location

- Monorepo workspaces are `apps/*` and `packages/*`.
- The app runtime is at `apps/katei`.
- Shared brand styles are in `packages/brand/src` and imported by `apps/katei/styles/app.css`.
- Generated app docs currently checked into the repo are under `apps/katei/docs`.

### Runtime stack

- Runtime: Node (workspace declares `node: 24.x`).
- Server: Express 5 + Nunjucks + cookie-parser + google-auth-library + mongodb driver.
- Browser layer: server-rendered HTML enhanced with Stimulus controllers from `apps/katei/public/js`.
- CSS pipeline: Tailwind CLI builds `apps/katei/public/assets/app.css` from `apps/katei/styles/app.css`.
- PWA/offline assets are present (`public/sw.js`, `public/manifest.webmanifest`, `public/offline.html`) and `scripts/build_pwa_assets.mjs` is used in deploy automation.

### Routes implemented today

Public routes:

- `GET /`
- `GET /health`
- `GET /docs/env-inventory.html`
- `GET /docs/filetree.html`
- `POST /auth/google`

Authenticated routes:

- `GET /boards`
- `GET /portfolio` (super admin required)
- `GET /api/workspace`
- `PUT /api/workspace`
- `POST /api/workspace/commands`
- `POST /api/workspace/localizations/generate`
- `POST /api/workspace/stage-prompts/run`
- `POST /api/workspace/import`
- `POST /api/workspace/create` (super admin required)
- `POST /auth/logout`

Optional debug route:

- `POST /__debug/login` when `KATEI_DEBUG_AUTH_ENABLED=true`

Access behavior in code:

- Unauthenticated `/boards` requests redirect to `/`.
- Unauthenticated `/portfolio` requests redirect to `/`; authenticated non-super-admin `/portfolio` requests redirect to `/boards`.
- Unauthenticated `/api/*` and `/auth/logout` requests return JSON `401`.
- Static files under `apps/katei/public` are served publicly.

### Authentication and sessions

- Landing page uses Google Identity Services and posts credentials to `POST /auth/google`.
- Server verifies Google ID tokens against `GOOGLE_CLIENT_ID`, allowed issuers (`accounts.google.com`, `https://accounts.google.com`), and token expiration.
- Optional Google subject allowlist is controlled by `GOOGLE_ALLOWLIST_SUBS` (comma-separated `sub` values).
- `SUPER_ADMINS` (comma-separated emails) controls access to super-admin-only surfaces/actions.
- If `APP_BASE_URL` resolves to an origin, sign-in requests with an `Origin` header must match that origin.
- Session cookie: signed `katei_session`, `HttpOnly`, `SameSite=Lax`, path `/`, `Secure` only in production.
- Session lifetime defaults to 7 days (`SESSION_TTL_SECONDS` overrides).
- Additional cookies used by the app: `katei_last_surface` (last board/portfolio surface memory) and `katei_ui_locale` (selected UI locale).
- Hosted debug auth is guarded by `KATEI_DEBUG_AUTH_ENABLED`, `KATEI_DEBUG_AUTH_SECRET`, and debug viewer identity settings.

### Persistence and data model

- Source of truth is server-owned MongoDB persistence via `MongoWorkspaceRecordRepository`.
- Workspace records are stored in Mongo collection `workspace_records`.
- The client’s primary data path is `HttpWorkspaceRepository` calling `/api/workspace*` routes.
- `PUT /api/workspace` performs full snapshot replacement with expected revision checks.
- `POST /api/workspace/commands` is the main mutation path (board/card/collaboration/localization/workspace operations).
- `POST /api/workspace/import` only succeeds while the target server record is pristine (conflict otherwise).
- Legacy browser `localStorage` (`katei.workspace.v4:<viewerSub>`) is still read only as a one-time import source on pristine home workspace load.

### AI/localization behavior currently implemented

- Board-level OpenAI keys are stored per board and encrypted with `KATEI_BOARD_SECRET_ENCRYPTION_KEY`.
- Localization generation endpoint: `POST /api/workspace/localizations/generate`.
- Stage prompt run endpoint: `POST /api/workspace/stage-prompts/run`.
- OpenAI responses API is used from server-side helpers (`openai_localizer`, `openai_stage_prompt_runner`) with default model `gpt-5.4-mini`.

### i18n and docs pages

- Supported UI locales are: `en`, `es-CL`, `ja`.
- Locale resolution order is: `?lang=...` query -> `katei_ui_locale` cookie -> `Accept-Language` -> default `en`.
- Generated docs currently tracked:
  - `apps/katei/docs/env-inventory.html`
  - `apps/katei/docs/env-inventory.json`
  - `apps/katei/docs/filetree.html`
  - `apps/katei/docs/filetree.json`
- App routes expose the HTML docs at `/docs/env-inventory.html` and `/docs/filetree.html`.

## Local development

Use Node 24 and install from repo root:

```bash
npm install
```

Root-level scripts:

```bash
npm run dev
npm run start:katei
npm run build:katei:css
npm run prepare:subtree:katei
npm run build
```

Current behavior:

- `npm run dev` -> runs `apps/katei` dev workflow.
- `npm run start:katei` -> runs `apps/katei` start script.
- `npm run build:katei:css` and `npm run prepare:subtree:katei` -> build app CSS.
- `npm run build` -> currently delegates to CSS build.

From `apps/katei`:

```bash
npm run dev
npm start
npm run build:css
npm run build:pwa
npm run build
npm test
```

Current behavior:

- `npm run dev` -> nodemon loop watching `src`, `public/js`, `styles`, and `../../packages/brand/src`, rebuilding CSS then starting `node src/server.js`.
- `npm start` -> `node src/server.js`.
- `npm run build:css` -> outputs `public/assets/app.css`.
- `npm run build:pwa` -> runs `scripts/build_pwa_assets.mjs`.
- `npm run build` -> informational stub (no extra app bundle step).
- `npm test` -> `node --test`.

## Deployment and runtime

Primary automated deploy path in-repo: `.github/workflows/deploy-katei-heroku.yml`.

What it does now:

1. Triggers on pushes to `main` for app/brand/workflow package changes (excluding markdown-only app/brand changes) and on manual dispatch.
2. Uses Node 24 and runs `npm ci` at monorepo root.
3. Prebuilds CSS with `npm run prepare:subtree:katei` and verifies the CSS artifact.
4. Copies `apps/katei` into a temporary deploy directory.
5. Runs `node ./scripts/build_pwa_assets.mjs` there and verifies `public/sw.js` + `public/build-meta.json`.
6. Pushes that deploy directory to Heroku git remote (`main`, force push).

Runtime process type in `apps/katei/Procfile`:

```Procfile
web: npm start
```

Inside deployed app, `npm start` runs `node src/server.js`.

## Architecture notes

- `apps/katei/src/app.js` composes middleware (JSON/urlencoded parsing, cookie parsing, UI locale attach, static files, session attach) and mounts route modules.
- `apps/katei/src/server.js` creates an HTTP server with explicit keep-alive/header timeouts and graceful shutdown handlers for `SIGTERM`/`SIGINT`.
- Views are Nunjucks templates under `apps/katei/src/views`; client enhancement is loaded from `/js/app.js`.
- Workspace records are versioned and migrated via shared domain modules before validation and persistence.
- Runtime is a single Node web process backed by MongoDB (no separate worker process is defined in current deploy files).

## Optional repo-local agent/skill tooling

Repository-local agent guidance and skill docs currently present:

- `AGENTS.md`
- `.agents/skills/env-inventory/SKILL.md`
- `.agents/skills/katei-auth-debug/SKILL.md`
- `.agents/skills/monorepo-filetree/SKILL.md`

Related generated navigation/docs artifacts currently present:

- `monorepo-filetree.md`
- `apps/katei/docs/env-inventory.html`
- `apps/katei/docs/env-inventory.json`
- `apps/katei/docs/filetree.html`
- `apps/katei/docs/filetree.json`
