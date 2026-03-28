# Env Inventory Reference Notes

This skill is intentionally lightweight and assumes an app-centric JavaScript or TypeScript monorepo.

Key repo assumptions:

- direct app targets live under `apps/*`
- shared workspace packages usually live under `packages/*` or `libs/*`
- the workspace is primarily Node-based and may mix CommonJS and ESM syntax
- `tsconfig.json` or `jsconfig.json` alias data is optional, but the analyzer will read it when present
- app-scoped docs can be written under `apps/<app>/docs/`

Operational conventions:

- run the generator from the repository being analyzed and point to this skill's scripts explicitly when the skill lives outside that repo
- generated machine-readable output lives at `apps/<app>/docs/env-inventory.json`
- generated human-facing output lives at `apps/<app>/docs/env-inventory.html`
- the JSON report is the source of truth; regenerate instead of editing generated HTML by hand
- prefer either an explicit `/docs/env-inventory.html` route or an existing `/docs` static mount that already exposes the app's docs folder
- shared workspace packages are only attributed to an app when the app imports them directly or through a resolved internal workspace dependency chain
- root-level definitions and usages are only attributed when they are grounded by the app's env usage set or the root file is explicitly app-scoped
- the HTML renderer currently assumes the target app shell can load `/assets/app.css` and the shared utility classes baked into the markup; if not, patch `scripts/render-env-inventory-html.mjs` for that repo before generating HTML

Config conventions:

- the default repo config path is `.agents/env-inventory.config.json`
- if the config file is missing, the scripts fall back to built-in defaults and record that fallback in the report
- the example config for this skill lives at `assets/env-inventory.config.example.json`
