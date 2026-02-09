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
deplens <package-or-import-path> [filter] [options]
```

### Common flags

```bash
--types                 Include type signatures (.d.ts)
--filter <text>         Substring filter
--search <query>        Lightweight semantic search (token + JSDoc)
--kind <k1,k2>          function,class,object,constant
--depth <0-5>           Object inspection depth
--resolve-from <dir>    Resolution base directory
--remote                Download package to cache and inspect it
--remote-version <v>    Version for remote download (default: latest)
--docs                  Include README preview
--list-sections         List README section names (for targeted extraction)
--docs-sections <csv>   Extract specific README sections by name
--examples              Include README/examples/@example snippets
--format text|json      Output format
--max-exports <n>       Max exports in output (default: 100)
--max-props <n>         Max props per object (default: 10)
--max-examples <n>      Max examples returned (default: 10)
```

### JSDoc flags

```bash
--jsdoc off|compact|full
--jsdoc-output off|section|inline|only
--jsdoc-symbol <name|glob|/re/>
--jsdoc-sections summary,params,returns,tags
--jsdoc-tags t1,t2
--jsdoc-tags-exclude t1,t2
--jsdoc-truncate none|sentence|word
--jsdoc-max-len <N>
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

DepLens ships an MCP server over **stdio** (`@deplens/mcp`) so agents can call `deplens.inspect` and receive structured output.

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

#### `deplens.inspect`

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

#### `deplens.diff`

Compare two versions of a package. Useful for upgrade planning and identifying breaking changes.

```json
{
  "package": "zod",
  "from": "3.22.0",
  "to": "latest"
}
```

## Programmatic API

```js
import { runInspect } from "@deplens/core";

const output = await runInspect({
  target: "ai",
  showTypes: true,
  filter: "generate",
  resolveFrom: process.cwd(),
});

console.log(output);
```

## Requirements

- Node.js >= 18
- Bun is optional (used if available for extra speed)

## License

MIT
