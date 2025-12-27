# @deplens/mcp

Model Context Protocol (MCP) server for DepLens.

## Run

```bash
npx @deplens/mcp
```

This starts an MCP server over stdio.

## Tool

`deplens.inspect`

### Input schema (high level)

- `target` (string, required): package name or import path (e.g. `react`, `next/server`)
- `subpath` (string, optional): appended to `target` (e.g. `server` for `next/server`)
- `filter` (string)
- `kind` (string[])
- `showTypes` (boolean)
- `depth` (number 0–5)
- `resolveFrom` (string)
- `rootDir` (string): working directory for inspection
- `jsdoc` (off|compact|full)
- `jsdocOutput` (off|section|inline|only)
- `jsdocQuery` (object):
  - `symbols` (string|string[])
  - `sections` (summary|params|returns|tags)[]
  - `tags.include` / `tags.exclude` (string[])
  - `mode` (compact|full)
  - `maxLen` (number)
  - `truncate` (none|sentence|word)

### Example call

```json
{
  "target": "ai",
  "showTypes": true,
  "filter": "generate",
  "resolveFrom": ".",
  "jsdocOutput": "section",
  "jsdocQuery": {
    "symbols": "generateText",
    "sections": ["summary", "params", "returns"],
    "tags": { "include": ["param", "returns"] },
    "mode": "compact"
  }
}
```

## Environment

- `DEPLENS_ROOT`: default `rootDir` if not provided.

## Requirements

- Node.js >= 18

## License

MIT
