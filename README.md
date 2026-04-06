# 過程 (katei)

Deliver as one.

Katei is a board-scoped workflow platform that coordinates collaboration among humans and agents.

Complete complex work faster and more reliably in one governed system that unifies process control, accountability, and coordination.

## Product Positioning

Katei currently ships in this repository as a single web app at `apps/katei` inside an npm workspaces monorepo. The runtime that exists today is a Google-authenticated boards application with server-owned workspaces, board-scoped sharing, localized card content, and board-scoped OpenAI actions for localization and stage-prompt card generation.

The implementation is concrete and narrow: one Node web process, one MongoDB-backed workspace store, one browser client enhanced with Stimulus, and one current deployment workflow that publishes the `apps/katei` subtree to Heroku.

## Current Implemented Scope

### Monorepo and app location

- Root workspaces are defined in `package.json` as `apps/*` and `packages/*`.
- The current application lives at `apps/katei`.
- Shared brand CSS lives at `packages/brand` and is imported from `apps/katei/styles/app.css`.

### Runtime stack

- `apps/katei` is an ESM Node app with `engines.node >=20`.
- The server uses Express 5, Nunjucks, `cookie-parser`, `google-auth-library`, and the MongoDB Node driver.
- The browser UI is server-rendered HTML enhanced with Stimulus controllers loaded from `apps/katei/public/js`.
- Tailwind CSS 4 builds `apps/katei/public/assets/app.css`.
- Workspace editing uses vendored EasyMDE, Marked, and DOMPurify assets from `apps/katei/public/vendor`.

### Routes implemented today

Public routes:

- `GET /`
- `GET /docs/env-inventory.html`
- `GET /docs/filetree.html`
- `GET /health`
- `POST /auth/google`

Authenticated routes:

- `GET /boards`
- `GET /api/workspace`
- `PUT /api/workspace`
- `POST /api/workspace/commands`
- `POST /api/workspace/localizations/generate`
- `POST /api/workspace/stage-prompts/run`
- `POST /api/workspace/import`
- `POST /auth/logout`

Optional debug route:

- `POST /__debug/login` when `KATEI_DEBUG_AUTH_ENABLED=true`

Unauthenticated browser requests to `/boards` redirect to `/`. Unauthenticated API and logout requests return `401` JSON responses.

### Authentication and session behavior

- The landing page loads Google Identity Services from `https://accounts.google.com/gsi/client` and posts the returned credential to `POST /auth/google`.
- Google token verification is server-side and checks the configured `GOOGLE_CLIENT_ID`, accepted issuers `accounts.google.com` and `https://accounts.google.com`, and token expiry.
- Only verified Google email addresses are copied into the session payload.
- `GOOGLE_ALLOWLIST_SUBS` optionally restricts sign-in to a comma-separated allowlist of Google `sub` identifiers. If it is unset or blank, any verified token for the configured client ID is allowed.
- If `APP_BASE_URL` is set, or implied by development defaults, sign-in requests with an `Origin` header must match that origin.
- Authenticated users receive a signed HTTP-only `katei_session` cookie with `SameSite=Lax`, path `/`, and `Secure` enabled in production.
- Session lifetime defaults to 7 days and can be overridden with `SESSION_TTL_SECONDS`.
- Hosted debug login is disabled by default. When enabled, `POST /__debug/login` requires the `x-katei-debug-auth` header to match `KATEI_DEBUG_AUTH_SECRET` and mints a session for the configured debug viewer.

### Persistence and source of truth

- The active source of truth is server-owned workspace persistence backed by MongoDB through `MongoWorkspaceRecordRepository`.
- Workspace records are stored in the `workspace_records` collection.
- Signed-in users get a home workspace record on first load if one does not already exist.
- The browser runtime wires `HttpWorkspaceRepository` into the main workspace controller, so normal reads and writes go through the server API.
- `GET /boards` bootstraps the current workspace into the HTML response, and the browser repository can fall back to `GET /api/workspace`.
- `PUT /api/workspace` replaces the full workspace snapshot with optimistic revision checks.
- `POST /api/workspace/commands` is the main mutation path for board, collaboration, and card commands.
- `POST /api/workspace/localizations/generate` generates localized card content through OpenAI.
- `POST /api/workspace/stage-prompts/run` generates exactly one new card through OpenAI for a configured target stage.
- `POST /api/workspace/import` is an import path that rejects non-pristine server records.
- The browser still contains a legacy import path from local storage. When a pristine home workspace loads, `HttpWorkspaceRepository` checks for legacy `katei.workspace.v4:` data and tries a one-time server import.
- `LocalWorkspaceRepository` still exists in the codebase, but it is not the repository used by the shipped browser runtime.
- Shared workspace projections are filtered by board access, and full snapshot replacement is blocked when the current viewer cannot read every board in the target workspace.

### Boards, cards, collaboration, and AI-assisted workflows

- A workspace can contain multiple boards.
- Boards can be created, renamed, updated, reset, deleted, and switched.
- Board schema currently includes language policy, ordered stages, allowed transition stage IDs, stage action IDs, optional stage prompt actions, and templates.
- Board language policy includes `sourceLocale`, `defaultLocale`, `supportedLocales`, and `requiredLocales`.
- Board collaboration supports `admin`, `editor`, and `viewer` roles, plus invite create, revoke, accept, decline, role change, and member removal flows.
- Cards can be created, updated, deleted, moved between stages, and rendered with title, markdown details, and priority (`urgent`, `important`, `normal`).
- Cards can store localized content variants, locale requests, review requests, and verification state.
- Boards can store an encrypted board-scoped OpenAI API key and a localization glossary.
- Generated localization and stage-prompt output are saved with agent provenance in the workspace data model.

### UI locales and generated docs

- Supported UI locales are `en`, `es-CL`, and `ja`.
- UI locale resolution order is `?lang=...`, then the `katei_ui_locale` cookie, then `Accept-Language`, then default `en`.
- Generated docs are currently checked in at `apps/katei/docs/env-inventory.html`.
- Generated docs are currently checked in at `apps/katei/docs/env-inventory.json`.
- Generated docs are currently checked in at `apps/katei/docs/filetree.html`.
- Generated docs are currently checked in at `apps/katei/docs/filetree.json`.
- The public app serves the checked-in HTML docs at `/docs/env-inventory.html` and `/docs/filetree.html`.

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

- `npm run dev` delegates to `apps/katei`.
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
- `npm run build` is an informational stub and does not create a separate server or client bundle.
- `npm test` runs the app test suite with `node --test`.

### Environment

Configuration is read from `process.env`. `apps/katei/.env.example` is a reference file, but the app code itself does not load `.env` files automatically.

Required application runtime variables:

- `GOOGLE_CLIENT_ID`
- `KATEI_SESSION_SECRET`
- `KATEI_BOARD_SECRET_ENCRYPTION_KEY`
- `MONGODB_URI`
- `MONGODB_DB_NAME`

Optional application runtime variables:

- `NODE_ENV` defaults to `development`
- `PORT` defaults to `3000`
- `SESSION_TTL_SECONDS` defaults to `604800`
- `APP_BASE_URL` defaults to `http://localhost:<PORT>` in development when unset
- `GOOGLE_ALLOWLIST_SUBS` for a comma-separated Google `sub` allowlist
- `KATEI_DEBUG_AUTH_ENABLED` to enable hosted debug login
- `KATEI_DEBUG_AUTH_SECRET`, required when hosted debug auth is enabled
- `KATEI_DEBUG_AUTH_VIEWER_SUB`, required when hosted debug auth is enabled
- `KATEI_DEBUG_AUTH_VIEWER_EMAIL`, optional debug viewer email
- `KATEI_DEBUG_AUTH_VIEWER_NAME`, optional debug viewer name

Deployment-only secrets referenced by repository automation:

- GitHub Actions secret `HEROKU_KATEI_APP_PROD`
- GitHub Actions secret `HEROKU_API_KEY`

The example env file also includes `HEROKU_APP_NAME` and `HEROKU_API_KEY` placeholders for deploy setup, but those are not application runtime variables read by `apps/katei/src/config.js`.

## Deployment / Runtime

The primary automated deployment path in this repository is `.github/workflows/deploy-katei-heroku.yml`.

That workflow:

- runs on pushes to `main` when relevant app, package, or deploy files change
- can also be started manually with `workflow_dispatch`
- installs dependencies with `npm ci`
- prebuilds `apps/katei/public/assets/app.css` by running `npm run prepare:subtree:katei`
- verifies that the generated CSS file exists
- creates a temporary commit if the tracked CSS artifact changed
- splits the `apps/katei` subtree
- archives the subtree into a temporary deploy directory
- force-pushes the resulting app tree to the target Heroku git remote

Heroku runs the `apps/katei` subtree with:

```Procfile
web: npm start
```

Inside that subtree, `npm start` runs `node src/server.js`.

No Dockerfile or second automated deployment target is committed in this repository today.

## Architecture Notes

- `apps/katei/src/app.js` wires JSON and URL-encoded parsing, cookie parsing, UI locale middleware, session attachment, static asset serving, and the full route tree.
- Pages are rendered from `apps/katei/src/views` with Nunjucks, then enhanced in the browser by unbundled ES modules loaded from `/js/app.js`.
- The workspace page can bootstrap server-projected state into the DOM through `#workspace-bootstrap` before the client repository falls back to JSON API reads.
- Workspace snapshots are migrated and validated at load and persistence boundaries.
- MongoDB persistence stores revisioned workspace records, activity events, and command receipts.
- Viewer-facing workspace projections are filtered at board scope, so shared users only receive boards they can read or pending-invite shells they can act on.
- Board-scoped AI features currently use the OpenAI Responses API only. Saved board API keys are encrypted server-side with `KATEI_BOARD_SECRET_ENCRYPTION_KEY`.
- The shipped runtime is a single web process. The data model includes `human`, `agent`, and `system` actors, but this repository does not currently ship real-time sync, background workers, or a separate agent runtime.

## Optional Repo-Local Agent Tooling

Repository guidance for Codex lives at `AGENTS.md`.

Current repo-local skills:

- `.agents/skills/env-inventory/SKILL.md`
- `.agents/skills/katei-auth-debug/SKILL.md`
- `.agents/skills/monorepo-filetree/SKILL.md`

Current generated navigation and inventory artifacts:

- `monorepo-filetree.md`
- `apps/katei/docs/env-inventory.html`
- `apps/katei/docs/env-inventory.json`
- `apps/katei/docs/filetree.html`
- `apps/katei/docs/filetree.json`
