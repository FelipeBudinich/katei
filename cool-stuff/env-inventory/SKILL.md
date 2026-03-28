---
name: env-inventory
description: Inventory environment variable definitions and usages for app-based JavaScript or TypeScript monorepos, generate per-app `apps/*/docs/env-inventory.json` and optional `env-inventory.html` reports, and inspect app-local, shared-package, and grounded root-level env configuration. Use when auditing env usage, reviewing `.env*` changes, debugging missing env wiring, mapping deployment variables, or refreshing environment documentation. Do not use for secret rotation, secret retrieval, runtime config mutation, or unrelated architecture analysis.
---

# Env Inventory

Use the bundled generator and HTML renderer instead of hand-building env inventories. Run commands from the repository being analyzed, and resolve script paths relative to this skill directory.

## Quick Start

```bash
SKILL_DIR=/absolute/path/to/env-inventory
node "$SKILL_DIR/scripts/generate-env-inventory.mjs" --root . --apps-root ./apps --app web
node "$SKILL_DIR/scripts/generate-env-inventory.mjs" --root . --apps-root ./apps --all-apps --html
node "$SKILL_DIR/scripts/generate-env-inventory.mjs" --root . --apps-root ./apps --all-apps --check
```

## Workflow

1. Confirm the repo matches the assumptions in `references/README.md`, especially the `apps/*` layout and shared workspace roots.
2. Run the generator for one app or for all direct app children under `/apps`.
3. When the task is human inspection or review, generate the HTML report too.
4. Verify the app exposes the generated HTML at `/docs/env-inventory.html`.
5. Treat either of these as sufficient:
   - an explicit GET route for `/docs/env-inventory.html`
   - an existing `express.static` mount that already exposes `apps/<app>/docs` at `/docs`
6. If neither exists, patch the router that already owns the app's docs artifacts and prefer a narrow explicit `sendFile()` route with ENOENT fallthrough over a new broad `/docs` static mount.
7. Review `git diff -- apps/*/docs/env-inventory.json apps/*/docs/env-inventory.html`.
8. Summarize concrete findings from the generated reports, including where each variable is defined, where it is used, whether it looks secret/public, any missing example/docs coverage, and any dynamic env access that could not be resolved statically.
9. Do not hand-edit `env-inventory.json` or `env-inventory.html`; regenerate them instead.

## Resources

- `scripts/generate-env-inventory.mjs`: machine-readable report generator and optional HTML writer.
- `scripts/render-env-inventory-html.mjs`: standalone HTML renderer for an existing JSON report.
- `assets/env-inventory.config.example.json`: example repo config for ignore roots, shared roots, public prefixes, secret-like patterns, and app path overrides.
- `references/README.md`: repo-shape assumptions and portability notes.
- `tests/`: smoke fixtures and node tests for the generator and renderer.

## Validation

```bash
SKILL_DIR=/absolute/path/to/env-inventory
node --test "$SKILL_DIR/tests/*.test.mjs"
node "$SKILL_DIR/scripts/generate-env-inventory.mjs" --root . --apps-root ./apps --all-apps --check
```

## Usage Examples

```bash
SKILL_DIR=/absolute/path/to/env-inventory
node "$SKILL_DIR/scripts/generate-env-inventory.mjs" --root . --apps-root ./apps --app web
node "$SKILL_DIR/scripts/generate-env-inventory.mjs" --root . --apps-root ./apps --app web --html
node "$SKILL_DIR/scripts/generate-env-inventory.mjs" --root . --apps-root ./apps --all-apps
node "$SKILL_DIR/scripts/generate-env-inventory.mjs" --root . --apps-root ./apps --app workers --config .agents/env-inventory.config.json
node "$SKILL_DIR/scripts/render-env-inventory-html.mjs" --input apps/web/docs/env-inventory.json --output apps/web/docs/env-inventory.html
```

## Notes

- Prefer the deterministic generator output over ad hoc reasoning.
- App discovery only uses immediate children of `/apps`.
- Reports are app-scoped and always written to `apps/<app-name>/docs/env-inventory.json`.
- The preferred human-facing output is `apps/<app-name>/docs/env-inventory.html`.
- The renderer assumes the target repo can serve the generated report inside an app shell that provides `/assets/app.css` and the shared utility classes already used in the markup. If that is not true, patch `scripts/render-env-inventory-html.mjs` before generating HTML.
- The generated HTML should inherit the app's normal visual system and CSS bundle rather than a standalone docs theme.
- The JSON report remains the machine-facing source of truth for the HTML renderer, and it is co-located with the HTML output under the same per-app docs folder.
- Shared workspace packages are only attributed to an app when that app imports them directly or through a resolved internal workspace dependency chain.
- Root-level definitions and usages are only attributed when they are grounded by the app's env usage set or the root file is explicitly app-scoped.
- The generator inventories names and locations only; it must not serialize actual env values.
- The analyzer supports static `process.env.*`, `import.meta.env.*`, `.env*` assignments, CI/container config scanning, and explicit docs mentions.
- Dynamic env access is reported separately in `dynamicAccesses[]` instead of guessed into named variables.
- If `.agents/env-inventory.config.json` is missing, built-in defaults are used and the report records that fallback.
