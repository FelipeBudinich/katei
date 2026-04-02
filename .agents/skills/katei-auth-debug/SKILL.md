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

Auth modes:

- `debug-route` is the default. It calls `POST /__debug/login` with the secret named by `auth.secretEnvVar`.
- `cookie` is the fallback. It reads a pre-obtained `katei_session` cookie from the env var named by `auth.cookieEnvVar`.

Important behavior:

- Artifacts write outside the repo by default under `/tmp/katei-auth-debug`.
- The browser profile is isolated under `/tmp/katei-auth-debug-profile`.
- `open-authenticated-page.mjs` writes `latest-session.json` and `latest-open.png` into the artifact directory.
- `capture-auth-debug-artifacts.mjs` writes a timestamped JSON report and PNG screenshot.
- Do not commit `.agents/katei-auth-debug.config.json` or debug secrets.

Config:

- Use `.agents/skills/katei-auth-debug/assets/katei-auth-debug.config.example.json` as the template.
- Required top-level fields: `baseUrl`.
- Recommended defaults are already baked into the loader for `startPath`, auth paths, Chrome path/port/profile, artifact dir, wait timeout, and selector snapshots.

Validation:

```bash
node --test apps/katei/test/config.test.js apps/katei/test/debug_auth.test.js .agents/skills/katei-auth-debug/tests/katei-auth-debug.test.mjs
```

Notes:

- Hosted debug auth only works after the target deployment is configured with `KATEI_DEBUG_AUTH_ENABLED=true`, `KATEI_DEBUG_AUTH_SECRET`, and `KATEI_DEBUG_AUTH_VIEWER_SUB`.
- The local fixture server enables the same route shape, so it is the fastest way to verify the full workflow before a deploy.
