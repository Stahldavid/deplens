# DepLens CLI — Recipes

End-to-end workflows that combine multiple flags to answer specific kinds of questions. Each recipe lists the user-facing question, the exact command, what it returns, and how to interpret the output.

## Quickly answer "what does function X do?"

**Question:** "What does `generateText` do in the `ai` package?"

```bash
deplens ai \
  --filter generateText \
  --jsdoc-symbol generateText \
  --jsdoc full \
  --jsdoc-output only \
  --jsdoc-sections summary,params,returns \
  --json
```

**Returns:** A focused JSON payload with `jsdoc.entries` and no unrelated export/type/symbol inventories. Read the entry with `jq '.jsdoc.entries[] | select(.name=="generateText")'`.

**Why each flag:** `--filter generateText` narrows declaration parsing. `--jsdoc-symbol generateText` selects the exact documented export. `--jsdoc full` keeps the full description. `--jsdoc-output only` suppresses inventories. `--json` makes the response parseable.

---

## Map a package's full API surface (for an LLM context window)

**Question:** "Give me a compact overview of every public function and class in `@tanstack/router`."

```bash
deplens @tanstack/router \
  --remote \
  --types \
  --kind function,class \
  --max-exports 300 \
  --json > tanstack-router-api.json
```

**Returns:** A trimmed JSON file with just functions and classes (no objects, constants), capped at 300 entries, suitable for feeding back into a follow-up prompt.

**Tip:** Add `--analyze-source` if implementation complexity matters; omit `--remote` if the package is already installed locally.

---

## Audit a major version bump

**Question:** "I'm bumping `react` from 18.2 to 19.0 — what breaks?"

```bash
deplens diff react --from 18.2.0 --to 19.0.0 --verbose --json > react-19-diff.json
```

**Then:**

```bash
jq '.summary' react-19-diff.json
jq '.changes[] | select(.kind=="breaking")' react-19-diff.json
```

**Returns:** The full diff plus a JSON list of every breaking change. Pair with `--include-source` to also see per-symbol complexity deltas (handy when reading the upgrade guide).

---

## Compare a project without flooding agent context

```bash
deplens project-diff --from HEAD~1 --to working --json
```

Each package's `api` field is compact by default. Use `--no-api` for version-only lockfile changes,
or `--detail full` only when a complete internal package diff is explicitly required.

---

## Find functions by intent, not by name

**Question:** "Is there something in `lodash` to deep-merge two objects?"

```bash
deplens lodash --search "deep merge" --types --json
```

**Returns:** Names of matching exports plus their signatures. Synonym expansion in `--search` covers `validate↔parse`, `auth↔token`, `http↔fetch/request`, `schema↔shape/struct` — so "merge" might also surface `assignDeep`/`mergeWith` via shared tokens.

---

## Pull just the Installation + Quick Start of a package README

**Question:** "Show me how to install and get started with `prisma`."

```bash
deplens prisma --docs-sections Installation,Quick,"Getting started" --json
```

**Notes:**

- Section matching is case-insensitive and partial — `"Quick"` matches both `"Quick Start"` and `"Quickstart"`.
- Use `--list-sections` first if the headers are unknown.

---

## Inspect a package without installing it

**Question:** "What's in `bun` 1.2 without running `npm install`?"

```bash
deplens bun --remote --remote-version 1.2.0 --types --kind function,class --json
```

**Subsequent runs hit the cache** at `~/.deplens-cache/versions/bun/1.2.0/`. To purge: `deplens cache clear bun`.

---

## Compare the locally-installed version against the latest published

**Question:** "Has anything broken in `zod` since I installed it?"

```bash
deplens diff zod --json | jq '.summary, .changes[] | select(.kind=="breaking")'
```

`--from` and `--to` default to `installed` and `latest` respectively, so no version flags needed.

---

## Save a historical snapshot for later comparison

**Question:** "I want to compare my current inspection of `next` against a future re-inspection."

```bash
# Today
deplens next --types --docs --save-history --json > /dev/null

# Tomorrow (after upgrading next)
deplens next --types --docs --save-history --json > /dev/null

# Compare the two stored snapshots
deplens history list next
deplens history compare next 14.2.5 14.3.0
```

History entries are JSON dumps stored under `~/.deplens/history/`. Move them with `--history-dir <path>` for team-shared baselines.

---

## Use within a monorepo where the package lives in a sibling workspace

**Question:** "Inspect `@my-org/utils` from any directory inside this monorepo."

```bash
# From repo root, with @my-org/utils installed in packages/utils/node_modules
deplens @my-org/utils --resolve-from ./packages/some-app

# Or simpler: run from the workspace that actually depends on it
cd packages/some-app && deplens @my-org/utils
```

`--resolve-from` accepts an absolute or relative path; deplens runs Node module resolution from there.

---

## Stream the source-code body of one function

**Question:** "Show me the implementation of `parse` in `zod`'s source code."

```bash
deplens zod --filter parse --analyze-source --source-include-body --source-max-files 20 --json \
  | jq '.sourceAnalysis // .languageAnalysis'
```

Useful for "is this method as complex as I think?" or "does the source confirm what the docs say?".

---

## Build a one-shot dependency map for a deps audit

**Question:** "Build a JSON file with every direct dependency's API summary."

```bash
# Read direct deps
jq -r '.dependencies | keys[]' package.json > /tmp/direct-deps.txt

# Inspect each in JSON and concat
echo '[' > deps-audit.json
first=1
while read pkg; do
  if [ $first -eq 0 ]; then echo ',' >> deps-audit.json; fi
  deplens "$pkg" --types --kind function,class --max-exports 100 --json >> deps-audit.json
  first=0
done < /tmp/direct-deps.txt
echo ']' >> deps-audit.json
```

Each entry follows the schema in [cli-flags.md](./cli-flags.md#inspect-payload). Feed the resulting file into a follow-up prompt that asks for cross-package patterns or duplicated functionality.

---

## Decide between `inspect` and `diff` quickly

- **"What's in / about package X?"** → `inspect`
- **"What changed in package X (between two versions)?"** → `diff`
- **"What's installed vs latest?"** → `diff` with defaults
- **"What does the npm registry have for X@Y that's not on disk?"** → `inspect --remote --remote-version Y`

---

## When the output is too noisy

Symptoms: hundreds of unfiltered exports, full README dumped, a wall of type signatures.

Fix order (cheapest first):

1. Add `--filter <name>` if a specific symbol is targeted.
2. Add `--search <intent>` if the name isn't known.
3. Add `--kind function` (or whatever kind matters) to drop the rest.
4. Lower `--max-exports` / `--max-props` / `--max-examples`.
5. Switch from `--docs` to `--docs-sections X,Y`.
6. Move from `--jsdoc full` to `--jsdoc compact` (or `--jsdoc-truncate sentence`).
7. As a last resort, switch to `--format json` and let downstream `jq` pick fields.
