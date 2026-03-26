# AGENTS.md

## Repository guidance

- Run Codex automation from the repository root so repo-local skills under `.agents/skills/` are available in context.
- Repo-local skills are the first place to look before making implementation decisions in a skill-covered domain.
- Keep each repo-local skill self-contained in `.agents/skills/<skill-name>/` with:
  - `SKILL.md`
  - `agents/openai.yaml`
  - any supporting scripts, fixtures, or tests inside that same skill folder

## Repo-local skills

- `monorepo-filetree`
  Path: `.agents/skills/monorepo-filetree/SKILL.md`
  Purpose: refresh generated monorepo and app file tree documentation, and keep root file tree guidance aligned when repository structure changes materially.

## File tree documentation

This repository maintains generated file tree references for navigation and agent orientation.

- Root overview: `monorepo-filetree.md`
- Per-app overviews: `apps/<app-name>/doc/filetree.md`

When repository structure changes materially, update these generated documents to keep them in sync.
