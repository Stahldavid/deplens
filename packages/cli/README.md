# @deplens/cli

Command-line interface for DepLens.

## Install

```bash
npm i -g @deplens/cli
# or
npx --yes @deplens/cli --help
```

## Usage

```bash
deplens <package-or-import-path> [filter]
deplens inspect <package-or-import-path> [filter]
deplens diff <package> [options]
```

## Examples

```bash
# Inspect exports and types
deplens ai --types --filter generate

# Use a monorepo root for resolution
deplens next/server --types --resolve-from /path/to/repo

# Show only classes
deplens livekit-server-sdk --kind class --types

# JSDoc summary + params + returns
deplens ai --types \
  --jsdoc compact \
  --jsdoc-output section \
  --jsdoc-symbol generateText \
  --jsdoc-sections summary,params,returns \
  --jsdoc-tags param,returns \
  --jsdoc-truncate sentence \
  --jsdoc-max-len 220

# Diff package versions

deplens diff express --from 4.18.0 --to 4.19.0 --verbose
```

## Flags (inspect)

- `--types` — include type signatures from `.d.ts`
- `--filter <text>` — substring filter for exports
- `--search <query>` — semantic search (token match + JSDoc)
- `--kind <k1,k2>` — `function`, `class`, `object`, `constant`
- `--depth <0-5>` — object inspection depth
- `--resolve-from <dir>` — base directory for module resolution
- `--docs` — include README preview
- `--examples` — include code examples
- `--list-sections` — list README sections
- `--docs-sections <s1,s2>` — extract README sections
- `--remote` — download package to cache
- `--remote-version <v>` — remote version override
- `--no-runtime` — skip importing/requiring the package entrypoint
- `--runtime` — force runtime import for remote inspections
- `--max-exports <n>` — limit exports shown
- `--max-props <n>` — limit object props shown
- `--max-examples <n>` — limit examples shown
- `--select <a,b>` — select JSON sections; repeatable and also accepts `--select=a,b`
- `--profile` — include inspect phase timings in `meta.timings`

In compact JSON, explicit documentation/example flags include their requested section. Cursor pages
after the first omit the full runtime/static export inventories unless those sections are explicitly
selected.

- `--analyze-source` — analyze source complexity
- `--source-max-files <n>` — max source files to analyze
- `--source-include-body` — include function body snippets

Source analysis recognizes ESM exports, default exported functions, and common
CommonJS assignment patterns such as `exports.foo`, `module.exports.foo`, and
`module.exports = { foo() {} }`.

## Flags (diff)

- `--from <version>` — base version (default: installed)
- `--to <version>` — target version (default: latest)
- `--filter <text>` — filter exports by name
- `--format text|json` — output format
- `--include-source` — compare source complexity
- `--no-runtime` — keep diff on static package/type data only (default)
- `--runtime` — import downloaded package entrypoints while diffing
- `--no-changelog` — skip changelog parsing
- `--verbose` — show detailed changes
- `--no-color` — disable ANSI colors
- `--project-dir <dir>` — base directory for installed version

JSDoc:

- `--jsdoc off|compact|full`
- `--jsdoc-output off|section|inline|only`
- `--jsdoc-symbol <name|glob|/re/>`
- `--jsdoc-sections summary,params,returns,tags`
- `--jsdoc-tags t1,t2`
- `--jsdoc-tags-exclude t1,t2`
- `--jsdoc-truncate none|sentence|word`
- `--jsdoc-max-len <N>`

## Requirements

- Node.js >= 18
- Bun is optional runtime acceleration; npm is the canonical package fetcher.

## License

MIT
