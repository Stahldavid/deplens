# @deplens/cli

## 0.2.1

### Patch Changes

- Fix remote package inspection by defaulting remote downloads to full npm installs, improve subpath type resolution and `.ts` re-export parsing, add runtime/type availability warnings, and normalize diff JSON with `package`, `changes`, and `changeCount`.

- Updated dependencies []:
  - @deplens/core@0.2.1

## 0.2.0

### Minor Changes

- Add native Java source analysis and replace Python regex inspection with environment-aware AST analysis.

  This release adds structural Java analysis in the core package, teaches the CLI and MCP schema about the new language option, and upgrades Python source analysis to resolve real project environments via `.venv`, `uv`, or the active interpreter before parsing code with Python's `ast` module.

### Patch Changes

- Updated dependencies []:
  - @deplens/core@0.2.0
