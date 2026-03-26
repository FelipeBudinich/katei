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

Production-style start:

```bash
npm start
```

The app renders at [http://localhost:3000](http://localhost:3000) by default, and `GET /health` returns `{ "ok": true }`.

## Monorepo Layout

- `apps/hanmoto`: the Express app, templates, browser modules, and built assets
- `packages/brand`: shared design tokens and reusable component classes

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

```bash
npm run prepare:subtree:hanmoto
git subtree split --prefix=apps/hanmoto --branch subtree/hanmoto
git ls-tree -r --name-only subtree/hanmoto | grep '^public/assets/app.css$'
git show subtree/hanmoto:public/assets/app.css | head
```

Expected result:

- the CSS build succeeds in full monorepo context
- the subtree contains `public/assets/app.css`
- the subtree does not need to rebuild Tailwind from shared monorepo sources

## Storage Swap Notes

The browser UI talks only to `BoardService`, and `BoardService` talks only to the repository contract in [board_repository.js](/Users/Felipe/Documents/hanmoto-board/apps/hanmoto/public/js/repositories/board_repository.js). To swap storage later:

- add `HttpBoardRepository` beside [local_board_repository.js](/Users/Felipe/Documents/hanmoto-board/apps/hanmoto/public/js/repositories/local_board_repository.js)
- add Express API routes for `GET /api/board`, `PUT /api/board`, and `POST /api/board/reset`
- keep the board document shape from [board.js](/Users/Felipe/Documents/hanmoto-board/apps/hanmoto/public/js/domain/board.js) unchanged so it can move to MongoDB later without rewriting the UI
