# DepLens repository guidance

This npm-workspaces project contains `@deplens/core`, CLI and MCP packages. Use the selected checkout's manifests, lockfile and source entrypoints; a newer source capability does not prove the global executable is updated. Preserve existing changes and the task's package/version baseline.

For package inspection workflows read [the CLI skill](skill/deplens-cli/SKILL.md); for contributor checks read [.github/CI_LOCAL.md](.github/CI_LOCAL.md). Load references by operation, not the whole command manual.

For prose-only edits, review the diff and affected links. For code changes use lint:check, test:types and tests of the affected workspace; lint writes fixes. Expand testing for affected contracts or failures, and complete required CI/release gates. Root CLI helpers and corpus tests may access registries; quality also includes dependency audit and pack. Do not run those effects merely to inspect documentation or imply that local validation proves publication.

Inspect can import package code; remote operations fetch/cache, type generation can write, Python analysis may invoke uv, and baselines/snapshots are writes. Keep these effects explicit in workflows. Do not install global latest, change credentials, clear caches, overwrite baselines or publish as automatic recovery.

The maintained skill source is `skill/deplens-cli/`, including references. Distribute that folder deliberately to selected consumers; installed skills and plugin caches are separate from source and need their own discovery evidence.

# DepLens repository guidance

## Code Review Rules

### Public API and CLI compatibility

- Flag changes that break documented core APIs, CLI commands or options, MCP tool contracts, exit codes, or versioned JSON schemas without an explicit compatibility or migration strategy. Additive, backward-compatible changes are allowed.
- For each finding, identify the affected caller or documented workflow, the triggering input, and the observable consequence. Do not report formatting issues already covered by lint or formatting checks.

### Inspection accuracy and cache integrity

- Inspection results must describe the package version and export conditions actually resolved from the requested project or remote target. Flag mixing exports, types, JSDoc, or documentation from different versions, projects, or conditions. Missing or unsupported information must not be reported as verified.
- Cached analyses, snapshots, and pagination must preserve their version, condition, and analysis-mode identity. Flag stale reuse that produces incorrect inspection or compatibility results. Direct-dependency filtering must remain the default for project-diff unless transitive dependencies are explicitly requested.

### Execution and filesystem boundaries

- Preserve documented execution modes: --no-runtime must skip package entrypoint imports; remote inspection and diff must remain static by default, with runtime imports enabled only through the documented opt-in. Local runtime inspection is supported behavior and is not itself a finding.
- Treat package contents, archive paths, and package-controlled metadata as untrusted. Flag extraction paths that escape the intended destination or cache/history cleanup that can delete unrelated files, including through traversal or symlink handling. Restrict findings to reachable paths with a concrete consequence.
