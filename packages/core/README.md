# @deplens/core

Programmatic API for inspecting installed packages: runtime exports, parsed type signatures, and JSDoc.

## Install

```bash
npm i @deplens/core
```

## Usage

```js
import { runInspect, runDiff } from '@deplens/core';

const output = await runInspect({
  target: 'ai',
  showTypes: true,
  filter: 'generate',
  resolveFrom: process.cwd(),
});

console.log(output);

const diff = await runDiff({
  package: 'express',
  from: '4.18.0',
  to: '4.19.0',
  format: 'json',
});

console.log(diff.output);
```

`runInspect` returns a string **when no custom writers are provided**. If you pass `write` or `writeError`, it will stream to those instead.

## Options

- `target` (string, required): package name or import path (e.g. `react`, `next/server`)
- `filter` (string): substring filter for export names
- `showTypes` (boolean): include type signatures from `.d.ts`
- `kind` (string[]): filter by export kind (`function`, `class`, `object`, `constant`)
- `runtime` (boolean): import the package entrypoint for runtime exports; set `false` for static type/package inspection
- `analyzeSource` (boolean): include source complexity and implementation summaries
- `depth` (number): object inspection depth (0–5)
- `resolveFrom` (string): base directory for module resolution
- `cwd` (string): working directory for the inspection
- `write` (function): output sink (defaults to collecting and returning a string)
- `writeError` (function): error output sink

JSDoc options:

- `jsdoc` (string): `off` | `compact` | `full`
- `jsdocOutput` (string): `off` | `section` | `inline` | `only`
- `jsdocQuery` (object):
  - `symbols`: string or string[]
  - `sections`: `summary` | `params` | `returns` | `tags`
  - `tags.include` / `tags.exclude`: string[]
  - `mode`: `compact` | `full`
  - `maxLen`: number
  - `truncate`: `none` | `sentence` | `word`

Example: JSDoc focused on params/returns

```js
await runInspect({
  target: 'ai',
  showTypes: true,
  jsdocOutput: 'section',
  jsdocQuery: {
    symbols: 'generateText',
    sections: ['params', 'returns'],
    tags: { include: ['param', 'returns'] },
    mode: 'compact',
    truncate: 'sentence',
    maxLen: 220,
  },
});
```

`jsdocOutput: 'only'` returns a focused `jsdoc.entries` projection in object/JSON mode
and renders the same entries in text mode. Plain `jsdocQuery.symbols` values match exact
export names; use `*` or `/regex/` for broader matching.

Compact projections keep `staticExports` to a count unless explicitly selected, summarize
source analysis, and omit symbol inventories for focused docs/examples/JSDoc requests.
`project-diff` returns direct dependency changes by default; set `includeTransitive: true`
for the complete lockfile graph. pnpm peer suffixes are stripped before versions are compared.
Enriched package API results are compact by default and expose per-package `pagination`; use
`maxChangesPerPackage` (default 25) and `packageCursors` to page large upgrades independently.
`maxChanges` remains an alias for the per-package limit. The report includes `detailLevel`; pass
`detail: 'full'` to retain the rich `runDiff` result. Source analysis is focused by default and
only includes symbols when selected. Structured JSDoc omits the renderer-only `text` duplicate.

Cache pruning accepts `maxSizeBytes` and `maxEntries`, using `lastUsedAt` for LRU order while
skipping active lock entries. Semantic compatibility separates isolated nominal identity noise
from actionable assignability diagnostics.

## Notes

- JSDoc is extracted from `.d.ts` declarations, not runtime JS.
- Source analysis recognizes ESM exports, default exported functions, and common CommonJS assignment patterns.
- `--resolve-from` is essential in monorepos to avoid false negatives.

## License

MIT
