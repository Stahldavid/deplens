# DepLens CLI — Recipes

Read the [execution gates](../SKILL.md#before-running) before using any command here. Remote/diff may contact registries and write caches; local inspect imports entrypoints unless --no-runtime. Redirects, baselines, snapshots, history and maintenance have write effects. Examples do not authorize installation or cleanup.

End-to-end workflows that combine multiple flags to answer specific kinds of questions. Each recipe lists the user-facing question, the exact command, what it returns, and how to interpret the output.

## Quickly answer "what does function X do?"

**Question:** "What does `generateText` do in the `ai` package?"

```bash
deplens ai \
  --filter generateText \
  --jsdoc-symbol generateText \
  --jsdoc full \
  --jsdoc-output only \
  --jsdoc-sections summary,params,returns \
  --json
```

**Returns:** A focused JSON payload with `jsdoc.entries` and no unrelated export/type/symbol inventories. Read the entry with `jq '.jsdoc.entries[] | select(.name=="generateText")'`.

**Why each flag:** `--filter generateText` narrows declaration parsing. `--jsdoc-symbol generateText` selects the exact documented export. `--jsdoc full` keeps the full description. `--jsdoc-output only` suppresses inventories. `--json` makes the response parseable.

---

## Map a package's full API surface (for an LLM context window)

**Question:** "Give me a compact overview of every public function and class in `@tanstack/router`."

```bash
deplens @tanstack/router \
  --remote \
  --types \
  --kind function,class \
  --max-exports 300 \
  --json > tanstack-router-api.json
```

**Returns:** A trimmed JSON file with just functions and classes (no objects, constants), capped at 300 entries, suitable for feeding back into a follow-up prompt.

**Tip:** Add `--analyze-source` if implementation complexity matters; omit `--remote` if the package is already installed locally.

---

## Audit a major version bump

**Question:** "I'm bumping `react` from 18.2 to 19.0 — what breaks?"

```bash
deplens diff react --from 18.2.0 --to 19.0.0 --verbose --json > react-19-diff.json
```

**Then:**

```bash
jq '.summary' react-19-diff.json
jq '.changes[] | select(.kind=="breaking")' react-19-diff.json
```

**Returns:** The full diff plus a JSON list of every breaking change. Pair with `--include-source` to also see per-symbol complexity deltas (handy when reading the upgrade guide).

---

## Compare a project without flooding agent context

```bash
deplens project-diff --from HEAD~1 --to working --json
```

Each package's `api` field is compact by default. Use `--no-api` for version-only lockfile changes,
or `--detail full` only when a complete internal package diff is explicitly required. Large package
diffs return 10 changes plus `api.pagination`. Save the first analysis, then continue one package
without returning or reanalyzing the others:

```bash
deplens project-diff --from HEAD~1 --to working \
  --project-snapshot .deplens-project.json \
  --package-only @clerk/shared \
  --package-cursor @clerk/shared=10 \
  --json
```

---

## Find functions by intent, not by name

**Question:** "Is there something in `lodash` to deep-merge two objects?"

```bash
deplens lodash --search "deep merge" --types --json
```

**Returns:** Names of matching exports plus their signatures. Synonym expansion in `--search` covers `validate↔parse`, `auth↔token`, `http↔fetch/request`, `schema↔shape/struct` — so "merge" might also surface `assignDeep`/`mergeWith` via shared tokens.

---

## Pull just the Installation + Quick Start of a package README

**Question:** "Show me how to install and get started with `prisma`."

```bash
deplens prisma --docs-sections Installation,Quick,"Getting started" --json
```

**Notes:**

- Section matching is case-insensitive and partial — `"Quick"` matches both `"Quick Start"` and `"Quickstart"`.
- Use `--list-sections` first if the headers are unknown.

---

## Inspect a package in the cache without adding it to the project

**Question:** "What's in `bun` 1.2 without adding it to my project?"

```bash
deplens bun --remote --remote-version 1.2.0 --types --kind function,class --json
```

The default fetcher runs npm install with lifecycle scripts disabled in a staging cache; --prefer-cdn tries archives and falls back to npm if unavailable. Neither adds the package to the inspected project. **Subsequent runs hit the cache** at `~/.deplens-cache/versions/bun@1.2.0/`. To purge: `deplens cache clear bun`.

---

## Compare the locally-installed version against the latest published

**Question:** "Has anything broken in `zod` since I installed it?"

```bash
deplens diff zod --json | jq '.summary, .changes[] | select(.kind=="breaking")'
```

`--from` and `--to` default to `installed` and `latest` respectively, so no version flags needed.

---

## Save a historical snapshot for later comparison

**Question:** "I want to compare my current inspection of `next` against a future re-inspection."

```bash
# Today
deplens next --types --docs --save-history --json > /dev/null

# Tomorrow (after upgrading next)
deplens next --types --docs --save-history --json > /dev/null

# Compare the two stored snapshots
deplens history list next
deplens history compare next 14.2.5 14.3.0
```

History entries are JSON dumps stored under `~/.deplens/history/`. Move them with `--history-dir <path>` for team-shared baselines.

---

## Use within a monorepo where the package lives in a sibling workspace

**Question:** "Inspect `@my-org/utils` from any directory inside this monorepo."

```bash
# From repo root, with @my-org/utils installed in packages/utils/node_modules
deplens @my-org/utils --resolve-from ./packages/some-app

# Or simpler: run from the workspace that actually depends on it
cd packages/some-app && deplens @my-org/utils
```

`--resolve-from` accepts an absolute or relative path; deplens runs Node module resolution from there.

---

## Stream the source-code body of one function

**Question:** "Show me the implementation of `parse` in `zod`'s source code."

```bash
deplens zod --filter parse --analyze-source --source-include-body --source-max-files 20 --json \
  | jq '.sourceAnalysis // .languageAnalysis'
```

Useful for "is this method as complex as I think?" or "does the source confirm what the docs say?".

---

## Build a one-shot dependency map for a deps audit

**Question:** "Build a JSON file with every direct dependency's API summary."

```bash
# Read direct deps
jq -r '.dependencies | keys[]' package.json > /tmp/direct-deps.txt

# Inspect each in JSON and concat
echo '[' > deps-audit.json
first=1
while read pkg; do
  if [ $first -eq 0 ]; then echo ',' >> deps-audit.json; fi
  deplens "$pkg" --types --kind function,class --max-exports 100 --json >> deps-audit.json
  first=0
done < /tmp/direct-deps.txt
echo ']' >> deps-audit.json
```

Each entry follows the schema in [cli-flags.md](./cli-flags.md#inspect-payload). Feed the resulting file into a follow-up prompt that asks for cross-package patterns or duplicated functionality.

---

## Decide between `inspect` and `diff` quickly

- **"What's in / about package X?"** → `inspect`
- **"What changed in package X (between two versions)?"** → `diff`
- **"What's installed vs latest?"** → `diff` with defaults
- **"What does the npm registry have for X@Y that's not on disk?"** → `inspect --remote --remote-version Y`

---

## When the output is too noisy

Symptoms: hundreds of unfiltered exports, full README dumped, a wall of type signatures.

Fix order (cheapest first):

1. Add `--filter <name>` if a specific symbol is targeted.
2. Add `--search <intent>` if the name isn't known.
3. Add `--kind function` (or whatever kind matters) to drop the rest.
4. Lower `--max-exports` / `--max-props` / `--max-examples`.
5. Switch from `--docs` to `--docs-sections X,Y`.
6. Move from `--jsdoc full` to `--jsdoc compact` (or `--jsdoc-truncate sentence`).
7. As a last resort, switch to `--format json` and let downstream `jq` pick fields.

## CLI workflow details

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
deplens ai --filter generateText --jsdoc-symbol generateText --jsdoc full --jsdoc-output only --jsdoc-sections summary,params,returns
```

`--jsdoc-output only` suppresses inventories and emits a focused `jsdoc.entries` section.
Plain `--jsdoc-symbol` values are exact; use a glob or `/regex/` for multiple symbols.

### 7. Diff two versions of a package

```bash
deplens diff zod --from 3.22.0 --to 3.24.0
deplens diff zod                              # defaults: from=installed, to=latest
deplens diff zod --from installed --to latest --verbose
deplens diff zod --include-source             # also compares per-symbol complexity
deplens diff zod --no-changelog               # skip CHANGELOG.md parsing
```

Returns: breaking changes, warnings, additions, removals, optional changelog excerpt.

Large JSON diffs are cursor-paginated. Use `--max-changes N --cursor VALUE` to continue.
Semantic TypeScript assignability is enabled by default; `--no-semantic` is the fast fallback.
When semantic compatibility is false, compact JSON includes up to three causal diagnostics plus
`diagnosticCount` and `diagnosticsTruncated`; long messages include `messageTruncated: true`.
Nominal identity mismatches caused only by isolated `unique symbol` or private-class declarations
are reported through `ignoredDiagnosticCount` instead of making the package incompatible.

### 8. Compare a project and enforce a baseline

```bash
deplens project-diff --from HEAD~1 --to working --json
deplens project-diff --from HEAD~1 --to working --max-changes-per-package 10 --json
deplens project-diff --from HEAD~1 --to working --project-snapshot .deplens-project.json --json
deplens project-diff --from HEAD~1 --to working --project-snapshot .deplens-project.json \
  --package-only @clerk/shared --package-cursor @clerk/shared=10 --json
deplens project-diff --from HEAD~1 --to working --package-only missing --strict-package-only --json
deplens project-diff --from HEAD~1 --to working --detail full --json
deplens check --write-baseline --baseline .deplens-baseline.json
deplens check --baseline .deplens-baseline.json --fail-on breaking --format sarif
```

Use `--no-api` for a registry-free lockfile-only comparison. Project analysis defaults to direct
dependencies; add `--include-transitive` only when the broader cost is justified.
API enrichment keeps only `package`, `summary`, `changes`, `semanticCompatibility`, and
`pagination` by default, with at most 10 changes per package. Use
`--max-changes-per-package N` (`--max-changes N` is an alias) and repeatable
`--package-cursor PKG=N` values to continue only the packages that need more context. Add
`--package-only PKG` so continuation omits every unrelated package. For repeated cursor calls,
write `--project-snapshot FILE` on the first call and reuse the same file; DepLens fingerprints
versions and analysis options and will not reuse stale results.
Use `--strict-package-only` when an unmatched package selector should be a non-zero structured
error for CI or automation.
Use `--detail full` only when the complete internal diff is required.

### 9. Inspect a package that isn't installed

```bash
deplens @tanstack/router --remote
deplens @tanstack/router --remote --remote-version 1.40.0
```

`--remote` downloads the package into `~/.deplens-cache/versions/` once and reuses it. Pair with any other flag (`--types`, `--docs`, etc.).

Use `--no-runtime` when inspecting untrusted packages and you only need static
package/type metadata. Runtime inspection imports the package entrypoint and may
execute package code. Remote inspections default to the safer static path unless
`--runtime` is explicitly supplied.

### 10. Semantic search across exports

```bash
deplens lodash --search "deep merge"
```

Token-matches the query (with synonym expansion: `validate ↔ parse`, `auth ↔ token`, etc.) against export names and JSDoc; falls back to fuzzy token scoring if no types are available.

### 11. Source-code analysis (JS / TS / Python / Java)

```bash
deplens zod --analyze-source --source-max-files 5
deplens some-python-pkg --analyze-source --language python
deplens some-java-pkg --analyze-source --language java
```

Walks the package's source files and reports function/class counts, complexity (approximate cyclomatic), imports, and body snippets when requested.
For JS/TS packages, source analysis recognizes ESM exports, default exported functions,
and common CommonJS assignments such as `exports.foo`, `module.exports.foo`, and
`module.exports = { foo() {} }`.

For Python, the current implementation is environment-aware:

- It prefers the project's `.venv` / `venv` when present.
- It falls back to `uv run --project <dir> python` when a `pyproject.toml` or `uv.lock` exists and `uv` is available.
- If neither exists, it falls back to the active system Python (`py`, `python3`, `python`).
- It parses Python with the real `ast` module rather than regex, so methods, imports, decorators, return annotations, and complexity are structurally extracted.
- Local path targets keep `pkgDir` anchored to the requested project root. The importable package
  directory is exposed as `resolution.moduleDir`; `src/` layouts are preferred over helper packages
  such as `tests/`.

For Java, source analysis uses a best-effort built-in parser for package/import/class/interface/enum/method extraction.

Rust and Go package layouts are detected, but implementation analysis is not yet available.
The CLI returns an explicit warning when either language is requested.
`--analyze-source` is a focused compact request and omits symbol/export inventories by default.
Add `--select sourceAnalysis,languageAnalysis,symbols` when source-linked symbols are required.

## Common gotchas

- **Wrong package resolves.** DepLens uses Node's resolver from `cwd`. If `node_modules/<pkg>` is in a parent dir but not the current one, pass `--resolve-from <dir>` pointing at a folder that does have access to it (typically the workspace root). Inside a monorepo, also consider `cd`-ing into the workspace whose `node_modules` exposes the target.
- **Python package resolution differs from Node.** When `--language python` is used, Deplens can resolve either a local Python project path or an installed package visible to the chosen Python runtime. If analysis looks stale or wrong, run from the project root that contains `.venv`, `venv`, `pyproject.toml`, or `uv.lock`, or pass `--resolve-from <dir>` pointing there.
- **`@types/<pkg>` not picked up.** This only happens automatically when the target package itself has no `types`/`typings`/exports-defined `.d.ts`. If types still come back empty, re-run with `--types` and check the `warnings[]` in JSON output.
- **`--remote` first run is slow.** It hits the npm registry / CDN; subsequent calls hit the cache. `deplens cache stats` shows what's cached; `deplens cache clear [pkg?]` purges it.
- **Cache sizes can be `unknown`.** `deplens cache stats` is fast by default and avoids recursively walking large package caches. Use `deplens cache stats --exact` when you need precise sizes.
- **Large cache stats.** Use `deplens cache stats --summary` to omit package entries, or `deplens cache stats --max-entries 25 --cursor 25` to page package metadata.
- **Legacy cache entries.** Use `deplens cache migrate --exact` to move tag aliases to exact versions and rebuild metadata. Preview cleanup with `deplens cache prune --dry-run`; pruning defaults to entries older than 90 days plus invalid/alias entries.
- **Large caches.** Run `deplens cache prune --max-size 2GB --dry-run` to preview an LRU size cap or `--max-entries 100` to keep the most recently used entries. Dry-run JSON keeps `removed: 0` and adds `wouldRemove` plus paginated `candidatesPreview`; continue with `--max-preview-entries N --cursor C`. Successful cache reads refresh `lastUsedAt`; active locks are never removed.
- **JSDoc requires `.d.ts` parsing.** `--jsdoc-output section` / `inline` / `only` all run the `.d.ts` parser internally. If a package has no shipped types and no `@types/<pkg>` package, JSDoc will be empty.
- **stdout discipline.** In `--json` mode, stdout is pure JSON. Argument errors are structured JSON with `errorInfo.code: "INVALID_ARGUMENT"` and exit code 2; malformed cursors, regex literals, enum values, and numeric limits are rejected before analysis. In default text mode, decorations make parsing unreliable; switch to `--json`.
- **Lockfile support.** `project-diff` and `check` accept npm `package-lock.json` v2/v3 and pnpm lockfiles with importers (pnpm v6+). Pass the actual path through `--lockfile`, `--from-lock`, or `--to-lock`.
- **Direct dependencies are the default.** `project-diff` returns only direct dependency changes unless `--include-transitive` is supplied. pnpm peer suffixes are normalized before version comparison.
- **Binary-only packages are metadata-only.** A package with `bin` but no importable entrypoint reports `resolution.metadataOnly: true`, `entrypointExists: false`, and a warning.
- **Cache JSON is versioned.** `stats`, `clear`, `pin`, `migrate`, and `prune` return `deplens-cache-*` envelopes and honor `--cache-dir`.
