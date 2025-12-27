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
npx deplens --help
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
deplens <package-or-import-path> [filter]
```

Common flags:

```bash
--types                 Include type signatures (.d.ts)
--filter <text>         Substring filter
--kind <k1,k2>          function,class,object,constant
--depth <0-5>           Object inspection depth
--resolve-from <dir>    Resolution base directory
```

JSDoc flags:

```bash
--jsdoc off|compact|full
--jsdoc-output off|section|inline|only
--jsdoc-symbol <name|glob|/re/>
--jsdoc-sections summary,params,returns,tags
--jsdoc-tags param,returns
--jsdoc-tags-exclude internal,deprecated
--jsdoc-truncate none|sentence|word
--jsdoc-max-len <N>
```

## MCP

```bash
npx @deplens/mcp
```

Tool: `deplens.inspect`

Example tool call payload:

```json
{
  "target": "next/server",
  "showTypes": true,
  "filter": "NextResponse",
  "resolveFrom": "."
}
```

## Programmatic API

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

## Requirements

- Node.js >= 18
- Bun is optional (used if available for extra speed)

## License

MIT
