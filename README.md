# 過程 (katei)

Deliver as one.

Katei is a board-scoped workflow platform that coordinates collaboration among humans and agents.

Complete complex work faster and more reliably in one governed system that unifies process control, accountability, and coordination.

## Product Positioning

Katei currently ships in this repository as the web app in `apps/katei`, with shared brand styling in `packages/brand`.

The implemented runtime today is an authenticated boards application for human users. It centers on board-scoped collaboration, structured board workflows, localized card content, and server-owned persistence in MongoDB. The data model records `human`, `agent`, and `system` actors in collaboration and localization provenance, but the sign-in flow shipped here authenticates humans only.

## Current Implemented Scope

### Monorepo and Runtime Stack

- Root `package.json` defines npm workspaces for `apps/*` and `packages/*`.
- The current app shipped under `apps/` is `apps/katei`.
- `apps/katei` is a Node.js 20+ ESM app using Express 5, Nunjucks, `cookie-parser`, `google-auth-library`, the MongoDB Node driver, Stimulus, and Tailwind CSS 4.
- `apps/katei/styles/app.css` imports shared brand CSS from `packages/brand/src/theme.css` and `packages/brand/src/components.css`.

### Routes and Session Gating

Public routes implemented today:

- `GET /`
- `GET /docs/env-inventory.html`
- `GET /docs/filetree.html`
- `GET /health`
- `POST /auth/google`

Authenticated routes implemented today:

- `GET /boards`
- `GET /api/workspace`
- `PUT /api/workspace`
- `POST /api/workspace/commands`
- `POST /api/workspace/localizations/generate`
- `POST /api/workspace/import`
- `POST /auth/logout`

Optional debug route:

- `POST /__debug/login` when `KATEI_DEBUG_AUTH_ENABLED=true` and the request includes the `x-katei-debug-auth` header.

Anonymous requests to `/boards` are redirected to `/`. Anonymous requests to the API and logout endpoints receive `401` JSON responses.

### Authentication and Sessions

- The landing page loads Google Identity Services and posts the returned credential to `POST /auth/google`.
- Server-side verification accepts Google ID tokens for the configured `GOOGLE_CLIENT_ID`, the issuers `accounts.google.com` and `https://accounts.google.com`, and non-expired credentials.
- `GOOGLE_ALLOWLIST_SUBS` can restrict access to a comma-separated set of Google `sub` identifiers. When it is unset, any verified token for the configured client ID is accepted.
- If `APP_BASE_URL` resolves to an origin, sign-in requests with an `Origin` header must match that origin.
- Authenticated viewers receive an HTTP-only `katei_session` cookie with `SameSite=Lax`, path `/`, and `Secure` enabled in production.
- Session lifetime defaults to 7 days and can be overridden with `SESSION_TTL_SECONDS`.
- The session payload stores the viewer `sub` and any available verified `email`, `name`, and `picture`.

### Persistence and Source of Truth

- The default server repository is `MongoWorkspaceRecordRepository`, backed by the MongoDB `workspace_records` collection.
- A viewer home workspace is created on first load. Home workspace IDs use the `workspace_home_<viewer-sub>` pattern.
- Persisted records store the workspace snapshot, optimistic `revision`, timestamps, `lastChangedBy`, recent activity events, and recent command receipts.
- The shipped browser runtime instantiates `HttpWorkspaceRepository`, so the active UI reads and writes through the server API.
- `PUT /api/workspace` replaces a full snapshot with optimistic revision checks.
- `POST /api/workspace/commands` is the main interactive mutation path for boards, cards, collaboration, locale review, and board settings.
- `POST /api/workspace/import` only imports while the server record is still pristine.
- Legacy browser storage still exists as a compatibility/import path. When a pristine home workspace is first loaded, the HTTP repository checks for older local workspace data and attempts a one-time import into the server-owned record.
- `LocalWorkspaceRepository` remains in the codebase, but it is not the repository wired into the main browser runtime.
- Shared workspace projections are filtered by board membership or pending invite state. Whole-workspace replacement is blocked when the viewer cannot read every board in the target workspace.

### Boards, Cards, Collaboration, and Localization

- A new workspace starts with one default board and can hold multiple boards.
- Board commands implemented today include create, update, rename, reset, delete, and active-board switching.
- Board schema editing supports ordered stages, allowed transitions, stage action IDs, and a language policy with `sourceLocale`, `defaultLocale`, `supportedLocales`, and `requiredLocales`.
- Board collaboration supports `admin`, `editor`, and `viewer` roles, invite-by-email, invite accept/decline/revoke, member role changes, and member removal.
- Cards support create, update, delete, move, Markdown details, localized `contentByLocale` variants, and priority values `urgent`, `important`, and `normal`.
- Card locale flows include locale upsert and discard, locale request and clear, human verification request and verify state, and OpenAI-backed locale generation through `POST /api/workspace/localizations/generate`.
- Board editors can store an encrypted board-scoped OpenAI API key and a localization glossary. Generated localized content is recorded with agent provenance and review metadata.
- Markdown authoring and rendering use vendored EasyMDE, Marked, and DOMPurify assets from `apps/katei/public/vendor`.

### i18n

- UI locales defined today are `en`, `es-CL`, and `ja`.
- Request locale resolution order is `?lang=...`, then the `katei_ui_locale` cookie, then `Accept-Language`, then the default locale `en`.
- Board content locales are configured per board through the board language policy rather than a single global content-locale list.

### Generated Docs Assets

- `GET /docs/env-inventory.html` and `GET /docs/filetree.html` serve app-local generated HTML docs when those files exist in `apps/katei/docs/`.
- Machine-readable generated docs are checked in at `apps/katei/docs/env-inventory.json` and `apps/katei/docs/filetree.json`.

## Local Development

Use Node 20 or newer. Install dependencies from the repo root so npm workspaces resolve correctly:

```bash
npm install
```

Root-level scripts:

```bash
npm run dev
npm run start:katei
npm run build
npm run build:katei:css
npm run prepare:subtree:katei
```

`npm run dev` delegates to `apps/katei`. The root `build`, `build:katei:css`, and `prepare:subtree:katei` scripts currently only build CSS.

App-level scripts from `apps/katei`:

```bash
npm run dev
npm start
npm run build:css
npm run build
npm test
```

`npm run dev` in `apps/katei` watches `src`, `public/js`, `styles`, and `packages/brand/src`, rebuilds CSS, and restarts `node src/server.js`. `npm start` runs `node src/server.js`. `npm run build` is currently an informational stub that reminds contributors to prebuild CSS before subtree deploy. `npm test` uses `node --test`.

### Environment

The app does not load `.env` files automatically. Runtime configuration is read directly from `process.env`, and `apps/katei/.env.example` is a reference file rather than a loader.

Required app runtime variables:

- `GOOGLE_CLIENT_ID`
- `KATEI_SESSION_SECRET`
- `KATEI_BOARD_SECRET_ENCRYPTION_KEY`
- `MONGODB_URI`
- `MONGODB_DB_NAME`

Optional app runtime variables:

- `NODE_ENV` defaults to `development`.
- `PORT` defaults to `3000`.
- `SESSION_TTL_SECONDS` defaults to `604800`.
- `APP_BASE_URL` defaults to `http://localhost:<PORT>` in development and is otherwise unset unless provided.
- `GOOGLE_ALLOWLIST_SUBS` may contain a comma-separated Google `sub` allowlist.
- `KATEI_DEBUG_AUTH_ENABLED` defaults to `false`.
- When debug auth is enabled, `KATEI_DEBUG_AUTH_SECRET` and `KATEI_DEBUG_AUTH_VIEWER_SUB` become required.
- `KATEI_DEBUG_AUTH_VIEWER_EMAIL` and `KATEI_DEBUG_AUTH_VIEWER_NAME` are optional debug-session metadata.

`apps/katei/.env.example` also includes placeholder deploy-secret lines, but the server runtime itself does not read `HEROKU_APP_NAME` or `HEROKU_API_KEY`.

## Deployment / Runtime

The primary automated deployment path in this repository is `.github/workflows/deploy-katei-heroku.yml`.

That workflow currently:

- runs on pushes to `main` that touch `apps/katei`, `packages/brand`, the root package manifests, or the workflow file
- can also be triggered manually with `workflow_dispatch`
- uses Node 24 in GitHub Actions
- runs `npm ci`
- prebuilds `apps/katei/public/assets/app.css` with `npm run prepare:subtree:katei`
- verifies that generated CSS exists before deploy
- splits the `apps/katei` subtree
- archives that subtree into a temporary deploy directory
- force-pushes the deploy tree to the target Heroku app git remote

The workflow depends on GitHub Actions secrets `HEROKU_KATEI_APP_PROD` and `HEROKU_API_KEY`.

Heroku runs the `apps/katei` subtree. Its `Procfile` is `web: npm start`, and `npm start` runs `node src/server.js`.

No Dockerfile or second automated deployment target is committed in this repository today.

## Architecture Notes

- `apps/katei/src/app.js` builds the Express app, config loading, JSON and URL-encoded parsing, cookie parsing, locale/session middleware, static asset serving, and the route tree.
- Pages are server-rendered from `apps/katei/src/views/` and then enhanced with browser ES modules from `apps/katei/public/js` via Stimulus. There is no bundled client JavaScript build step in the current runtime.
- The base layout loads `/assets/app.css`, `/js/app.js`, and vendored browser libraries directly.
- Workspace pages can bootstrap initial state from the server-rendered `#workspace-bootstrap` JSON payload before falling back to `/api/workspace`.
- Board-scoped AI localization is OpenAI-only today. The server encrypts saved board API keys with `KATEI_BOARD_SECRET_ENCRYPTION_KEY` and uses `src/ai/openai_localizer.js` when generating localized card content.
- The shipped runtime is a single web process. The data model includes `human`, `agent`, and `system` actors in provenance records, but this repository does not expose a separate agent sign-in path or worker runtime.
- Public generated docs HTML is served by explicit routes from `apps/katei/docs`; the JSON docs are committed for tooling rather than served as public static assets.

## Optional Repo-Local Agent Tooling

Repo-local Codex guidance lives at `AGENTS.md`.

Repo-local skills currently present:

- `.agents/skills/env-inventory/SKILL.md`
- `.agents/skills/katei-auth-debug/SKILL.md`
- `.agents/skills/monorepo-filetree/SKILL.md`

Generated repo-local navigation and inventory artifacts present today:

- `monorepo-filetree.md`
- `apps/katei/docs/env-inventory.html`
- `apps/katei/docs/env-inventory.json`
- `apps/katei/docs/filetree.html`
- `apps/katei/docs/filetree.json`
