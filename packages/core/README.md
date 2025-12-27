# @deplens/core

Programmatic API for inspecting installed packages: runtime exports, parsed type signatures, and JSDoc.

## Install

```bash
npm i @deplens/core
```

## Usage

```js
import { runInspect } from "@deplens/core";

const output = await runInspect({
  target: "ai",
  showTypes: true,
  filter: "generate",
  resolveFrom: process.cwd()
});

console.log(output);
```

`runInspect` returns a string **when no custom writers are provided**. If you pass `write` or `writeError`, it will stream to those instead.

## Options

- `target` (string, required): package name or import path (e.g. `react`, `next/server`)
- `filter` (string): substring filter for export names
- `showTypes` (boolean): include type signatures from `.d.ts`
- `kind` (string[]): filter by export kind (`function`, `class`, `object`, `constant`)
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
  target: "ai",
  showTypes: true,
  jsdocOutput: "section",
  jsdocQuery: {
    symbols: "generateText",
    sections: ["params", "returns"],
    tags: { include: ["param", "returns"] },
    mode: "compact",
    truncate: "sentence",
    maxLen: 220
  }
});
```

## Notes

- JSDoc is extracted from `.d.ts` declarations, not runtime JS.
- `--resolve-from` is essential in monorepos to avoid false negatives.

## License

MIT
