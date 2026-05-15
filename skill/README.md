# Skills

Claude Code skills that ship with this repo. Each subdirectory is a self-contained skill following the [Claude Code Skills spec](https://docs.claude.com/en/docs/claude-code/skills) (a required `SKILL.md` with YAML frontmatter plus optional `references/`, `scripts/`, `assets/` subfolders).

## Skills in this repo

### `deplens-cli/`

Teaches another Claude instance to drive the `deplens` CLI to answer real questions about npm packages — exports, type signatures, README sections, JSDoc, version diffs — sourced from the actual files on disk instead of model memory or web search.

- [SKILL.md](./deplens-cli/SKILL.md) — entry point, decision tree, 10 core workflows
- [references/cli-flags.md](./deplens-cli/references/cli-flags.md) — full flag matrix for `inspect` / `diff` / `cache` / `history` + JSON output schema
- [references/recipes.md](./deplens-cli/references/recipes.md) — end-to-end workflows (audit a major version bump, build a deps-API map for an LLM, etc.)

## Install (user-level, available from any directory)

```bash
# Copy into your Claude Code skills directory
cp -r skill/deplens-cli ~/.claude/skills/
```

After copying, Claude Code picks up the skill automatically — it will be triggered by the `description` field in `SKILL.md` whenever a relevant question is asked.

## Install (project-level, this repo only)

```bash
# Already lives in this repo, but Claude Code expects project skills under .claude/skills/
mkdir -p .claude/skills
ln -s ../../skill/deplens-cli .claude/skills/deplens-cli
```

(Or copy instead of symlink if you prefer.)

## Package for distribution

Use the helper from the `skill-creator` skill bundled with Claude Code:

```bash
PYTHONUTF8=1 py -X utf8 ~/.claude/skills/skill-creator/scripts/package_skill.py \
  ./skill/deplens-cli ./dist
```

That produces `dist/deplens-cli.zip` ready to share or upload.

## Validate

```bash
PYTHONUTF8=1 py -X utf8 ~/.claude/skills/skill-creator/scripts/quick_validate.py \
  ./skill/deplens-cli
```

Should print `Skill is valid!`.
