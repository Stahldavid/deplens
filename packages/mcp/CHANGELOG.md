# @deplens/mcp

## 0.4.0

### Minor Changes

- Add safer runtime controls, richer diff output, and more reliable type analysis.
  - Add `--no-runtime` / `--runtime` controls for inspect and diff, with safer CI defaults for remote package analysis.
  - Improve `.d.ts` parsing for aliased re-exports, named default declarations, full interface and enum structures, and local symbol names.
  - Make declaration parse caching stale-safe by validating file size and mtime.
  - Fix CLI source-body flag aliases and remove duplicated option plumbing.
  - Avoid shell-based npm execution on Windows and reduce expensive recursive cache metadata work by default.
  - Return richer structured MCP diff results, including symbols, source comparison, changelog, and metadata.
  - Add CI coverage, restore npm Trusted Publisher provenance, and update docs and skill guidance.

### Patch Changes

- Updated dependencies []:
  - @deplens/core@0.3.0

## 0.3.6

### Patch Changes

- Updated dependencies []:
  - @deplens/core@0.2.6

## 0.3.5

### Patch Changes

- Updated dependencies []:
  - @deplens/core@0.2.5

## 0.3.4

### Patch Changes

- Updated dependencies []:
  - @deplens/core@0.2.4

## 0.3.3

### Patch Changes

- Updated dependencies []:
  - @deplens/core@0.2.3

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @deplens/core@0.2.2

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
