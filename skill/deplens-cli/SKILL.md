---
name: deplens-cli
description: Inspect package exports, types, documentation and version differences from installed or explicitly fetched package files.
---

# DepLens CLI

Inspect package files from the selected installed version or an explicitly fetched archive. Keep the package/version and resolution root with the result; source checkout capabilities do not prove an installed binary was upgraded.

## Select a workflow

- One version's exports/types/docs: `inspect` (or the package shorthand), with focused symbol/section filters.
- Two versions: `diff` with explicit versions; preserve the intended baseline/fallback.
- Dependency changes across a project: `project-diff` or `check`, using the actual lockfile and an existing baseline.
- Implementation structure: source analysis for the language supported by the chosen executable. Load the relevant section of the [workflow reference](references/workflows.md).

## Resolve execution and effects

Prefer an existing executable or project-local binary. In this monorepo use `node packages/cli/bin/deplens.js` for unpublished source changes. Check version/help when needed; do not install global `@latest` or use downloading `npx` as an implicit fallback. If missing, explain the smallest setup needed or answer from already available package files.

Resolve packages from the intended cwd or `--resolve-from`. Local inspection can import the package entrypoint; use `--no-runtime` when execution is outside scope. Type generation can write files: use `--no-auto-generate-types` when unwanted. Remote/diff operations may access registries and write caches even without modifying project dependencies. Offline/cache reads are not a universal no-write guarantee.

Keep baseline/history/snapshot creation, cache maintenance and fetching within the task. Do not clear/migrate caches or overwrite a baseline as automatic recovery. Python source analysis can select a venv or use `uv run --project`; `--no-runtime` alone does not prove offline execution.

## Evidence and output

Prefer compact JSON and focused symbols/sections. Preserve resolution warnings, incomplete/truncated output and continuation cursors. Expand only missing evidence. Source structural analysis is not runtime, ABI or behavioral validation; do not infer support solely from a language being detected.

## References by task

- [Workflow reference](references/workflows.md): inspect, types, README/JSDoc, examples, diff, project baselines, language analysis and focused output.
- [CLI flags](references/cli-flags.md): option details and effects; confirm against the actual executable.
- [Recipes](references/recipes.md): larger compositions only when the request needs them. Examples are not authorization to install, fetch, execute packages or clean caches.
