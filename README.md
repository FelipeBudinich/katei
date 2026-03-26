# 過程 (katei)

過程 (katei) is a mobile-first, single-user kanban board built with Express, Nunjucks, Stimulus, and Tailwind CSS v4.

## Setup

```bash
npm install
```

## Run

Development:

```bash
npm run dev
```

Local app start from the monorepo root:

```bash
npm run start:hanmoto
```

App-local runtime start from the deployable subtree:

```bash
cd apps/hanmoto
npm start
```

The app renders at [http://localhost:3000](http://localhost:3000) by default, and `GET /health` returns `{ "ok": true }`.

## Monorepo Layout

- `apps/hanmoto`: the Express app, templates, browser modules, and built assets
- `packages/brand`: shared design tokens and reusable component classes

## Deploy Ownership Boundary

- the monorepo root is orchestration only for local workspace helpers
- `apps/hanmoto` is the Heroku deployable unit and future subtree split prefix
- Heroku runtime artifacts now live inside `apps/hanmoto`, including its `package.json` runtime metadata and `Procfile`

## Hanmoto Subtree Prebuild Contract

`apps/hanmoto/styles/app.css` imports and scans shared sources from `packages/brand`, so the Tailwind build depends on files that do not exist inside an `apps/hanmoto` subtree by itself.

- `packages/brand` remains the source of truth for shared tokens and component styles
- `apps/hanmoto/public/assets/app.css` is the generated deploy artifact that must be present before a subtree split
- runtime only serves the generated artifact at `/assets/app.css`; it does not need Tailwind CLI, `styles/app.css`, or files from `packages/brand`

Before any future subtree deploy, run this from the monorepo root:

```bash
npm run prepare:subtree:hanmoto
```

That command performs only the Hanmoto CSS prebuild and writes the result to:

```text
apps/hanmoto/public/assets/app.css
```

## Subtree Verification

Use this sequence from the monorepo root to verify the friction point is resolved before adding any automation:

`git subtree split` operates on committed history, so run the split after the boundary change and the prebuilt CSS artifact are committed.

```bash
test ! -f Procfile
test -f apps/hanmoto/Procfile
rg -n '"start"|"engines"|"node"' apps/hanmoto/package.json
npm run prepare:subtree:hanmoto
git subtree split --prefix=apps/hanmoto --branch subtree/hanmoto
git show subtree/hanmoto:Procfile
git show subtree/hanmoto:package.json | sed -n '1,20p'
git ls-tree -r --name-only subtree/hanmoto | grep '^public/assets/app.css$'
git show subtree/hanmoto:public/assets/app.css | head
```

Expected result:

- the monorepo root has no `Procfile`
- `apps/hanmoto/Procfile` exists and the split subtree includes it
- `apps/hanmoto/package.json` remains the authoritative runtime manifest with `start` and `engines.node`
- the CSS build succeeds in full monorepo context
- the subtree contains `public/assets/app.css`
- the subtree does not need to rebuild Tailwind from shared monorepo sources

## Storage Swap Notes

The browser UI talks only to `BoardService`, and `BoardService` talks only to the repository contract in [board_repository.js](/Users/Felipe/Documents/hanmoto-board/apps/hanmoto/public/js/repositories/board_repository.js). To swap storage later:

- add `HttpBoardRepository` beside [local_board_repository.js](/Users/Felipe/Documents/hanmoto-board/apps/hanmoto/public/js/repositories/local_board_repository.js)
- add Express API routes for `GET /api/board`, `PUT /api/board`, and `POST /api/board/reset`
- keep the board document shape from [board.js](/Users/Felipe/Documents/hanmoto-board/apps/hanmoto/public/js/domain/board.js) unchanged so it can move to MongoDB later without rewriting the UI
