---
name: "monorepo-filetree"
description: "Use when a monorepo needs generated file tree documentation refreshed, when app folders under apps/ are added, removed, or renamed, or when root AGENTS guidance must ensure file tree documentation references exist. Do not use for code-only edits that do not materially change repository structure."
---

# Monorepo File Tree

Run the generator from the repo root:

```bash
python3 .agents/skills/monorepo-filetree/scripts/build_monorepo_filetree.py
```

Use this skill when repository structure changes materially or when file tree docs and root AGENTS guidance need to be refreshed.

Workflow:

1. Run the generator.
2. Review `git diff -- AGENTS.md monorepo-filetree.md apps/*/doc/filetree.md`.
3. Summarize which files were created or updated, any zero-asset or empty apps, and any partial app failures.
4. Do not hand-edit generated file tree docs unless the generation contract changes.

Validation:

```bash
python3 .agents/skills/monorepo-filetree/scripts/build_monorepo_filetree.py
```

Notes:

- The generator fails with a clear blocking error if `/apps` does not exist at the repo root.
- App discovery only uses immediate children of `/apps`.
- The root output is always `monorepo-filetree.md`.
- Each app output is always `apps/<app-name>/doc/filetree.md`; missing `doc/` folders are created.
- App trees are scoped to that app only and do not include another app's files.
- Empty apps still get a valid `apps/<app-name>/doc/filetree.md`.
- `AGENTS.md` is created if missing and otherwise updated conservatively without duplicating the file tree documentation section.
