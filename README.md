# 過程 (katei)

Deliver as one.

Katei is a board-scoped workflow platform that coordinates collaboration among humans and agents.

Complete complex work faster and more reliably in one governed system that unifies process control, accountability, and coordination.

## Product Positioning

Katei currently ships in this repository as the web app in `apps/katei`, with shared brand styling in `packages/brand`.

The code here implements a private tester preview for authenticated human users: a Google Identity Services landing page, a signed Katei session cookie, an authenticated board workspace at `/boards`, board-scoped collaboration, and MongoDB-backed workspace persistence. The domain model already records `human`, `agent`, and `system` actors in collaboration and localization provenance, but the shipped runtime currently authenticates humans only. No runtime code or deployment path in this repository currently exposes realtime sync, background jobs, scheduled automation, or a separate agent sign-in/runtime flow.

## Current Implemented Scope

### App and Stack

- Root `package.json` defines npm workspaces for `apps/*` and `packages/*`.
- The only app under `apps/` right now is `apps/katei`.
- The Katei app uses Node.js, Express 5, Nunjucks, Stimulus, Tailwind CSS 4, `google-auth-library`, and the MongoDB Node driver.
- Shared visual tokens and components are imported from `packages/brand/src/theme.css` and `packages/brand/src/components.css` into `apps/katei/styles/app.css`.

### Routes

Public routes implemented today:

- `GET /` renders the signed-out landing page and redirects authenticated viewers to `/boards`.
- `GET /docs/env-inventory.html` serves the generated environment inventory HTML when `apps/katei/docs/env-inventory.html` exists.
- `GET /docs/filetree.html` serves the generated file tree HTML when `apps/katei/docs/filetree.html` exists.
- `GET /health` returns `{ "ok": true }`.
- `POST /auth/google` verifies a Google ID token and starts a Katei session.

Session-gated routes implemented today:

- `GET /boards`
- `GET /api/workspace`
- `PUT /api/workspace`
- `POST /api/workspace/commands`
- `POST /api/workspace/import`
- `POST /auth/logout`

Optional debug route:

- `POST /__debug/login` exists only when debug auth is enabled and requires the `x-katei-debug-auth` header.

Anonymous requests to `/boards` are redirected to `/`. Anonymous requests to `/api/*` and `POST /auth/logout` receive a `401` JSON response. The boards page and the workspace API can target an accessible shared workspace by `workspaceId`; without that parameter, the viewer's home workspace is loaded or created.

### Authentication and Sessions

- The landing page loads the Google Identity Services browser script and posts the returned credential to `POST /auth/google`.
- Server-side token verification accepts only Google ID tokens for `GOOGLE_CLIENT_ID`, the allowed issuers `accounts.google.com` and `https://accounts.google.com`, and non-expired credentials.
- `GOOGLE_ALLOWLIST_SUBS` is an optional comma-separated allowlist of Google `sub` identifiers. If it is unset, any token that passes the audience, issuer, expiry, and origin checks is accepted.
- When `APP_BASE_URL` resolves to an origin, `POST /auth/google` rejects requests whose `Origin` header does not match that origin.
- The `katei_session` cookie is HTTP-only, `SameSite=Lax`, scoped to `/`, marked `Secure` in production, and defaults to a 7-day TTL unless `SESSION_TTL_SECONDS` overrides it.
- The session payload stores the viewer `sub`, issue and expiry timestamps, and any available `email`, `name`, and `picture` fields.

### Persistence and Collaboration Model

- The server creates a `MongoWorkspaceRecordRepository` by default and persists records in the MongoDB `workspace_records` collection.
- A viewer's home workspace is created on first authenticated load. Home workspace IDs use the `workspace_home_<google-sub>` pattern.
- Each persisted workspace record stores the workspace snapshot, revision, timestamps, `lastChangedBy`, recent activity events, and recent command receipts.
- The active browser repository is `HttpWorkspaceRepository`, so `/api/workspace*` is the live source of truth for the UI.
- `PUT /api/workspace` replaces a full workspace snapshot with optimistic revision checks.
- `POST /api/workspace/commands` is the main interactive write path for board, card, locale, and collaboration mutations.
- `POST /api/workspace/import` imports a full snapshot only while the server record is still pristine.
- The browser still contains a legacy local import path: when a pristine home workspace is first loaded, the HTTP repository checks for older local workspace data and tries a one-time import into the server-owned record.
- `LocalWorkspaceRepository` remains in the codebase, but it is not the repository wired into the main browser runtime.
- Shared workspace projections are filtered by board membership or pending invite state, and full snapshot replacement is blocked when the viewer cannot read the entire workspace.

### Boards, Cards, and Locales

- Workspaces are multi-board. The default initial workspace contains one default board.
- Implemented board actions include create, update, rename, reset, delete, and switch-active-board flows.
- The current board editor covers ordered stages, allowed stage transitions, stage action IDs, and a board language policy with `sourceLocale`, `defaultLocale`, `supportedLocales`, and `requiredLocales`.
- Board collaboration currently supports `admin`, `editor`, and `viewer` roles, invite-by-email flows, invite accept/decline/revoke, member role changes, and member removal.
- Cards support create, update, move, view, and delete flows, priority values `urgent`, `important`, and `normal`, Markdown details, and localized `contentByLocale` variants.
- Card localization flows currently include locale upsert, locale request, and locale request clear operations, plus provenance metadata for `human`, `agent`, and `system` actors.
- The workspace page loads vendored EasyMDE, Marked, and DOMPurify assets from `apps/katei/public/vendor` for Markdown authoring and rendering.
- UI locales implemented today are `en`, `es-CL`, and `ja`.
- UI locale resolution order is `?lang=...`, then the `katei_ui_locale` cookie, then `Accept-Language`, then the default locale `en`.

## Local Development

Use Node 20 or newer. Install dependencies from the repo root so npm workspaces are available:

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

`npm run dev` forwards to the Katei app workspace. `npm run build`, `npm run build:katei:css`, and `npm run prepare:subtree:katei` only build CSS.

App-level scripts from `apps/katei`:

```bash
npm run dev
npm start
npm run build:css
npm run build
npm test
```

`npm run dev` in `apps/katei` uses `nodemon` to watch `src`, `public/js`, `styles`, and `packages/brand/src`, rebuild CSS, and restart `node src/server.js`.

There is no separate JavaScript bundle build in the current app. The active build step is CSS compilation to `apps/katei/public/assets/app.css`; the app-level `npm run build` script is only an informational stub.

### Environment

Required runtime variables:

- `GOOGLE_CLIENT_ID`
- `KATEI_SESSION_SECRET`
- `MONGODB_URI`
- `MONGODB_DB_NAME`

Optional runtime variables:

- `NODE_ENV` defaults to `development`.
- `PORT` defaults to `3000`.
- `SESSION_TTL_SECONDS` defaults to `604800`.
- `APP_BASE_URL` defaults to `http://localhost:<PORT>` in development and is otherwise unset unless provided.
- `GOOGLE_ALLOWLIST_SUBS` may contain a comma-separated allowlist of Google `sub` identifiers.
- `KATEI_DEBUG_AUTH_ENABLED` defaults to `false`; when set to `true`, `POST /__debug/login` is enabled for hosted debugging.
- `KATEI_DEBUG_AUTH_SECRET` is required when hosted debug auth is enabled and must match the `x-katei-debug-auth` request header.
- `KATEI_DEBUG_AUTH_VIEWER_SUB` is required when hosted debug auth is enabled and selects the single debug viewer session identity.
- `KATEI_DEBUG_AUTH_VIEWER_EMAIL` and `KATEI_DEBUG_AUTH_VIEWER_NAME` are optional metadata included in the debug viewer session.

`apps/katei/.env.example` documents the current variables, but the running app does not load `.env` files automatically. Configuration is read directly from `process.env`.

Deployment automation uses GitHub Actions secrets rather than app runtime variables:

- `HEROKU_KATEI_APP_PROD`
- `HEROKU_API_KEY`

Committed generated env inventory artifacts for the app:

- `apps/katei/docs/env-inventory.json`
- `apps/katei/docs/env-inventory.html`

## Deployment / Runtime

The primary automated deployment path in this repository is `.github/workflows/deploy-katei-heroku.yml`.

That workflow currently:

- runs on pushes to `main` that touch `apps/katei`, `packages/brand`, the root package manifests, or the deploy workflow itself
- can also be started manually with `workflow_dispatch`
- uses Node 24 in GitHub Actions
- installs monorepo dependencies with `npm ci`
- prebuilds `apps/katei/public/assets/app.css` with `npm run prepare:subtree:katei`
- verifies that generated CSS exists before deploy
- splits the `apps/katei` subtree
- archives that subtree into a temporary deploy directory
- force-pushes the deploy tree to the target Heroku app git remote

The Heroku runtime unit is the `apps/katei` subtree. Its `Procfile` is:

```Procfile
web: npm start
```

Inside that subtree, `npm start` runs `node src/server.js`.

No Dockerfile or second automated deployment target is committed in this repository today.

## Architecture Notes

- `apps/katei/src/app.js` builds the Express app, Nunjucks views, locale/session middleware, static asset serving, and the route tree.
- Pages are server-rendered first from Nunjucks templates under `apps/katei/src/views/` and then enhanced with browser ES modules served directly from `apps/katei/public/js`; there is no client bundling step in the current runtime.
- The landing page loads Google Identity Services in the browser and posts credentials to `/auth/google`, while the server verifies the ID token with `google-auth-library`.
- The workspace page can bootstrap its initial state from the server-rendered `#workspace-bootstrap` JSON payload before falling back to `/api/workspace`.
- Static runtime assets are served from `apps/katei/public`. Generated docs HTML is served by explicit routes from `apps/katei/docs`.
- The boards runtime instantiates `HttpWorkspaceRepository` in `apps/katei/public/js/controllers/workspace_controller.js`, so the live source of truth is the server API, not browser storage.
- Server persistence lives in MongoDB collection `workspace_records` through `MongoWorkspaceRecordRepository`.
- `POST /api/workspace/commands` is the main write path for the interactive UI. `PUT /api/workspace` supports whole-workspace replacement with revision checks, and `POST /api/workspace/import` imports a full snapshot only while the server record is still pristine.
- Workspace writes use optimistic concurrency with `expectedRevision`, and command writes are deduplicated by recent `clientMutationId` receipts stored on the server.
- Browser storage still exists only as compatibility code. The shipped HTTP repository looks for legacy local workspace data when a pristine home workspace is loaded; `LocalWorkspaceRepository` remains in the codebase but is not the active runtime repository.
- Shared workspace projections are filtered by board membership or pending invite state. Full snapshot replacement is blocked when the viewer cannot see the entire workspace.
- The domain model already recognizes `human`, `agent`, and `system` actors in collaboration and localized-content provenance records, but the shipped runtime authenticates humans only and exposes no separate agent runtime.

## Optional Repo-Local Agent Tooling

This repository includes repo-local Codex guidance in `AGENTS.md` and three repo-local skills under `.agents/skills/`:

- `env-inventory` at `.agents/skills/env-inventory/SKILL.md`
- `katei-auth-debug` at `.agents/skills/katei-auth-debug/SKILL.md`
- `monorepo-filetree` at `.agents/skills/monorepo-filetree/SKILL.md`

Committed generated navigation and inventory docs currently present in the repo include:

- `monorepo-filetree.md`
- `apps/katei/docs/env-inventory.html`
- `apps/katei/docs/env-inventory.json`
- `apps/katei/docs/filetree.html`
- `apps/katei/docs/filetree.json`
:-)
