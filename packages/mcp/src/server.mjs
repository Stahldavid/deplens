#!/usr/bin/env node
/**
 * DepLens MCP Server
 *
 * Exposes DepLens' package inspection and version diff capabilities as MCP tools
 * over stdio transport. Built on the modern `McpServer` + `registerTool` API
 * (MCP SDK >= 1.18) with Zod input validation, structured output, and
 * tool annotations per MCP best practices.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PKG_VERSION = '0.2.0';
const SERVER_NAME = 'deplens-mcp-server';

/** Max characters to emit in a single text response before truncating. */
const CHARACTER_LIMIT = 100_000;

const DEBUG = process.env.DEPLENS_DEBUG === 'true';

function debug(label, payload) {
  if (!DEBUG) return;
  try {
    // stderr only — stdout is the MCP transport
    console.error(
      `[deplens-mcp] ${label}`,
      typeof payload === 'string' ? payload : JSON.stringify(payload)
    );
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Lazy core loader (keeps cold start tiny)
// ---------------------------------------------------------------------------

let corePromise = null;
async function loadCore() {
  if (!corePromise) corePromise = import('@deplens/core');
  return corePromise;
}

async function loadRunInspect() {
  const core = await loadCore();
  const fn = core.runInspect || core.default?.runInspect;
  if (typeof fn !== 'function') {
    throw new Error('runInspect not exported by @deplens/core');
  }
  return fn;
}

async function loadRunDiff() {
  const core = await loadCore();
  const fn = core.runDiff || core.default?.runDiff;
  if (typeof fn !== 'function') {
    throw new Error('runDiff not exported by @deplens/core');
  }
  return fn;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function truncateIfNeeded(text) {
  if (typeof text !== 'string') return { text: String(text ?? ''), truncated: false };
  if (text.length <= CHARACTER_LIMIT) return { text, truncated: false };
  const head = text.slice(0, CHARACTER_LIMIT);
  const suffix = `\n\n… (truncated ${text.length - CHARACTER_LIMIT} chars; use 'filter', 'search', 'maxExports' or 'docsSections' to narrow output, or request format='json' to receive the structured payload)`;
  return { text: head + suffix, truncated: true };
}

function buildErrorResponse(error, fallbackStructured) {
  const message = error instanceof Error ? error.message : String(error);
  const stack =
    DEBUG && error instanceof Error && error.stack ? `\n\n[stack]\n${error.stack}` : '';
  debug('error', message);
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${message}${stack}` }],
    structuredContent: {
      ...fallbackStructured,
      error: message,
      warnings: [message],
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: deplens_inspect
// ---------------------------------------------------------------------------

const KindEnum = z.enum(['function', 'class', 'object', 'constant', 'interface', 'type']);

const FormatEnum = z.enum(['text', 'json', 'object']);

const JsdocModeEnum = z.enum(['off', 'compact', 'full']);
const JsdocOutputEnum = z.enum(['off', 'section', 'inline', 'only']);
const JsdocSectionEnum = z.enum(['summary', 'params', 'returns', 'tags']);
const JsdocTruncateEnum = z.enum(['none', 'sentence', 'word']);

const JsdocQuerySchema = z
  .object({
    symbols: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('Single symbol name or list of names to extract JSDoc for'),
    sections: z
      .array(JsdocSectionEnum)
      .optional()
      .describe('Which JSDoc sections to include'),
    tags: z
      .object({
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
      })
      .optional()
      .describe('Filter JSDoc by tag name (include/exclude)'),
    mode: z.enum(['compact', 'full']).optional(),
    maxLen: z.number().int().nonnegative().optional(),
    truncate: JsdocTruncateEnum.optional(),
  })
  .strict()
  .describe('Fine-grained JSDoc extraction options');

const inspectInputShape = {
  target: z
    .string()
    .min(1, 'target must not be empty')
    .describe('Package name or import path (e.g. "react", "next/server", "@scope/pkg")'),
  subpath: z
    .string()
    .optional()
    .describe('Optional subpath appended to target (e.g. "server" for next/server)'),
  filter: z
    .string()
    .optional()
    .describe('Case-insensitive substring filter for export names. Use /regex/ for regex.'),
  kind: z
    .array(KindEnum)
    .optional()
    .describe('Restrict exports to specific kinds'),
  showTypes: z
    .boolean()
    .optional()
    .describe('Parse .d.ts files and return type signatures, interfaces, classes, enums'),
  includeDocs: z
    .boolean()
    .optional()
    .describe('Include README preview in the response'),
  includeExamples: z
    .boolean()
    .optional()
    .describe('Include code examples from README, examples/ dir, and @example JSDoc'),
  remote: z
    .boolean()
    .optional()
    .describe('Download the package to local cache and inspect that version (no install needed)'),
  remoteVersion: z
    .string()
    .optional()
    .describe('Version to download when remote=true (default: "latest")'),
  format: FormatEnum
    .optional()
    .describe(
      "Output format for the text content. 'text' (default) returns pretty output; 'json' returns a JSON stringified payload; 'object' returns only structuredContent."
    ),
  listSections: z
    .boolean()
    .optional()
    .describe('List available README section headers instead of returning content'),
  docsSections: z
    .array(z.string())
    .optional()
    .describe('Extract specific README sections by header name (case-insensitive partial match)'),
  search: z
    .string()
    .optional()
    .describe('Semantic search query (token matching + JSDoc) over export names'),
  maxExports: z
    .number()
    .int()
    .positive()
    .max(10_000)
    .optional()
    .describe('Maximum exports to include (default: 100)'),
  maxProps: z
    .number()
    .int()
    .positive()
    .max(1_000)
    .optional()
    .describe('Maximum props per object when depth > 0 (default: 10)'),
  maxExamples: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe('Maximum examples to show (default: 10)'),
  depth: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe('Depth for object inspection (0-5, default: 1)'),
  resolveFrom: z
    .string()
    .optional()
    .describe('Base directory for module resolution. Defaults to rootDir/cwd.'),
  rootDir: z
    .string()
    .optional()
    .describe('Working directory for the inspection (default: $DEPLENS_ROOT or process.cwd())'),
  jsdoc: JsdocModeEnum.optional().describe('JSDoc verbosity mode'),
  jsdocOutput: JsdocOutputEnum.optional().describe('Where to render JSDoc in the output'),
  jsdocQuery: JsdocQuerySchema.optional(),
  analyzeSource: z
    .boolean()
    .optional()
    .describe('Analyze source code (JS/TS/Python/Java/Rust/Go) for implementation details + complexity'),
  sourceMaxFiles: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .describe('Max source files to analyze (default: 5)'),
  sourceIncludeBody: z
    .boolean()
    .optional()
    .describe('Include function body snippets in the source analysis'),
  language: z
    .enum(['javascript', 'typescript', 'python', 'java', 'rust', 'go'])
    .optional()
    .describe('Force language detection instead of auto-detecting from the package layout'),
};

const InspectInputSchema = z.object(inspectInputShape).strict();

/** @typedef {z.infer<typeof InspectInputSchema>} InspectInput */

const inspectOutputShape = {
  schemaVersion: z.number(),
  package: z.string().nullable(),
  version: z.string().nullable(),
  description: z.string().nullable(),
  resolution: z
    .object({
      target: z.string().nullable(),
      resolveFrom: z.string().nullable(),
      resolveCwd: z.string().nullable(),
      resolved: z.string().nullable(),
      entrypointPath: z.string().nullable(),
      entrypointExists: z.boolean(),
    })
    .nullable(),
  exports: z
    .object({
      total: z.number(),
      functions: z.array(z.string()),
      classes: z.array(z.string()),
      objects: z.array(z.string()),
      constants: z.array(z.string()),
    })
    .nullable(),
  types: z.record(z.any()).nullable(),
  docs: z.record(z.any()).nullable(),
  sections: z.array(z.record(z.any())).nullable(),
  examples: z.record(z.any()).nullable(),
  meta: z.record(z.any()).nullable(),
  warnings: z.array(z.string()),
  error: z.string().optional(),
};

// Note: the SDK serializes `inspectOutputShape` into JSON Schema for clients
// and validates handler output against it automatically. We expose the shape
// (not a built z.object) because that's what `registerTool` expects.

const emptyInspectStructured = () => ({
  schemaVersion: 1,
  package: null,
  version: null,
  description: null,
  resolution: null,
  exports: null,
  types: null,
  docs: null,
  sections: null,
  examples: null,
  meta: null,
  warnings: [],
});

async function handleInspect(params) {
  debug('inspect args', params);
  const runInspect = await loadRunInspect();

  const rootDir = params.rootDir || process.env.DEPLENS_ROOT || process.cwd();
  const target = params.subpath ? `${params.target}/${params.subpath}` : params.target;

  // Step 1: always produce a structured (object) payload — this is the
  // canonical result and is included as structuredContent.
  const sharedOpts = {
    target,
    filter: params.filter,
    showTypes: params.showTypes,
    includeDocs: params.includeDocs,
    includeExamples: params.includeExamples,
    remote: params.remote,
    remoteVersion: params.remoteVersion,
    jsdoc: params.jsdoc,
    jsdocOutput: params.jsdocOutput,
    jsdocQuery: params.jsdocQuery,
    kind: params.kind,
    depth: params.depth,
    resolveFrom: params.resolveFrom,
    cwd: rootDir,
    analyzeSource: params.analyzeSource,
    sourceMaxFiles: params.sourceMaxFiles,
    sourceIncludeBody: params.sourceIncludeBody,
    language: params.language,
    listSections: params.listSections,
    docsSections: params.docsSections,
    search: params.search,
    maxExports: params.maxExports,
    maxProps: params.maxProps,
    maxExamples: params.maxExamples,
  };

  const structured = await runInspect({ ...sharedOpts, format: 'object' });

  // Defensive: runInspect should always return an object in 'object' mode.
  const finalStructured =
    structured && typeof structured === 'object'
      ? structured
      : {
          ...emptyInspectStructured(),
          meta: { target },
          warnings: ['runInspect did not return an object payload'],
        };

  // Step 2: produce the text representation, depending on requested format.
  const requestedFormat = params.format || 'text';
  let textOut;
  if (requestedFormat === 'json') {
    textOut = JSON.stringify(finalStructured, null, 2);
  } else if (requestedFormat === 'object') {
    // No human-readable text — return a short hint pointing to structuredContent.
    textOut = `Structured payload returned for ${target} (${finalStructured.package ?? 'unknown'}@${finalStructured.version ?? '?'}). See structuredContent.`;
  } else {
    textOut = await runInspect({ ...sharedOpts, format: 'text' });
  }

  const { text, truncated } = truncateIfNeeded(textOut);
  if (truncated && Array.isArray(finalStructured.warnings)) {
    finalStructured.warnings.push(
      `Text output truncated at ${CHARACTER_LIMIT} chars; full payload is in structuredContent or use format='json'.`
    );
  }

  return {
    content: [{ type: 'text', text }],
    structuredContent: finalStructured,
  };
}

// ---------------------------------------------------------------------------
// Tool: deplens_diff
// ---------------------------------------------------------------------------

const diffInputShape = {
  package: z
    .string()
    .min(1, 'package must not be empty')
    .describe('Package name to compare (e.g. "react", "zod", "@scope/pkg")'),
  from: z
    .string()
    .optional()
    .describe(
      "Source version. Accepts a concrete semver ('3.22.0'), 'installed' (default) for the currently installed version, or 'latest'."
    ),
  to: z
    .string()
    .optional()
    .describe(
      "Target version. Accepts a concrete semver ('3.24.0'), 'latest' (default), or 'installed'."
    ),
  filter: z
    .string()
    .optional()
    .describe('Filter exports by name (substring or /regex/)'),
  format: FormatEnum
    .optional()
    .describe("Output format: 'text' (default) or 'json'"),
  includeSource: z
    .boolean()
    .optional()
    .describe('Include source code complexity comparison between versions'),
  includeChangelog: z
    .boolean()
    .optional()
    .describe('Parse and include CHANGELOG.md entries (default: true)'),
  verbose: z
    .boolean()
    .optional()
    .describe('Show detailed per-symbol changes'),
  rootDir: z
    .string()
    .optional()
    .describe('Working directory for the inspection (default: $DEPLENS_ROOT or process.cwd())'),
};

const DiffInputSchema = z.object(diffInputShape).strict();

const diffOutputShape = {
  schemaVersion: z.number(),
  package: z.string(),
  from: z.string(),
  to: z.string(),
  output: z.string().nullable(),
  summary: z.record(z.any()).nullable(),
  changes: z.array(z.record(z.any())).nullable(),
  error: z.string().optional(),
  warnings: z.array(z.string()).optional(),
};

// (See note above on inspectOutputShape — same applies here.)

async function handleDiff(params) {
  debug('diff args', params);
  const runDiff = await loadRunDiff();

  const rootDir = params.rootDir || process.env.DEPLENS_ROOT || process.cwd();
  const from = params.from || 'installed';
  const to = params.to || 'latest';
  const requestedFormat = params.format || 'text';

  const result = await runDiff({
    package: params.package,
    from,
    to,
    projectDir: rootDir,
    includeSource: Boolean(params.includeSource),
    includeChangelog: params.includeChangelog !== false,
    filter: params.filter,
    format: requestedFormat,
    verbose: Boolean(params.verbose),
    colors: false, // never emit ANSI codes through MCP
  });

  const summary = result?.diff?.summary ?? result?.summary ?? null;
  const changes = result?.changes
    ? result.changes
    : result?.diff
      ? [
          ...(result.diff.breaking || []),
          ...(result.diff.warnings || []),
          ...(result.diff.additions || []),
          ...(result.diff.info || []),
        ]
      : null;

  const structured = {
    schemaVersion: 1,
    package: result?.package || params.package,
    from: result?.from || from,
    to: result?.to || to,
    output: result?.output ?? null,
    summary,
    changes,
    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
  };

  let textOut;
  if (requestedFormat === 'json') {
    textOut = JSON.stringify(structured, null, 2);
  } else if (requestedFormat === 'object') {
    textOut = `Diff payload returned for ${structured.package} (${from} → ${to}). See structuredContent.`;
  } else {
    textOut =
      typeof result?.output === 'string' && result.output.length > 0
        ? result.output
        : JSON.stringify(structured, null, 2);
  }

  const { text, truncated } = truncateIfNeeded(textOut);
  if (truncated) {
    structured.warnings = [
      ...(structured.warnings || []),
      `Text output truncated at ${CHARACTER_LIMIT} chars; full payload is in structuredContent or use format='json'.`,
    ];
  }

  return {
    content: [{ type: 'text', text }],
    structuredContent: structured,
  };
}

// ---------------------------------------------------------------------------
// Server registration
// ---------------------------------------------------------------------------

const server = new McpServer(
  {
    name: SERVER_NAME,
    version: PKG_VERSION,
  },
  {
    capabilities: { tools: {} },
    instructions:
      'DepLens exposes two read-only tools for inspecting npm packages already resolvable from the working directory:\n' +
      '  • deplens_inspect — package exports, types (.d.ts), README docs/sections, examples, JSDoc, source analysis\n' +
      '  • deplens_diff   — semver diff between two versions (uses CHANGELOG.md when available)\n' +
      'Both honor a working directory via the `rootDir` parameter or the DEPLENS_ROOT env var. ' +
      'For ad-hoc inspection of a non-installed package, pass `remote: true` to download it into a local cache.',
  }
);

const inspectToolConfig = {
  title: 'Inspect npm package',
  description: [
    'Inspect an installed (or remotely downloaded) npm package and return its exports, type signatures, README docs/sections, examples, and resolution metadata.',
    '',
    'Read-only. Resolves the package from `rootDir` (or DEPLENS_ROOT, or process.cwd()) using Node\'s ESM/CJS resolver. Set `remote: true` to download a specific version into a local cache instead.',
    '',
    'Common parameter shapes:',
    '  - target: "react", "next/server", "@scope/pkg" (use `subpath` to append a subpath separately)',
    '  - filter: substring (case-insensitive) or "/regex/" pattern over export names',
    '  - kind: ["function","class","object","constant","interface","type"]',
    '  - showTypes: true to parse .d.ts (functions/interfaces/classes/types/enums)',
    '  - includeDocs / docsSections / listSections: control README extraction',
    '  - format: "text" (default human-readable), "json" (stringified payload), or "object" (only structuredContent)',
    '',
    'The structured payload is ALWAYS returned in `structuredContent` regardless of `format`. Use `format: "json"` when you want the structured payload duplicated in the text channel.',
  ].join('\n'),
  inputSchema: inspectInputShape,
  outputSchema: inspectOutputShape,
  annotations: {
    title: 'Inspect npm package',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

const diffToolConfig = {
  title: 'Diff npm package versions',
  description: [
    'Compare two versions of an npm package and detect breaking changes, additions, removals, and modifications. Parses CHANGELOG.md when available.',
    '',
    'Read-only. Both versions are resolved from the public npm registry/CDN cache; the source version may also be the one currently installed in `rootDir` via from="installed" (the default).',
    '',
    'Common parameter shapes:',
    '  - package: "react", "zod", "@scope/pkg"',
    '  - from: "installed" (default), a concrete semver ("3.22.0"), or "latest"',
    '  - to: "latest" (default), a concrete semver ("3.24.0"), or "installed"',
    '  - filter: substring (case-insensitive) or "/regex/" pattern',
    '  - includeSource: include source-code complexity comparison',
    '  - includeChangelog: parse CHANGELOG.md entries (default: true)',
    '  - format: "text" (default), "json", or "object"',
    '',
    'The structured payload is ALWAYS returned in `structuredContent` regardless of `format`.',
  ].join('\n'),
  inputSchema: diffInputShape,
  outputSchema: diffOutputShape,
  annotations: {
    title: 'Diff npm package versions',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

// Primary, spec-compliant snake_case names.
server.registerTool('deplens_inspect', inspectToolConfig, async (rawArgs) => {
  try {
    const parsed = InspectInputSchema.parse(rawArgs ?? {});
    return await handleInspect(parsed);
  } catch (error) {
    return buildErrorResponse(error, {
      ...emptyInspectStructured(),
      meta: { target: rawArgs?.target ?? null },
    });
  }
});

server.registerTool('deplens_diff', diffToolConfig, async (rawArgs) => {
  try {
    const parsed = DiffInputSchema.parse(rawArgs ?? {});
    return await handleDiff(parsed);
  } catch (error) {
    return buildErrorResponse(error, {
      schemaVersion: 1,
      package: rawArgs?.package ?? '',
      from: rawArgs?.from ?? 'installed',
      to: rawArgs?.to ?? 'latest',
      output: null,
      summary: null,
      changes: null,
      warnings: [],
    });
  }
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  debug('startup', { name: SERVER_NAME, version: PKG_VERSION, pid: process.pid });
}

main().catch((error) => {
  // stderr only — never write protocol noise to stdout
  console.error('[deplens-mcp] fatal:', error?.stack || error);
  process.exit(1);
});
