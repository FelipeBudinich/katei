---
name: env-inventory
description: Use this skill to inventory environment variable definitions and usages for one or more apps in this monorepo, regenerate per-app JSON reports under apps/*/doc/env-inventory.json and self-contained HTML reports under apps/*/docs/env-inventory.html, and inspect app-local, shared-package, and grounded root-level env configuration. Trigger for env audits, .env changes, missing-env debugging, deployment/env mapping, or environment documentation work. Do not trigger for secret rotation, secret retrieval, runtime config mutation, or unrelated architecture analysis.
---

# Env Inventory

This skill is monorepo-specific and follows the same repo-local conventions as the other skills in this repository.

Run the generator from the repo root:

```bash
node .agents/skills/env-inventory/scripts/generate-env-inventory.mjs --root . --apps-root ./apps --all-apps
```

Use this skill when environment variables, `.env*` files, deployment env mappings, or app-specific env documentation need to be inspected or refreshed for the repo's apps.

Workflow:

1. Run the generator for a single app or for all direct app children under `/apps`.
2. When the task is human inspection or review, generate the HTML report too.
3. Keep the generated HTML aligned with the app's real shell and CSS entrypoint instead of introducing a docs-only stylesheet.
4. Verify the app exposes the generated HTML at `/docs/env-inventory.html`.
5. Treat either of these as sufficient:
   - an explicit GET route for `/docs/env-inventory.html`
   - an existing `express.static` mount that already exposes `apps/<app>/docs` at `/docs`
6. If neither exists, patch the router that already owns the app’s docs artifacts (`/docs/assets.html`, `/docs/color-swatch.html`, `/docs/specimen.html`) and prefer a narrow explicit `sendFile()` route with ENOENT fallthrough over a new broad `/docs` static mount.
7. Review `git diff -- apps/*/doc/env-inventory.json apps/*/docs/env-inventory.html`.
8. Summarize concrete findings from the generated reports, including where each variable is defined, where it is used, whether it looks secret/public, any missing example/docs coverage, and any dynamic env access that could not be resolved statically.
9. Do not hand-edit generated `env-inventory.json` or `env-inventory.html`; regenerate them instead.

Validation:

```bash
node .agents/skills/env-inventory/scripts/generate-env-inventory.mjs --root . --apps-root ./apps --all-apps --check
```

Usage examples:

```bash
node .agents/skills/env-inventory/scripts/generate-env-inventory.mjs --root . --apps-root ./apps --app listings
node .agents/skills/env-inventory/scripts/generate-env-inventory.mjs --root . --apps-root ./apps --app listings --html
node .agents/skills/env-inventory/scripts/generate-env-inventory.mjs --root . --apps-root ./apps --all-apps
node .agents/skills/env-inventory/scripts/generate-env-inventory.mjs --root . --apps-root ./apps --app agents --config .agents/env-inventory.config.json
node .agents/skills/env-inventory/scripts/render-env-inventory-html.mjs --input apps/listings/doc/env-inventory.json --output apps/listings/docs/env-inventory.html
```

Notes:

- Prefer the deterministic generator output over ad hoc reasoning.
- App discovery only uses immediate children of `/apps`.
- Reports are app-scoped and always written to `apps/<app-name>/doc/env-inventory.json`.
- The preferred human-facing output is `apps/<app-name>/docs/env-inventory.html`.
- For repo usability, the corresponding app should expose that HTML at `/docs/env-inventory.html`.
- The generated HTML should inherit the app's normal visual system and CSS bundle rather than a standalone docs theme.
- The JSON report remains the machine-facing source of truth for the HTML renderer.
- Shared workspace packages are only attributed to an app when that app imports them directly or through a resolved internal workspace dependency chain.
- Root-level definitions and usages are only attributed when they are grounded by the app's env usage set or the root file is explicitly app-scoped.
- The generator inventories names and locations only; it must not serialize actual env values.
- The analyzer supports static `process.env.*`, `import.meta.env.*`, `.env*` assignments, CI/container config scanning, and explicit docs mentions.
- Dynamic env access is reported separately in `dynamicAccesses[]` instead of guessed into named variables.
- If `.agents/env-inventory.config.json` is missing, built-in defaults are used and the report records that fallback.
