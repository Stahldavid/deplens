# @deplens/cli

Command-line interface for DepLens.

## Install

```bash
npm i -g @deplens/cli
# or
npx deplens --help
```

## Usage

```bash
deplens <package-or-import-path> [filter]
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
```

## Flags

- `--types` — include type signatures from `.d.ts`
- `--filter <text>` — substring filter for exports
- `--kind <k1,k2>` — `function`, `class`, `object`, `constant`
- `--depth <0-5>` — object inspection depth
- `--resolve-from <dir>` — base directory for module resolution

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
- Bun is optional and used automatically if available

## License

MIT
