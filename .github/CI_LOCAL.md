# Local CI preparation

Use `npm run lint:check`, `npm run test:types`, and the relevant workspace tests for the development preflight. `npm run lint` writes fixes. The existing `npm run quality` remains the comprehensive gate: formatting, lint, API types, core coverage thresholds, CLI/MCP tests, security audit, and package dry-runs.

The workflow retains all five compatibility combinations, existing smoke suites, coverage thresholds, and the daily real-package corpus. Scheduled CI and CodeQL runs use separate concurrency groups from push/PR runs so a main push cannot cancel a scheduled scan or corpus run. Preserving these runs can increase total runner time; no runner savings have been measured.

Use the declared package manager and a Node version supported by the development tools. The Node 22 compatibility lane intentionally installs production dependencies and runs the existing runtime smoke. Full local quality validation requires Node 24 or another version supported by all development tools. Record actual runtime versions and command results in the integration report.

For a core change, use `npm --workspace @deplens/core test -- --maxWorkers=2`; CLI and MCP changes use the corresponding `@deplens/cli` and `@deplens/mcp` workspaces. The root CLI helper also performs a zod package inspection. CLI/corpus tests and dependency audit may access the registry. Local Linux checks do not validate the hosted Windows/macOS/Node 26 lanes, CodeQL service, or scheduler cancellation behavior.

Working-branch pushes do not match the repository workflows' push filters. A pull request to main runs CI and CodeQL. The unchanged `publish.yml` runs on main pushes, release tag pushes, or explicit dispatch; a main push can open a Changesets version PR or publish npm packages. Branch/PR creation does not authorize merging, pushing main/tags, dispatching publication, or publishing packages.
