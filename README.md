# 過程 (katei)

Deliver as one.

Katei is a board-scoped workflow platform that coordinates collaboration among humans and agents.

Complete complex work faster and more reliably in one governed system that unifies process control, accountability, and coordination.

## Product Positioning

Katei currently ships in this repository as a board-scoped web application inside an npm workspaces monorepo. The implemented product today is a server-rendered and Stimulus-enhanced workflow surface with Google sign-in, MongoDB-backed workspace persistence, board collaboration and invite flows, locale-aware card content, board-scoped AI actions, and a separate super-admin portfolio view.

## Current Implemented Scope

### Monorepo location

- Root workspaces are `apps/*` and `packages/*`.
- The running app lives at `apps/katei`.
- Shared brand styles live at `packages/brand/src` and are imported by `apps/katei/styles/app.css`.
- Generated app docs checked into the repo live under `apps/katei/docs`.

### Runtime and UI

- Node runtime: `24.x` in `apps/katei/package.json`.
- Server stack: Express 5, Nunjucks, `cookie-parser`, `google-auth-library`, and the MongoDB Node driver.
- Browser layer: server-rendered pages enhanced by Stimulus controllers from `apps/katei/public/js/app.js`.
- CSS build: Tailwind CLI compiles `apps/katei/styles/app.css` to `apps/katei/public/assets/app.css`.
- PWA assets are present today: `apps/katei/public/manifest.webmanifest`, `apps/katei/public/sw.js`, `apps/katei/public/offline.html`, and generated `apps/katei/public/build-meta.json`.

### Routes implemented today

Public routes:

- `GET /`
- `GET /health`
- `GET /docs/env-inventory.html`
- `GET /docs/filetree.html`
- `POST /auth/google`

Authenticated routes:

- `GET /boards`
- `POST /auth/logout`
- `GET /api/workspace`
- `PUT /api/workspace`
- `POST /api/workspace/commands`
- `POST /api/workspace/localizations/generate`
- `POST /api/workspace/stage-prompts/run`
- `POST /api/workspace/import`

Super-admin routes:

- `GET /portfolio`
- `POST /api/workspace/create`

Optional debug route:

- `POST /__debug/login` when `KATEI_DEBUG_AUTH_ENABLED=true`

Current access behavior:

- Unauthenticated `GET /boards` requests redirect to `/`.
- `GET /portfolio` requires both a session and super-admin status; non-super-admin viewers are redirected back to `/boards`.
- Unauthenticated API requests use JSON `401` responses from the session middleware.
- Static files under `apps/katei/public` are served directly by Express.

### Authentication and session behavior

- The landing page loads Google Identity Services and posts the returned credential to `POST /auth/google`.
- The server verifies Google ID tokens against `GOOGLE_CLIENT_ID`, allowed issuers (`accounts.google.com`, `https://accounts.google.com`), and token expiration.
- `GOOGLE_ALLOWLIST_SUBS` is an optional comma-separated allowlist of Google `sub` values. When empty, any verified Google account may sign in.
- `SUPER_ADMINS` is an optional comma-separated list of email addresses used to grant access to the portfolio surface and workspace-creation/title-management actions.
- If `APP_BASE_URL` is set, Katei checks the request `Origin` header during sign-in and requires it to match that app origin.
- Katei issues its own signed `katei_session` cookie after Google verification. The cookie is `HttpOnly`, `SameSite=Lax`, scoped to `/`, and `Secure` only when `NODE_ENV=production`.
- Session TTL defaults to 7 days and is configurable with `SESSION_TTL_SECONDS`.
- The app also uses `katei_last_surface` to remember the last board or portfolio destination and `katei_ui_locale` to remember the selected UI locale.
- Hosted debug login is implemented behind `POST /__debug/login` and is controlled by `KATEI_DEBUG_AUTH_ENABLED`, `KATEI_DEBUG_AUTH_SECRET`, and the configured debug viewer identity vars.

### Persistence, API flow, and data model

- MongoDB is the current source of truth. `apps/katei/src/app.js` wires `MongoWorkspaceRecordRepository` and `MongoPortfolioReadModel` by default.
- Workspace records persist in the `workspace_records` collection.
- Each workspace record carries the workspace snapshot plus `revision`, `createdAt`, `updatedAt`, `lastChangedBy`, bounded `activityEvents`, and bounded `commandReceipts`.
- Home workspace IDs are derived as `workspace_home_<viewerSub>`.
- The browser app uses `HttpWorkspaceRepository` as its active repository in both `workspace_controller.js` and `portfolio_controller.js`.
- The workspace page can bootstrap initial data from embedded `workspace-bootstrap` JSON; subsequent loads and writes use `/api/workspace*`.
- `PUT /api/workspace` performs full snapshot replacement with optimistic `expectedRevision` checks.
- `POST /api/workspace/commands` is the main command-based mutation path for interactive board and card changes.
- `POST /api/workspace/import` only succeeds while the target server record is still pristine.
- Browser `localStorage` still matters only as a legacy import source: on a pristine home workspace load, `HttpWorkspaceRepository` reads `katei.workspace.v4:<viewerSub>` and attempts a one-time import through `/api/workspace/import`.
- `LocalWorkspaceRepository` still exists in source, but it is not the wired persistence path for the current server-rendered app.

### Localization, portfolio, and board-scoped AI

- Supported UI locales are `en`, `es-CL`, and `ja`.
- UI locale resolution order is `?lang=...` query, then `katei_ui_locale` cookie, then `Accept-Language`, then default `en`.
- Boards carry language policy data, and the portfolio read model summarizes missing required locales, open locale requests, awaiting human verification items, and agent proposal items across workspaces.
- `POST /api/workspace/localizations/generate` runs server-side localization generation.
- `POST /api/workspace/stage-prompts/run` runs server-side stage prompt generation for stages that support that action.
- Board-scoped OpenAI keys are stored on the board record and encrypted with `KATEI_BOARD_SECRET_ENCRYPTION_KEY`.
- The current OpenAI integrations call the Responses API from `openai_localizer.js` and `openai_stage_prompt_runner.js`, both defaulting to model `gpt-5.4-mini`.

### Generated docs and assets present now

Tracked generated docs:

- `apps/katei/docs/env-inventory.html`
- `apps/katei/docs/env-inventory.json`
- `apps/katei/docs/filetree.html`
- `apps/katei/docs/filetree.json`

Served docs pages:

- `/docs/env-inventory.html`
- `/docs/filetree.html`

Build-generated runtime assets:

- `apps/katei/public/sw.js`
- `apps/katei/public/build-meta.json`

## Local Development

Use Node 24 and install dependencies from the repo root:

```bash
npm install
```

Use `apps/katei/.env.example` as the current reference file for app configuration.

### Required app runtime variables

- `GOOGLE_CLIENT_ID`
- `KATEI_SESSION_SECRET`
- `KATEI_BOARD_SECRET_ENCRYPTION_KEY`
- `MONGODB_URI`
- `MONGODB_DB_NAME`

### Optional app runtime variables

- `NODE_ENV`
- `PORT`
- `GOOGLE_ALLOWLIST_SUBS`
- `SUPER_ADMINS`
- `SESSION_TTL_SECONDS`
- `APP_BASE_URL`
- `KATEI_DEBUG_AUTH_ENABLED`
- `KATEI_DEBUG_AUTH_SECRET`
- `KATEI_DEBUG_AUTH_VIEWER_SUB`
- `KATEI_DEBUG_AUTH_VIEWER_EMAIL`
- `KATEI_DEBUG_AUTH_VIEWER_NAME`

### Deploy workflow secrets and placeholders

- The GitHub Actions deploy workflow reads repository secrets `HEROKU_KATEI_APP_PROD` and `HEROKU_API_KEY`.
- `apps/katei/.env.example` also includes `HEROKU_APP_NAME` and `HEROKU_API_KEY` placeholders, but the Katei runtime itself does not read those values from app code.

### Commands from repo root

```bash
npm run dev
npm run start:katei
npm run build:katei:css
npm run prepare:subtree:katei
npm run build
```

Current behavior:

- `npm run dev` runs the Katei app development workflow in `apps/katei`.
- `npm run start:katei` runs the app start script in `apps/katei`.
- `npm run build:katei:css` builds Katei CSS.
- `npm run prepare:subtree:katei` currently delegates to the same CSS build step used before Heroku subtree deploys.
- `npm run build` currently delegates to the CSS build step.

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

- `npm run dev` watches `src`, `public/js`, `styles`, and `../../packages/brand/src`, rebuilds CSS, and starts `node src/server.js` through `nodemon`.
- `npm start` runs `node src/server.js`.
- `npm run build:css` writes `public/assets/app.css`.
- `npm run build:pwa` runs `scripts/build_pwa_assets.mjs`.
- `npm run build` is currently an informational stub and does not produce an additional app bundle.
- `npm test` runs `node --test`.

## Deployment and Runtime

The primary automated deploy path currently checked into the repo is `.github/workflows/deploy-katei-heroku.yml`.

What that workflow does today:

1. Runs on pushes to `main` that touch `apps/katei`, `packages/brand`, root package manifests, or the workflow itself, with markdown-only changes under `apps/katei` and `packages/brand` excluded.
2. Sets up Node 24 and runs `npm ci` from the monorepo root.
3. Prebuilds CSS with `npm run prepare:subtree:katei`.
4. Copies `apps/katei` into a temporary deploy directory.
5. Regenerates PWA assets there with `node ./scripts/build_pwa_assets.mjs`.
6. Pushes that deploy directory to the Heroku git remote as `main`.

Runtime process definition in `apps/katei/Procfile`:

```Procfile
web: npm start
```

Additional runtime behavior from `apps/katei/src/server.js`:

- Local development defaults to port `3000`.
- In production, or whenever `DYNO` is set, `PORT` must be provided explicitly.
- The HTTP server sets keep-alive and headers timeouts and installs graceful shutdown handlers for `SIGTERM` and `SIGINT`.

## Architecture Notes

- `apps/katei/src/app.js` configures Nunjucks, JSON and URL-encoded body parsing, cookie parsing, UI locale middleware, static asset serving, session attachment, and the composed web router.
- Route modules are split across `apps/katei/src/routes/public.js`, `auth.js`, `boards.js`, `portfolio.js`, `workspace_api.js`, and `debug_auth.js`.
- Page templates live under `apps/katei/src/views`, and the workspace page embeds initial state in a `workspace-bootstrap` JSON script tag for the browser controller.
- Client mutations are validated in `apps/katei/public/js/domain/workspace_commands.js`, sent through `WorkspaceService`, and applied on the server through `apps/katei/src/workspaces/apply_workspace_command.js`.
- Workspace visibility is board-derived: non-owner viewers only receive readable boards plus pending-invite board shells from the repository projection layer.
- The portfolio view is backed by a separate Mongo read model in `apps/katei/src/workspaces/mongo_portfolio_read_model.js`.
- The service worker is static-asset and offline-page oriented; it explicitly bypasses `/api/`, `/auth/`, and `/__debug/` requests.
- The repo defines a single Node web process backed by MongoDB. No separate worker process is defined in the current deploy files.

## Optional Repo-Local Agent and Skill Tooling

Repository-local agent guidance and skills present today:

- `AGENTS.md`
- `.agents/skills/env-inventory/SKILL.md`
- `.agents/skills/katei-auth-debug/SKILL.md`
- `.agents/skills/monorepo-filetree/SKILL.md`

Related repo-local docs currently present:

- `monorepo-filetree.md`
- `apps/katei/docs/env-inventory.html`
- `apps/katei/docs/env-inventory.json`
- `apps/katei/docs/filetree.html`
- `apps/katei/docs/filetree.json`
