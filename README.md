# 過程 (katei)

Deliver as one.

Katei is a board-scoped workflow platform that coordinates collaboration among humans and agents.

Complete complex work faster and more reliably in one governed system that unifies process control, accountability, and coordination.

## Product Positioning

Katei ships in this repository as a single web app at `apps/katei` inside an npm workspaces monorepo. The runtime that exists today is an authenticated boards application for human users, with board-level collaboration, localized card content, and server-owned workspace persistence.

The data model records `human`, `agent`, and `system` actors in workspace activity and content provenance. In the shipped runtime, human users sign in with Google, and agent activity appears through server-side OpenAI-backed actions for localization and stage-prompt card generation.

## Current Implemented Scope

### Monorepo and App Location

- Root workspaces are defined in `package.json` as `apps/*` and `packages/*`.
- The current app in `apps/` is `apps/katei`.
- Shared brand CSS lives in `packages/brand` and is imported into `apps/katei/styles/app.css`.

### Runtime Stack

- `apps/katei` is a Node.js 20+ ESM app.
- The server uses Express 5, Nunjucks, `cookie-parser`, `google-auth-library`, and the MongoDB Node driver.
- The browser UI is server-rendered HTML enhanced with Stimulus controllers from `apps/katei/public/js`.
- Tailwind CSS 4 builds `apps/katei/public/assets/app.css`.
- Client-side markdown editing and rendering use vendored EasyMDE, Marked, and DOMPurify assets from `apps/katei/public/vendor`.

### Routes Implemented Today

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

Anonymous requests to `/boards` redirect to `/`. Anonymous requests to authenticated API and logout routes return `401` JSON responses.

### Authentication and Session Behavior

- The landing page loads Google Identity Services and posts the returned credential to `POST /auth/google`.
- Server-side token verification checks the configured `GOOGLE_CLIENT_ID`, accepted issuers `accounts.google.com` and `https://accounts.google.com`, and token expiry.
- Only verified Google emails are copied into the session payload.
- `GOOGLE_ALLOWLIST_SUBS` can restrict access to a comma-separated set of Google `sub` identifiers. If it is unset, any verified token for the configured client ID is accepted.
- If `APP_BASE_URL` is set or implied, sign-in requests with an `Origin` header must match that origin.
- Authenticated users receive a signed HTTP-only `katei_session` cookie with `SameSite=Lax`, path `/`, and `Secure` enabled in production.
- Session lifetime defaults to 7 days and can be overridden with `SESSION_TTL_SECONDS`.
- When debug auth is enabled, `POST /__debug/login` requires the `x-katei-debug-auth` header to match `KATEI_DEBUG_AUTH_SECRET` and mints a session for the configured debug viewer.

### Persistence and Source of Truth

- The active application repository is server-owned and backed by MongoDB through `MongoWorkspaceRecordRepository`.
- Workspace records are stored in the `workspace_records` collection.
- A signed-in viewer gets a home workspace record on first load.
- The browser runtime uses `HttpWorkspaceRepository`, so normal reads and writes go through the server API rather than local storage.
- `PUT /api/workspace` replaces the full workspace snapshot with optimistic revision checks.
- `POST /api/workspace/commands` is the main mutation path for board, card, collaboration, locale, and settings changes.
- `POST /api/workspace/localizations/generate` generates localized card content through OpenAI.
- `POST /api/workspace/stage-prompts/run` generates a new card for a configured target stage through OpenAI.
- `POST /api/workspace/import` is only allowed while the server workspace is still pristine.
- Legacy browser storage is still present as an import path. When a pristine home workspace loads, the HTTP repository checks for older local workspace data and tries a one-time server import.
- `LocalWorkspaceRepository` still exists in the codebase, but it is not the repository wired into the main browser runtime.
- Shared workspace views are filtered by board access, and full snapshot replacement is blocked when the viewer cannot read every board in the target workspace.

### Boards, Cards, Collaboration, and Localization

- A workspace can hold multiple boards.
- Board commands support create, rename, update, reset, delete, and active-board selection.
- Board workflow configuration includes ordered stages, allowed transitions, stage action IDs, and stage-prompt actions.
- Board language policy includes `sourceLocale`, `defaultLocale`, `supportedLocales`, and `requiredLocales`.
- Board collaboration supports `admin`, `editor`, and `viewer` roles, invite-by-email, invite accept/decline/revoke, member role changes, and member removal.
- Cards support create, update, delete, move, markdown details, per-locale content variants, and priorities `urgent`, `important`, and `normal`.
- Locale actions support locale upsert and discard, locale request and clear, human review request, and review verification state.
- Boards can store an encrypted board-scoped OpenAI API key plus a localization glossary.
- Generated localized content and stage-prompt output are recorded with agent provenance.

### UI Locales and Content Locales

- Supported UI locales are `en`, `es-CL`, and `ja`.
- UI locale resolution order is `?lang=...`, then the `katei_ui_locale` cookie, then `Accept-Language`, then default `en`.
- Board content locales are configured per board through each board language policy.

### Generated Docs Assets

- `GET /docs/env-inventory.html` serves `apps/katei/docs/env-inventory.html` when that file exists.
- `GET /docs/filetree.html` serves `apps/katei/docs/filetree.html` when that file exists.
- Generated JSON artifacts are checked in at `apps/katei/docs/env-inventory.json` and `apps/katei/docs/filetree.json`.

## Local Development

Use Node 20 or newer and install dependencies from the repo root:

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

- `npm run dev` runs `apps/katei` in workspace mode.
- `npm run start:katei` starts the app workspace.
- `npm run build`, `npm run build:katei:css`, and `npm run prepare:subtree:katei` currently build CSS only.

App-level scripts from `apps/katei`:

```bash
npm run dev
npm start
npm run build:css
npm run build
npm test
```

- `npm run dev` runs `nodemon`, watches `src`, `public/js`, `styles`, and `packages/brand/src`, rebuilds CSS, and restarts `node src/server.js`.
- `npm start` runs `node src/server.js`.
- `npm run build:css` writes `public/assets/app.css`.
- `npm run build` is an informational stub, not a separate app bundle build.
- `npm test` uses `node --test`.

### Environment

The app reads configuration from `process.env`. `apps/katei/.env.example` is a reference file; the runtime does not automatically load `.env` files.

Required runtime variables:

- `GOOGLE_CLIENT_ID`
- `KATEI_SESSION_SECRET`
- `KATEI_BOARD_SECRET_ENCRYPTION_KEY`
- `MONGODB_URI`
- `MONGODB_DB_NAME`

Optional runtime variables:

- `NODE_ENV` defaults to `development`
- `PORT` defaults to `3000`
- `SESSION_TTL_SECONDS` defaults to `604800`
- `APP_BASE_URL` defaults to `http://localhost:<PORT>` in development when unset
- `GOOGLE_ALLOWLIST_SUBS` for a comma-separated Google `sub` allowlist
- `KATEI_DEBUG_AUTH_ENABLED` to enable hosted debug login
- `KATEI_DEBUG_AUTH_SECRET`, required when debug auth is enabled
- `KATEI_DEBUG_AUTH_VIEWER_SUB`, required when debug auth is enabled
- `KATEI_DEBUG_AUTH_VIEWER_EMAIL`, optional debug viewer email
- `KATEI_DEBUG_AUTH_VIEWER_NAME`, optional debug viewer name

`HEROKU_APP_NAME` and `HEROKU_API_KEY` appear in `apps/katei/.env.example` as deployment-secret placeholders, but they are not runtime variables read by the app server.

## Deployment / Runtime

The primary automated deployment path in this repository is `.github/workflows/deploy-katei-heroku.yml`.

That workflow currently:

- runs on pushes to `main` when relevant `apps/katei`, `packages/brand`, root package manifest, or workflow files change
- can also be triggered manually with `workflow_dispatch`
- uses Node 24 in GitHub Actions
- runs `npm ci`
- prebuilds `apps/katei/public/assets/app.css` with `npm run prepare:subtree:katei`
- verifies that generated CSS exists before deploy
- creates a temporary commit if the CSS build changed tracked output
- splits the `apps/katei` subtree
- archives that subtree into a temporary deploy directory
- force-pushes the deploy tree to the target Heroku git remote

The workflow depends on GitHub Actions secrets `HEROKU_KATEI_APP_PROD` and `HEROKU_API_KEY`.

Heroku runs the `apps/katei` subtree. Its `Procfile` is:

```Procfile
web: npm start
```

`npm start` in that subtree runs `node src/server.js`.

No Dockerfile or second automated deployment target is committed in this repository today.

## Architecture Notes

- `apps/katei/src/app.js` wires Express middleware, cookie parsing, locale/session attachment, static asset serving, and the route tree.
- Views are rendered from `apps/katei/src/views`, with browser enhancement from ES modules in `apps/katei/public/js`.
- The base layout loads `/assets/app.css` and `/js/app.js` directly. There is no separate bundled frontend build step for application JavaScript.
- The workspace page can bootstrap initial state from server-rendered JSON before the browser repository falls back to `/api/workspace`.
- MongoDB is the server persistence layer, with viewer-scoped home workspaces and access-filtered projections for shared workspaces.
- Board-scoped AI features are OpenAI-only in the current runtime. Saved board API keys are encrypted server-side with `KATEI_BOARD_SECRET_ENCRYPTION_KEY`.
- The shipped runtime is a single web process. The data model includes human, agent, and system actors, but the repository does not expose a separate agent runtime, worker process, or real-time sync layer.

## Optional Repo-Local Agent Tooling

Repo-local Codex guidance lives at `AGENTS.md`.

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
☹
