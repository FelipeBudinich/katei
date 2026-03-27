# Env Inventory References

This is the standalone, shareable copy of `env-inventory`.

Default implementation assumptions:

- direct app targets live under `apps/*` unless `--apps-root` says otherwise
- shared workspace packages live outside the apps root, typically under `packages/*` or `libs/*`
- the analyzer is optimized for Node/CommonJS JavaScript with some ESM-style syntax, but it can also follow common TypeScript source extensions
- the analyzer can read `tsconfig.json` or `jsconfig.json` path mappings when present

Important conventions in this portable copy:

- reusable implementation lives entirely inside the copied `env-inventory/` folder
- generated analysis outputs live with each app under `<apps-root>/<app>/doc/`
- generated human-facing HTML lives with each app under `<apps-root>/<app>/docs/`
- generated HTML is self-contained so it can be opened directly, committed as an artifact, or served by a repo-specific docs route later
- the script supports a generator-style `--check` mode
- the HTML report is the preferred human-facing inspection surface
- the JSON artifact remains the machine-facing source of truth

The optional repo-level config file defaults to:

```text
.agents/env-inventory.config.json
```

See the example config in:

```text
assets/env-inventory.config.example.json
```

Porting notes:

- Copy the folder into the destination repo's local skill location, such as `.agents/skills/env-inventory/`.
- If the destination repo wants app-native HTML styling, customize `scripts/render-env-inventory-html.mjs`; the standalone copy intentionally avoids hardcoded asset paths.
- If the destination repo uses a different config path, pass `--config <path>` instead of changing the generator.
