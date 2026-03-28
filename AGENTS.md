# AGENTS.md

## Repository guidance

- Run Codex automation from the repository root so repo-local skills under `.agents/skills/` are available in context.
- Repo-local skills are the first place to look before making implementation decisions in a skill-covered domain.
- For generated docs or reporting work, use the matching repo-local skill before hand-editing derived outputs or adding ad hoc scripts.
- Keep each repo-local skill self-contained in `.agents/skills/<skill-name>/` with:
  - `SKILL.md`
  - `agents/openai.yaml`
  - any supporting scripts, fixtures, or tests inside that same skill folder

## Repo-local skills

- `env-inventory`
  Path: `.agents/skills/env-inventory/SKILL.md`
  Purpose: inventory per-app environment variable definitions and usages, regenerate `apps/*/docs/env-inventory.json` and `apps/*/docs/env-inventory.html`, and verify apps expose `/docs/env-inventory.html`.

- `monorepo-filetree`
  Path: `.agents/skills/monorepo-filetree/SKILL.md`
  Purpose: refresh generated monorepo and app file tree documentation, and keep root file tree guidance aligned when repository structure changes materially.

## File tree documentation

This repository maintains generated file tree references for navigation and agent orientation.

- Root overview: `monorepo-filetree.md`
- Per-app overviews: `apps/<app-name>/docs/filetree.html`
- Per-app structured data: `apps/<app-name>/docs/filetree.json`

When repository structure changes materially, update these generated documents to keep them in sync.
