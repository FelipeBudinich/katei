---
name: katei-auth-debug
description: Use when you need an authenticated browser debugging harness for Katei, including hosted deployments. This skill loads `.agents/katei-auth-debug.config.json`, launches an isolated Chrome session, authenticates with the hosted debug login route by default or a fallback katei_session cookie, opens the configured authenticated page, and captures screenshots, selector snapshots, console errors, page errors, and failed requests. Trigger for hosted behavior debugging, authenticated UI inspection, live deployment smoke checks, or local fixture-based repro work. Do not use for production user impersonation outside the guarded debug-auth contract.
---

# Katei Auth Debug

Run from the repo root so the default config path resolves correctly.

Default workflow:

1. Ensure `.agents/katei-auth-debug.config.json` exists.
2. For local smoke work, start the fixture server:

```bash
node .agents/skills/katei-auth-debug/scripts/fixture-server.mjs
```

3. Launch isolated Chrome:

```bash
bash .agents/skills/katei-auth-debug/scripts/run-chrome.sh
```

4. Open an authenticated page:

```bash
node .agents/skills/katei-auth-debug/scripts/open-authenticated-page.mjs
```

5. Capture baseline artifacts:

```bash
node .agents/skills/katei-auth-debug/scripts/capture-auth-debug-artifacts.mjs
```

6. Exercise localization generation with the configured hosted session:

```bash
node .agents/skills/katei-auth-debug/scripts/exercise-localization-flow.mjs --board-title "過程 - Roadmap"
```

7. Verify `review.origin` persistence with a direct authenticated API flow that creates and deletes a temporary card:

```bash
node .agents/skills/katei-auth-debug/scripts/verify-review-origin.mjs --board-title "過程 - Roadmap"
```

8. Exercise create -> edit -> delete board flows:

```bash
node .agents/skills/katei-auth-debug/scripts/exercise-board-lifecycle.mjs
```

9. Reproduce cross-workspace board switching or invite acceptance:

```bash
node .agents/skills/katei-auth-debug/scripts/repro-cross-workspace-switch.mjs
```

Auth modes:

- `debug-route` is the default. It calls `POST /__debug/login` with the secret named by `auth.secretEnvVar`.
- `cookie` is the fallback. It reads a pre-obtained `katei_session` cookie from the env var named by `auth.cookieEnvVar`.

Secret sourcing:

- The debug secret is resolved from `auth.secretEnvVar` first.
- If the env var is missing on macOS, the skill falls back to a Keychain item using `auth.secretKeychainService` and `auth.secretKeychainAccount`.
- The default Keychain target is service `katei-auth-debug` and account equal to the configured `baseUrl` hostname.

Hosted convenience commands:

```bash
bash .agents/skills/katei-auth-debug/scripts/smoke-hosted.sh
bash .agents/skills/katei-auth-debug/scripts/smoke-review-origin.sh
bash .agents/skills/katei-auth-debug/scripts/smoke-board-lifecycle.sh
bash .agents/skills/katei-auth-debug/scripts/smoke-cross-workspace-switch.sh
bash .agents/skills/katei-auth-debug/scripts/store-debug-secret-in-keychain.sh
```

Important behavior:

- Artifacts write outside the repo by default under `/tmp/katei-auth-debug`.
- The browser profile is isolated under `/tmp/katei-auth-debug-profile`.
- `open-authenticated-page.mjs` writes `latest-session.json` and `latest-open.png` into the artifact directory.
- `capture-auth-debug-artifacts.mjs` writes a timestamped JSON report and PNG screenshot.
- `exercise-localization-flow.mjs` writes a timestamped JSON report plus `latest-localization-flow.json`, resolving the target workspace/board/card/locale over an authenticated session and recording the localization generation response.
- `verify-review-origin.mjs` talks to `/api/workspace`, `/api/workspace/commands`, and `/api/workspace/localizations/generate` directly, writes a timestamped JSON report plus `latest-review-origin-verification.json`, creates and removes a temporary card by default, and avoids unrelated browser-only failures when you only need to validate `review.origin` persistence.
- `exercise-board-lifecycle.mjs` creates a temporary board, edits it, then deletes it, writing per-step screenshots plus `latest-board-lifecycle.json`.
- `repro-cross-workspace-switch.mjs` runs the local or hosted workspace-navigation repro, recording switch-button or invite-button datasets, emitted board-options event detail, `/api/workspace*` traffic, history transitions, and per-scenario screenshots into `latest-cross-workspace-switch.json`.
- The local fixture now includes a readable foreign home workspace board titled `Casa` plus a separate invite-only `Casa` workspace so the skill can exercise both the home-workspace routing bug and the accept-first invite flow.
- Lifecycle verification uses the initial `#workspace-bootstrap` payload for orientation and then reads live `/api/workspace` state after each mutation because the bootstrap script is not rewritten after in-page commands.
- `verify-review-origin.mjs` does not require Chrome, so it can run against a local fixture config for permission-free local smoke checks. Hosted runs still need the configured debug auth secret and any required network approval.
- Do not commit `.agents/katei-auth-debug.config.json` or debug secrets.

Config:

- Use `.agents/skills/katei-auth-debug/assets/katei-auth-debug.config.example.json` as the template.
- Required top-level fields: `baseUrl`.
- Recommended defaults are already baked into the loader for `startPath`, auth paths, Keychain service/account, Chrome path/port/profile, artifact dir, wait timeout, selector snapshots, and a default board lifecycle schema.
- `workspaceSwitchRepro.scenarios[]` accepts an optional `action` of `switch` or `accept-invite`; omit it for the default switch flow.

Validation:

```bash
node --test apps/katei/test/config.test.js apps/katei/test/debug_auth.test.js .agents/skills/katei-auth-debug/tests/katei-auth-debug.test.mjs
```

Notes:

- Hosted debug auth only works after the target deployment is configured with `KATEI_DEBUG_AUTH_ENABLED=true`, `KATEI_DEBUG_AUTH_SECRET`, and `KATEI_DEBUG_AUTH_VIEWER_SUB`.
- The local fixture server enables the same route shape, so it is the fastest way to verify the full workflow before a deploy.
