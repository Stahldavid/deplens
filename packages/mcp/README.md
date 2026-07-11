# @deplens/mcp

Model Context Protocol (MCP) server for DepLens. Exposes six package-analysis tools over **stdio** transport:

- `deplens_inspect` — package exports, types (.d.ts), README docs/sections, examples, JSDoc, source analysis
- `deplens_diff` — semver diff between two versions (uses `CHANGELOG.md` when available)
- `deplens_doctor` — package resolution and runtime/type diagnostics
- `deplens_project_diff` — project dependency changes between lockfiles or Git refs
- `deplens_check` — baseline and policy enforcement for dependency upgrades
- `deplens_versions` — latest and recent npm package versions

Built on the modern `McpServer` / `registerTool` API of the [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) (≥ 1.18) with **Zod input validation**, **`structuredContent`** outputs, and proper [tool annotations](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-annotations).

## Run

```bash
npx --yes @deplens/mcp
```

If your MCP host requires `command + args`:

```json
{ "command": "npx", "args": ["--yes", "@deplens/mcp"] }
```

Or install once and call the binary:

```bash
npm i -g @deplens/mcp
```

```json
{ "command": "deplens-mcp" }
```

Or point directly to the local bin:

```json
{ "command": "node", "args": ["./node_modules/@deplens/mcp/bin/deplens-mcp.js"] }
```

This starts an MCP server over stdio.

## Tools

All tools always populate `structuredContent` in addition to the text channel. Analysis tools are
marked non-read-only because remote inspection writes a local cache and explicit runtime
inspection executes package entrypoints.

### `deplens_inspect`

Inspect an installed (or remotely downloaded) npm package.

| Param               | Type                                                                 | Description                                                                      |
| ------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `target`            | string **(required)**                                                | Package name or import path (e.g. `react`, `next/server`, `@scope/pkg`)          |
| `subpath`           | string                                                               | Optional subpath appended to `target`                                            |
| `filter`            | string                                                               | Case-insensitive substring filter, or `/regex/`                                  |
| `kind`              | `('function'\|'class'\|'object'\|'constant'\|'interface'\|'type')[]` | Restrict by export kind                                                          |
| `showTypes`         | boolean                                                              | Parse `.d.ts` and include function signatures, interfaces, classes, types, enums |
| `includeDocs`       | boolean                                                              | Include README preview                                                           |
| `listSections`      | boolean                                                              | List README section headers                                                      |
| `docsSections`      | string[]                                                             | Extract specific README sections by name (partial match)                         |
| `includeExamples`   | boolean                                                              | Include code from README, `examples/`, and `@example` JSDoc tags                 |
| `search`            | string                                                               | Semantic search over export names (token matching + JSDoc)                       |
| `remote`            | boolean                                                              | Download into local cache instead of resolving from `rootDir`                    |
| `remoteVersion`     | string                                                               | Version to download when `remote=true` (default: `"latest"`)                     |
| `runtime`           | boolean                                                              | Explicitly import/require the package entrypoint. Defaults off                   |
| `format`            | `'text'\|'json'\|'object'`                                           | Output format for the text channel. `structuredContent` is always populated.     |
| `maxExports`        | number (1–10000)                                                     | Max exports to include (default: 100)                                            |
| `maxSymbols`        | number (1–5000)                                                      | Max canonical symbols in structured output (default: 250)                        |
| `maxProps`          | number (1–1000)                                                      | Max props per object when `depth>0` (default: 10)                                |
| `maxExamples`       | number (1–100)                                                       | Max examples (default: 10)                                                       |
| `depth`             | number (0–5)                                                         | Object inspection depth (default: 1)                                             |
| `resolveFrom`       | string                                                               | Base directory for module resolution. Defaults to `rootDir`.                     |
| `rootDir`           | string                                                               | Working directory (default: `$DEPLENS_ROOT` or `process.cwd()`)                  |
| `jsdoc`             | `'off'\|'compact'\|'full'`                                           | JSDoc verbosity mode                                                             |
| `jsdocOutput`       | `'off'\|'section'\|'inline'\|'only'`                                 | Where to render JSDoc                                                            |
| `jsdocQuery`        | object                                                               | Fine-grained JSDoc extraction, including `maxParams` and `paramCursor`           |
| `analyzeSource`     | boolean                                                              | Analyze JS/TS/Python/Java source for implementation details + complexity         |
| `sourceMaxFiles`    | number (1–500)                                                       | Max source files to analyze (default: 5)                                         |
| `sourceIncludeBody` | boolean                                                              | Include function body snippets                                                   |
| `language`          | `'javascript'\|'typescript'\|'python'\|'java'\|'rust'\|'go'`         | Force language detection                                                         |
| `detail`            | `'compact'\|'full'`                                                  | Versioned structured output projection                                           |
| `cursor`            | string                                                               | Resume symbol pagination                                                         |
| `conditions`        | string[]                                                             | Export conditions in priority order                                              |
| `cacheDir`          | string                                                               | Override the shared version cache                                                |
| `timeoutMs`         | number                                                               | Bound registry/download work                                                     |

**Example call:**

```json
{
  "name": "deplens_inspect",
  "arguments": {
    "target": "ai",
    "showTypes": true,
    "filter": "generate",
    "resolveFrom": ".",
    "jsdocOutput": "section",
    "jsdocQuery": {
      "symbols": "generateText",
      "sections": ["summary", "params", "returns"],
      "tags": { "include": ["param", "returns"] },
      "mode": "compact",
      "maxParams": 5
    }
  }
}
```

### `deplens_diff`

Compare two versions of an npm package.

| Param              | Type                       | Description                                                                                  |
| ------------------ | -------------------------- | -------------------------------------------------------------------------------------------- |
| `package`          | string **(required)**      | Package name to compare                                                                      |
| `from`             | string                     | Source version: a concrete semver, `"installed"` (default), or `"latest"`                    |
| `to`               | string                     | Target version: a concrete semver, `"latest"` (default), or `"installed"`                    |
| `filter`           | string                     | Filter exports by name (substring or `/regex/`)                                              |
| `format`           | `'text'\|'json'\|'object'` | Output format for the text channel                                                           |
| `includeSource`    | boolean                    | Include source code complexity comparison                                                    |
| `runtime`          | boolean                    | Import package entrypoints while diffing. Defaults off for safer static comparison           |
| `preferCdn`        | boolean                    | Prefer lightweight CDN downloads instead of full npm installs                                |
| `offline`          | boolean                    | Use only versions already present in the local DepLens cache                                 |
| `includeChangelog` | boolean                    | Parse `CHANGELOG.md` entries (default: `true`)                                               |
| `verbose`          | boolean                    | Show detailed per-symbol changes                                                             |
| `rootDir`          | string                     | Working directory for resolution of `from="installed"` (default: `$DEPLENS_ROOT` or `cwd()`) |
| `conditions`       | string[]                   | Export conditions in priority order                                                          |
| `semantic`         | boolean                    | TypeScript assignability validation (default: true)                                          |
| `maxChanges`       | number                     | Changes per page                                                                             |
| `cursor`           | string                     | Resume change pagination                                                                     |

### Project tools

`deplens_project_diff` accepts `from`, `to`, `rootDir`, `lockfile`, `analyze`,
`includeTransitive`, `detail`, `maxChangesPerPackage`, `packageCursors`, `packageOnly`,
`strictPackageOnly`, `projectSnapshot`, `conditions`, and
timeout/cache controls. `from` and `to` can be Git refs, lockfile paths, or `working`. API
enrichment defaults to `detail: "compact"`, retaining package, summary, changes, semantic
compatibility, and per-package pagination. The default page size is 10; use `packageCursors`
to continue selected packages, `packageOnly` to omit unrelated work, and `projectSnapshot` to
reuse fingerprinted compact analysis. Use `strictPackageOnly` when an unmatched package filter
should mark the MCP result as an error. The result exposes `detailLevel`; use `detail: "full"`
for the rich per-package diff object.

`deplens_check` accepts a baseline path plus optional `config` and `failOn`. It returns a
structured policy result and marks the MCP result as an error when policy fails. Format `sarif`
is available for code-scanning integrations.

`deplens_doctor` mirrors the CLI Doctor report. `deplens_versions` is read-only and returns a
bounded list of published versions.

**Example call:**

```json
{
  "name": "deplens_diff",
  "arguments": { "package": "zod", "from": "3.22.0", "to": "3.23.0" }
}
```

## Environment

| Variable        | Effect                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| `DEPLENS_ROOT`  | Default `rootDir` if a tool call omits it.                             |
| `DEPLENS_DEBUG` | When set to `"true"`, emits debug logs to **stderr** (never `stdout`). |

## Requirements

- Node.js ≥ 22

## Development

```bash
npm run start            # run the MCP server
npm run inspector        # launch the MCP Inspector against this server
```

## Breaking changes in 0.2.0

- **Tool names**: `deplens.inspect` → `deplens_inspect`, `deplens.diff` → `deplens_diff`.
  Dots are not allowed by the MCP tool-name grammar; the new snake_case names match the spec and align with the rest of the MCP ecosystem.
- **Migration**: rename calls in your MCP host config. The input/output schemas are unchanged.

## License

MIT
