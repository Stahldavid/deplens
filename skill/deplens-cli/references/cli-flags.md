# DepLens CLI — Full Flag Reference

This document enumerates every flag of `deplens inspect` (default subcommand) and `deplens diff`, plus the cache/history subcommands, environment variables, and JSON output schema. Pair with the main [SKILL.md](../SKILL.md) workflows.

## Commands

```
deplens <pacote> [filtro] [opções]
deplens inspect <pacote> [filtro] [opções]
deplens diff <pacote> [opções]
deplens cache [stats|clear] [pacote?]
deplens history [list|show|compare|clear] [args…]
```

Positional `[filtro]` is shorthand for `--filter`. The default subcommand is `inspect`.

---

## `deplens inspect` flags

### Filtering and search

| Flag                 | Type      | Default | Effect                                                                                         |
| -------------------- | --------- | ------- | ---------------------------------------------------------------------------------------------- |
| `--filter VALUE`     | string    | —       | Case-insensitive substring match on export names. Use `/regex/` (mandatory slashes) for regex. |
| `--search QUERY`     | string    | —       | Semantic search (token matching + JSDoc) over export names. Has built-in synonym expansion.    |
| `--kind f,c,o,k,i,t` | csv       | —       | Restrict by kind: `function`, `class`, `object`, `constant`, `interface`, `type`.              |
| `--max-exports N`    | int       | 100     | Cap on the number of exports rendered/returned.                                                |
| `--max-props N`      | int       | 10      | Cap on nested object props rendered when `--depth>0`.                                          |
| `--depth N`          | int (0-5) | 1       | Object inspection depth.                                                                       |

### Types

| Flag                       | Type | Default | Effect                                                                                                                                                                |
| -------------------------- | ---- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--types`                  | flag | off     | Parse `.d.ts`, return function signatures, interfaces, classes, types, enums. Auto-generates if missing (via `dts-gen` when available). Falls back to `@types/<pkg>`. |
| `--no-auto-generate-types` | flag | off     | Disable the `dts-gen` fallback.                                                                                                                                       |

### Documentation (README)

| Flag                        | Type | Default | Effect                                                                     |
| --------------------------- | ---- | ------- | -------------------------------------------------------------------------- |
| `--docs` / `--include-docs` | flag | off     | Include a README preview (first ~4000 chars).                              |
| `--list-sections`           | flag | off     | List README section headers (level, title, has code, char count).          |
| `--docs-sections S1,S2,…`   | csv  | —       | Extract specific sections by header name (case-insensitive partial match). |

### Examples

| Flag                                | Type | Default | Effect                                                                                  |
| ----------------------------------- | ---- | ------- | --------------------------------------------------------------------------------------- |
| `--examples` / `--include-examples` | flag | off     | Include code fences from README, files from `examples/`, and `@example` JSDoc snippets. |
| `--max-examples N`                  | int  | 10      | Cap on the number of examples.                                                          |

### JSDoc

| Flag                                        | Type                                | Default                              | Effect                                                    |
| ------------------------------------------- | ----------------------------------- | ------------------------------------ | --------------------------------------------------------- |
| `--jsdoc off\|compact\|full`                | enum                                | off                                  | JSDoc verbosity.                                          |
| `--jsdoc-output off\|section\|inline\|only` | enum                                | off / `section` if jsdocQuery passed | Where to render JSDoc. `only` suppresses everything else. |
| `--jsdoc-symbol NAME\|glob\|/re/`           | string                              | —                                    | Restrict JSDoc to specific symbols (comma-separated).     |
| `--jsdoc-sections s1,s2,…`                  | csv (`summary,params,returns,tags`) | —                                    | Which JSDoc sections to render.                           |
| `--jsdoc-tags t1,t2,…`                      | csv                                 | —                                    | Include only these tag names.                             |
| `--jsdoc-tags-exclude t1,t2,…`              | csv                                 | —                                    | Exclude these tag names.                                  |
| `--jsdoc-truncate none\|sentence\|word`     | enum                                | `word`                               | How to truncate long summaries.                           |
| `--jsdoc-max-len N`                         | int                                 | (mode default)                       | Max chars per summary.                                    |

### Source code analysis

| Flag                                                        | Type | Default | Effect                                                                                       |
| ----------------------------------------------------------- | ---- | ------- | -------------------------------------------------------------------------------------------- |
| `--analyze-source`                                          | flag | off     | Walk source files, report function/class counts, approximate cyclomatic complexity, imports. |
| `--language javascript\|typescript\|python\|java\|rust\|go` | enum | auto    | Force language detection. Rust/Go currently return an explicit unsupported-analysis warning. |
| `--source-max-files N`                                      | int  | 5       | Max source files to analyze.                                                                 |
| `--source-include-body`                                     | flag | off     | Include function body snippets in source analysis.                                           |

Python source analysis prefers `.venv` / `venv`, then `uv run --project`, then the system Python runtime. Java source analysis uses a best-effort built-in parser.
JS/TS source analysis recognizes ESM exports, default exported functions, and common CommonJS assignment patterns such as `exports.foo`, `module.exports.foo`, and `module.exports = { foo() {} }`.

### Resolution

| Flag                            | Type   | Default               | Effect                                                                                            |
| ------------------------------- | ------ | --------------------- | ------------------------------------------------------------------------------------------------- |
| `--resolve-from DIR`            | path   | cwd                   | Base directory for Node module resolution. Useful when targeting a sibling workspace.             |
| `--remote`                      | flag   | off                   | Download the package into `~/.deplens-cache/versions/` and inspect that copy.                     |
| `--remote-version V`            | string | `latest`              | Version to download (only with `--remote`).                                                       |
| `--no-runtime`                  | flag   | off                   | Do not import/require the package entrypoint; use static package/type data only.                  |
| `--runtime`                     | flag   | local on / remote off | Force runtime import for remote inspections. Local inspect imports runtime unless `--no-runtime`. |
| `--prefer-cdn` / `--prefer-npm` | flag   | `--prefer-npm`        | Use CDN tarball (jsdelivr/unpkg) vs `npm install`. CDN is faster; npm is canonical.               |

### Output

| Flag                  | Type | Default | Effect                         |
| --------------------- | ---- | ------- | ------------------------------ |
| `--format text\|json` | enum | `text`  | Output format.                 |
| `--json`              | flag | off     | Shorthand for `--format json`. |

### History

| Flag                | Type | Default              | Effect                                                            |
| ------------------- | ---- | -------------------- | ----------------------------------------------------------------- |
| `--save-history`    | flag | off                  | Persist this inspection to `~/.deplens/history/<pkg>@<ver>.json`. |
| `--no-save-history` | flag | off                  | Force disable history (overrides `--save-history`).               |
| `--history-dir DIR` | path | `~/.deplens/history` | Custom history directory.                                         |

---

## `deplens diff` flags

| Flag                            | Type   | Default        | Effect                                                               |
| ------------------------------- | ------ | -------------- | -------------------------------------------------------------------- |
| `--from VERSION`                | string | `installed`    | Source version. Accepts a concrete semver, `installed`, or `latest`. |
| `--to VERSION`                  | string | `latest`       | Target version. Same accepted values.                                |
| `--filter VALUE`                | string | —              | Substring / `/regex/` filter on export names.                        |
| `--format text\|json`           | enum   | `text`         | Output format.                                                       |
| `--json`                        | flag   | off            | Shorthand for `--format json`.                                       |
| `--include-source`              | flag   | off            | Compare per-symbol source complexity between versions.               |
| `--no-runtime`                  | flag   | implicit       | Keep diff on static package/type data only.                          |
| `--runtime`                     | flag   | off            | Import downloaded package entrypoints while diffing.                 |
| `--no-changelog`                | flag   | off (parse on) | Skip `CHANGELOG.md` parsing (much faster on huge changelogs).        |
| `--verbose`                     | flag   | off            | Show detailed per-symbol changes.                                    |
| `--no-color`                    | flag   | off            | Disable ANSI color codes in text output.                             |
| `--project-dir DIR`             | path   | cwd            | Working directory used when `--from installed`.                      |
| `--prefer-cdn` / `--prefer-npm` | flag   | `--prefer-npm` | Same as inspect's CDN preference.                                    |

---

## Cache subcommands

```bash
deplens cache              # alias for cache stats
deplens cache stats        # fast summary using cached metadata
deplens cache stats --exact # recalculate recursive directory sizes
deplens cache clear        # clear all cached versions
deplens cache clear <pkg>  # clear cache for one package
```

Fast stats do not walk every cached package. Entries without metadata may report
`unknown` size until a future exact stats run or cache refresh records size data.

Cache lives in `~/.deplens-cache/`:

- `versions/` — packages downloaded via `--remote`
- `parse/` — parsed `.d.ts` files (memoization)
- `types/` — generated/transformed types

## History subcommands

```bash
deplens history list                     # all entries
deplens history list <filter>            # filter by name
deplens history show zod                 # most recent entry for zod
deplens history show zod@4.3.6           # exact version
deplens history compare zod 4.3.6 4.4.0  # diff two entries
deplens history clear [pkg]              # clear all or one
deplens history … --history-dir DIR      # use a non-default location
```

History entries store a full `runInspect` JSON payload. Useful for time-travel diffs and reproducible reports.

---

## Environment variables

| Variable             | Effect                                                            |
| -------------------- | ----------------------------------------------------------------- |
| `DEPLENS_ROOT`       | Default `rootDir` if not provided (MCP server uses this too).     |
| `DEPLENS_DEBUG=true` | Verbose debug logs to stderr (CLI + MCP). Never writes to stdout. |

---

## JSON output schema

`schemaVersion: 1` (current).

### `inspect` payload

```jsonc
{
  "schemaVersion": 1,
  "package": "zod",
  "version": "4.3.6",
  "description": "TypeScript-first schema declaration and validation library …",
  "resolution": {
    "target": "zod",
    "resolveFrom": "/abs/path",
    "resolveCwd": "/abs/path",
    "resolved": "/abs/path/node_modules/zod/index.js",
    "entrypointPath": "/abs/path/node_modules/zod/index.js",
    "entrypointExists": true
  },
  "exports": {
    "total": 3,
    "functions": ["ZodString", "ZodStringFormat", "_ZodString"],
    "classes":   [],
    "objects":   [],
    "constants": []
  },
  "staticExports": {
    "total": 3,
    "names": ["ZodString", "ZodStringFormat", "_ZodString"]
  },
  "types": {
    "source": "index.d.cts",
    "functions": {
      "<name>": { "params": "<formatted params string>", "returnType": "<type>" }
    },
    "interfaces": { "<name>": ["field: Type", "method(arg: Type): Return"] },
    "types":      { "<name>": "<type alias body>" },
    "classes":    { "<name>": "<extends clause or null>" },
    "enums":      { "<name>": { /* members */ } }
  },
  "docs":     { "readme": "<text>", "truncated": false } | { "sections": [...] },
  "sections": [ { "level": 1, "title": "Installation", "hasCode": true, "charCount": 132 } ],
  "examples": {
    "readme": [ { "lang": "ts", "code": "…" } ],
    "files":  [ { "path": "examples/basic.ts", "code": "…" } ],
    "jsdoc":  [ { "symbol": "generateText", "code": "…" } ]
  },
  "meta": {
    "target": "zod",
    "includeDocs": false,
    "showTypes": true,
    "format": "json",
    "maxExports": 100,
    "maxProps": 10,
    "maxExamples": 10
  },
  "warnings": []
}
```

`exports` describes runtime introspection. `staticExports` is derived from the public
declaration surface and remains available when runtime loading is disabled. The expanded
`types` object is included when `--types` or JSDoc extraction is requested.

Optional extension fields (only when relevant flags are passed):

- `sourceAnalysis: { files: number, summary: { totalFunctions, totalClasses, avgComplexity, … } }`
- `languageAnalysis: { language: 'javascript'|'typescript'|'python'|'java', files: number, summary: { … } }`
- `pkgDir: "/abs/path/to/package/root"` (always populated for chaining with other tooling)

### `diff` payload

```jsonc
{
  "schemaVersion": 1,
  "package": "zod",
  "from": "3.22.0",
  "to": "3.24.0",
  "output": "<full text rendering, or null in non-text formats>",
  "summary": { "breaking": 0, "warnings": 0, "additions": 2, "removals": 0 },
  "changes": [
    { "kind": "addition", "name": "deepClone", "details": "…" },
    { "kind": "breaking", "name": "ZodString.url", "details": "signature changed" },
  ],
}
```

Some diff implementations emit a more granular structure under `diff.{breaking,warnings,additions,info}[]` which the MCP wrapper flattens into `changes[]` for convenience.
