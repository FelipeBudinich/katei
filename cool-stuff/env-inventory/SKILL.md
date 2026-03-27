---
name: env-inventory
description: Use this skill to inventory environment variable definitions and usages for one or more apps in a repository, regenerate per-app JSON reports under <apps-root>/*/doc/env-inventory.json and self-contained HTML reports under <apps-root>/*/docs/env-inventory.html, and inspect app-local, shared-package, and grounded root-level env configuration. Trigger for env audits, .env.example maintenance, missing-env debugging, deployment/env mapping, or environment documentation work. Do not trigger for secret rotation, secret retrieval, runtime config mutation, or unrelated architecture analysis.
---

# Env Inventory

This is a portable copy of `env-inventory` meant to be copied into another repository as a local skill.

Run the generator from the target repo root:

```bash
node <skill-dir>/scripts/generate-env-inventory.mjs --root . --apps-root ./apps --all-apps
```

Use this skill when environment variables, `.env.example` files, deployment env mappings, or app-specific env documentation need to be inspected or refreshed for one or more apps in the destination repo.

Workflow:

1. Install the folder wherever the destination repo keeps local skills.
2. Run the generator for a single app or for all direct app children under the configured apps root.
3. Use `--apps-root` if the destination repo does not keep apps under `/apps`.
4. When the task is human inspection or review, generate the HTML report too.
5. Treat the JSON report as the machine-readable source of truth and the HTML file as the human-facing report.
6. Do not hand-edit generated `env-inventory.json` or `env-inventory.html`; regenerate them instead.
7. If the destination repo already exposes generated docs pages, wire `docs/env-inventory.html` into that same route or static-serving pattern. If it does not, keep the HTML file as a build artifact.
8. Review `git diff -- <apps-root>/*/doc/env-inventory.json <apps-root>/*/docs/env-inventory.html`.
9. Summarize concrete findings from the generated reports, including where each variable is defined, where it is used, whether it looks secret/public, any missing example coverage, and any dynamic env access that could not be resolved statically.

Validation:

```bash
node <skill-dir>/scripts/generate-env-inventory.mjs --root . --apps-root ./apps --all-apps --check
```

Usage examples:

```bash
node <skill-dir>/scripts/generate-env-inventory.mjs --root . --apps-root ./apps --app app-a
node <skill-dir>/scripts/generate-env-inventory.mjs --root . --apps-root ./apps --app app-a --html
node <skill-dir>/scripts/generate-env-inventory.mjs --root . --apps-root ./apps --all-apps
node <skill-dir>/scripts/generate-env-inventory.mjs --root . --apps-root ./services --app api --config .agents/env-inventory.config.json
node <skill-dir>/scripts/render-env-inventory-html.mjs --input apps/app-a/doc/env-inventory.json --output apps/app-a/docs/env-inventory.html
```

Notes:

- The standalone HTML renderer is self-contained and does not assume an app CSS bundle, favicon, or route shell.
- App discovery uses immediate children of the configured apps root.
- Reports are app-scoped and written to `<apps-root>/<app-name>/doc/env-inventory.json`.
- The preferred human-facing output is `<apps-root>/<app-name>/docs/env-inventory.html`.
- Shared workspace packages are only attributed to an app when that app imports them directly or through a resolved internal workspace dependency chain.
- Root-level definitions and usages are only attributed when they are grounded by the app's env usage set or the root file is explicitly app-scoped.
- Definitions in the report are sourced from `.env.example` only.
- The generator inventories names and locations only; it must not serialize actual env values from runtime sources.
- The analyzer supports static `process.env.*`, `import.meta.env.*`, `.env*` assignments, CI/container config scanning, and explicit docs mentions.
- Dynamic env access is reported separately in `dynamicAccesses[]` instead of guessed into named variables.
- If `.agents/env-inventory.config.json` is missing, built-in defaults are used and the report records that fallback.
