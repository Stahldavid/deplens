# DepLens

Dependency/API oracle for Node.js and TypeScript. DepLens inspects **what is actually installed**: runtime exports, type signatures, and JSDoc pulled from `.d.ts` files, without relying on the internet.

Use it to reduce API hallucination, verify exports, and quickly answer “does this symbol exist in my project?”

## Why DepLens

- **Local truth**: inspects the packages you have installed.
- **Runtime + types**: shows runtime exports and parsed type signatures.
- **JSDoc aware**: summaries, params/returns, and tag filters.
- **Workspace friendly**: `--resolve-from` for monorepos.
- **Fast**: Node-first with optional Bun acceleration.

## Packages

- `@deplens/core` — programmatic API
- `@deplens/cli` — CLI (`deplens`)
- `@deplens/mcp` — MCP server (`deplens-mcp`)

## Install

```bash
npm i -D @deplens/cli
# or
npx --yes @deplens/cli --help
```

## Quickstart

```bash
deplens ai --types --filter generate --resolve-from .
```

Example output (truncated):

```
🔍 Target: ai (Type Analysis)
🧭 Resolution:
   ResolveFrom: /path/to/project
   Entrypoint: /path/to/node_modules/ai/dist/index.mjs
📄 Package Info:
   Name: ai
   Version: 5.0.97
🔑 Exports Encontrados (100 total):
  📘 Functions (54):
     generateText, generateObject, generateImage, ...
🔬 Type Definitions Analysis:
  📘 Function Type Signatures:
     generateText(options: object): Promise<GenerateTextResult<...>>
```

## CLI Usage

```bash
deplens <package-or-import-path> [filter] [options]
deplens inspect <package> [filter] [options]
deplens diff <package> [options]
deplens project-diff [--from REF] [--to REF] [options]
deplens check --baseline FILE [options]
deplens cache [stats|clear|pin|migrate|prune] [options]
deplens history [list|show <pkg@v>|compare <pkg> <v1> <v2>|clear [pkg]]
```

### Inspection flags

```bash
--types                       Include type signatures (.d.ts)
--filter <text>               Substring filter for export names
--search <query>              Lightweight semantic search (token + JSDoc)
--kind <k1,k2>                Filter by kind (function,class,object,constant)
--depth <0-5>                 Object inspection depth (default: 1)
--resolve-from <dir>          Base directory for module resolution (workspaces)
--remote                      Download package to cache (no install required)
--remote-version <v>          Version for remote download (default: latest)
--no-runtime                  Skip importing/requiring the package entrypoint
--runtime                     Force runtime import (remote inspect defaults static)
--prefer-cdn                  Prefer lightweight CDN download
--prefer-npm                  Force npm install [default]
--docs                        Include README preview
--list-sections               List available README section names
--docs-sections <s1,s2>       Extract specific README sections by name
--examples                    Include code examples from README/@example tags
--format text|json            Output format (default: text)
--json                       Shorthand for --format json
--detail compact|full        Versioned JSON projection (inspect schema v2)
--select <sections>          Select JSON sections (CSV, repeatable, or --select=CSV)
--max-symbols <N>            Symbols per page
--cursor <value>             Resume symbol/change pagination
--conditions <list>          Export conditions in priority order
--cache-dir <dir>            Override the shared version cache
--timeout <ms>               Bound registry/download/analysis work
--profile                    Include phase timings in metadata

## Multi-language & source analysis
--analyze-source              Analyze source code (JS/TS/Python/Java)
--source-max-files <N>        Maximum source files to analyze (default: 10)
--source-include-body         Include function body snippets in output
--language <lang>             Force language detection: javascript|typescript|python|java|rust|go
--auto-generate-types         Auto-generate .d.ts via dts-gen when missing [default]
--no-auto-generate-types      Disable automatic type generation

## History & caching
--save-history                Save analysis snapshot to ~/.deplens/history/
--history-dir <dir>           Custom history directory path
--cache                       (separate command) view/clear cache

## JSDoc flags
--jsdoc off|compact|full      JSDoc verbosity mode
--jsdoc-output off|section|inline|only  Where to place JSDoc in output
--jsdoc-symbol <name|glob|regex>  Filter symbols for JSDoc extraction
--jsdoc-sections <list>       Comma-separated: summary,params,returns,tags
--jsdoc-tags <t1,t2>          Include only these JSDoc tags
--jsdoc-tags-exclude <t1,t2>  Exclude these JSDoc tags
--jsdoc-truncate none|sentence|word  Truncation for long summaries
--jsdoc-max-len <N>           Maximum JSDoc length per symbol
```

### Diff flags

```bash
deplens diff <package> [options]

Flags:
  --from VERSION          Base version (default: currently installed)
  --to VERSION            Target version (default: latest)
  --filter <text>         Filter export name changes
  --format text|json      Output format
  --json                  Shorthand for --format json
  --prefer-cdn            Prefer lightweight CDN download
  --prefer-npm            Force npm install [default]
  --include-source        Include source complexity metrics in diff
  --no-runtime            Keep diff on static package/type data only [default]
  --runtime               Import downloaded package entrypoints while diffing
  --no-changelog          Skip remote changelog fetching
  --verbose               Show detailed per-export changes
  --no-color              Disable ANSI colors in text output
  --project-dir DIR       Base directory for installed version lookup
  --conditions LIST       Compare a specific export-condition surface
  --max-changes N         Changes per JSON page (default: 100)
  --cursor VALUE          Resume change pagination
  --no-semantic           Skip TypeScript assignability validation
```

### Project upgrades and CI policy

Compare dependency versions between lockfiles or Git refs. Direct dependencies are
the only changes returned and enriched with semantic API diffs by default. Add
`--include-transitive` to include the complete dependency graph, or use `--no-api`
for a fast lockfile-only pass. pnpm peer suffixes are normalized before comparison.

```bash
deplens project-diff --from HEAD~1 --to working --json
deplens project-diff --from HEAD~1 --to working --max-changes-per-package 10 --json
deplens project-diff --from HEAD~1 --to working --package-cursor @clerk/shared=10 --json
deplens project-diff --from-lock old-lock.json --to-lock package-lock.json --no-api
deplens project-diff --from-lock old-pnpm-lock.yaml --to-lock pnpm-lock.yaml --no-api
deplens project-diff --from HEAD~1 --to working --detail full --json
```

API enrichment is compact by default: each changed package keeps only `package`, `summary`,
`changes`, `semanticCompatibility`, and `pagination`. It returns at most 25 changes per package;
set `--max-changes-per-package N` (`--max-changes N` is an alias) and resume individual packages
with repeatable `--package-cursor PKG=N`. The top-level `detailLevel` records the selected
projection. Use `--detail full` for the legacy rich `runDiff` object, including `output` and
internal analysis snapshots.

Create a baseline once, then enforce it in CI. `check` exits non-zero when the configured
threshold is crossed and can emit SARIF for GitHub code scanning.

```bash
deplens check --write-baseline --baseline .deplens-baseline.json
deplens check --baseline .deplens-baseline.json --fail-on breaking
deplens check --baseline .deplens-baseline.json --format sarif > deplens.sarif
```

Optional `.deplensrc.json` / `deplens.config.json`:

```json
{
  "failOn": "breaking",
  "packages": {
    "legacy-package": { "allow": ["breaking"] },
    "generated-package": { "ignore": true }
  }
}
```

### Cache management

```bash
deplens cache stats              # Fast cache statistics from metadata
deplens cache stats --exact      # Recalculate recursive sizes
deplens cache clear [package]    # Clear all or specific package cache
deplens cache migrate --exact    # Move legacy aliases to exact versions and rebuild metadata
deplens cache prune --dry-run    # Preview stale, alias, and invalid entries
deplens cache prune --max-age-days 90 # Remove maintenance candidates
deplens cache prune --max-size 2GB --dry-run # Preview an LRU size limit
deplens cache prune --max-entries 100 # Keep the 100 most recently used entries
```

Fast cache stats avoid walking large cached packages. Older entries that do not
have size metadata may show `unknown`; run `cache migrate --exact` to normalize
legacy entries and calculate precise metadata. `cache prune` defaults to 90 days,
supports `--dry-run`, and accepts `--keep-aliases` when tag aliases must be retained.
All cache JSON commands return versioned `deplens-cache-*` envelopes and honor
`--cache-dir`, including `stats`, `clear`, `pin`, `migrate`, and `prune`.
Successful cache reads update `lastUsedAt`; size/count limits evict the least recently
used unlocked entries and report whether the requested limit could be satisfied.

Compact inspect JSON returns only `staticExports.total` by default. Select
`staticExports` explicitly to page names, and follow its nested `pagination` object.
Focused `--list-sections`, `--docs-for`, `--examples-for`, and JSDoc-only requests omit
symbol inventories unless selected. Compact source analysis includes its summary plus
separate `runtimeLanguage` and `sourceLanguage` fields.
Structured JSDoc entries contain canonical `name`, `summary`, and `tags` fields; the rendered
`text` form is kept only in human-readable output to avoid duplicating documentation in JSON.
`--analyze-source` is itself a focused request and omits symbols unless they are explicitly
selected with `--select sourceAnalysis,languageAnalysis,symbols`.

Packages that only expose a `bin` entry are reported as `metadataOnly` with
`entrypointExists: false` and an explicit warning instead of treating `package.json`
as an importable runtime module.

Source analysis recognizes ESM exports, default exported functions, and common
CommonJS assignment patterns such as `exports.foo`, `module.exports.foo`, and
`module.exports = { foo() {} }`.

Rust and Go layouts can be detected, but implementation analysis is not yet available;
requesting either language returns an explicit warning instead of an empty success.

### History management

```bash
deplens history list             # List all saved analyses
deplens history show <pkg[@v]>   # Show full JSON for one entry
deplens history compare <pkg> <v1> <v2>  # Semantic diff between versions
deplens history clear [pkg]      # Clear history (all or per-package)
```

### Examples

Inspect local package (types + search):

```bash
deplens zod --types --search validate --filter parse
```

Inspect remotely (no install) as JSON:

```bash
deplens zod --remote --remote-version latest --format json --filter parse
```

List README sections and extract specific ones:

```bash
deplens zod --docs --list-sections
# then

deplens zod --docs-sections "Getting Started,Usage" --format json
```

## MCP

DepLens ships an MCP server over **stdio** (`@deplens/mcp`) with `deplens_inspect`,
`deplens_diff`, `deplens_doctor`, `deplens_project_diff`, `deplens_check`, and
`deplens_versions`.

### Run

```bash
npx @deplens/mcp
```

If your MCP host expects a command + args, use one of:

```json
{ "command": "npx", "args": ["--yes", "@deplens/mcp"] }
```

```json
{ "command": "npm", "args": ["exec", "--", "@deplens/mcp"] }
```

If your environment has issues with `npx`/`npm exec`, install once and call the binary directly:

```bash
npm i -g @deplens/mcp
```

```json
{ "command": "deplens-mcp" }
```

Or point directly to the local bin if installed in a project:

```json
{
  "command": "node",
  "args": ["./node_modules/@deplens/mcp/bin/deplens-mcp.js"]
}
```

Note: `npm @deplens/mcp` is not a valid npm invocation and will print “Unknown command”.

### Configure (Claude Desktop / MCP hosts)

Most MCP hosts expect a JSON config with a server command.

Example config snippet:

```json
{
  "mcpServers": {
    "deplens": {
      "command": "npx",
      "args": ["--yes", "@deplens/mcp"],
      "env": {
        "DEPLENS_ROOT": "."
      }
    }
  }
}
```

### Tools

#### `deplens_inspect`

Recommended for agents: use `format: "json"` to avoid parsing human text.

Example tool call payload:

```json
{
  "target": "next/server",
  "showTypes": true,
  "filter": "NextResponse",
  "resolveFrom": ".",
  "format": "json",
  "docsSections": ["Usage", "API"],
  "includeExamples": true
}
```

The JSON response includes a `resolution` block to explain where DepLens resolved the module from:

```json
{
  "package": "next",
  "version": "14.2.0",
  "resolution": {
    "target": "next/server",
    "resolveFrom": ".",
    "resolveCwd": "C:\\path\\to\\project",
    "resolved": "C:\\path\\to\\project\\node_modules\\next\\server.js",
    "entrypointPath": "C:\\path\\to\\project\\node_modules\\next\\server.js",
    "entrypointExists": true
  }
}
```

#### `deplens_diff`

Compare two versions of a package. Useful for upgrade planning and identifying breaking changes.
Compact semantic results include up to ten diagnostics responsible for
`semanticCompatible: false`; the total and truncation state remain explicit.
Nominal incompatibilities caused only by isolated `unique symbol` or private-class identities
are counted under `ignoredDiagnosticCount` instead of failing assignability. Full detail keeps
the ignored diagnostic records for auditing.

```json
{
  "package": "zod",
  "from": "3.22.0",
  "to": "latest"
}
```

## Programmatic API

```js
import { runInspect } from '@deplens/core';

const output = await runInspect({
  target: 'ai',
  showTypes: true,
  filter: 'generate',
  resolveFrom: process.cwd(),
});

console.log(output);
```

## Requirements

- Node.js >= 22
- Bun is optional runtime acceleration; npm is the canonical package fetcher.

## License

MIT
