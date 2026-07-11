# @deplens/core

## 1.0.7

### Patch Changes

- Add strict validation for cursors, regex filters, enum flags, numeric limits, and source-depth bounds so malformed agent calls fail instead of producing empty success payloads.

  Compact inspect/diff JSON is now smaller by default: inspect pages return 50 symbols unless requested otherwise, omit null/false/empty fields, trim duplicated resolution paths, and summarize semantic diagnostics without repeating full TypeScript diagnostics on later diff pages.

  Treat identical concrete diff versions as successful no-op results, return structured package-not-found errors, make `--types` include the `types` section in JSON, keep npm fetches from reusing incomplete CDN cache entries, paginate cache prune previews, and normalize Python path analysis around the target project/source summary.

## 1.0.6

### Patch Changes

- Add strict project package selection for automation, expose resumable JSDoc parameter limits with cursors, and make cache maintenance JSON more agent-friendly with summary/paginated stats plus dry-run `wouldRemove` previews.

## 1.0.5

### Patch Changes

- Reduce the default project diff page to ten changes, add selective package continuation with reusable fingerprinted analysis snapshots, populate size metadata for fresh downloads, and cap parameter-heavy JSDoc with explicit truncation metadata.

## 1.0.4

### Patch Changes

- Paginate compact project API changes independently per package, expose the selected detail level, and remove duplicated renderer text from structured JSDoc output.

## 1.0.3

### Patch Changes

- Compact project API enrichment by default and retain the legacy rich package diff only with full detail, reducing large agent-facing project reports by more than 98 percent.

  Make source analysis focused by default, document all JSDoc and diff pagination flags, separate isolated nominal TypeScript identity noise from actionable diagnostics, and report npm downloads as fetched.

  Track cache access time and add LRU pruning by maximum size or entry count, with lock-aware limit reporting and versioned JSON results.

## 1.0.2

### Patch Changes

- Fix pnpm project diffs with nested peer suffixes and return direct dependency changes by default.

  Restore JSDoc-only output in text, JSON, and MCP responses; compact static export inventories and focused docs/examples requests; expose compact source summaries with separate runtime/source languages and causal semantic diagnostics.

  Report binary-only packages as metadata-only, version all doctor/cache machine envelopes, honor custom cache directories across cache commands, and add regression coverage for the public agent workflows.

## 1.0.1

### Patch Changes

- Fix compact JSON projection, profiling, semantic symbol search, example ranking, subpath runtime resolution, and JSON history output. Add pnpm lockfile support and avoid repeating complete export inventories on later symbol pages.

## 1.0.0

### Major Changes

- Ship the DepLens 1.0 project-upgrade workflow and stable machine contracts.
  - Add npm lockfile snapshots, project/Git-ref diffs, dependency baselines, configurable CI policy, SARIF output, progress, cancellation, custom cache directories, and operation timeouts.
  - Add compact cursor-paginated inspect/diff schemas, shared JSON Schemas, export-condition and `typesVersions` resolution, TypeScript semantic assignability checks, and phase profiling.
  - Fix prototype-key collisions for declarations such as `constructor`, harden symbol dictionaries against prototype pollution, and validate the fix against Zod and a deterministic parser corpus.
  - Expand MCP with Doctor, project diff, policy check, and version tools while keeping runtime execution opt-in and structured outputs bounded.
  - Modularize runtime, docs, snapshot, projection, policy, schema, export-map, and semantic analysis responsibilities.
  - Require Node.js 22 or newer and modernize CI with Node 22/24/26, Windows/macOS, coverage thresholds, nightly real-package corpus, CodeQL, Dependabot, and Node 24-based GitHub Actions.

## 0.5.0

### Minor Changes

- Introduce compact diff JSON schema version 2, reducing repeated symbol payloads while preserving complete before/after snapshots behind verbose mode and the rich programmatic diff result.

  Normalize workspace and symlink entrypoints before Doctor comparisons, capture text-mode history from a single inspection pass, and represent intentionally disabled runtime loading as structured metadata instead of warnings.

  Add cache migration and pruning APIs with exact metadata rebuilding, legacy alias normalization, age-based cleanup, dry-run support, active-lock protection, and conflict-safe maintenance. Expose the new maintenance commands through the CLI with validation before command execution.

  Complete the public TypeScript declarations for changelog and cache APIs, enforce JavaScript/declaration export parity, align MCP with compact diff payloads, clarify detection-only languages, and run the TypeScript API smoke test in pull-request CI.

## 0.4.0

### Minor Changes

- Rebuild declaration inspection around the TypeScript semantic model, including public re-exports, aliases, overloads, classes, enums, variables, default exports, and dependency-aware parse caching.

  Make version diffs subpath-aware and detect optionality, readonly, overload, constructor, class property, enum member, and enum value changes. Harden remote package resolution with exact versions, atomic cache writes, concurrent download locks, package identity checks, confined metadata paths, offline guarantees, and sanitized npm failures.

  Improve CLI validation and error exit codes, expose compact static export metadata, add public TypeScript declarations, make Python source analysis asynchronous, clarify unsupported language analysis, and strengthen history and changelog handling.

  Default MCP inspection to static analysis, align tool annotations with package downloads, propagate structured errors, cap large symbol payloads, and validate the server through real SDK stdio integration tests.

  Expand CI across supported Node.js versions and Windows, require formatting, types, tests, audit, and package dry-runs before trusted publishing, and update package documentation and the DepLens CLI skill.

## 0.3.1

### Patch Changes

- Make diff analysis static by default so comparing downloaded package versions no longer imports package entrypoints unless `runtime: true` is explicitly supplied.
- Allow `runInspect(..., { saveHistory: true })` to persist history snapshots in text mode by generating a quiet structured payload for storage.
- Update release docs and agent skill guidance for the safer runtime defaults.

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
