Use this skill when the problem only reproduces in an authenticated Katei session, especially on a hosted deployment.

Expected hosted setup:

- `KATEI_DEBUG_AUTH_ENABLED=true`
- `KATEI_DEBUG_AUTH_SECRET=<shared secret>`
- `KATEI_DEBUG_AUTH_VIEWER_SUB=<single debug viewer sub>`
- optional viewer email and name

Recommended artifact review order:

1. `latest-session.json`
2. the timestamped JSON report from `capture-auth-debug-artifacts.mjs`
3. the matching PNG screenshot
