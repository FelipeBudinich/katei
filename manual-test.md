# Katei Auth Debug Manual Test Plan

This document defines what the repo-local `katei-auth-debug` skill does today and turns that behavior into a manual test checklist that can be reimplemented with Computer Use.

Source analyzed:

- `.agents/skills/katei-auth-debug/SKILL.md`
- `.agents/skills/katei-auth-debug/assets/katei-auth-debug.config.example.json`
- `.agents/skills/katei-auth-debug/scripts/*`
- `.agents/skills/katei-auth-debug/scripts/lib/*`
- `.agents/skills/katei-auth-debug/tests/katei-auth-debug.test.mjs`
- `apps/katei/src/routes/debug_auth.js`
- `apps/katei/test/debug_auth.test.js`

## Existing Skill Contract

`katei-auth-debug` is an authenticated browser and API debugging harness for Katei. It is intended for local fixture repros, hosted deployment smoke checks, and authenticated UI inspection. It must not be used for production user impersonation outside the guarded debug-auth contract.

The skill currently does five jobs:

1. Load `.agents/katei-auth-debug.config.json` from the repo root, normalize defaults, and derive a target URL from `baseUrl + startPath`.
2. Obtain a Katei session either by calling the guarded hosted debug login route or by reading a pre-obtained session cookie from the environment.
3. Launch or attach to an isolated Google Chrome profile with Chrome DevTools Protocol enabled.
4. Drive authenticated browser flows through CDP, including navigation, clicks, form entry, screenshots, selector snapshots, page summaries, console warnings/errors, page exceptions, and failed requests.
5. Run higher-level probes for baseline page load, localization generation, `review.origin` persistence, board lifecycle, cross-workspace switching/invite acceptance, and manual localization editing.

## Configuration

The default config path is `.agents/katei-auth-debug.config.json`. Use `.agents/skills/katei-auth-debug/assets/katei-auth-debug.config.example.json` as the template.

Required field:

- `baseUrl`: HTTP or HTTPS origin of the Katei deployment.

Important defaults:

- `startPath`: `/boards`
- `auth.mode`: `debug-route`
- `auth.debugLoginPath`: `/__debug/login`
- `auth.secretEnvVar`: `KATEI_DEBUG_AUTH_SECRET`
- `auth.cookieName`: `katei_session`
- `auth.cookieEnvVar`: `KATEI_DEBUG_SESSION_COOKIE`
- `chrome.remoteDebuggingPort`: `9222`
- `chrome.userDataDir`: `/tmp/katei-auth-debug-profile`
- `page.waitForSelector`: `[data-controller="workspace"]`
- `page.waitTimeoutMs`: `15000`
- `page.artifactDir`: `/tmp/katei-auth-debug`
- `page.inspectSelectors`: workspace root, board title, and `#workspace-bootstrap`

Debug-route auth requires the target app to have:

- `KATEI_DEBUG_AUTH_ENABLED=true`
- `KATEI_DEBUG_AUTH_SECRET`
- `KATEI_DEBUG_AUTH_VIEWER_SUB`
- Optional `KATEI_DEBUG_AUTH_VIEWER_EMAIL`
- Optional `KATEI_DEBUG_AUTH_VIEWER_NAME`

Secret resolution order:

1. Read `auth.secretEnvVar`.
2. On macOS, fall back to Keychain service `auth.secretKeychainService` and account `auth.secretKeychainAccount`.
3. Fail if neither exists.

Cookie auth mode reads the full cookie value from `auth.cookieEnvVar` and sets `auth.cookieName` in the browser.

## Computer Use Replacement Notes

Computer Use can replace the visible browser interaction layer: opening Chrome, navigating, clicking UI controls, typing into forms, selecting locales, accepting dialogs, and taking screenshots.

Computer Use does not directly replace all CDP behaviors:

- It cannot mint a debug session by sending `POST /__debug/login` with the `x-katei-debug-auth` header unless another helper performs that request.
- It cannot directly set an `HttpOnly` `katei_session` cookie the way CDP `Network.setCookie` does.
- It cannot directly collect browser console entries, page exceptions, failed network requests, or structured DOM selector snapshots unless a separate browser/devtools/API helper exposes them.
- It cannot verify hidden data such as `review.origin` from visible UI alone; that requires API readback, app-side debug UI, or another state-inspection helper.

Recommended replacement shape:

1. Keep or replace the auth bootstrap explicitly before attempting UI automation.
2. Use Computer Use for browser-visible interactions and screenshots.
3. Keep lightweight API/state readback for assertions that are not visible in the UI.
4. Store run evidence under `/tmp/katei-auth-debug` or an equivalent run artifact directory.

## Setup Checklist

Local fixture target:

```bash
node .agents/skills/katei-auth-debug/scripts/fixture-server.mjs
```

Use this config shape for local fixture testing:

```json
{
  "baseUrl": "http://127.0.0.1:3126",
  "auth": {
    "mode": "debug-route",
    "secretEnvVar": "KATEI_DEBUG_AUTH_SECRET"
  }
}
```

Set the local fixture secret:

```bash
export KATEI_DEBUG_AUTH_SECRET=fixture-debug-secret
```

Hosted target:

1. Copy `.agents/skills/katei-auth-debug/assets/katei-auth-debug.config.example.json` to `.agents/katei-auth-debug.config.json`.
2. Set `baseUrl` to the hosted deployment.
3. Ensure hosted debug auth is enabled on that deployment.
4. Set `KATEI_DEBUG_AUTH_SECRET` or store it in macOS Keychain with the skill helper.
5. Confirm the debug viewer has the workspace/board access required by the target scenario.

Never commit `.agents/katei-auth-debug.config.json` or debug secrets.

## Manual Test 1: Baseline Authenticated Page Load

Current automation:

- `run-chrome.sh`
- `open-authenticated-page.mjs`
- `capture-auth-debug-artifacts.mjs`
- `smoke-hosted.sh`

Purpose:

- Prove an authenticated session can reach the configured Katei page and render the workspace UI.
- Capture the same baseline evidence the skill currently writes as `latest-session.json`, `latest-open.png`, and a timestamped JSON/PNG report.

Manual or Computer Use steps:

1. Start from a clean browser profile or clearly note the existing profile/session used.
2. Authenticate as the configured debug viewer.
3. Navigate to `<baseUrl><startPath>`, usually `/boards`.
4. Wait until the workspace surface is visible.
5. Verify the page did not redirect to `/`.
6. Verify the board title is visible.
7. Verify the workspace root exists visually: the board workspace, board controls, and card/stage area are rendered.
8. Capture a screenshot.

Pass criteria:

- URL is on the configured `baseUrl`.
- The authenticated `/boards` UI renders.
- The visible workspace is usable.
- There are no visible fatal error states.

Evidence to record:

- Target URL.
- Page title.
- Visible board title.
- Screenshot path.
- Viewer identity, if available.
- Any visible browser/app errors.

CDP parity gap:

- The current skill also records console entries, page errors, failed requests, and selector snapshots. Computer Use needs a helper or manual devtools inspection to preserve those exact artifacts.

## Manual Test 2: Localization Generation

Current automation:

- `exercise-localization-flow.mjs`

Purpose:

- Prove an authenticated viewer can find a board/card needing a target locale and generate localized content through `/api/workspace/localizations/generate`.

Current automated selection logic:

- Load `/api/workspace`.
- If a board title is requested, search the active workspace first, then accessible workspaces.
- Select a board by exact title when provided.
- Use board language policy to find a non-source supported locale.
- Select the first card in stage order with meaningful source content and missing target-locale content.
- POST `workspaceId`, `boardId`, `cardId`, `targetLocale`, `expectedRevision`, and a `clientMutationId` to `/api/workspace/localizations/generate`.

Manual or Computer Use steps:

1. Open the authenticated board target.
2. Choose a board with AI localization configured and at least two supported locales.
3. Find a card with source-locale title or details and a missing target locale.
4. Open the card editor.
5. Select the missing target locale.
6. Trigger localization generation.
7. Wait for generated title/details to appear.
8. Save or confirm the generated localization if the UI requires it.
9. Reopen or inspect the card and verify target-locale content persists.

Pass criteria:

- The selected board has AI localization enabled.
- The generated locale has a non-empty title or details.
- The generated content is visible after refresh or reopen.
- The board/workspace remains usable after generation.

Evidence to record:

- Workspace ID, if available.
- Board title and board ID, if available.
- Card title and card ID, if available.
- Source locale and target locale.
- Before and after screenshots.
- API/state readback showing generated target-locale content when possible.

CDP/API parity gap:

- The existing script verifies success through API response bodies. Visible UI alone is an approximation unless paired with state readback.

## Manual Test 3: Review Origin Persistence

Current automation:

- `verify-review-origin.mjs`
- `smoke-review-origin.sh`

Purpose:

- Verify generated locales and later human edits preserve the intended `review.origin` and provenance semantics.

Current automated flow:

1. Find an editable board with AI localization configured and a non-source target locale.
2. Create a temporary source-locale card through `POST /api/workspace/commands` with `card.create`.
3. Assert the source-locale variant has `review.origin = human`.
4. Generate a target locale through `POST /api/workspace/localizations/generate`.
5. Assert the generated target-locale variant has `review.origin = ai`.
6. Assert generated provenance has `includesHumanInput = false`.
7. Manually edit the generated target locale through `card.locale.upsert`.
8. Assert `review.origin` remains `ai`.
9. Assert latest-write provenance now records human input and a human actor.
10. Discard the generated target locale through `card.locale.discard`.
11. Manually recreate that target locale through `card.locale.upsert`.
12. Assert the recreated target-locale variant has `review.origin = human`.
13. Delete the temporary card unless `--keep-card` was passed.

Manual or Computer Use steps:

1. Open an editable AI-enabled board with at least one target locale.
2. Create a temporary card in the source locale.
3. Generate a target-locale localization for that card.
4. Verify target-locale content appears.
5. Edit the generated target-locale title/details manually and save.
6. Discard/remove that localized variant.
7. Manually create the target-locale title/details again and save.
8. Delete the temporary card.

Required state assertions:

- After card creation: source variant `review.origin` is `human`.
- After generation: target variant `review.origin` is `ai`.
- After generation: target variant provenance has `includesHumanInput = false`.
- After manual edit of generated locale: target variant `review.origin` stays `ai`.
- After manual edit of generated locale: provenance records human input.
- After discard: target variant is absent.
- After manual recreation: target variant `review.origin` is `human`.

Pass criteria:

- All required state assertions pass.
- Temporary card is deleted or intentionally retained with the reason recorded.

Computer Use limitation:

- The key assertions are not visible in normal UI. A Computer Use replacement must include API/state readback or expose these fields in a debug-only UI.

## Manual Test 4: Board Lifecycle

Current automation:

- `exercise-board-lifecycle.mjs`
- `smoke-board-lifecycle.sh`

Purpose:

- Exercise create, edit, and delete board flows through the real browser UI.

Default generated values:

- Created title: `Codex Board Smoke <YYYYMMDDHHMMSS>`
- Edited title: `<created title> Edited`
- Source locale: `en`
- Default locale: `en`
- Supported locales: `en`
- Required locales: `en`
- Stages:

```text
backlog | Backlog | doing, done
doing | Doing | backlog, done
done | Done | backlog, doing, archived
archived | Archived | backlog, doing, done | card.delete
```

Manual or Computer Use steps:

1. Open the authenticated `/boards` page.
2. Capture the initial active board title and workspace summary.
3. Open board options.
4. Choose create board.
5. Fill the board editor with the generated board title, locale policy, and stage definitions.
6. Submit the form.
7. Verify the new board becomes active and the board title matches exactly.
8. Open board options again.
9. Choose edit for the active board.
10. Verify the editor is in edit mode for the created board.
11. Change the board title to the edited title.
12. Change the first stage title from `Backlog` to `Backlog Edited`.
13. Submit the form.
14. Verify the edited board title is visible and the first stage title changed.
15. Open the editor for the active board again.
16. Verify the delete button targets the created board.
17. Delete the board and confirm the dialog.
18. Verify the deleted board is no longer visible, no longer active, and another board is active.

Pass criteria:

- Created board becomes active.
- Edited board title appears exactly.
- First stage title reflects the edited stage definition.
- The flow refuses to delete the last remaining board.
- Deleted board is absent after confirmation.

Evidence to record:

- Screenshots for initial, create, edit, and delete steps.
- Board title before and after.
- Created board ID if available.
- Any visible errors.

Cleanup:

- If the test fails after board creation, delete the temporary board before ending the run whenever possible.

## Manual Test 5: Cross-Workspace Switch And Invite Acceptance

Current automation:

- `repro-cross-workspace-switch.mjs`
- `smoke-cross-workspace-switch.sh`

Purpose:

- Reproduce and diagnose board switching across workspaces, including external home workspaces and accept-first invite flows.

Default switch scenarios:

- Switch to external board with board ID `notes`.
- Switch to external board titled `Shared Main` where the workspace is external.
- Switch to external home board titled `Casa` where the workspace is external.

Optional config scenarios:

- `workspaceSwitchRepro.scenarios[]`
- `action`: `switch` or `accept-invite`
- `target.boardId`
- `target.boardTitle`
- `target.workspaceId`
- `target.workspaceRelation`: `external`

Manual or Computer Use steps for switch scenarios:

1. Open authenticated `/boards`.
2. Record current URL, active board title, active workspace ID if available, and active board ID if available.
3. Open board options.
4. Find the target switch row by board ID, board title, or external workspace relation.
5. Record the row text, workspace title, role/state, board title, and any visible workspace ID if available.
6. Capture a before screenshot.
7. Click the target switch button.
8. Wait until navigation/network activity settles and the UI updates.
9. Record the after URL, board title, active workspace ID, and active board ID.
10. Capture an after screenshot.

Manual or Computer Use steps for invite acceptance:

1. Open authenticated `/boards`.
2. Open board options.
3. Find a pending invite row, for example `Casa`.
4. Record invite title, role, inviter metadata, workspace ID, board ID, and invite ID if available.
5. Capture a before screenshot.
6. Click accept invite.
7. Wait until the UI lands on the invited workspace/board.
8. Record after URL, board title, active workspace ID, and active board ID.
9. Capture an after screenshot.

Pass criteria:

- The clicked row carries the expected board/workspace identity.
- The final active workspace matches the target workspace.
- The final active board matches the target board when a board target is specified.
- The visible board title matches the clicked board title.
- The URL/history matches the target workspace rules.
- For home workspaces, the URL may omit `workspaceId`; for external non-home workspaces, the URL should include the target `workspaceId`.

Known diagnostic categories to preserve:

- `success`: workspace and board landed as expected.
- `wrong-or-missing-workspace-id`: clicked row did not carry the expected workspace ID.
- `home-workspace-routing-or-history-issue`: UI routed/history-updated incorrectly, especially for an external workspace marked as home.
- `access-denied-or-workspace-not-found`: server rejected the workspace with 403 or 404.
- `workspace-switched-but-board-filtered-out`: target workspace loaded but the board was not present in the actor-facing projection.
- `inconclusive`: captured evidence was insufficient.

Computer Use limitation:

- The existing script instruments `fetch`, `history.pushState`, `history.replaceState`, and custom `board-options:*` events. Computer Use can observe the visible outcome, but exact event/network diagnosis needs a helper or debug UI.

## Manual Test 6: Manual Localization Editing Without AI

Current automation:

- `exercise-manual-localization-edit.mjs`

Purpose:

- Verify a board without AI configuration still allows manual missing-locale editing and does not show the generate-localization action.

Current automated flow:

1. Create a temporary board titled `Codex Manual Locale <stamp>`.
2. Configure source/default locale `en`, supported locales `en, es, ja`, and required locale `en`.
3. Create a source card in `en`.
4. Open the card editor and select `es`.
5. Verify missing-locale fields are blank.
6. Verify the generate button is hidden because the board has no AI configuration.
7. Verify manual save controls are visible.
8. Verify help text mentions manual editing.
9. Enter Spanish title/details and save.
10. Verify the board card renders the Spanish title.
11. Open the card view dialog and verify the localized title/body render.
12. Reopen the editor and verify it opens on the saved `es` variant.
13. Optionally switch to a viewer board and verify create/edit controls are unavailable while view remains available.
14. Delete the temporary board.

Manual or Computer Use steps:

1. Create a new temporary board with supported locales `en, es, ja`.
2. Do not configure board AI localization.
3. Create an English source card.
4. Open the card editor for that card.
5. Select locale `es`.
6. Confirm title and details inputs are blank.
7. Confirm generate localization is hidden or unavailable.
8. Confirm save controls remain visible.
9. Confirm help text communicates manual locale editing.
10. Fill Spanish title and details.
11. Save the card.
12. Verify the localized title appears on the board.
13. Open the card view dialog and verify localized content appears.
14. Reopen the card editor and verify the `es` locale and saved fields persist.
15. Delete the temporary board.

Pass criteria:

- Missing locale can be edited manually without AI configuration.
- Generate action is hidden/unavailable.
- Save controls are visible.
- Saved localized content renders in board card, view dialog, and editor.
- Temporary board is deleted.

## Local Fixture Expectations

The fixture server creates an in-memory Katei app at `http://127.0.0.1:3126` with debug auth enabled and these default identities:

- Viewer sub: `fixture_debug_sub`
- Viewer email: `fixture-debug@example.com`
- Viewer name: `Fixture Debug User`
- Debug secret: `fixture-debug-secret`

The fixture repository includes:

- A home workspace with `Debug board` and `Smoke test card`.
- A readable external workspace with board ID `notes` and title `Notes`.
- A readable external workspace with board title `Shared Main`.
- A readable external home workspace with board title `Casa`.
- A separate invite-only workspace with board title `Casa` and pending invite `invite_casa_1`.

Use the fixture when validating the Computer Use replacement locally before running against hosted deployments.

## Artifact Expectations

The current skill writes artifacts under `/tmp/katei-auth-debug` by default:

- `latest-session.json`
- `latest-open.png`
- Timestamped baseline JSON and PNG reports.
- `latest-localization-flow.json`
- `latest-review-origin-verification.json`
- `latest-board-lifecycle.json`
- `latest-cross-workspace-switch.json`
- `latest-manual-localization-edit.json`
- Per-step screenshots for lifecycle, workspace switch, and manual localization flows.

A Computer Use replacement should preserve equivalent evidence, even if the implementation format changes. At minimum, each run should record:

- Scenario name.
- Target base URL.
- Auth mode used.
- Viewer identity when available.
- Start and end URL.
- Visible board/workspace/card identifiers.
- Screenshots for key before/after states.
- API/state readback for hidden assertions.
- Failure notes and cleanup status.

## Validation Commands

The existing automated validation command is:

```bash
node --test apps/katei/test/config.test.js apps/katei/test/debug_auth.test.js .agents/skills/katei-auth-debug/tests/katei-auth-debug.test.mjs
```

Use this command after modifying the skill or replacing its behavior to ensure config normalization, debug auth, artifact normalization, selection logic, classification logic, fixture shape, and review-origin target selection still behave as expected.

## Replacement Readiness Checklist

Before deleting or fully replacing `katei-auth-debug`, confirm the Computer Use version can do these things:

- Load or receive the same target configuration.
- Authenticate reliably without leaking secrets.
- Open the authenticated `/boards` page in a controlled browser session.
- Capture baseline screenshots.
- Create, edit, and delete a board through the UI.
- Generate localization for a missing target locale or intentionally delegate that assertion to an API helper.
- Verify `review.origin` and provenance through state readback.
- Exercise manual locale editing on a no-AI board.
- Switch to external workspaces and accept pending invites.
- Preserve enough event/network/state evidence to classify workspace-switch failures.
- Clean up temporary boards/cards after success and after failure.
- Keep `.agents/katei-auth-debug.config.json`, session cookies, and debug secrets out of git.
