# 過程 (katei)

Deliver as one.

Katei is a board-scoped workflow platform that coordinates collaboration among humans and agents.

Complete complex work faster and more reliably in one governed system that unifies process control, accountability, and coordination.

## Product Positioning

Katei currently ships in this repository as a private-tester web app inside an npm workspaces monorepo. The implemented product today is a board-centric collaboration surface with Google sign-in, server-owned workspace records, board-level sharing, locale-aware card content, and board-scoped OpenAI helpers.

The repository also ships a super-admin portfolio surface for cross-workspace summaries, searchable board discovery, workspace creation, workspace title management, board self-role assignment, and localization review queues. The runtime today is a single Node web process backed by MongoDB and enhanced in the browser with Stimulus.

## Current Implemented Scope

### Monorepo location

- Root workspaces are defined in `package.json` as `apps/*` and `packages/*`.
- The current application lives at `apps/katei`.
- Shared brand CSS lives under `packages/brand/src` and is imported by `apps/katei/styles/app.css`.
- Checked-in app docs live under `apps/katei/docs`.

### Runtime stack

- `apps/katei` is an ESM Node app with `engines.node >=20`.
- The server uses Express 5, Nunjucks, `cookie-parser`, `google-auth-library`, and the MongoDB Node driver.
- The browser UI is server-rendered HTML enhanced by Stimulus controllers loaded from `apps/katei/public/js`.
- Tailwind CSS 4 builds `apps/katei/public/assets/app.css`.
- Public assets include a service worker, install manifest, offline fallback page, and vendored EasyMDE, Marked, DOMPurify, and Stimulus files under `apps/katei/public`.

### Routes

Public routes:

- `GET /`
- `GET /health`
- `GET /docs/env-inventory.html`
- `GET /docs/filetree.html`
- `POST /auth/google`

Authenticated routes:

- `GET /boards`
- `GET /portfolio` for super admins
- `GET /api/workspace`
- `PUT /api/workspace`
- `POST /api/workspace/commands`
- `POST /api/workspace/localizations/generate`
- `POST /api/workspace/stage-prompts/run`
- `POST /api/workspace/import`
- `POST /api/workspace/create` for super admins
- `POST /auth/logout`

Optional debug route:

- `POST /__debug/login` when `KATEI_DEBUG_AUTH_ENABLED=true`

Current access behavior:

- Unauthenticated browser requests to `/boards` and `/portfolio` redirect to `/`.
- Authenticated non-super-admin requests to `/portfolio` redirect to `/boards`.
- Unauthenticated `POST /auth/logout` and `/api/*` requests return `401` JSON responses.
- Static files are served from `apps/katei/public`, so assets such as `/assets/app.css`, `/js/app.js`, `/sw.js`, `/manifest.webmanifest`, and `/offline.html` are public.

### Authentication and session behavior

- The landing page loads Google Identity Services from `https://accounts.google.com/gsi/client` and posts the returned credential to `POST /auth/google`.
- Google ID token verification runs server-side against the configured `GOOGLE_CLIENT_ID`, accepted issuers `accounts.google.com` and `https://accounts.google.com`, and token expiry.
- `GOOGLE_ALLOWLIST_SUBS` optionally restricts sign-in to a comma-separated allowlist of Google `sub` values. When it is blank or unset, any verified token for the configured client ID is allowed.
- `SUPER_ADMINS` is an optional comma-separated email allowlist used to enable the Portfolio view and super-admin-only actions.
- If `APP_BASE_URL` resolves to an origin, sign-in requests with an `Origin` header must match that origin. In development, `APP_BASE_URL` defaults to `http://localhost:<PORT>` when unset.
- Authenticated users receive a signed `katei_session` cookie with an embedded expiry, `HttpOnly`, `SameSite=Lax`, path `/`, and `Secure` enabled only in production.
- Session lifetime defaults to 7 days and can be overridden with `SESSION_TTL_SECONDS`.
- `katei_last_surface` remembers whether a viewer last landed on a board surface or the portfolio surface.
- `katei_ui_locale` stores the selected UI locale when the request uses `?lang=...`.
- Hosted debug login is disabled by default. When enabled, `POST /__debug/login` requires the `x-katei-debug-auth` header to match `KATEI_DEBUG_AUTH_SECRET` and mints a session for the configured debug viewer.

### Persistence and source of truth

- The active source of truth is server-owned workspace persistence backed by MongoDB through `MongoWorkspaceRecordRepository`.
- Workspace records are stored in the `workspace_records` collection.
- Each record stores the authoritative workspace snapshot plus revision metadata, timestamps, activity events, and command receipts.
- Signed-in users get a home workspace record on first load if one does not already exist.
- Viewer-facing workspace responses are filtered server-side so users only receive boards they can read, plus pending-invite shells where applicable.
- The shipped browser runtime uses `HttpWorkspaceRepository` for normal reads and writes, and `GET /boards` can bootstrap the first workspace payload directly into the HTML response.
- `PUT /api/workspace` replaces the full workspace snapshot with optimistic revision checks.
- `POST /api/workspace/commands` is the main mutation path for workspace title updates, board management, collaboration changes, invite flows, card CRUD, card moves, locale requests, locale review actions, and active-board changes.
- `POST /api/workspace/localizations/generate` and `POST /api/workspace/stage-prompts/run` call OpenAI with a board-scoped API key that is stored in the workspace record after server-side encryption with `KATEI_BOARD_SECRET_ENCRYPTION_KEY`.
- The committed runtime does not read a global `OPENAI_API_KEY` environment variable.
- `POST /api/workspace/import` is an import path that only succeeds while the target server record is still pristine.
- Legacy browser storage still matters only as an import path: when a pristine home workspace loads, the HTTP repository attempts a one-time server import from `localStorage` key prefix `katei.workspace.v4:`.
- `LocalWorkspaceRepository` still exists in the codebase, but the shipped Stimulus workspace controller instantiates `HttpWorkspaceRepository`.

### Boards, cards, localization, and portfolio

- Each workspace starts from the current workspace schema and includes at least one board.
- Default board stages are `backlog`, `doing`, `done`, and `archived`.
- Board definitions include ordered stages, allowed stage transitions, known stage action IDs, templates, collaboration settings, language policy, localization glossary entries, and board-scoped AI settings.
- Board collaboration supports `admin`, `editor`, and `viewer` roles, plus invite create, revoke, accept, decline, role change, self-role assignment, and member removal flows.
- Cards can be created, updated, deleted, moved between stages, and edited per locale.
- Card content is stored in `contentByLocale` rather than a single global title/details pair.
- Cards also support locale requests, human-verification requests, verified review states, AI proposal states, and priority values `urgent`, `important`, and `normal`.
- Board language policy defaults to `en` as source, default, supported, and required locale, but boards can define broader locale sets.
- The Portfolio page is backed by a dedicated Mongo read model and currently includes workspace and board summary counts, board directory search, missing-required-localization views, awaiting-human-verification queues, agent proposal queues, aging sections, workspace creation, workspace title management, and board self-role assignment.

### i18n and generated docs

- Supported UI locales are `en`, `es-CL`, and `ja`.
- UI locale resolution order is `?lang=...`, then the `katei_ui_locale` cookie, then `Accept-Language`, then default `en`.
- UI locale middleware and translation helpers live in `apps/katei/src/middleware/attach_ui_locale.js`, `apps/katei/src/i18n/request_ui_locale.js`, and `apps/katei/public/js/i18n`.
- Generated docs are checked in at `apps/katei/docs/env-inventory.html`, `apps/katei/docs/env-inventory.json`, `apps/katei/docs/filetree.html`, and `apps/katei/docs/filetree.json`.
- The app exposes the HTML reports at `/docs/env-inventory.html` and `/docs/filetree.html`.

## Local Development

Use Node 20 or newer and install dependencies from the repository root:

```bash
npm install
```

Root-level commands:

```bash
npm run dev
npm run start:katei
npm run build
npm run build:katei:css
npm run prepare:subtree:katei
```

- `npm run dev` delegates to the Katei workspace dev server.
- `npm run start:katei` runs the app workspace start script.
- `npm run build`, `npm run build:katei:css`, and `npm run prepare:subtree:katei` currently build CSS only.

App-level commands from `apps/katei`:

```bash
npm run dev
npm start
npm run build:css
npm run build
npm test
```

- `npm run dev` uses `nodemon`, watches `src`, `public/js`, `styles`, and `../../packages/brand/src`, rebuilds CSS, and restarts `node src/server.js`.
- `npm start` runs `node src/server.js`.
- `npm run build:css` writes `public/assets/app.css`.
- `npm run build` is an informational stub and does not produce a separate server or client bundle.
- `npm test` runs the app test suite with `node --test`.

### Environment

Katei reads runtime configuration from `process.env`. `apps/katei/.env.example` is the current reference file, but no dotenv loader is committed in the app runtime.

Required runtime variables:

- `GOOGLE_CLIENT_ID`
- `KATEI_SESSION_SECRET`
- `KATEI_BOARD_SECRET_ENCRYPTION_KEY`
- `MONGODB_URI`
- `MONGODB_DB_NAME`

Optional runtime variables:

- `NODE_ENV`, which defaults to `development`
- `PORT`, which defaults to `3000` locally and must be set explicitly in production-style environments
- `SESSION_TTL_SECONDS`, which defaults to `604800`
- `APP_BASE_URL`, which defaults to `http://localhost:<PORT>` in development and otherwise stays unset
- `GOOGLE_ALLOWLIST_SUBS`, for Google `sub` allowlisting
- `SUPER_ADMINS`, for super-admin email allowlisting
- `KATEI_DEBUG_AUTH_ENABLED`, to enable hosted debug auth
- `KATEI_DEBUG_AUTH_SECRET`, required when hosted debug auth is enabled
- `KATEI_DEBUG_AUTH_VIEWER_SUB`, required when hosted debug auth is enabled
- `KATEI_DEBUG_AUTH_VIEWER_EMAIL`, optional debug viewer email
- `KATEI_DEBUG_AUTH_VIEWER_NAME`, optional debug viewer display name

Deployment automation variables and secrets:

- The GitHub Actions workflow reads repository secret `HEROKU_KATEI_APP_PROD` and exports it to `HEROKU_APP_NAME` during the job.
- The same workflow reads repository secret `HEROKU_API_KEY` and exports it to `HEROKU_API_KEY`.
- `apps/katei/.env.example` includes `HEROKU_APP_NAME` and `HEROKU_API_KEY` placeholders for deploy setup, but `apps/katei/src/config.js` does not read either variable at application runtime.

## Deployment / Runtime

The primary automated deployment path in this repository is `.github/workflows/deploy-katei-heroku.yml`.

That workflow currently:

- runs on pushes to `main` when `apps/katei`, `packages/brand`, the root lockfile/package files, or the deploy workflow change
- can also be started manually with `workflow_dispatch`
- installs monorepo dependencies with `npm ci`
- prebuilds `apps/katei/public/assets/app.css` with `npm run prepare:subtree:katei`
- verifies that the generated CSS artifact exists
- creates a temporary commit if the tracked CSS artifact changed during the build
- splits the `apps/katei` subtree
- archives that subtree into a temporary `deploy-katei` directory
- verifies the target Heroku git remote with `git ls-remote`
- force-pushes the resulting app tree to the target Heroku git remote

Heroku runs the `apps/katei` subtree with:

```Procfile
web: npm start
```

Inside that subtree, `npm start` runs `node src/server.js`.

No Dockerfile, `heroku.yml`, `app.json`, or second automated deployment target is currently committed in this repository.

## Architecture Notes

- `apps/katei/src/app.js` wires JSON and URL-encoded body parsing, cookie parsing, UI locale attachment, static asset serving from `public`, session attachment, and the route tree.
- `apps/katei/src/server.js` creates a Node HTTP server with explicit keep-alive and headers timeouts above Heroku router defaults and installs graceful shutdown handlers for `SIGTERM` and `SIGINT`.
- Pages live under `apps/katei/src/views` and are rendered with Nunjucks. The browser enhancement layer is loaded from `/js/app.js` and registers Stimulus controllers for landing, workspace, board management, session, locale, and portfolio behavior.
- Workspace snapshots are migrated and validated at load and persistence boundaries. The current workspace schema version is `6`.
- The browser registers a service worker and serves an offline fallback page, but workspace interaction still assumes network access for board data and mutations.
- The shipped runtime is a single web process. The data model includes `human`, `agent`, and `system` actors, but this repository does not currently ship WebSocket-based real-time sync, background workers, or a separate agent service.

## Optional Repo-Local Agent Tooling

Repository guidance for Codex lives at `AGENTS.md`. Run repo-local automation from the repository root so the repo-local skills under `.agents/skills` stay in context.

Current repo-local skill docs:

- `.agents/skills/env-inventory/SKILL.md`
- `.agents/skills/katei-auth-debug/SKILL.md`
- `.agents/skills/monorepo-filetree/SKILL.md`

Current generated navigation and inventory artifacts:

- `monorepo-filetree.md`
- `apps/katei/docs/env-inventory.html`
- `apps/katei/docs/env-inventory.json`
- `apps/katei/docs/filetree.html`
- `apps/katei/docs/filetree.json`
