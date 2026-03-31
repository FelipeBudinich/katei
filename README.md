# 過程 (katei)

Deliver as one.

Katei is a board-scoped workflow platform that coordinates collaboration among humans and agents.

Complete complex work faster and more reliably in one governed system that unifies process control, accountability, and coordination.

## Product Positioning

Katei currently ships in this monorepo as the app at `apps/katei`. The implemented product is a private tester preview of an authenticated board workspace: each verified Google account gets its own persisted workspace, and each workspace can hold multiple boards.

The current shipped web app is centered on per-user board operations rather than shared multi-user execution. The runtime in this repository does not expose shared board membership, realtime sync, background jobs, or in-app agent execution routes.

## Current Implemented Scope

- Monorepo layout: the deployable app lives in `apps/katei`, and shared styling source lives in `packages/brand`.
- Runtime stack: Node.js, Express 5, Nunjucks, Stimulus, Tailwind CSS v4, Google Identity Services, `google-auth-library`, and MongoDB-backed workspace persistence.
- Public routes implemented today: `GET /`, `GET /docs/env-inventory.html`, `GET /docs/filetree.html`, and `GET /health`.
- Auth routes implemented today: `POST /auth/google` verifies a Google ID token server-side and creates a signed Katei session cookie; `POST /auth/logout` clears that cookie.
- Route behavior: `GET /` renders the landing page for signed-out visitors and redirects to `/boards` when a valid Katei session is already present. `GET /boards` requires a session and redirects back to `/` when one is missing.
- Session behavior: the `katei_session` cookie is HTTP-only, `SameSite=Lax`, scoped to `/`, `Secure` in production, and defaults to a 7-day TTL unless `SESSION_TTL_SECONDS` overrides it.
- Access control: if `GOOGLE_ALLOWLIST_SUBS` is blank, any verified Google account may sign in; if it contains comma-separated Google `sub` values, only those accounts are admitted.
- Origin checks: when `APP_BASE_URL` is set, sign-in requests are accepted only when the request `Origin` matches that configured app origin.
- Authenticated routes implemented today: `GET /boards`, `GET /api/workspace`, `PUT /api/workspace`, `POST /api/workspace/commands`, and `POST /api/workspace/import`.
- Workspace model: each signed-in Google `sub` gets one server-owned workspace record. The workspace starts with a default board and supports switching, creating, editing, resetting, and deleting boards from the web UI.
- Board model: boards are not fixed to four hard-coded columns anymore. Each board stores its own ordered stages, allowed stage transitions, templates, and language policy (`sourceLocale`, `defaultLocale`, `supportedLocales`, `requiredLocales`).
- Card model: cards store priority, timestamps, and localized `contentByLocale` variants with provenance metadata. The current UI supports creating, editing, viewing, moving, and deleting cards.
- Markdown support: card details are edited with EasyMDE and rendered with Marked plus DOMPurify.
- UI locales implemented today: `en`, `es-CL`, and `ja`.
- UI locale resolution: `?lang=` query parameter first, then the `katei_ui_locale` cookie, then `Accept-Language`, then the default locale `en`.

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

App-level scripts from `apps/katei`:

```bash
npm run dev
npm start
npm run build:css
npm test
```

Runtime environment is documented in `apps/katei/.env.example` and `apps/katei/docs/env-inventory.html`.

Required for the authenticated workspace experience:

- `GOOGLE_CLIENT_ID`
- `KATEI_SESSION_SECRET`
- `MONGODB_URI`
- `MONGODB_DB_NAME`

Optional runtime variables:

- `GOOGLE_ALLOWLIST_SUBS`
- `SESSION_TTL_SECONDS` (defaults to `604800`)
- `APP_BASE_URL` (defaults to `http://localhost:<PORT>` in development and is the origin check anchor outside development)
- `PORT` (defaults to `3000`)
- `NODE_ENV` (defaults to `development`)

Deployment-related values also appear in `apps/katei/.env.example`, but the running app code does not read `HEROKU_APP_NAME` or `HEROKU_API_KEY`.

## Deployment / Runtime

The primary automated deployment path in this repository is `.github/workflows/deploy-katei-heroku.yml`.

That workflow currently:

- runs on pushes to `main` that touch `apps/katei`, `packages/brand`, the root package manifests, or the deploy workflow itself
- installs monorepo dependencies with `npm ci`
- prebuilds `apps/katei/public/assets/app.css` with `npm run prepare:subtree:katei`
- splits the `apps/katei` subtree
- archives that subtree into a temporary deploy directory
- force-pushes the deploy tree to the target Heroku app git remote

The Heroku runtime unit is the `apps/katei` subtree. Its `Procfile` is:

```Procfile
web: npm start
```

The deploy workflow expects GitHub repository secrets for the target Heroku app name and API key. The workflow reads `HEROKU_KATEI_APP_PROD` and `HEROKU_API_KEY` from GitHub Actions secrets; those are separate from the app's runtime environment variables.

## Architecture Notes

- Katei is a server-rendered web app. `src/app.js` wires Express middleware, Nunjucks views, static assets, locale/session middleware, and the route tree.
- The browser layer is served as ES modules from `apps/katei/public/js`; there is no separate JavaScript bundling step in the current app runtime.
- `GET /boards` renders the initial workspace HTML and embeds a `workspace-bootstrap` JSON payload when a workspace record is available.
- The shipped UI uses `HttpWorkspaceRepository` from `public/js/repositories/http_workspace_repository.js`, so the source of truth today is server-owned persistence, not browser storage.
- Server persistence lives in MongoDB collection `workspace_records`. Each record is keyed by the verified Google `sub` and stores the workspace snapshot, revision, timestamps, `lastChangedBy`, activity events, and command receipts.
- `POST /api/workspace/commands` is the main write path used by the current UI. `PUT /api/workspace` also exists for whole-workspace replacement with revision checking.
- Browser storage still exists in the codebase, but not as the primary runtime store. `LocalWorkspaceRepository` writes `katei.workspace.v5:<sub>`, while the shipped HTTP repository only uses browser storage to look for legacy `katei.workspace.v4:<sub>` data and import it through `POST /api/workspace/import` when the server workspace is still pristine.
- Shared brand styles live in `packages/brand/src/theme.css` and `packages/brand/src/components.css`; deploy preparation prebuilds the resulting CSS into `apps/katei/public/assets/app.css`.

## Optional Repo-Local Agent Tooling

This repository includes repo-local Codex guidance in `AGENTS.md` and two repo-local skills under `.agents/skills/`:

- `env-inventory` at `.agents/skills/env-inventory/SKILL.md`
- `monorepo-filetree` at `.agents/skills/monorepo-filetree/SKILL.md`

Generated navigation and environment docs currently present in the repo include:

- `monorepo-filetree.md`
- `apps/katei/docs/env-inventory.html`
- `apps/katei/docs/env-inventory.json`
- `apps/katei/docs/filetree.html`
- `apps/katei/docs/filetree.json`
