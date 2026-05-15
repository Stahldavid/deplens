# Changelog

All notable changes to this project will be documented in this file. Each
package keeps its own version under [Semantic Versioning](https://semver.org/);
pre-1.0 minor bumps may contain breaking changes (called out explicitly).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## 2026-05-15 — `@deplens/core@0.1.7`, `@deplens/cli@0.1.7`, `@deplens/mcp@0.2.0`

### `@deplens/mcp@0.2.0` — modernization (BREAKING for tool names)

Rewritten on top of the modern `McpServer` + `registerTool` API in
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
`^1.29.0` with Zod input validation and proper tool annotations.

**Breaking changes:**

- **Tool names renamed** to comply with the MCP tool-name grammar
  (`^[a-zA-Z0-9_-]+$` — dots are not allowed).
  - `deplens.inspect` → `deplens_inspect`
  - `deplens.diff` → `deplens_diff`

  MCP host configurations referencing the old names need to be updated. Input
  and output schemas are unchanged.

**Added:**

- Zod schemas for both tools, validated by the SDK before reaching the handler.
  Invalid inputs now return a clear `-32602 Invalid arguments` with the offending
  enum values listed, instead of silently failing.
- Tool annotations: `readOnlyHint: true`, `destructiveHint: false`,
  `idempotentHint: true`, `openWorldHint: true`.
- `instructions` field in the initialize response describing the two tools and
  the `rootDir` / `DEPLENS_ROOT` working-directory contract.
- `CHARACTER_LIMIT` guard (100 000 chars) on text responses, with a hint pointing
  to `format: "json"` and `filter` / `maxExports` when truncated.
- `DEPLENS_DEBUG=true` enables stderr-only debug logs (never writes to stdout,
  which is the stdio transport).
- New scripts: `npm start`, `npm run inspector` (launches MCP Inspector).
- Server name now follows the convention: `deplens-mcp-server` (was `deplens`).

**Changed:**

- Bumped `@modelcontextprotocol/sdk` from `^1.25.1` to `^1.29.0`.
- Added `zod` `^3.25.0` as a direct dependency.
- Error handling: SDK now validates inputs; the handler only catches downstream
  core errors and returns them as `isError: true` with `structuredContent`
  preserved.

### `@deplens/core@0.1.7` — bug fixes

**Fixed:**

- `resolveTargetModule` no longer short-circuits on the workspace root's
  `package.json` when the user did not pass `--resolve-from`. Previously, any
  call from a workspace directory returned the workspace `package.json` as the
  entrypoint, causing exports to come back as the workspace's keys
  (`workspaces`, `scripts`, …) regardless of the target package.
- Text-mode `--types` output was empty because `getCachedDtsParse(dtsPath)` was
  invoked without `await`, leaving `typeInfoRaw` as an unresolved Promise. Added
  the missing `await` so the parsed type info actually populates the text
  rendering. JSON mode was unaffected.
- `inspect-types.mjs` previously used `process.env.HOME || '~'` to build the
  parse-cache directory, which on Windows produced a literal `./~/` folder in
  the current working directory. Switched to `os.homedir()` to match the rest
  of the codebase (`inspect-core.mjs`, `history-manager.mjs`,
  `version-resolver.mjs`).
- Python parser regex (`analyze-python.mjs`) now matches function definitions
  with return-type annotations (e.g. `def f(a: int) -> bool:`). Both top-level
  and method regexes were tightened to allow an optional `-> Type` between the
  closing `)` and the `:`.

**Tests:**

- `__tests__/language-detector.test.js` no longer hard-codes the Unix path
  `/tmp/deplens-lang-test`; uses `os.tmpdir()` so the suite runs on Windows
  too. Path-separator assertions updated similarly.
- Added Python fixtures referenced by `__tests__/analyze-python.test.js`:
  `fixtures/py_simple.py`, `fixtures/py_complex.py`, and
  `fixtures/python_samples/{function_simple,class_simple,malformed,filter_test,body_test,typehints,imports_test}.py`.
  Test suite is now 40/40 passing on both POSIX and Windows.

### `@deplens/cli@0.1.7` — dependency bump

**Changed:**

- Bumped `@deplens/core` from `0.1.6` to `0.1.7` to pick up the resolver,
  type-extraction, and HOME-path fixes above. No CLI surface change otherwise.

### Repo

**Added:**

- `skill/deplens-cli/` — a Claude Code skill teaching agents to drive the
  `deplens` CLI for npm package inspection and version diff. Includes
  `SKILL.md`, `references/cli-flags.md` (full flag matrix + JSON schema), and
  `references/recipes.md` (end-to-end workflows). See
  [skill/README.md](./skill/README.md) for installation.
- This `CHANGELOG.md` was updated after a long gap; previous releases between
  `0.1.3` and `0.1.6` are documented only in git history.

---

## 0.1.0 - 2025-12-27

- Initial standalone release of DepLens core and CLI.
- Runtime export inspection with safe object probing.
- Type parsing for .d.ts/.d.cts/.d.mts (functions, classes, interfaces, types, enums, namespaces).
- JSDoc extraction with compact/full modes and query filters.
- Node-first CLI with optional Bun acceleration.
- JSDoc query controls and output placement (section/inline/only).

## 0.1.1 - 2025-12-27

- Fix published CLI/MCP bins by shipping wrapper scripts under `bin/`.

## 0.1.2 - 2025-12-27

- Normalize `bin` entries for CLI/MCP packages and bump workspace versions.

## 0.1.3 - 2025-12-27

- Fix MCP core loading via lazy import + fallback to bundled core files.
- Document correct MCP invocation for npx/npm exec.
