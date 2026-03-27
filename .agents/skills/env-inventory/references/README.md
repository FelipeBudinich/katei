# Env Inventory References

This skill is intentionally lightweight and repo-specific.

Key repo assumptions baked into v1:

- direct app targets live under `apps/*`
- shared workspace packages live outside `/apps`, currently under `packages/*`
- the current repo is primarily Node/CommonJS JavaScript with some ESM-style syntax
- there is no current `tsconfig.json` or `jsconfig.json` alias configuration at the repo, app, or package roots outside `node_modules`, but the analyzer still supports reading one when present

Important conventions mirrored from the existing repo-local skills:

- reusable implementation lives under `.agents/skills/env-inventory/`
- generated analysis outputs live with each app under `apps/<app>/doc/`
- generated human-facing HTML lives with each app under `apps/<app>/docs/`
- generated HTML should load the app's normal CSS entrypoint and reuse the app shell rather than a separate docs-only stylesheet
- the preferred app integration is a narrow explicit `/docs/env-inventory.html` route in the same router that already owns the other docs artifacts
- the script supports a generator-style `--check` mode
- the HTML report is the preferred human-facing inspection surface
- the JSON artifact remains the machine-facing source of truth

The optional repo-level config file defaults to:

```text
.agents/env-inventory.config.json
```

See the example config in:

```text
.agents/skills/env-inventory/assets/env-inventory.config.example.json
```
