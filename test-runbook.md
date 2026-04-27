# Computer Use Test Runbook

This runbook tells a Computer Use agent how to perform the browser-side Katei auth/debug checks described in `manual-test.md`.

Assumption: Computer Use can open the user's normal browser profile and sign in using credentials already available in that browser. Do not expose, copy, print, or store passwords, cookies, session tokens, OAuth codes, debug secrets, or recovery codes.

## Scope

Computer Use owns browser-visible work:

- Open the target Katei URL.
- Complete sign-in with browser-stored credentials.
- Navigate `/boards`.
- Click UI controls.
- Type into forms.
- Select locales.
- Confirm dialogs.
- Capture screenshots and visible observations.
- Clean up temporary boards/cards created during the run.

Computer Use does not own hidden state assertions unless another tool or debug surface is provided:

- `review.origin`
- provenance fields such as `includesHumanInput`
- raw `/api/workspace` payloads
- console logs
- failed network requests
- DOM selector snapshots
- custom browser events such as `board-options:switch-board`

If a scenario requires hidden state, finish all browser steps and record that API/state readback is required.

## Run Inputs

Before starting, determine these values:

- `BASE_URL`: the deployment origin, for example `https://katei-...herokuapp.com`.
- `START_PATH`: usually `/boards`.
- `RUN_ID`: `computer-use-YYYYMMDD-HHMMSS`.
- `ACCOUNT_HINT`: the expected signed-in Google account, if known.
- `EVIDENCE_DIR`: where screenshots/notes should be saved or referenced.

If no `BASE_URL` is provided, read `.agents/katei-auth-debug.config.json` if it exists. If that file is absent, ask for the target deployment URL.

Do not create, edit, or commit `.agents/katei-auth-debug.config.json` from this runbook.

## Browser Rules

Use the user's normal browser profile because this runbook assumes saved credentials are available there.

Keep these rules throughout the run:

- Prefer visible labels and accessible names over coordinates.
- If the page language is not English, use the same button position plus the localized label when obvious.
- After every mutation, wait for the UI to visibly settle before judging the result.
- Capture a screenshot before and after each scenario.
- Record the current URL, visible board title, visible workspace label, and any toast/announcement text when observable.
- If a password, MFA challenge, passkey prompt, or account chooser cannot be completed using existing browser credentials, stop and ask the user to take over. Do not guess.
- If a destructive action would affect a non-temporary board/card, stop instead of proceeding.

## Sign-In Bootstrap

Goal: reach an authenticated board workspace without using CDP or a debug cookie.

Steps:

1. Open the browser.
2. Navigate to `BASE_URL + START_PATH`, usually `/boards`.
3. If `/boards` opens and a board workspace is visible, record that an existing session was reused.
4. If redirected to the landing page, click the Google sign-in control.
5. Choose the expected saved account if an account chooser appears.
6. Complete any browser-managed saved-credential/passkey flow that does not expose secrets.
7. Wait for the app to redirect to `/boards`.
8. Verify a board title and `Board options` button are visible.
9. Capture `RUN_ID-baseline-authenticated.png`.

Pass criteria:

- The final URL is on `BASE_URL`.
- The visible page is an authenticated Katei board workspace.
- The user is not stuck on the landing page or an auth error.

Stop conditions:

- Google credentials are not available in the browser.
- MFA or passkey approval requires user action.
- The chosen account is not allowed to access the deployment.

## Common UI Map

Use these visible controls when available:

- Top bar board menu: `Board options`
- Create board: `New Board`
- Switch board: `Switch`
- Edit board: icon button with accessible name `Edit Board`
- Collaborators: icon button with accessible name `Collaborators`
- Accept pending invite: `Accept` or `Accept invite`
- Decline pending invite: `Reject` or `Decline invite`
- Board title field: `Board title`
- Source locale field: `Source locale`
- Default locale field: `Default locale`
- Supported locales field: `Supported locales`
- Required locales field: `Required locales`
- Configure stages button: `Configure stages`
- Save board: `Save Board` or `Create Board`
- Delete board: `Delete Board`
- Confirm delete board: `Delete board`
- Card title field: `Title`
- Card details field: details textarea with placeholder `Optional context, notes, or next steps.`
- Save card: `Save Card`
- Locale selector: `Locale`
- Generate locale: `Generate localization`
- Discard locale: `Discard localization`
- Card view edit: icon button with accessible name `Edit`
- Card view delete: `Delete`
- Generic confirmation cancel: `Cancel`

Fallback DOM hints for debugging only:

- Workspace root: `[data-controller="workspace"]`
- Board title: `[data-workspace-target="boardTitle"]`
- Board options dialog: `[data-controller="board-options"][open]`
- Board editor dialog: `[data-controller="board-editor"][open]`
- Card editor dialog: `[data-controller="card-editor"][open]`
- Card view dialog: `[data-workspace-target="viewDialog"][open]`

## Evidence Template

For each scenario, record:

```text
Scenario:
Run ID:
Base URL:
Account/session:
Start URL:
End URL:
Start board:
End board:
Actions performed:
Screenshots:
Visible pass/fail:
Cleanup performed:
Hidden state readback required:
Notes:
```

## Scenario 1: Baseline Authenticated Page Load

Purpose: prove Computer Use can reach and visually inspect the authenticated `/boards` UI.

Steps:

1. Complete Sign-In Bootstrap.
2. Record the current URL.
3. Record the visible workspace label above the board title.
4. Record the visible board title.
5. Verify the board columns/cards area is visible.
6. Open `Board options`.
7. Verify the `Board options` dialog opens and contains `Switch board`.
8. Close the dialog.
9. Capture `RUN_ID-baseline-board.png`.

Pass criteria:

- `/boards` renders an authenticated workspace.
- `Board options` opens and closes.
- No fatal error page or auth redirect is visible.

## Scenario 2: Board Lifecycle

Purpose: create, edit, and delete a temporary board through visible UI only.

Generated values:

- Created title: `Computer Use Board Smoke <RUN_ID>`
- Edited title: `Computer Use Board Smoke <RUN_ID> Edited`
- Source locale: `en`
- Default locale: `en`
- Supported locales: `en`
- Required locales: `en`
- Initial stages:

```text
backlog | Backlog | doing, done
doing | Doing | backlog, done
done | Done | backlog, doing, archived
archived | Archived | backlog, doing, done | card.delete
```

- Edited first stage:

```text
backlog | Backlog Edited | doing, done
```

Steps:

1. Start on authenticated `/boards`.
2. Record the initial board title.
3. Capture `RUN_ID-board-lifecycle-initial.png`.
4. Click `Board options`.
5. Click `New Board`.
6. In `Board title`, enter the created title.
7. In `Source locale`, enter `en`.
8. In `Default locale`, enter `en`.
9. In `Supported locales`, enter `en`.
10. In `Required locales`, enter `en`.
11. If stage definitions are directly editable, enter the initial stages exactly.
12. If only `Configure stages` is visible, open it and set the equivalent stages through that UI, then apply.
13. Click `Save Board` or `Create Board`.
14. Wait until the top board title equals the created title.
15. Capture `RUN_ID-board-lifecycle-created.png`.
16. Click `Board options`.
17. Find the row for the created title.
18. Click its `Edit Board` icon.
19. Verify the board editor opens in edit mode for the created board.
20. Change `Board title` to the edited title.
21. Change the first stage title from `Backlog` to `Backlog Edited`.
22. Click `Save Board`.
23. Wait until the top board title equals the edited title.
24. Verify the first column/stage title is `Backlog Edited`.
25. Capture `RUN_ID-board-lifecycle-edited.png`.
26. Click `Board options`.
27. Find the row for the edited title.
28. Click its `Edit Board` icon.
29. Click `Delete Board`.
30. In the confirmation dialog, click `Delete board`.
31. Wait until the edited title is no longer the active board title.
32. Open `Board options` and confirm the edited title is absent.
33. Close `Board options`.
34. Capture `RUN_ID-board-lifecycle-deleted.png`.

Pass criteria:

- Temporary board is created and becomes active.
- Temporary board can be edited.
- Edited title is visible.
- First stage title changes to `Backlog Edited`.
- Temporary board is deleted.
- Another board becomes active after deletion.

Cleanup:

- If the scenario fails after creation, reopen `Board options`, edit the temporary board, and delete it.
- Never delete a board whose title does not start with `Computer Use Board Smoke`.

## Scenario 3: Manual Localization Editing Without AI

Purpose: verify browser-visible manual locale editing works on a board without AI localization configured.

Generated values:

- Board title: `Computer Use Manual Locale <RUN_ID>`
- Source card title: `Manual locale source <RUN_ID>`
- Source details: `English source details <RUN_ID>`
- Locale: `es`
- Localized title: `Titulo manual <RUN_ID>`
- Localized details: `Detalles manuales <RUN_ID>`

Steps:

1. Create a temporary board using Scenario 2 creation steps, with these differences:
2. Set `Supported locales` to `en, es, ja`.
3. Set `Required locales` to `en`.
4. Leave AI localization/OpenAI API key blank.
5. Save the board and wait until the board title equals the generated board title.
6. Capture `RUN_ID-manual-locale-board-created.png`.
7. Click the visible create-card control. If no visible button label appears, use the primary card creation control in the first stage that allows card creation.
8. In the card editor `Title` field, enter the source card title.
9. In the details textarea, enter the source details.
10. Click `Save Card`.
11. Wait until the source card appears on the board.
12. Open the card editor for the source card. If the card opens in view mode first, click the `Edit` icon in the card view dialog.
13. In the `Locale` selector, choose `es`.
14. Verify the title and details fields are blank for the missing `es` locale.
15. Verify `Generate localization` is hidden, disabled, or accompanied by no-AI help text.
16. Verify `Save Card` remains visible.
17. Verify visible help text says manual writing is allowed, if present.
18. Enter the localized title and localized details.
19. Click `Save Card`.
20. Wait until the board card renders the localized title or the saved locale can be viewed.
21. Capture `RUN_ID-manual-locale-saved.png`.
22. Open the card view dialog for the card.
23. Select or confirm locale `es` in the view locale control if present.
24. Verify the localized title/details are visible.
25. Capture `RUN_ID-manual-locale-view.png`.
26. Click `Edit` from the view dialog.
27. Verify the editor opens with locale `es` and the saved localized title/details.
28. Close the editor.
29. Delete the temporary board using the Scenario 2 cleanup flow.

Pass criteria:

- Manual localized content can be written without AI configuration.
- `Generate localization` is not available for the no-AI board.
- Saved localized content is visible in card view and editor.
- Temporary board is deleted.

Hidden state readback:

- Not required for the visible pass criteria.

## Scenario 4: Localization Generation

Purpose: generate a missing locale on a board that already has AI localization configured.

Preconditions:

- The signed-in account can edit at least one board with AI localization configured.
- That board has at least two supported locales.
- A card exists with source-locale content and missing target-locale content.

Steps:

1. Start on authenticated `/boards`.
2. Open `Board options`.
3. Select a known AI-enabled board. If the run has no known board title, inspect available boards and choose one expected to support localization.
4. Record selected board title.
5. Find a card with source content.
6. Open its card editor. If it opens in view mode, click the `Edit` icon.
7. Record the source title/details.
8. In the `Locale` selector, choose a non-source locale that shows as missing.
9. Verify `Generate localization` is visible and enabled.
10. Capture `RUN_ID-localization-before-generate.png`.
11. Click `Generate localization`.
12. Wait while the button reads `Generating localization...` if that state appears.
13. Wait until generated title/details appear.
14. If `Save Card` is still required, click `Save Card`.
15. Close and reopen the card view/editor.
16. Select the target locale again.
17. Verify generated title or details persist.
18. Capture `RUN_ID-localization-after-generate.png`.

Pass criteria:

- `Generate localization` is available for the missing target locale.
- Generated title or details appear.
- Generated content persists after close/reopen.

Cleanup:

- Do not delete existing user cards.
- If a temporary card was created for this scenario, delete only that temporary card.

Hidden state readback:

- Required if the run must prove API response contents or localization metadata.

## Scenario 5: Review Origin Browser Flow

Purpose: perform the visible browser actions that exercise `review.origin` transitions. Hidden assertions must be checked separately.

Preconditions:

- Editable AI-enabled board.
- Non-source target locale available.

Generated values:

- Temporary card title: `Computer Use review-origin <RUN_ID>`
- Temporary card details: `Temporary verification card for browser-side origin checks.`
- Edited generated title: `Manual follow-up <RUN_ID>`
- Edited generated details: `Human edit after AI generation.`
- Manual recreated title: `Manual fresh locale <RUN_ID>`
- Manual recreated details: `Human-created localization after discarding the AI locale.`

Steps:

1. Start on an editable AI-enabled board.
2. Create a temporary source-locale card with the generated card title/details.
3. Open the temporary card editor.
4. Select a non-source missing locale.
5. Click `Generate localization`.
6. Wait until generated content appears.
7. Save if needed.
8. Capture `RUN_ID-review-origin-generated.png`.
9. Reopen the card editor for the same card and target locale.
10. Replace the generated title/details with the edited generated title/details.
11. Click `Save Card`.
12. Reopen and verify the edited content persists.
13. Capture `RUN_ID-review-origin-edited.png`.
14. Click `Discard localization`.
15. Confirm with `Discard localization` if a confirmation dialog appears.
16. Verify the target locale becomes missing or blank again.
17. Enter the manual recreated title/details.
18. Click `Save Card`.
19. Reopen and verify the manually recreated target-locale content persists.
20. Capture `RUN_ID-review-origin-recreated.png`.
21. Delete the temporary card if visible delete controls are available for cards in this board's current stage.
22. If card delete is unavailable, move the card to a delete-enabled stage or record that cleanup needs API assistance.

Visible pass criteria:

- Temporary card can be created.
- Target locale can be generated.
- Generated target locale can be manually edited.
- Target locale can be discarded.
- Target locale can be manually recreated.
- Temporary card is deleted or cleanup is explicitly deferred.

Required hidden assertions:

- Source variant `review.origin = human`.
- Generated target variant `review.origin = ai`.
- Generated provenance `includesHumanInput = false`.
- Manual edit after generation keeps `review.origin = ai`.
- Manual edit after generation records human input.
- Discard removes the target variant.
- Manual recreation sets `review.origin = human`.

## Scenario 6: Cross-Workspace Switch

Purpose: verify browser-visible workspace and board switching.

Target defaults, if available:

- Board ID `notes`, usually visible as `Notes`.
- Board title `Shared Main`.
- External home board title `Casa`.

Steps:

1. Start on authenticated `/boards`.
2. Record start URL, workspace label, and board title.
3. Click `Board options`.
4. In the `Switch board` section, find the target board row.
5. Record the row's visible board title, workspace section heading, and role/state text.
6. Capture `RUN_ID-switch-<target>-before.png`.
7. Click `Switch` in the target row.
8. Wait until the dialog closes or the active board changes.
9. Record end URL, workspace label, and board title.
10. Capture `RUN_ID-switch-<target>-after.png`.
11. Repeat for each target board that is visible and safe to switch to.

Pass criteria:

- The clicked target row is visible.
- The active board title changes to the expected target title.
- The workspace label or URL changes when switching to an external workspace.
- The app remains on an authenticated board workspace.

Diagnostic notes to record:

- If the wrong board appears, record both the clicked row title and final board title.
- If the URL has a `workspaceId` query parameter, record it.
- If a home workspace target omits `workspaceId`, record that as expected only when the target is truly the current user's home workspace.
- If the page remains on the original board, classify the visible result as likely routing/history issue or missing workspace identity.

Hidden state readback:

- Required to classify exact causes such as wrong workspace ID, server 403/404, filtered board projection, or custom event mismatch.

## Scenario 7: Pending Invite Acceptance

Purpose: accept a pending workspace invite through browser-visible UI.

Target default, if available:

- Pending invite titled `Casa`.

Steps:

1. Start on authenticated `/boards`.
2. Record start URL, workspace label, and board title.
3. Click `Board options`.
4. Find `Pending workspace invites`.
5. Find the target invite row, for example `Casa`.
6. Record invite title, role text, inviter text, and visible workspace context.
7. Capture `RUN_ID-invite-before.png`.
8. Click `Accept` or `Accept invite`.
9. Wait for the dialog to close or the active board to change.
10. Record end URL, workspace label, and board title.
11. Capture `RUN_ID-invite-after.png`.

Pass criteria:

- Invite row is visible before acceptance.
- Acceptance completes without visible error.
- The final board title matches the invited board.
- The app remains authenticated and usable.

Cleanup:

- Invite acceptance mutates real collaboration state. Only run this scenario on fixture/test data or when acceptance is intended.

Hidden state readback:

- Required to confirm invite ID, workspace ID, board ID, and exact API outcome.

## Scenario 8: Viewer Permission Smoke

Purpose: verify a viewer-access board allows viewing but not editing/creating.

Steps:

1. Start on authenticated `/boards`.
2. Click `Board options`.
3. Find a board row whose role/state indicates `Viewer`.
4. Click `Switch`.
5. Wait until that board is active.
6. Verify no create-card control is available.
7. Open an existing card.
8. Verify the card view dialog opens.
9. Verify the `Edit` icon is hidden or disabled.
10. Capture `RUN_ID-viewer-permission.png`.
11. Switch back to the original board if needed.

Pass criteria:

- Viewer board can be opened.
- Card content can be viewed.
- Card creation/editing is unavailable.

## Cleanup Protocol

At the end of every run:

1. Delete temporary boards whose title starts with `Computer Use Board Smoke` or `Computer Use Manual Locale`.
2. Delete temporary cards whose title starts with `Computer Use review-origin` if card delete controls are available.
3. Return to the original board when practical.
4. Record anything left behind with title, board, workspace, and reason cleanup was not completed.
5. Do not sign out unless the user explicitly asked for sign-out.

## Failure Handling

If a scenario fails:

1. Capture an immediate screenshot.
2. Record the current URL and visible board title.
3. Record visible error text, disabled buttons, or unexpected redirects.
4. Attempt cleanup only for temporary data created in this run.
5. Stop if cleanup would require deleting non-temporary data.
6. Mark whether API/state readback is needed.

Common visible failures:

- Redirected to landing page: auth/session failure.
- `Board options` missing: not on workspace UI or page did not load.
- `New Board` missing: account may lack edit/create permission on current workspace.
- `Generate localization` hidden with no-AI message: board does not have AI localization configured.
- `Generate localization` disabled because locale already exists: choose a different target locale/card.
- Delete board rejected: temporary board may be the last remaining board.
- Invite row missing: invite already accepted/declined or account mismatch.

## Completion Report

End with a compact report:

```text
Run ID:
Target:
Account/session used:
Scenarios passed:
Scenarios failed:
Scenarios skipped:
Screenshots/evidence:
Cleanup status:
Hidden readback still needed:
Blocking issues:
```
