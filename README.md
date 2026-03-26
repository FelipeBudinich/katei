# 過程 (katei)

Katei is a single-user, multi-board kanban app built with Node.js, Express, Nunjucks, Stimulus, and Tailwind CSS v4.

Each board always has the same fixed columns:

- `backlog`
- `doing`
- `done`
- `archived`

Cards use three priorities:

- `urgent`
- `important`
- `normal`

New cards are always created in `backlog`.

## Workspace and Boards

Katei stores one local workspace per browser. That workspace can contain multiple named boards, and one board is active at a time.

Board management lives in the **Options** modal. From there you can:

- switch boards
- create a board
- rename the active board
- delete the active board when more than one board exists
- reset the active board

Resetting a board only clears that board's cards. There is no workspace-wide reset in v2.

## Layout

On mobile and tablet widths, the active board keeps the mobile-first stacked column layout.

On desktop widths:

- `backlog`, `doing`, and `done` render on the first row
- `archived` renders on a second row beneath them
- archived cards render in a 3-column grid

There is no persistent board rail or board sidebar. Board switching stays inside the Options modal.

## Monorepo Layout

The deployable app subtree is:

- `apps/katei`

Shared design-system styles stay in:

- `packages/brand`

The generated runtime stylesheet is:

- `apps/katei/public/assets/app.css`

The runtime serves that built CSS artifact and does not depend on monorepo-only style source paths at request time.

## Commands

From the repo root:

- `npm install`
- `npm run dev`
- `npm run start:katei`
- `npm run build:katei:css`
- `npm run prepare:subtree:katei`

From the app subtree:

- `cd apps/katei && npm start`

## Runtime

- `GET /` renders the workspace shell
- `GET /health` returns `{ ok: true }`

Heroku deployment is subtree-based. The deployable unit is `apps/katei`, and runtime metadata lives in:

- `apps/katei/package.json`
- `apps/katei/Procfile`

## Persistence

Katei v2 stores the full workspace in browser `localStorage` under:

- `katei.workspace.v2`

v2 does not migrate old `hanmoto.board.v1` data.

Persistence is abstracted behind `WorkspaceRepository`, with:

- `LocalWorkspaceRepository` in v2
- future `HttpWorkspaceRepository`
- future `MongoWorkspaceRepository`

## Architecture Notes

- server-rendered HTML with Nunjucks
- Stimulus for UI behavior
- domain logic kept out of controllers
- repository/service seam preserved for future storage swaps
- templates kept fragment-friendly for future HTMX-style enhancement
