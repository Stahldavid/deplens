# @deplens/mcp

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @deplens/core@0.2.1

## 0.3.0

### Minor Changes

- Add native Java source analysis and replace Python regex inspection with environment-aware AST analysis.

  This release adds structural Java analysis in the core package, teaches the CLI and MCP schema about the new language option, and upgrades Python source analysis to resolve real project environments via `.venv`, `uv`, or the active interpreter before parsing code with Python's `ast` module.

### Patch Changes

- Updated dependencies []:
  - @deplens/core@0.2.0
