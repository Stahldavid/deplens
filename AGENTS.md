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
