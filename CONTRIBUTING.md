# Contributing to DepLens

## Releases (Changesets)

DepLens uses [Changesets](https://github.com/changesets/changesets) for
version management and automated publishing. Concretely:

- Every PR that changes a published package (`@deplens/core`, `@deplens/cli`,
  `@deplens/mcp`) should include a **changeset** describing the change.
- A changeset is a small Markdown file under `.changeset/` that lists which
  packages are affected and at which semver level (`patch` / `minor` /
  `major`).
- When PRs land on `main`, a GitHub Action automatically opens (or updates)
  a **"Version Packages"** PR that:
  - Consumes all pending changesets.
  - Bumps the affected packages' `version` in `package.json`.
  - Writes per-package release notes into `CHANGELOG.md`.
  - Updates internal dependencies (e.g. when `@deplens/core` bumps, the
    `@deplens/core` dependency in `cli`/`mcp` bumps with it).
- Merging the "Version Packages" PR triggers a second run of the same
  workflow, which publishes the updated packages to npm via the
  [npm Trusted Publisher](https://docs.npmjs.com/trusted-publishers) OIDC
  flow (no `NPM_TOKEN` involved; every release ships with provenance
  attestation).

### Adding a changeset to a PR

After making changes:

```bash
npm run changeset
```

The CLI will ask:

1. **Which packages have changed?** — select with space, confirm with enter.
2. **Bump kind for each?**
   - `patch` — bug fix, no API change
   - `minor` — backwards-compatible feature
   - `major` — breaking change
   - For pre-1.0 packages, **a `major` bump still results in a `0.x.y →
0.(x+1).0` minor version** (per npm convention). That's fine — flag
     breaking changes as `major` regardless.
3. **Summary line** — one or two sentences. This goes verbatim into the
   `CHANGELOG.md` entry, so write it as you'd want users to read it.

The result is a file like `.changeset/funny-cats-jump.md` — commit it
alongside your code changes.

### Inspecting pending changesets

```bash
npm run changeset -- status
```

### Manual / emergency publish

If something goes wrong with the automated flow, single packages can still
be published manually via the GitHub Actions **"Publish to npm"** workflow:

- **UI:** Actions → "Publish to npm" → "Run workflow" → choose package.
- **CLI:** `gh workflow run publish.yml -f package=@deplens/core`

This bypasses Changesets entirely and publishes the version currently in
the workspace's `package.json` (the npm registry rejects re-publishes of
existing versions, so you must bump first).

Tag-based publishes also still work as a fallback:

```bash
git tag core-v0.1.8
git push --follow-tags
```

### Trusted Publisher configuration (for repo admins)

The npm Trusted Publisher is configured **per package** at
`https://www.npmjs.com/package/<name>/access`:

| Field             | Value          |
| ----------------- | -------------- |
| Publisher         | GitHub Actions |
| Organization      | `Stahldavid`   |
| Repository        | `deplens`      |
| Workflow filename | `publish.yml`  |
| Environment name  | _(blank)_      |

This must be set for each of `@deplens/core`, `@deplens/cli`, `@deplens/mcp`.

### Local development

```bash
npm install        # install workspace deps
npm test           # run vitest + CLI/MCP smoke
npm run lint       # eslint with --fix
npm run format     # prettier --write
```

The repo is a monorepo:

```
packages/
├── core/   # @deplens/core   - package inspection engine
├── cli/    # @deplens/cli    - command-line interface
└── mcp/    # @deplens/mcp    - MCP server
skill/
└── deplens-cli/   # Claude Code skill for driving the CLI
```
