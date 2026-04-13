# 過程 (katei)

Deliver as one.

Katei is a board-scoped workflow platform that coordinates collaboration among humans and agents.

Complete complex work faster and more reliably in one governed system that unifies process control, accountability, and coordination.

## Product Positioning

Katei currently ships in this repository as a single web app inside an npm workspaces monorepo. The implemented product today is a server-rendered Express application with a signed-in board workspace surface and a separate super-admin portfolio surface for cross-workspace oversight. The codebase already includes Google sign-in, server-owned MongoDB persistence, board collaboration and invite flows, locale-aware card content, and optional OpenAI-backed localization and stage-prompt actions.

## Current Implemented Scope

### Monorepo location

- Root workspaces are `apps/*` and `packages/*`.
- The only app workspace checked in today is `apps/katei`.
- Shared brand styles live in `packages/brand/src` and are imported by `apps/katei/styles/app.css`.
- Generated app docs live in `apps/katei/docs`.

### Runtime and UI

- `apps/katei/package.json` pins Node `24.x`.
- The server stack is Express 5, Nunjucks, `cookie-parser`, `google-auth-library`, and the MongoDB Node driver.
- The browser layer is server-rendered HTML enhanced by Stimulus controllers from `apps/katei/public/js/app.js`.
- Tailwind CLI builds `apps/katei/styles/app.css` into `apps/katei/public/assets/app.css`.
- The checked-in public assets include a web app manifest, service worker, offline page, icons, and `apps/katei/public/build-meta.json`.

### Routes and access

Public routes:

- `GET /`
- `GET /health`
- `GET /docs/env-inventory.html`
- `GET /docs/filetree.html`
- `POST /auth/google`

Session-protected routes:

- `GET /boards`
- `POST /auth/logout`
- `GET /api/workspace`
- `PUT /api/workspace`
- `POST /api/workspace/commands`
- `POST /api/workspace/localizations/generate`
- `POST /api/workspace/stage-prompts/run`
- `POST /api/workspace/import`
- `POST /api/workspace/create` (super-admin-only)

Super-admin route:

- `GET /portfolio`

Optional debug route:

- `POST /__debug/login` when `KATEI_DEBUG_AUTH_ENABLED=true`

Current access behavior:

- Anonymous `GET /boards` and `GET /portfolio` requests redirect to `/`.
- Anonymous API requests return JSON `401`.
- `GET /portfolio` requires both a session and super-admin status; non-super-admin viewers are redirected to `/boards`.
- `GET /` redirects authenticated viewers to `/boards` or `/portfolio` depending on super-admin status and remembered last surface.
- Static files under `apps/katei/public` are served directly by Express, so `/manifest.webmanifest`, `/offline.html`, `/sw.js`, `/assets/*`, `/js/*`, `/vendor/*`, `/svg/*`, and `/icons/*` are public.

### Authentication and session behavior

- The landing page uses Google Identity Services and posts the returned credential to `POST /auth/google`.
- The server verifies Google ID tokens against `GOOGLE_CLIENT_ID`, allowed Google issuers, and token expiration.
- `GOOGLE_ALLOWLIST_SUBS` is an optional comma-separated allowlist of Google `sub` values. When it is blank, any verified Google account can sign in.
- `SUPER_ADMINS` is an optional comma-separated list of email addresses that unlock the portfolio surface and super-admin-only actions such as workspace creation, workspace title management, and board self-role assignment.
- Katei derives its app origin from `APP_BASE_URL`; in development it falls back to `http://localhost:${PORT || 3000}`. `POST /auth/google` checks any incoming `Origin` header against that origin when present.
- Katei issues its own signed `katei_session` cookie after Google verification. The cookie is `HttpOnly`, `SameSite=Lax`, scoped to `/`, and `Secure` only in production.
- Session TTL defaults to 7 days and can be changed with `SESSION_TTL_SECONDS`.
- The app also uses `katei_last_surface` to remember the last board or portfolio destination and `katei_ui_locale` to remember the selected UI locale.
- Hosted debug login is available behind `POST /__debug/login` only when `KATEI_DEBUG_AUTH_ENABLED=true` and the related debug auth variables are configured.

### Persistence and API behavior

- MongoDB is the current source of truth. `apps/katei/src/app.js` wires `MongoWorkspaceRecordRepository` and `MongoPortfolioReadModel` by default.
- Workspace records are stored in the `workspace_records` collection.
- Each workspace record stores the workspace snapshot plus server-side metadata including `revision`, timestamps, `lastChangedBy`, bounded `activityEvents`, and bounded `commandReceipts`.
- Home workspaces are created on demand with IDs derived from the viewer `sub` using the `workspace_home_` prefix.
- The browser app uses `HttpWorkspaceRepository` in both the workspace and portfolio controllers, so the current app reads and writes through server APIs rather than browser-only persistence.
- `PUT /api/workspace` replaces a full workspace snapshot and enforces `expectedRevision`.
- `POST /api/workspace/commands` handles board, collaboration, and card mutation commands such as workspace title changes, board create/update/reset/delete, invites, role changes, card CRUD, localization request/review updates, card review decisions, and board switching.
- `POST /api/workspace/import` only succeeds while the target server record is still pristine.
- Legacy browser storage still exists as an import path. On a pristine home workspace load, `HttpWorkspaceRepository` checks `localStorage` for `katei.workspace.v4:<viewerSub>` and attempts a one-time import through `/api/workspace/import`.
- `LocalWorkspaceRepository` is still present in source, but it is not the wired persistence path for the current server-rendered app.

### Localization, review, and AI-assisted actions

- Supported UI locales are `en`, `es-CL`, and `ja`.
- UI locale resolution order is `?lang=...`, then the `katei_ui_locale` cookie, then `Accept-Language`, then default `en`.
- Boards store language policy, localization glossary, collaboration, stage configuration, and AI-localization settings alongside cards.
- The portfolio surface summarizes cross-workspace board directory data, missing required locales, open locale requests, awaiting human verification, AI proposal items, pending card reviews, and aging backlogs.
- `POST /api/workspace/localizations/generate` generates localized card content on the server.
- `POST /api/workspace/stage-prompts/run` generates a new stage-targeted card result on the server.
- Board-scoped OpenAI secrets are encrypted before persistence with `KATEI_BOARD_SECRET_ENCRYPTION_KEY` and are not serialized into the board bootstrap payload sent to the browser.

### Generated docs currently in the repo

- `apps/katei/docs/env-inventory.json`
- `apps/katei/docs/env-inventory.html`
- `apps/katei/docs/filetree.json`
- `apps/katei/docs/filetree.html`
- The app serves the HTML outputs at `/docs/env-inventory.html` and `/docs/filetree.html`.

## Local Development

Use Node 24 and install from the repo root:

```bash
npm install
```

Use `apps/katei/.env.example` as the current configuration reference.

### Required app runtime variables

- `GOOGLE_CLIENT_ID`
- `KATEI_SESSION_SECRET`
- `KATEI_BOARD_SECRET_ENCRYPTION_KEY`
- `MONGODB_URI`
- `MONGODB_DB_NAME`

### Optional app runtime variables

- `NODE_ENV`
- `PORT`
- `APP_BASE_URL`
- `GOOGLE_ALLOWLIST_SUBS`
- `SUPER_ADMINS`
- `SESSION_TTL_SECONDS`
- `KATEI_DEBUG_AUTH_ENABLED`
- `KATEI_DEBUG_AUTH_SECRET`
- `KATEI_DEBUG_AUTH_VIEWER_SUB`
- `KATEI_DEBUG_AUTH_VIEWER_EMAIL`
- `KATEI_DEBUG_AUTH_VIEWER_NAME`

### Deployment-only placeholders and workflow secrets

- `apps/katei/.env.example` also includes `HEROKU_APP_NAME` and `HEROKU_API_KEY` placeholders for deployment setup notes.
- The automated deploy workflow actually reads the GitHub repository secrets `HEROKU_KATEI_APP_PROD` and `HEROKU_API_KEY`.
- `PWA_BUILD_ID` and `GITHUB_SHA` are used by the PWA asset build script when generating `public/sw.js` and `public/build-meta.json`.

### Commands from the repo root

```bash
npm run dev
npm run start:katei
npm run build:katei:css
npm run prepare:subtree:katei
npm run build
```

Current behavior:

- `npm run dev` delegates to `apps/katei`.
- `npm run start:katei` runs the app start script in `apps/katei`.
- `npm run build:katei:css` builds Katei CSS.
- `npm run prepare:subtree:katei` currently runs the same CSS build used before Heroku deploys.
- `npm run build` currently delegates to the CSS build and does not produce a separate app bundle.

### Commands from `apps/katei`

```bash
npm run dev
npm start
npm run build:css
npm run build:pwa
npm run build
npm test
```

Current behavior:

- `npm run dev` watches `src`, `public/js`, `styles`, and `../../packages/brand/src`, rebuilds CSS, and restarts `node src/server.js` through `nodemon`.
- `npm start` runs `node src/server.js`.
- `npm run build:css` writes `public/assets/app.css`.
- `npm run build:pwa` generates `public/sw.js` and `public/build-meta.json`.
- `npm run build` is an informational stub and does not emit an additional production bundle.
- `npm test` runs `node --test`.

## Deployment and Runtime

The primary automated deployment path checked into this repository is `.github/workflows/deploy-katei-heroku.yml`.

What that workflow does today:

1. Runs on pushes to `main` that touch `apps/katei`, `packages/brand`, root package manifests, or the workflow itself, while excluding markdown-only changes inside `apps/katei` and `packages/brand`.
2. Sets up Node 24 and runs `npm ci` from the repo root.
3. Builds CSS with `npm run prepare:subtree:katei`.
4. Copies `apps/katei` into a temporary deploy directory under `$RUNNER_TEMP`.
5. Sets `PWA_BUILD_ID` from `GITHUB_SHA` and regenerates `public/sw.js` and `public/build-meta.json`.
6. Pushes that temporary app directory to the Heroku git remote as `main`.

Runtime process definition in `apps/katei/Procfile`:

```Procfile
web: npm start
```

Additional runtime behavior from `apps/katei/src/server.js`:

- Local development defaults to port `3000`.
- In production, or whenever `DYNO` is set, `PORT` must be provided explicitly.
- The HTTP server sets keep-alive and headers timeouts and installs graceful shutdown handlers for `SIGTERM` and `SIGINT`.

Deployment shape checked into the repo today:

- One web process.
- Heroku git deployment from the `apps/katei` subtree.
- No `Dockerfile`, `heroku.yml`, or additional worker process definition is committed.

## Architecture Notes

- `apps/katei/src/app.js` configures Nunjucks, JSON and URL-encoded body parsing, cookie parsing, UI locale middleware, static asset serving, session attachment, and the composed web router.
- Route modules are split across `apps/katei/src/routes/public.js`, `auth.js`, `boards.js`, `portfolio.js`, `workspace_api.js`, `debug_auth.js`, and `web.js`.
- Page templates live under `apps/katei/src/views`. The workspace page embeds a `workspace-bootstrap` JSON payload so the Stimulus controller can hydrate with server-rendered state before moving to API-backed mutations.
- The server currently pairs a writable Mongo repository (`mongo_workspace_record_repository.js`) with a separate Mongo read model for the portfolio surface (`mongo_portfolio_read_model.js`).
- The mutation model is command-driven. Browser controllers send structured commands through `WorkspaceService` and `HttpWorkspaceRepository`, while the server applies them through `apply_workspace_command.js`.
- Record writes use `expectedRevision` checks for optimistic concurrency, and command receipts are stored server-side to safely replay duplicate `clientMutationId` submissions.
- Workspace projections are viewer-aware: the repository filters board data by access and keeps pending invite summaries and accessible workspace summaries alongside the active workspace payload.
- The service worker caches static assets and an offline fallback page, but intentionally bypasses `/api/`, `/auth/`, and `/__debug/` requests.

## Optional Repo-Local Agent Tooling

Repo-local agent guidance and skills currently present:

- `AGENTS.md`
- `.agents/skills/env-inventory/SKILL.md`
- `.agents/skills/katei-auth-debug/SKILL.md`
- `.agents/skills/monorepo-filetree/SKILL.md`

Generated repo-local docs currently present:

- `monorepo-filetree.md`
- `apps/katei/docs/env-inventory.html`
- `apps/katei/docs/env-inventory.json`
- `apps/katei/docs/filetree.html`
- `apps/katei/docs/filetree.json`
