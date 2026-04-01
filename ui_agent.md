# UI Agent

This document describes how to create a repo-local agent that verifies the Katei card editor UI behavior we just changed:

- the EasyMDE toolbar no longer shows `Link` or `Preview`
- `Save Card` appears immediately to the left of `Close`
- header `Save Card` still submits the form in create and edit mode
- read-only view still hides save controls but keeps `Close` visible

The approach below is based on the exact setup used for verification in this repository.

## Why This Needs a Fixture

For this UI check, `npm test` was not enough:

- the app-local test suite currently has unrelated API failures because `apps/katei/test/workspace_api.test.js` creates the app without Mongo env values
- the real app runtime expects server config such as `MONGODB_URI`, `MONGODB_DB_NAME`, `GOOGLE_CLIENT_ID`, and `KATEI_SESSION_SECRET`
- the UI behavior we care about is easiest to verify in a real browser, not just from controller unit tests

Because of that, the cleanest agent design is:

1. start a temporary in-memory fixture server
2. log into that fixture app automatically
3. launch an isolated Chrome instance with remote debugging
4. drive the real UI through Chrome DevTools Protocol
5. assert the expected create, edit, and read-only view behavior

## Recommended Repo Layout

Follow the repo-local skill convention from `AGENTS.md`.

Recommended folder:

```text
.agents/skills/katei-card-editor-ui/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── scripts/
│   ├── fixture-server.mjs
│   ├── run-chrome.sh
│   └── check-card-editor-ui.mjs
└── references/
    └── card-editor-behavior.md
```

Use a narrow, purpose-built skill rather than a generic browser-testing skill. This workflow is tightly coupled to Katei's authentication, workspace bootstrapping, and Stimulus-driven card editor.

## What The Fixture Server Must Do

The fixture server should reuse the real app:

- import `createApp` from `apps/katei/src/app.js`
- pass a repository double so no real Mongo connection is needed
- still provide dummy env values required by `createRuntimeConfig()`

Suggested env passed to `createApp(...)`:

```js
{
  NODE_ENV: 'development',
  PORT: '3126',
  APP_BASE_URL: 'http://127.0.0.1:3126',
  GOOGLE_CLIENT_ID: 'fixture-google-client-id',
  KATEI_SESSION_SECRET: 'fixture-session-secret',
  MONGODB_URI: 'mongodb://127.0.0.1:27017',
  MONGODB_DB_NAME: 'fixture-katei'
}
```

Important detail:

- the repository double prevents real Mongo usage
- the dummy Mongo env values only satisfy config validation

### Seed Data

Seed one private workspace with:

- one signed-in human viewer who is also board admin
- one board
- one existing card
- a normal editable language policy

That is enough to exercise:

- create mode via the board's `Add Card` button
- edit mode via the card edit button
- view/read-only mode via the card view button

### Dev-Only Fixture Routes

Add two fixture-only routes to the temporary server:

- `GET /dev-login`
  - creates a signed Katei session cookie
  - redirects to `/boards`
- `GET /dev-state`
  - returns the current in-memory workspace record
  - lets the browser check confirm that header save actually persisted changes

Do not add these routes to the real app. They belong in the temporary fixture harness only.

## What The Browser Harness Must Do

Use an isolated Chrome instance instead of the user's main profile.

Recommended launch:

```bash
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/katei-chrome-profile \
  --no-first-run \
  --no-default-browser-check \
  http://127.0.0.1:3126/dev-login
```

Why this shape:

- `--user-data-dir=/tmp/...` keeps the run isolated
- `--remote-debugging-port=9222` exposes a CDP endpoint
- loading `/dev-login` lands the browser in an authenticated `/boards` session

### Why CDP Instead of AppleScript JavaScript

On this machine, both Chrome and Safari block JavaScript execution from Apple Events unless the browser setting is manually enabled. CDP is more reliable for agent automation because it does not depend on that toggle.

The agent script should:

1. fetch `http://127.0.0.1:9222/json/list`
2. find the `/boards` page target
3. connect to its `webSocketDebuggerUrl`
4. use `Runtime.evaluate` with `awaitPromise: true`
5. run the assertions inside the real page

## The Assertions The Agent Should Run

### Create Flow

The browser script should:

1. click `[data-action="workspace#openCreateCard"]`
2. wait for `dialog[data-controller="card-editor"][open]`
3. read `.editor-toolbar button`
4. assert:
   - `Link` is absent
   - `Preview` is absent
   - toolbar button text reads `B`, `I`, `H`, `•`, `Code`
   - toolbar `aria-label` values read `Bold`, `Italic`, `Heading 2`, `Bulleted list`, `Code`
   - toolbar `title` values read `Bold (Cmd-B)`, `Italic (Cmd-I)`, `Heading 2 (Cmd+⌥+2)`, `Bulleted list (Cmd-L)`, `Code (Cmd-⌥-C)`
   - header buttons read `Save Card`, then `Close`
5. fill the title field
6. click the header save button:
   - `.dialog-header-row button[type="submit"][form="card-editor-form"]`
7. confirm the dialog closes
8. confirm the new card appears on the board

### Edit Flow

The browser script should:

1. open edit on the existing card
2. confirm header order is still `Save Card`, then `Close`
3. change the title
4. click header save
5. confirm the updated title appears on the board

### Read-Only View Flow

The browser script should:

1. open view mode on a card
2. inspect `[data-card-editor-target="submitActions"]`
3. assert it is hidden
4. find the `Close` button in the header
5. assert `Close` is still visible

This last check exists because `submitActionsTarget.hidden = this.isReadOnlyLocaleView` in `apps/katei/public/js/controllers/card_editor_controller.js`. If `Close` is ever moved inside `submitActions`, read-only users would lose the ability to dismiss the dialog.

## Suggested Skill Contents

### `SKILL.md`

The skill should tell Codex to:

- run from the repo root
- use the fixture server instead of the normal app server for this check
- prefer CDP-driven browser verification over AppleScript JS
- verify the card editor in create, edit, and read-only view
- report both test command results and browser verification results

Suggested trigger scope:

- card editor UI verification
- toolbar button regressions
- header action placement regressions
- read-only locale dialog regressions

### `agents/openai.yaml`

Example:

```yaml
interface:
  display_name: "Katei Card Editor UI"
  short_description: "Verify the card editor toolbar and header actions"
  default_prompt: "Use $katei-card-editor-ui to verify the Katei card editor toolbar, header save/close layout, and read-only dialog behavior with the local fixture server and real browser automation."

policy:
  allow_implicit_invocation: false
```

### `references/card-editor-behavior.md`

Keep this reference short. It should capture:

- the expected toolbar contents
- the expected header button order
- the read-only constraint for `submitActions`
- the main selectors used by the browser harness

## Suggested Scripts

### `scripts/fixture-server.mjs`

Responsibilities:

- create a temporary Katei app with `createApp(...)`
- seed one in-memory workspace
- expose `/dev-login`
- expose `/dev-state`
- listen on a fixed local port such as `3126`

### `scripts/run-chrome.sh`

Responsibilities:

- launch isolated Chrome with remote debugging
- point it at `/dev-login`
- keep flags stable so the verification script can depend on port `9222`

### `scripts/check-card-editor-ui.mjs`

Responsibilities:

- connect to the CDP target
- evaluate browser-side assertions
- print one JSON result block summarizing:
  - toolbar button text
  - toolbar aria-label values
  - toolbar titles
  - whether `Link` and `Preview` exist
  - header button order in create and edit
  - whether header save persisted
  - whether read-only hid save but kept close visible

The script used during verification returned a shape like this:

```json
{
  "create": {
    "toolbarText": ["B", "I", "H", "•", "Code"],
    "toolbarAriaLabels": ["Bold", "Italic", "Heading 2", "Bulleted list", "Code"],
    "toolbarTitles": ["Bold (Cmd-B)", "Italic (Cmd-I)", "Heading 2 (Cmd+⌥+2)", "Bulleted list (Cmd-L)", "Code (Cmd-⌥-C)"],
    "hasLink": false,
    "hasPreview": false,
    "headerButtons": ["Save Card", "Close"],
    "saveLeftOfClose": true
  },
  "edit": {
    "headerButtons": ["Save Card", "Close"],
    "saveLeftOfClose": true
  },
  "view": {
    "submitActionsHidden": true,
    "closeVisible": true,
    "headerButtons": ["Save Card", "Close"]
  },
  "state": {
    "revision": 3,
    "titles": ["Edited from header save", "Created from header save"]
  }
}
```

## Recommended Agent Workflow

For a future Codex agent, the full workflow should be:

1. run the narrow relevant tests first
   - example: `node --test apps/katei/test/card_editor_controller.test.js apps/katei/test/workspace_controller.test.js`
2. note any unrelated failures in the broader app-local suite
3. start the fixture server
4. launch isolated Chrome
5. run the CDP verification script
6. report:
   - code-level test result
   - live-browser verification result
   - any unrelated environment failures

## Important Implementation Notes

- Keep all fixture artifacts inside the skill folder if you formalize this into a repo-local skill.
- Do not depend on the user's normal browser profile.
- Do not depend on manually enabling JavaScript from Apple Events.
- Do not mutate the real app to add dev-login routes.
- Do not require a real Mongo instance for this UI-only verification.
- Keep the fixture server focused on one board and one existing card unless the test surface expands.

## Minimal Success Criteria

The agent is complete when it can prove all of the following from a real rendered page:

- `Link` is gone from the EasyMDE toolbar
- `Preview` is gone from the EasyMDE toolbar
- the toolbar buttons read `B`, `I`, `H`, `•`, `Code`
- the toolbar `aria-label` values read `Bold`, `Italic`, `Heading 2`, `Bulleted list`, `Code`
- the toolbar `title` values still include the expected shortcuts
- `Save Card` is immediately left of `Close`
- clicking header `Save Card` submits successfully in create mode
- clicking header `Save Card` submits successfully in edit mode
- read-only view hides save controls
- read-only view still shows `Close`

If you later want, this document can be turned directly into a repo-local skill under `.agents/skills/katei-card-editor-ui/`.
