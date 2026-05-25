---
name: deplens-cli
description: This skill should be used when needing concrete, verified-by-disk information about an npm package's exports, types, README docs, examples, JSDoc, or version differences. It drives the `deplens` CLI (binary from the `@deplens/cli` npm package) to inspect installed packages from `node_modules`, fetch and inspect non-installed packages on demand, and diff two versions for breaking changes. Triggers when the user asks things like "what does X export from package Y", "what types does package Y expose", "what's the API of Y", "what changed between version A and B of Y", "show me README usage of Y", "compare installed Y to latest", or any other question whose answer should be sourced from the actual package on disk rather than from model memory or web search.
---

# DepLens CLI

## Overview

DepLens reads npm packages directly from `node_modules` (or downloads them on demand) and returns their exports, type signatures, README sections, code examples, and JSDoc. It also computes semver diffs between two versions of a package, surfacing breaking changes, additions, and removals — with `CHANGELOG.md` parsing when available.

Use this skill instead of guessing an API from training data or hitting external doc sites. The output is sourced from the actual files on disk (or fetched archive), so it reflects the exact version present in the project.

## When to use this skill

Trigger this skill when the user asks about:

- **Package API surface** — "what does `zod` export?", "list functions in `fast-glob`"
- **Type signatures** — "what's the signature of `useQuery`?", "show types for `next/server`"
- **README / docs** — "show me the Installation section of `prisma`", "list README sections of `next`"
- **Examples** — "show usage examples for `ai`'s `generateText`"
- **JSDoc** — "what does the JSDoc say about `parse` in `zod`?"
- **Version diff** — "what changed between react 18.2 and 18.3?", "is there a breaking change in zod 3.23?"
- **Source analysis** — "how complex is the `parse` function in `zod`?", "analyze this Python package from its local project/venv", "inspect Java implementation details"
- **A non-installed package** — "what's in `@tanstack/router` without installing it?"

Skip this skill when:

- The question is about authoring docs or package metadata rather than reading existing ones.
- The package is not on npm (e.g. a private git URL with no published version; for git URLs, `--remote` won't work).

## Prerequisites — locate the binary

The CLI binary is `deplens`. Pick the first option below that works:

1. **Project-installed:** `npx --yes @deplens/cli@latest <args>` — works in any directory; npx caches the binary
2. **Globally installed:** `deplens <args>` — after `npm i -g @deplens/cli`
3. **In the deplens monorepo:** `node packages/cli/bin/deplens.js <args>`
4. **Local-project bin:** `node ./node_modules/.bin/deplens <args>` — only if `@deplens/cli` is installed locally

Working directory matters: deplens resolves the target package relative to the **current working directory** (or `--resolve-from DIR`). Run it from a directory whose `node_modules` contains the target, or pass `--remote` to download it.

## Quick decision tree

```
Is the user asking about a SINGLE version of a package?
├── Yes → use `deplens inspect` (or just `deplens <pkg>`)
│   ├── Want types from .d.ts?           add --types
│   ├── Want README / docs?              add --docs OR --list-sections OR --docs-sections X,Y
│   ├── Want code examples?              add --examples
│   ├── Want only JSDoc for a symbol?    add --jsdoc-output only --filter <symbol> --jsdoc full
│   ├── Package not installed locally?   add --remote (--remote-version X.Y.Z optional)
│   └── Output for an LLM/agent?         add --json
└── No, comparing TWO versions → use `deplens diff <pkg> --from X --to Y`
```

## Core workflows

Every command below uses `deplens` as the binary; substitute one of the four prerequisites above if needed.

### 1. Inspect a package

```bash
deplens zod
```

Returns: name, version, license, subpath exports list, runtime exports (functions/classes/objects/constants), default export type.

### 2. Filter exports by name (substring or regex)

```bash
deplens zod --filter parse           # substring, case-insensitive
deplens zod --filter "/^Zod/"        # regex (slashes are mandatory)
deplens zod --kind function,class    # restrict by export kind
```

### 3. Get TypeScript signatures from `.d.ts`

```bash
deplens zod --types --filter ZodString
```

Returns: parsed function signatures, interfaces, types, classes, enums. If the package has no shipped `.d.ts` and `dts-gen` is available, deplens auto-generates one. Falls back to `@types/<pkg>` if present.

### 4. Extract README — three modes

```bash
deplens next --list-sections                       # just the headers
deplens next --docs-sections Installation,Routing  # specific sections
deplens next --docs                                 # full preview (4000-char cap)
```

`--docs-sections` does a case-insensitive partial match on the header text.

### 5. Code examples (README fences + `examples/` + `@example` JSDoc)

```bash
deplens ai --examples --filter generateText
```

### 6. JSDoc-only output — great for "what does function X do?"

```bash
deplens ai --filter generateText --jsdoc full --jsdoc-output only --jsdoc-sections summary,params,returns
```

`--jsdoc-output only` suppresses everything else and emits just the JSDoc for matched symbols.

### 7. Diff two versions of a package

```bash
deplens diff zod --from 3.22.0 --to 3.24.0
deplens diff zod                              # defaults: from=installed, to=latest
deplens diff zod --from installed --to latest --verbose
deplens diff zod --include-source             # also compares per-symbol complexity
deplens diff zod --no-changelog               # skip CHANGELOG.md parsing
```

Returns: breaking changes, warnings, additions, removals, optional changelog excerpt.

### 8. Inspect a package that isn't installed

```bash
deplens @tanstack/router --remote
deplens @tanstack/router --remote --remote-version 1.40.0
```

`--remote` downloads the package into `~/.deplens-cache/versions/` once and reuses it. Pair with any other flag (`--types`, `--docs`, etc.).

### 9. Semantic search across exports

```bash
deplens lodash --search "deep merge"
```

Token-matches the query (with synonym expansion: `validate ↔ parse`, `auth ↔ token`, etc.) against export names and JSDoc; falls back to fuzzy token scoring if no types are available.

### 10. Source-code analysis (JS / TS / Python / Java / Rust / Go)

```bash
deplens zod --analyze-source --source-max-files 5
deplens some-python-pkg --analyze-source --language python
deplens some-java-pkg --analyze-source --language java
```

Walks the package's source files and reports function/class counts, complexity (approximate cyclomatic), imports, and body snippets when requested.

For Python, the current implementation is environment-aware:

- It prefers the project's `.venv` / `venv` when present.
- It falls back to `uv run --project <dir> python` when a `pyproject.toml` or `uv.lock` exists and `uv` is available.
- If neither exists, it falls back to the active system Python (`py`, `python3`, `python`).
- It parses Python with the real `ast` module rather than regex, so methods, imports, decorators, return annotations, and complexity are structurally extracted.

For Java, the source analysis is CST-based via `java-parser`, so package/import/class/interface/enum/method extraction is structural rather than regex-driven.

## Output handling

### Text (default) vs JSON

`--json` (or `--format json`) switches to a stable structured payload. **Always prefer JSON when downstream parsing or further reasoning is needed** — the text format is decorated with emojis and section headers that are hard to parse reliably.

The JSON envelope has this top-level shape (full schema in [references/cli-flags.md](./references/cli-flags.md#json-output-schema)):

```jsonc
{
  "schemaVersion": 1,
  "package": "zod",
  "version": "4.3.6",
  "exports": { "total": 3, "functions": [...], "classes": [...], "objects": [...], "constants": [...] },
  "types":   { "source": "index.d.cts", "functions": {...}, "interfaces": {...}, "classes": {...}, "types": {...}, "enums": {...} },
  "docs":    { ... },        // only if --docs / --docs-sections / --list-sections
  "examples":{ ... },        // only if --examples
  "resolution": { "resolveCwd": "...", "entrypointPath": "...", "entrypointExists": true },
  "meta":    { ... },
  "warnings":[]
}
```

### Large outputs — keep responses focused

If a response is going to be enormous (e.g. inspecting a huge package without filters), proactively add one of:

- `--filter <name>` — focuses on one symbol or substring
- `--search <query>` — semantic narrowing
- `--max-exports N` — caps the export list (default 100)
- `--max-props N` — caps nested object props at `--depth>0` (default 10)
- `--max-examples N` — caps examples (default 10)
- `--docs-sections X` — fetches only specific README sections instead of the full preview

## Common gotchas

- **Wrong package resolves.** DepLens uses Node's resolver from `cwd`. If `node_modules/<pkg>` is in a parent dir but not the current one, pass `--resolve-from <dir>` pointing at a folder that does have access to it (typically the workspace root). Inside a monorepo, also consider `cd`-ing into the workspace whose `node_modules` exposes the target.
- **Python package resolution differs from Node.** When `--language python` is used, Deplens can resolve either a local Python project path or an installed package visible to the chosen Python runtime. If analysis looks stale or wrong, run from the project root that contains `.venv`, `venv`, `pyproject.toml`, or `uv.lock`, or pass `--resolve-from <dir>` pointing there.
- **`@types/<pkg>` not picked up.** This only happens automatically when the target package itself has no `types`/`typings`/exports-defined `.d.ts`. If types still come back empty, re-run with `--types` and check the `warnings[]` in JSON output.
- **`--remote` first run is slow.** It hits the npm registry / CDN; subsequent calls hit the cache. `deplens cache stats` shows what's cached; `deplens cache clear [pkg?]` purges it.
- **JSDoc requires `.d.ts` parsing.** `--jsdoc-output section` / `inline` / `only` all run the `.d.ts` parser internally. If a package has no shipped types and no `@types/<pkg>` package, JSDoc will be empty.
- **stdout discipline.** In `--json` mode, stdout is pure JSON and errors go to stderr — safe to pipe into `jq` or another parser. In default text mode, decorations make parsing unreliable; switch to `--json`.

## Composition with other tools

After producing the JSON, downstream processing can use:

- `jq '.exports.functions[]'` — list functions
- `jq '.types.functions | keys'` — list typed symbol names
- `jq '.types.functions["generateText"]'` — pull one symbol's signature
- Pipe into a file and feed back to a follow-up prompt for further analysis.

## References

For exhaustive details, consult:

- [references/cli-flags.md](./references/cli-flags.md) — full flag matrix for both `inspect` and `diff`, environment variables, JSON schema
- [references/recipes.md](./references/recipes.md) — longer end-to-end workflows (extract one symbol's full doc + signature + examples; audit a major version bump; build a dependency-API map for an LLM)
