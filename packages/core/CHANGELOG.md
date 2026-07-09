# @deplens/core

## 0.3.0

### Minor Changes

- Add safer runtime controls, richer diff output, and more reliable type analysis.
  - Add `--no-runtime` / `--runtime` controls for inspect and diff, with safer CI defaults for remote package analysis.
  - Improve `.d.ts` parsing for aliased re-exports, named default declarations, full interface and enum structures, and local symbol names.
  - Make declaration parse caching stale-safe by validating file size and mtime.
  - Fix CLI source-body flag aliases and remove duplicated option plumbing.
  - Avoid shell-based npm execution on Windows and reduce expensive recursive cache metadata work by default.
  - Return richer structured MCP diff results, including symbols, source comparison, changelog, and metadata.
  - Add CI coverage, restore npm Trusted Publisher provenance, and update docs and skill guidance.

## 0.2.6

### Patch Changes

- Fix JSON diff crashes for object-shaped type aliases and locally parsed changelogs, and make history commands parse `--history-dir` and scoped package names correctly.

## 0.2.5

### Patch Changes

- Repair semantic diff symbol analysis for packages that expose declarations through conditional exports, include symbol changes in JSON `changes`/`changeCount`, and add runtime symbol coverage for simple packages.

  Also add `deplens --version`, JSON output for `deplens cache stats --json`, document cache commands in help, and warn when CDN remote cache lacks enough files for type analysis.

## 0.2.4

### Patch Changes

- Add a canonical multi-facet `symbols[]` JSON layer that correlates runtime exports, type declarations, and JSDoc while preserving the legacy `exports` and `types` fields.

  Also expose conditional export/type resolution traces, add `deplens doctor` for agent-friendly package resolution diagnostics, include symbol-based semantic diff metadata, add focused `--docs-for`/`--examples-for` ranking, link `symbols[]` to source analysis when `--analyze-source` is enabled, and improve remote cache reproducibility with `--offline`, `cache pin`, and cache integrity metadata.

## 0.2.3

### Patch Changes

- Fix subpath type resolution for package self re-exports and prioritize implementation files over barrel entrypoints during source analysis.

## 0.2.2

### Patch Changes

- Remove the vulnerable `java-parser` dependency and keep Java source analysis covered by the built-in parser.

## 0.2.1

### Patch Changes

- Fix remote package inspection by defaulting remote downloads to full npm installs, improve subpath type resolution and `.ts` re-export parsing, add runtime/type availability warnings, and normalize diff JSON with `package`, `changes`, and `changeCount`.

## 0.2.0

### Minor Changes

- Add native Java source analysis and replace Python regex inspection with environment-aware AST analysis.

  This release adds structural Java analysis in the core package, teaches the CLI and MCP schema about the new language option, and upgrades Python source analysis to resolve real project environments via `.venv`, `uv`, or the active interpreter before parsing code with Python's `ast` module.
