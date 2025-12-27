# deplens

- Core library: `@deplens/core`
- CLI: `@deplens/cli` (bin: `deplens`)
- MCP: `@deplens/mcp` (bin: `deplens-mcp`)

## Requirements

This CLI is Node-first for broad adoption, and will use Bun APIs if available for extra speed.
Install Node (>=18) and run the CLI with `node` or via the bin entry.

## CLI usage

```bash
node packages/cli/src/cli.mjs ai --types --filter generate \
  --jsdoc-output section \
  --jsdoc-symbol generateText \
  --jsdoc-sections summary,params,returns \
  --jsdoc-tags param,returns \
  --jsdoc-truncate sentence \
  --resolve-from /path/to/project
```

## MCP
Run the MCP server (stdio JSON-RPC):
```bash
node packages/mcp/src/server.mjs
```
Available tools:
- `deplens.inspect`

## Publishing

- Publish `packages/core` and `packages/cli` as separate npm packages.
- The CLI depends on the core package.
