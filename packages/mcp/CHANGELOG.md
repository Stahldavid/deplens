# @deplens/mcp

## 1.0.0

### Major Changes

- Ship the DepLens 1.0 project-upgrade workflow and stable machine contracts.
  - Add npm lockfile snapshots, project/Git-ref diffs, dependency baselines, configurable CI policy, SARIF output, progress, cancellation, custom cache directories, and operation timeouts.
  - Add compact cursor-paginated inspect/diff schemas, shared JSON Schemas, export-condition and `typesVersions` resolution, TypeScript semantic assignability checks, and phase profiling.
  - Fix prototype-key collisions for declarations such as `constructor`, harden symbol dictionaries against prototype pollution, and validate the fix against Zod and a deterministic parser corpus.
  - Expand MCP with Doctor, project diff, policy check, and version tools while keeping runtime execution opt-in and structured outputs bounded.
  - Modularize runtime, docs, snapshot, projection, policy, schema, export-map, and semantic analysis responsibilities.
  - Require Node.js 22 or newer and modernize CI with Node 22/24/26, Windows/macOS, coverage thresholds, nightly real-package corpus, CodeQL, Dependabot, and Node 24-based GitHub Actions.

### Patch Changes

- Updated dependencies []:
  - @deplens/core@1.0.0

## 0.6.0

### Minor Changes

- Introduce compact diff JSON schema version 2, reducing repeated symbol payloads while preserving complete before/after snapshots behind verbose mode and the rich programmatic diff result.

  Normalize workspace and symlink entrypoints before Doctor comparisons, capture text-mode history from a single inspection pass, and represent intentionally disabled runtime loading as structured metadata instead of warnings.

  Add cache migration and pruning APIs with exact metadata rebuilding, legacy alias normalization, age-based cleanup, dry-run support, active-lock protection, and conflict-safe maintenance. Expose the new maintenance commands through the CLI with validation before command execution.

  Complete the public TypeScript declarations for changelog and cache APIs, enforce JavaScript/declaration export parity, align MCP with compact diff payloads, clarify detection-only languages, and run the TypeScript API smoke test in pull-request CI.

### Patch Changes

- Updated dependencies []:
  - @deplens/core@0.5.0

## 0.5.0

### Minor Changes

- Rebuild declaration inspection around the TypeScript semantic model, including public re-exports, aliases, overloads, classes, enums, variables, default exports, and dependency-aware parse caching.

  Make version diffs subpath-aware and detect optionality, readonly, overload, constructor, class property, enum member, and enum value changes. Harden remote package resolution with exact versions, atomic cache writes, concurrent download locks, package identity checks, confined metadata paths, offline guarantees, and sanitized npm failures.

  Improve CLI validation and error exit codes, expose compact static export metadata, add public TypeScript declarations, make Python source analysis asynchronous, clarify unsupported language analysis, and strengthen history and changelog handling.

  Default MCP inspection to static analysis, align tool annotations with package downloads, propagate structured errors, cap large symbol payloads, and validate the server through real SDK stdio integration tests.

  Expand CI across supported Node.js versions and Windows, require formatting, types, tests, audit, and package dry-runs before trusted publishing, and update package documentation and the DepLens CLI skill.

### Patch Changes

- Updated dependencies []:
  - @deplens/core@0.4.0

## 0.4.1

### Patch Changes

- Default remote `deplens_inspect` calls to static analysis unless `runtime: true` is supplied.
- Default `deplens_diff` to static analysis and make entrypoint imports opt-in with `runtime: true`.
- Document the safer runtime defaults in the MCP schema and README.

- Updated dependencies []:
  - @deplens/core@0.3.1

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
