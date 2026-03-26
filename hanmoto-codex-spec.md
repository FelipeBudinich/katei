# 過程 (katei) — Codex Implementation Spec

## 1) Project summary

Build **過程 (katei)**, a **mobile-first**, single-user kanban app with one fixed board and four fixed columns:

- backlog
- doing
- done
- reviewed

This is **not** a React/Vue/SPA app.

Use this stack:

- **Node.js + Express**
- **Nunjucks** for server-rendered templates
- **Stimulus** for frontend behavior
- **Tailwind CSS v4** for styling
- **HTMX is not required in v1**, but the codebase must be structured so HTMX fragments can be added later without major rewrites
- **localStorage-backed persistence for v1**, designed behind a repository interface so it can later be replaced with an HTTP/MongoDB-backed implementation
- **monorepo layout**
- **Heroku-compatible Node deployment**

## 2) Non-negotiable constraints

1. Do **not** use React.
2. Do **not** use Vue.
3. Do **not** use client-side routing.
4. Do **not** add a database in v1.
5. Do **not** add authentication or users.
6. Do **not** create more than one board.
7. Do **not** let Stimulus controllers talk directly to `localStorage`.
8. Do **not** couple domain logic to browser APIs, Express request handlers, or Mongo.
9. Keep the board document shape stable so it can later be reused as:
   - localStorage JSON
   - API payload
   - MongoDB document

## 3) Product behavior

### 3.1 Fixed board
The app has exactly one board.

- board id: `main`
- board title: `過程`
- columns in exact order:
  - `backlog`
  - `doing`
  - `done`
  - `reviewed`

Columns are fixed in v1:
- cannot be renamed
- cannot be deleted
- cannot be reordered
- cannot be added to

### 3.2 Cards
Each card supports:
- `id`
- `title` (required)
- `description` (optional)
- `createdAt`
- `updatedAt`

Users can:
- create a card in any column
- edit a card
- delete a card
- move a card to another column
- reorder a card within a column

## 4) UX requirements

### 4.1 Mobile-first layout
Mobile is the primary target.

On small screens, **show one column at a time**.

Required mobile structure:
- top app bar
- board title
- reset action
- column switcher/tabs
- active column content area
- floating add button
- bottom sheet or modal for create/edit card

### 4.2 Column navigation
Use tabs or a segmented control for:
- Backlog
- Doing
- Done
- Reviewed

Persist the active column in app state.

### 4.3 Move and reorder UX
For v1, do **not** depend on drag-and-drop.

Required interactions:
- move card between columns via explicit “Move to…” action
- reorder card within a column via “Move up” / “Move down” actions

Optional later:
- drag-and-drop
- swipe between columns

### 4.4 Desktop enhancement
On wider screens, it is acceptable to progressively enhance into a 4-column board layout.

This is a presentation change only.
The underlying board state and actions must stay identical.

## 5) Architecture

Use these layers.

### 5.1 Domain layer
Pure board logic only.

Responsibilities:
- create board
- create/update/delete card
- move card
- reorder card
- set active column
- validate board shape

Forbidden in this layer:
- DOM access
- localStorage
- fetch
- Express req/res
- Nunjucks
- Stimulus

### 5.2 Repository layer
Persistence abstraction.

Create a repository contract with async methods:
- `loadBoard()`
- `saveBoard(board)`
- `resetBoard()`

Implementations:
- **v1:** `LocalBoardRepository`
- **future:** `HttpBoardRepository`
- **future server-side:** `MongoBoardRepository`

### 5.3 Service layer
Coordinates domain logic + persistence.

Responsibilities:
- load board through repository
- apply domain mutations
- save new state through repository
- return updated state

### 5.4 UI layer
Use:
- Nunjucks for HTML shell and partials
- Stimulus for browser behavior
- Tailwind CSS for styling

Responsibilities:
- render page shell
- bootstrap Stimulus
- invoke service methods
- update DOM

## 6) Repository contract

Treat storage as swappable from day one.

```js
export class BoardRepository {
  async loadBoard() {
    throw new Error('Not implemented');
  }

  async saveBoard(board) {
    throw new Error('Not implemented');
  }

  async resetBoard() {
    throw new Error('Not implemented');
  }
}
```

### 6.1 Local repository
`LocalBoardRepository` stores the full board document in:

```js
const STORAGE_KEY = 'hanmoto.board.v1';
```

Behavior:
- load JSON from localStorage
- validate minimal shape
- fallback to default board if missing or invalid
- save full board JSON after each mutation

### 6.2 Future HTTP repository
Design the UI code so it can later swap to:

- `GET /api/board`
- `PUT /api/board`
- `POST /api/board/reset`

The service/controller code should not need major changes when this swap happens.

## 7) Canonical board state

Use this normalized state shape.

```js
export const DEFAULT_BOARD_STATE = {
  version: 1,
  boardId: 'main',
  title: '過程',
  ui: {
    activeColumnId: 'backlog'
  },
  columnOrder: ['backlog', 'doing', 'done', 'reviewed'],
  columns: {
    backlog: {
      id: 'backlog',
      title: 'Backlog',
      cardIds: []
    },
    doing: {
      id: 'doing',
      title: 'Doing',
      cardIds: []
    },
    done: {
      id: 'done',
      title: 'Done',
      cardIds: []
    },
    reviewed: {
      id: 'reviewed',
      title: 'Reviewed',
      cardIds: []
    }
  },
  cards: {}
};
```

Card shape:

```js
{
  id: 'card_xxxxx',
  title: 'Example card',
  description: 'Optional description',
  createdAt: '2026-03-25T12:00:00.000Z',
  updatedAt: '2026-03-25T12:00:00.000Z'
}
```

## 8) Domain API

Implement pure functions in the domain layer.

Required functions:

```js
createEmptyBoard()
cloneBoard(board)
validateBoardShape(value)
setActiveColumn(board, columnId)
createCard(board, columnId, input)
updateCard(board, cardId, updates)
deleteCard(board, cardId)
moveCard(board, cardId, sourceColumnId, targetColumnId, targetIndex)
moveCardUp(board, columnId, cardId)
moveCardDown(board, columnId, cardId)
```

Rules:
- no hidden mutation of input objects
- return a new board object or a clearly cloned board
- reject invalid column ids
- reject empty card titles
- always update `updatedAt` on edits/moves
- keep `createdAt` unchanged after creation

## 9) Service API

The service should be async even though localStorage is sync internally.

Required service methods:

```js
load()
createCard(columnId, input)
updateCard(cardId, updates)
deleteCard(cardId)
moveCard(cardId, sourceColumnId, targetColumnId, targetIndex)
moveCardUp(columnId, cardId)
moveCardDown(columnId, cardId)
setActiveColumn(columnId)
reset()
```

Behavior:
- load current board from repository
- apply domain function
- save updated board to repository
- return updated board

## 10) Server requirements

Use Express as a thin server.

### 10.1 Responsibilities
The server must:
- serve static assets
- render the initial page with Nunjucks
- expose a health endpoint

The server must not:
- store cards in memory as the source of truth
- add a database
- add auth

### 10.2 Required routes
- `GET /` → render board page
- `GET /health` → return `{ ok: true }`

No board API routes in v1.

## 11) Nunjucks template structure

Use Nunjucks because the app is server-rendered and should later support HTML fragment responses cleanly when HTMX is added.

Suggested template layout:

```txt
src/views/
├─ layouts/
│  └─ base.njk
├─ pages/
│  └─ board.njk
├─ partials/
│  ├─ board-shell.njk
│  ├─ active-column.njk
│  ├─ card-item.njk
│  ├─ card-form.njk
│  └─ card-editor-sheet.njk
└─ macros/
   └─ ui.njk
```

Guidelines:
- `base.njk` owns document structure
- `board.njk` renders page-level content
- small partials for reusable UI pieces
- macros allowed for repeated button/input/card patterns
- keep templates mostly HTML-shaped and readable

## 12) Stimulus requirements

Use Stimulus for client behavior.

Do not write a custom frontend framework.

Suggested controllers:

```txt
public/js/controllers/
├─ board_controller.js
├─ tabs_controller.js
├─ card_editor_controller.js
└─ flash_controller.js   (optional)
```

### 12.1 Main board controller responsibilities
- initialize board service
- load initial board state
- render active column
- respond to tab changes
- handle add/edit/delete/move/reorder interactions
- update DOM after state changes

### 12.2 Stimulus rules
- keep business logic out of controllers
- use controller targets/values for local UI state only
- no direct storage calls from controllers
- no giant controller files; split behavior if needed

## 13) Styling requirements

Use **Tailwind CSS v4**.

### 13.1 Approach
- Tailwind utilities for layout, spacing, typography, responsive behavior
- a small semantic component layer for repeated patterns where useful
- no Sass required

### 13.2 Monorepo styling setup
Use a shared package for design tokens and reusable component classes.

Suggested structure:

```txt
packages/brand/
├─ package.json
├─ src/
│  ├─ theme.css
│  └─ components.css

apps/hanmoto/
├─ styles/
│  └─ app.css
```

### 13.3 Styling guidance
Implement these UI patterns:
- mobile-safe spacing
- 44x44 minimum tap targets
- sticky column tabs
- full-width cards on mobile
- floating add button
- bottom sheet / modal for card editor
- safe-area support for modern phones
- 4-column layout enhancement at desktop widths

### 13.4 Important browser note
Tailwind CSS v4 targets modern browsers. If older browser support becomes mandatory later, the project may need to stay on Tailwind v3.4 instead. For this implementation, assume modern browser support is acceptable.

## 14) Monorepo layout

Use npm workspaces.

Recommended repo layout:

```txt
/
├─ package.json
├─ Procfile
├─ apps/
│  └─ hanmoto/
│     ├─ package.json
│     ├─ src/
│     │  ├─ server.js
│     │  ├─ app.js
│     │  ├─ routes/
│     │  │  └─ web.js
│     │  └─ views/
│     │     ├─ layouts/
│     │     │  └─ base.njk
│     │     ├─ pages/
│     │     │  └─ board.njk
│     │     ├─ partials/
│     │     └─ macros/
│     ├─ public/
│     │  ├─ js/
│     │  │  ├─ app.js
│     │  │  ├─ controllers/
│     │  │  ├─ domain/
│     │  │  ├─ repositories/
│     │  │  ├─ services/
│     │  │  └─ utils/
│     │  └─ assets/
│     │     └─ app.css
│     └─ styles/
│        └─ app.css
└─ packages/
   └─ brand/
      ├─ package.json
      └─ src/
         ├─ theme.css
         └─ components.css
```

## 15) Root package.json requirements

Use a root `package.json` for workspace management and Heroku startup.

Required scripts:
- `start` → starts the hanmoto app
- `dev` → local development command
- `build` → builds CSS/assets if needed

Example:

```json
{
  "name": "hanmoto-monorepo",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "npm run dev -w apps/hanmoto",
    "build": "npm run build -w apps/hanmoto",
    "start": "node apps/hanmoto/src/server.js"
  }
}
```

## 16) Heroku requirements

The app must be deployable to Heroku as a Node.js app.

Required:
- root `package.json`
- root `start` script
- root `Procfile`

Procfile:

```txt
web: npm start
```

Server requirements:
- bind to `process.env.PORT`
- default to a local port when `PORT` is absent
- do not assume persistent filesystem storage

## 17) Future HTMX compatibility rules

HTMX is not required in v1, but the app must be prepared for it.

Design for future fragment rendering:
- keep server templates modular
- make card/list markup reusable as partials
- avoid client-only rendering assumptions
- do not bury all rendering in JavaScript string templates

Future-friendly direction:
- initial page render with Nunjucks
- later, HTMX endpoints can return partial HTML fragments for list refreshes, editor forms, and card updates

## 18) Future MongoDB Atlas migration plan

The implementation must be migration-friendly.

### 18.1 Today
- browser UI uses `BoardService`
- `BoardService` uses `LocalBoardRepository`
- localStorage stores the canonical board document

### 18.2 Later
- add Express API routes:
  - `GET /api/board`
  - `PUT /api/board`
  - `POST /api/board/reset`
- implement `HttpBoardRepository` on the client
- implement `MongoBoardRepository` on the server
- persist the same board document shape in MongoDB Atlas

### 18.3 Migration goal
The UI layer should switch repositories without needing a redesign of core board logic.

## 19) Acceptance criteria

The implementation is complete when all of these are true:

1. `npm install` works from the repo root.
2. `npm run dev` starts the app locally.
3. `npm start` starts the production server locally.
4. `GET /` renders a usable board shell.
5. `GET /health` returns `{ ok: true }`.
6. The app shows exactly four columns:
   - backlog
   - doing
   - done
   - reviewed
7. On mobile widths, only one active column is shown at a time.
8. The user can switch active columns.
9. The user can create cards.
10. The user can edit cards.
11. The user can delete cards.
12. The user can move cards between columns.
13. The user can reorder cards within a column.
14. Refreshing the browser preserves board state.
15. Refreshing the browser preserves active column.
16. Resetting the board clears persisted data and restores defaults.
17. No database is required.
18. No auth is required.
19. No React is present anywhere in the app.
20. Storage is implemented behind a repository interface and is not hard-coded throughout UI code.

## 20) Delivery requirements

The implementation should include:
- working code
- minimal README with setup/run commands
- brief notes describing where to swap storage later

## 21) Implementation priority order

Implement in this order:

1. monorepo scaffolding
2. Express app boot + Nunjucks rendering
3. Tailwind build pipeline + base layout
4. canonical board state + domain functions
5. local repository + service layer
6. Stimulus board controller
7. mobile-first board UI
8. create/edit/delete/move/reorder interactions
9. reset action
10. responsive desktop enhancement
11. cleanup + README

## 22) Explicit implementation notes for the agent

- Prefer readability over cleverness.
- Keep modules small.
- Use inline comments only where behavior is non-obvious.
- Avoid premature abstractions except the repository seam, which is required now.
- Keep the first version fully functional without HTMX.
- Structure templates and routes so HTMX can be added later cleanly.
- Do not add TypeScript unless explicitly requested.
- Do not add a test framework unless explicitly requested.
- Do not add a database dependency.
- Do not add session middleware.

## 23) Short rationale

This project is intentionally built as a server-rendered Node app with a very small client-side behavior layer. The repository abstraction is the most important long-term decision: it allows the initial localStorage mockup to evolve into an HTTP + MongoDB Atlas-backed app later without rewriting the board domain logic or UI architecture.

## 24) Drift notes — 2026-03-26

As of 2026-03-26, the implementation has drifted from this spec in the following confirmed ways:

- **Column model drift:** the shipped app uses `archived` as the fourth fixed column instead of `reviewed`. This is now encoded in the canonical state and UI flow (`apps/hanmoto/public/js/domain/board.js`, `apps/hanmoto/src/views/partials/card-editor-sheet.njk`, `apps/hanmoto/src/views/partials/card-view-dialog.njk`).
- **Card shape drift:** cards now have a required `priority` field and a corresponding UI/state model (`apps/hanmoto/public/js/domain/board.js`, `apps/hanmoto/src/routes/web.js`, `apps/hanmoto/src/views/partials/card-editor-sheet.njk`). The original spec only described `id`, `title`, `description`, `createdAt`, and `updatedAt`.
- **Create-card API drift:** the spec says cards can be created in any column and defines `createCard(board, columnId, input)` / `createCard(columnId, input)`. The current implementation always creates new cards in `backlog`, and both the domain and service signatures dropped `columnId` (`apps/hanmoto/public/js/domain/board.js`, `apps/hanmoto/public/js/services/board_service.js`).
- **Ordering and reorder drift:** the spec requires explicit reorder support via `targetIndex`, `moveCardUp`, and `moveCardDown`. The current implementation does not expose or implement those APIs, and card display order is derived by sorting on priority and `createdAt` instead of preserving manual within-column order (`apps/hanmoto/public/js/domain/board.js`, `apps/hanmoto/public/js/renderers/board_renderer.js`, `apps/hanmoto/public/js/controllers/board_controller.js`).
- **Mobile interaction drift:** the spec requires one active column at a time on mobile plus tabs/segmented control for switching columns. The current board renders every column in a stacked grid on small screens, has no tab/switcher UI, and does not use `ui.activeColumnId` to drive rendering (`apps/hanmoto/src/views/partials/board-shell.njk`, `apps/hanmoto/src/views/partials/desktop-board.njk`, `apps/hanmoto/public/js/controllers/board_controller.js`).
- **Active-column persistence drift:** the spec requires the user to switch active columns and have that choice persist. `activeColumnId` still exists in board state, but there is no UI or controller flow that changes it after initialization, so the persisted active-column behavior is effectively unimplemented (`apps/hanmoto/public/js/domain/board.js`, `apps/hanmoto/public/js/services/board_service.js`, `apps/hanmoto/public/js/controllers/board_controller.js`).
- **Deployment-boundary drift:** sections 14-16 assume the monorepo root is the Heroku deploy target with a root `Procfile` and root `start` script. The current repo has intentionally moved deploy ownership into `apps/hanmoto`: the root `Procfile` is gone, the root `package.json` no longer has `start`, and runtime metadata now lives in `apps/hanmoto/package.json` plus `apps/hanmoto/Procfile` (`package.json`, `apps/hanmoto/package.json`, `apps/hanmoto/Procfile`).
- **Acceptance-criteria drift:** because of the changes above, this document's current acceptance criteria are stale in several places. In particular, criteria 3, 6, 7, 8, 13, and 15 no longer describe the shipped implementation accurately.

Additional drift that is additive rather than purely missing functionality:

- **Read-only inspection flow:** the app now includes a dedicated read-only card view modal in addition to the edit flow (`apps/hanmoto/src/views/partials/card-view-dialog.njk`, `apps/hanmoto/public/js/controllers/board_controller.js`).
- **Card/column visual system expansion:** the implementation now includes a much richer semantic token and component styling system than this spec describes, including column/card glass surfaces, priority accents, and app-local deploy artifacts generated from shared brand sources (`packages/brand/src/theme.css`, `packages/brand/src/components.css`, `apps/hanmoto/public/assets/app.css`).
