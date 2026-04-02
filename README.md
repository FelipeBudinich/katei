# 過程 (katei)

Deliver as one.

Katei is a board-scoped workflow platform that coordinates collaboration among humans and agents.

Complete complex work faster and more reliably in one governed system that unifies process control, accountability, and coordination.

## Product Positioning

Katei currently ships in this monorepo as the web app at `apps/katei`. The implemented product in this repository is a private tester preview of an authenticated board workspace: a verified Google account can sign in, receive a signed Katei session, and work inside a persisted home workspace that can also load accessible shared workspaces by `workspaceId`.

Today’s runtime is centered on board execution and board-scoped collaboration. It does not currently ship realtime sync, background jobs, scheduled automation, agent sign-in, or public agent execution routes.

## Current Implemented Scope

- Monorepo layout: the deployable app lives in `apps/katei`, and shared brand CSS source lives in `packages/brand`.
- Runtime stack: Node.js, Express 5, Nunjucks, Stimulus, Tailwind CSS 4, Google Identity Services on the landing page, `google-auth-library` for server-side token verification, and MongoDB-backed workspace persistence.
- Public routes implemented today: `GET /`, `GET /docs/env-inventory.html`, `GET /docs/filetree.html`, and `GET /health`.
- Auth routes implemented today: `POST /auth/google` verifies a Google ID token server-side and sets a signed Katei session cookie; `POST /auth/logout` clears that cookie.
- Route behavior: `GET /` renders the landing page for signed-out visitors and redirects authenticated sessions to `/boards`. `GET /boards` requires a session and redirects anonymous requests back to `/`.
- Session behavior: the `katei_session` cookie is HTTP-only, `SameSite=Lax`, scoped to `/`, marked `Secure` in production, and defaults to a 7-day TTL unless `SESSION_TTL_SECONDS` overrides it.
- Access control: if `GOOGLE_ALLOWLIST_SUBS` is blank, any verified Google account may sign in; if it contains comma-separated Google `sub` values, only those accounts are admitted.
- Origin checks: when `APP_BASE_URL` resolves to an origin, `/auth/google` rejects requests whose `Origin` header does not match that origin.
- Authenticated workspace routes implemented today: `GET /boards`, `GET /api/workspace`, `PUT /api/workspace`, `POST /api/workspace/commands`, and `POST /api/workspace/import`.
- Workspace model: each signed-in Google `sub` gets a persisted home workspace record, and the same runtime can load other accessible workspaces by `workspaceId`. Persisted records track the workspace snapshot, revision, timestamps, `lastChangedBy`, recent activity events, and recent command receipts.
- Board capabilities implemented today: create, rename, edit, reset, delete, and switch boards; editable board schemas with ordered stages, allowed transitions, templates, and board language policy.
- Collaboration capabilities implemented today: board-scoped memberships with `admin`, `editor`, and `viewer` roles; invite, revoke, accept, decline, role-change, and member-removal flows backed by the commands API and the boards UI.
- Card capabilities implemented today: create, edit, move, view, and delete cards; priority handling; localized `contentByLocale` variants; locale request and clear flows; and rendered Markdown details.
- Markdown/runtime assets: `/boards` loads vendored EasyMDE, Marked, and DOMPurify assets from `apps/katei/public/vendor`.
- UI locales implemented today: `en`, `es-CL`, and `ja`.
- UI locale resolution: `?lang=` query parameter first, then the `katei_ui_locale` cookie, then `Accept-Language`, then the default locale `en`.

## Local Development

Use Node 20 or newer. Install dependencies from the repo root so npm workspaces are available:

```bash
npm install
```

The app reads configuration directly from `process.env`. `apps/katei/.env.example` documents the current variables, but the committed runtime does not load `.env` files automatically.

Root-level scripts:

```bash
npm run dev
npm run start:katei
npm run build
npm run build:katei:css
npm run prepare:subtree:katei
```

App-level scripts from `apps/katei`:

```bash
npm run dev
npm start
npm run build:css
npm test
```

There is no separate JavaScript bundle build in the current app. The active build step is CSS compilation to `apps/katei/public/assets/app.css`; the app-level `npm run build` script is only an informational stub.

Required runtime variables:

- `GOOGLE_CLIENT_ID`
- `KATEI_SESSION_SECRET`

Required for persisted boards and workspace APIs:

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

Deployment workflow variables:

- `HEROKU_APP_NAME` and `HEROKU_API_KEY` appear in `apps/katei/.env.example` and `apps/katei/docs/env-inventory.html`, but the running app code does not read them.
- The deploy workflow uses GitHub repository secrets `HEROKU_KATEI_APP_PROD` and `HEROKU_API_KEY`.

Human-readable generated docs already present in the repo:

- `apps/katei/docs/env-inventory.html`
- `apps/katei/docs/filetree.html`

## Deployment / Runtime

The primary automated deployment path in this repository is `.github/workflows/deploy-katei-heroku.yml`.

That workflow currently:

- runs on pushes to `main` that touch `apps/katei`, `packages/brand`, the root package manifests, or the deploy workflow itself
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
- The UI is server-rendered first and then enhanced with browser ES modules served directly from `apps/katei/public/js`; there is no client bundling step in the current runtime.
- The landing page loads Google Identity Services in the browser and posts credentials to `/auth/google`, while the server verifies the ID token with `google-auth-library`.
- The boards runtime instantiates `HttpWorkspaceRepository` in `apps/katei/public/js/controllers/workspace_controller.js`, so the live source of truth is the server API, not browser storage.
- Server persistence lives in MongoDB collection `workspace_records` through `MongoWorkspaceRecordRepository`.
- `POST /api/workspace/commands` is the main write path for the interactive UI. `PUT /api/workspace` supports whole-workspace replacement with revision checks, and `POST /api/workspace/import` imports a full snapshot only while the server record is still pristine.
- Browser storage still exists, but only as compatibility code. The shipped HTTP repository looks for legacy `katei.workspace.v4:<sub>` data and imports it into a pristine server workspace; `LocalWorkspaceRepository` with `katei.workspace.v5:<sub>` remains in the codebase but is not the active runtime repository.
- Shared workspace projections are filtered by board membership or pending invite state. Full snapshot replacement is blocked when the viewer cannot see the entire workspace.
- The domain model already recognizes `human`, `agent`, and `system` actors in collaboration and localized-content provenance records, but the shipped runtime authenticates humans only and exposes no separate agent runtime.

## Optional Repo-Local Agent Tooling

This repository includes repo-local Codex guidance in `AGENTS.md` and three repo-local skills under `.agents/skills/`:

- `env-inventory` at `.agents/skills/env-inventory/SKILL.md`
- `katei-auth-debug` at `.agents/skills/katei-auth-debug/SKILL.md`
- `monorepo-filetree` at `.agents/skills/monorepo-filetree/SKILL.md`

Generated navigation and inventory docs currently present in the repo include:

- `monorepo-filetree.md`
- `apps/katei/docs/env-inventory.html`
- `apps/katei/docs/env-inventory.json`
- `apps/katei/docs/filetree.html`
- `apps/katei/docs/filetree.json`
