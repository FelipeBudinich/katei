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

## Storage Swap Notes

The browser UI talks only to `BoardService`, and `BoardService` talks only to the repository contract in [board_repository.js](/Users/Felipe/Documents/hanmoto-board/apps/hanmoto/public/js/repositories/board_repository.js). To swap storage later:

- add `HttpBoardRepository` beside [local_board_repository.js](/Users/Felipe/Documents/hanmoto-board/apps/hanmoto/public/js/repositories/local_board_repository.js)
- add Express API routes for `GET /api/board`, `PUT /api/board`, and `POST /api/board/reset`
- keep the board document shape from [board.js](/Users/Felipe/Documents/hanmoto-board/apps/hanmoto/public/js/domain/board.js) unchanged so it can move to MongoDB later without rewriting the UI
