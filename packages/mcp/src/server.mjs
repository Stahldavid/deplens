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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_NAME = 'deplens-mcp-server';

/** Max characters to emit in a single text response before truncating. */
const CHARACTER_LIMIT = 100_000;

const DEBUG = process.env.DEPLENS_DEBUG === 'true';

function readPackageVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '..', 'package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const PKG_VERSION = readPackageVersion();

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

async function loadCoreFunction(name) {
  const core = await loadCore();
  const fn = core[name] || core.default?.[name];
  if (typeof fn !== 'function') throw new Error(`${name} not exported by @deplens/core`);
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

function formatInspectSummary(payload, target) {
  const lines = [
    `Package: ${payload.package || target}${payload.version ? `@${payload.version}` : ''}`,
  ];
  if (payload.description) lines.push(`Description: ${payload.description}`);
  if (payload.exports) lines.push(`Runtime exports: ${payload.exports.total}`);
  if (Array.isArray(payload.symbols)) lines.push(`Symbols: ${payload.symbols.length}`);
  if (payload.resolution?.entrypointPath) {
    lines.push(`Entrypoint: ${payload.resolution.entrypointPath}`);
  }
  for (const warning of payload.warnings || []) lines.push(`Warning: ${warning}`);
  return lines.join('\n');
}

function buildErrorResponse(error, fallbackStructured) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = DEBUG && error instanceof Error && error.stack ? `\n\n[stack]\n${error.stack}` : '';
  debug('error', message);
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${message}${stack}` }],
    structuredContent: {
      ...fallbackStructured,
      error: message,
      ...(error?.code
        ? {
            errorInfo: {
              code: error.code,
              phase: error.phase || 'unknown',
              retryable: Boolean(error.retryable),
              details: error.details || null,
            },
          }
        : {}),
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
    sections: z.array(JsdocSectionEnum).optional().describe('Which JSDoc sections to include'),
    tags: z
      .object({
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
      })
      .optional()
      .describe('Filter JSDoc by tag name (include/exclude)'),
    mode: z.enum(['compact', 'full']).optional(),
    maxLen: z.number().int().nonnegative().optional(),
    maxParams: z.number().int().nonnegative().max(1000).optional(),
    paramCursor: z.number().int().nonnegative().optional(),
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
  kind: z.array(KindEnum).optional().describe('Restrict exports to specific kinds'),
  showTypes: z
    .boolean()
    .optional()
    .describe('Parse .d.ts files and return type signatures, interfaces, classes, enums'),
  includeDocs: z.boolean().optional().describe('Include README preview in the response'),
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
  runtime: z
    .boolean()
    .optional()
    .describe(
      'Whether to import/require the package entrypoint for runtime exports. Defaults to false.'
    ),
  format: FormatEnum.optional().describe(
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
  maxSymbols: z
    .number()
    .int()
    .positive()
    .max(5_000)
    .optional()
    .describe('Maximum canonical symbols in structuredContent (default: 250)'),
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
    .describe(
      'Analyze source code (JS/TS/Python/Java/Rust/Go) for implementation details + complexity'
    ),
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
  detail: z.enum(['compact', 'full']).optional().describe('Structured output detail level'),
  select: z.array(z.string()).optional().describe('Structured sections to include'),
  cursor: z.string().optional().describe('Symbol pagination cursor'),
  conditions: z
    .array(z.string())
    .optional()
    .describe('Package export conditions in priority order'),
  cacheDir: z.string().optional().describe('Override the DepLens version cache directory'),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
};

const InspectInputSchema = z.object(inspectInputShape).strict();

/** @typedef {z.infer<typeof InspectInputSchema>} InspectInput */

const inspectOutputShape = {
  schemaVersion: z.number(),
  kind: z.string().optional(),
  detailLevel: z.enum(['compact', 'full']).optional(),
  package: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  resolution: z
    .object({
      target: z.string().nullable(),
      resolveFrom: z.string().nullable(),
      resolveCwd: z.string().nullable(),
      resolved: z.string().nullable(),
      entrypointPath: z.string().nullable(),
      entrypointExists: z.boolean(),
    })
    .catchall(z.any())
    .nullable()
    .optional(),
  pkgDir: z.string().nullable().optional(),
  exports: z
    .object({
      total: z.number(),
      functions: z.array(z.string()),
      classes: z.array(z.string()),
      objects: z.array(z.string()),
      constants: z.array(z.string()),
    })
    .nullable()
    .optional(),
  staticExports: z
    .object({
      total: z.number(),
      names: z.array(z.string()).optional(),
      pagination: z.record(z.any()).optional(),
    })
    .nullable()
    .optional(),
  types: z.record(z.any()).nullable().optional(),
  docs: z.record(z.any()).nullable().optional(),
  sections: z.array(z.record(z.any())).nullable().optional(),
  examples: z.record(z.any()).nullable().optional(),
  jsdoc: z.record(z.any()).nullable().optional(),
  symbols: z.array(z.record(z.any())).nullable().optional(),
  pagination: z.record(z.any()).optional(),
  sourceAnalysis: z.record(z.any()).nullable().optional(),
  languageAnalysis: z.record(z.any()).nullable().optional(),
  meta: z.record(z.any()).nullable().optional(),
  warnings: z.array(z.string()).optional(),
  error: z.string().optional(),
  errorInfo: z.record(z.any()).optional(),
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
  pkgDir: null,
  exports: null,
  staticExports: null,
  types: null,
  docs: null,
  sections: null,
  examples: null,
  jsdoc: null,
  symbols: null,
  sourceAnalysis: null,
  languageAnalysis: null,
  meta: null,
  warnings: [],
});

async function handleInspect(params, extra = {}) {
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
    runtime: params.runtime === true,
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
    maxSymbols: params.maxSymbols,
    detail: params.detail,
    select: params.select,
    cursor: params.cursor,
    conditions: params.conditions,
    cacheDir: params.cacheDir,
    timeoutMs: params.timeoutMs,
    signal: extra.signal,
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

  finalStructured.symbols ??= null;
  finalStructured.sourceAnalysis ??= null;
  finalStructured.languageAnalysis ??= null;
  const maxSymbols = params.maxSymbols || 250;
  if (Array.isArray(finalStructured.symbols) && finalStructured.symbols.length > maxSymbols) {
    const omitted = finalStructured.symbols.length - maxSymbols;
    finalStructured.symbols = finalStructured.symbols.slice(0, maxSymbols);
    finalStructured.warnings.push(
      `${omitted} symbols omitted from structuredContent; use filter/search or increase maxSymbols.`
    );
    finalStructured.meta = {
      ...(finalStructured.meta || {}),
      symbolsTruncated: true,
      omittedSymbols: omitted,
    };
  }

  // Step 2: produce the text representation, depending on requested format.
  const requestedFormat = params.format || 'text';
  let textOut;
  if (finalStructured.error) {
    textOut = `Error: ${finalStructured.error}`;
  } else if (requestedFormat === 'json') {
    textOut = JSON.stringify(finalStructured, null, 2);
  } else if (requestedFormat === 'object') {
    // No human-readable text — return a short hint pointing to structuredContent.
    textOut = `Structured payload returned for ${target} (${finalStructured.package ?? 'unknown'}@${finalStructured.version ?? '?'}). See structuredContent.`;
  } else {
    textOut = formatInspectSummary(finalStructured, target);
  }

  const { text, truncated } = truncateIfNeeded(textOut);
  if (truncated && Array.isArray(finalStructured.warnings)) {
    finalStructured.warnings.push(
      `Text output truncated at ${CHARACTER_LIMIT} chars; full payload is in structuredContent or use format='json'.`
    );
  }

  const response = {
    content: [{ type: 'text', text }],
    structuredContent: finalStructured,
  };
  if (finalStructured.error) response.isError = true;
  return response;
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
  filter: z.string().optional().describe('Filter exports by name (substring or /regex/)'),
  format: FormatEnum.optional().describe("Output format: 'text' (default) or 'json'"),
  includeSource: z
    .boolean()
    .optional()
    .describe('Include source code complexity comparison between versions'),
  runtime: z
    .boolean()
    .optional()
    .describe(
      'Whether to import package entrypoints while diffing. Defaults to false for safer static type-only comparison.'
    ),
  preferCdn: z
    .boolean()
    .optional()
    .describe(
      'Prefer lightweight CDN downloads instead of full npm installs when fetching package versions.'
    ),
  offline: z
    .boolean()
    .optional()
    .describe('Use only versions already present in the local DepLens cache.'),
  includeChangelog: z
    .boolean()
    .optional()
    .describe('Parse and include CHANGELOG.md entries (default: true)'),
  verbose: z.boolean().optional().describe('Show detailed per-symbol changes'),
  rootDir: z
    .string()
    .optional()
    .describe('Working directory for the inspection (default: $DEPLENS_ROOT or process.cwd())'),
  conditions: z
    .array(z.string())
    .optional()
    .describe('Package export conditions in priority order'),
  cacheDir: z.string().optional().describe('Override the DepLens version cache directory'),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  semantic: z
    .boolean()
    .optional()
    .describe('Run TypeScript assignability validation (default: true)'),
  maxChanges: z.number().int().positive().max(10_000).optional(),
  cursor: z.string().optional().describe('Change pagination cursor'),
};

const DiffInputSchema = z.object(diffInputShape).strict();

const diffOutputShape = {
  schemaVersion: z.number(),
  detailLevel: z.enum(['compact', 'verbose']).nullable().optional(),
  package: z.string(),
  from: z.string(),
  to: z.string(),
  output: z.string().nullable(),
  summary: z.record(z.any()).nullable(),
  changes: z.array(z.record(z.any())).nullable(),
  symbols: z.record(z.any()).nullable(),
  sourceComparison: z.record(z.any()).nullable(),
  semanticCompatibility: z.record(z.any()).nullable().optional(),
  pagination: z.record(z.any()).nullable().optional(),
  changelog: z.record(z.any()).nullable(),
  meta: z.record(z.any()).nullable(),
  error: z.string().optional(),
  warnings: z.array(z.string()).optional(),
};

// (See note above on inspectOutputShape — same applies here.)

async function handleDiff(params, extra = {}) {
  debug('diff args', params);
  const runDiff = await loadRunDiff();

  const rootDir = params.rootDir || process.env.DEPLENS_ROOT || process.cwd();
  const from = params.from || 'installed';
  const to = params.to || 'latest';
  const requestedFormat = params.format || 'text';
  const coreFormat = requestedFormat === 'object' ? 'json' : requestedFormat;

  const result = await runDiff({
    package: params.package,
    from,
    to,
    projectDir: rootDir,
    includeSource: Boolean(params.includeSource),
    runtime: params.runtime === true,
    preferCdn: Boolean(params.preferCdn),
    offline: Boolean(params.offline),
    includeChangelog: params.includeChangelog !== false,
    filter: params.filter,
    format: coreFormat,
    verbose: Boolean(params.verbose),
    colors: false, // never emit ANSI codes through MCP
    conditions: params.conditions,
    cacheDir: params.cacheDir,
    timeoutMs: params.timeoutMs,
    semantic: params.semantic !== false,
    maxChanges: params.maxChanges,
    cursor: params.cursor,
    signal: extra.signal,
  });

  let jsonPayload = null;
  if (
    (requestedFormat === 'json' || requestedFormat === 'object') &&
    typeof result?.output === 'string'
  ) {
    try {
      jsonPayload = JSON.parse(result.output);
    } catch {
      jsonPayload = null;
    }
  }
  const summary = jsonPayload?.summary ?? result?.summary ?? result?.diff?.summary ?? null;
  const changes = Array.isArray(jsonPayload?.changes)
    ? jsonPayload.changes
    : result?.changes
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
    schemaVersion: jsonPayload?.schemaVersion || 1,
    detailLevel: jsonPayload?.detailLevel || null,
    package: jsonPayload?.package || result?.package || params.package,
    from: result?.diff?.from?.version || jsonPayload?.from?.version || result?.from || from,
    to: result?.diff?.to?.version || jsonPayload?.to?.version || result?.to || to,
    output: requestedFormat === 'text' ? result?.output || null : null,
    summary,
    changes,
    symbols: jsonPayload?.symbols || result?.symbols || result?.diff?.symbols || null,
    sourceComparison: result?.diff?.sourceComparison || jsonPayload?.sourceComparison || null,
    semanticCompatibility:
      result?.diff?.semanticCompatibility || jsonPayload?.semanticCompatibility || null,
    pagination: jsonPayload?.pagination || null,
    changelog: result?.changelog || jsonPayload?.changelog || null,
    meta: jsonPayload?.meta || null,
    error: result?.error || jsonPayload?.error,
    warnings: Array.isArray(result?.warnings)
      ? result.warnings
      : Array.isArray(jsonPayload?.warnings)
        ? jsonPayload.warnings
        : [],
  };

  let textOut;
  if (structured.error) {
    textOut = `Error: ${structured.error}`;
  } else if (requestedFormat === 'json') {
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

  const response = {
    content: [{ type: 'text', text }],
    structuredContent: structured,
  };
  if (structured.error) response.isError = true;
  return response;
}

// ---------------------------------------------------------------------------
// Project, policy, doctor, and version tools
// ---------------------------------------------------------------------------

const ProjectFormatEnum = z.enum(['text', 'json', 'object', 'sarif']);
const projectInputShape = {
  from: z
    .string()
    .optional()
    .describe('Git ref or lockfile path for the baseline (default: HEAD~1)'),
  to: z.string().optional().describe('Git ref or lockfile path for the target (default: working)'),
  rootDir: z.string().optional(),
  lockfile: z.string().optional().describe('Lockfile path inside Git refs'),
  analyze: z.boolean().optional().describe('Enrich direct dependency changes with API diffs'),
  includeTransitive: z.boolean().optional(),
  includeSource: z.boolean().optional(),
  runtime: z.boolean().optional(),
  semantic: z.boolean().optional(),
  preferCdn: z.boolean().optional(),
  offline: z.boolean().optional(),
  conditions: z.array(z.string()).optional(),
  cacheDir: z.string().optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  concurrency: z.number().int().positive().max(16).optional(),
  detail: z.enum(['compact', 'full']).optional(),
  maxChangesPerPackage: z.number().int().positive().max(1000).optional(),
  packageCursors: z.record(z.union([z.string(), z.number().int().nonnegative()])).optional(),
  packageOnly: z.array(z.string()).optional(),
  strictPackageOnly: z.boolean().optional(),
  projectSnapshot: z.string().optional(),
  format: ProjectFormatEnum.optional(),
};
const ProjectInputSchema = z.object(projectInputShape).strict();
const projectOutputShape = {
  schemaVersion: z.number(),
  kind: z.string(),
  detailLevel: z.enum(['compact', 'full']),
  from: z.record(z.any()).nullable(),
  to: z.record(z.any()).nullable(),
  summary: z.record(z.any()),
  changes: z.array(z.record(z.any())),
  warnings: z.array(z.string()),
  snapshot: z.record(z.any()).optional(),
  packageSelection: z.record(z.any()).optional(),
  error: z.string().optional(),
  errorInfo: z.record(z.any()).optional(),
};

const DoctorInputSchema = z
  .object({
    target: z.string().min(1),
    rootDir: z.string().optional(),
    remote: z.boolean().optional(),
    remoteVersion: z.string().optional(),
    runtime: z.boolean().optional(),
    preferCdn: z.boolean().optional(),
    offline: z.boolean().optional(),
    conditions: z.array(z.string()).optional(),
    cacheDir: z.string().optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
    format: FormatEnum.optional(),
  })
  .strict();
const doctorOutputShape = {
  schemaVersion: z.number(),
  target: z.string().nullable(),
  package: z.string().nullable(),
  version: z.string().nullable(),
  status: z.string(),
  summary: z.record(z.any()),
  resolution: z.record(z.any()).nullable(),
  checks: z.array(z.record(z.any())),
  suggestions: z.array(z.string()),
  warnings: z.array(z.string()),
  symbols: z.record(z.any()),
  error: z.string().optional(),
};

const CheckInputSchema = z
  .object({
    baseline: z.string().min(1).describe('Path to a DepLens baseline JSON file'),
    rootDir: z.string().optional(),
    lockfile: z.string().optional(),
    config: z.string().optional(),
    failOn: z.enum(['breaking', 'warning', 'change', 'none']).optional(),
    analyze: z.boolean().optional(),
    includeTransitive: z.boolean().optional(),
    includeSource: z.boolean().optional(),
    runtime: z.boolean().optional(),
    semantic: z.boolean().optional(),
    preferCdn: z.boolean().optional(),
    offline: z.boolean().optional(),
    conditions: z.array(z.string()).optional(),
    cacheDir: z.string().optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
    concurrency: z.number().int().positive().max(16).optional(),
    format: ProjectFormatEnum.optional(),
  })
  .strict();
const checkOutputShape = {
  schemaVersion: z.number(),
  kind: z.string(),
  passed: z.boolean(),
  failOn: z.string(),
  summary: z.record(z.any()),
  violations: z.array(z.record(z.any())),
  report: z.record(z.any()),
  policy: z.record(z.any()),
  error: z.string().optional(),
};

const VersionsInputSchema = z
  .object({
    package: z.string().min(1),
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict();
const versionsOutputShape = {
  schemaVersion: z.number(),
  kind: z.string(),
  package: z.string(),
  latest: z.string(),
  versions: z.array(z.string()),
  total: z.number(),
};

function toolResponse(structuredContent, text, isError = false) {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: 'text', text }],
    structuredContent,
  };
}

function progressReporter(extra) {
  const progressToken = extra?._meta?.progressToken;
  if (progressToken === undefined || typeof extra?.sendNotification !== 'function')
    return undefined;
  return (progress) => {
    Promise.resolve(
      extra.sendNotification({
        method: 'notifications/progress',
        params: { progressToken, progress: progress.completed, total: progress.total },
      })
    ).catch(() => {});
  };
}

async function handleDoctor(params, extra = {}) {
  const runDoctor = await loadCoreFunction('runDoctor');
  const rootDir = params.rootDir || process.env.DEPLENS_ROOT || process.cwd();
  const report = await runDoctor({
    ...params,
    cwd: rootDir,
    format: 'object',
    signal: extra.signal,
  });
  return toolResponse(report, `Doctor ${report.status}: ${params.target}`, Boolean(report.error));
}

async function handleProjectDiff(params, extra = {}) {
  const [loadProjectSnapshot, runProjectDiff, formatProjectDiffText] = await Promise.all([
    loadCoreFunction('loadProjectSnapshot'),
    loadCoreFunction('runProjectDiff'),
    loadCoreFunction('formatProjectDiffText'),
  ]);
  const rootDir = params.rootDir || process.env.DEPLENS_ROOT || process.cwd();
  const lockfile = params.lockfile || 'package-lock.json';
  const [from, to] = await Promise.all([
    loadProjectSnapshot(params.from || 'HEAD~1', { projectDir: rootDir, lockfile }),
    loadProjectSnapshot(params.to || 'working', { projectDir: rootDir, lockfile }),
  ]);
  const report = await runProjectDiff({
    ...params,
    from,
    to,
    projectDir: rootDir,
    analyze: params.analyze !== false,
    signal: extra.signal,
    onProgress: progressReporter(extra),
  });
  const text =
    params.format === 'json' ? JSON.stringify(report, null, 2) : formatProjectDiffText(report);
  return toolResponse(
    report,
    truncateIfNeeded(text).text,
    report.summary.failedPackages > 0 || Boolean(report.error)
  );
}

async function handleCheck(params, extra = {}) {
  const [
    loadProjectSnapshot,
    runProjectCheck,
    loadProjectPolicy,
    formatPolicyText,
    formatPolicyAsSarif,
  ] = await Promise.all([
    loadCoreFunction('loadProjectSnapshot'),
    loadCoreFunction('runProjectCheck'),
    loadCoreFunction('loadProjectPolicy'),
    loadCoreFunction('formatPolicyText'),
    loadCoreFunction('formatPolicyAsSarif'),
  ]);
  const rootDir = params.rootDir || process.env.DEPLENS_ROOT || process.cwd();
  const current = await loadProjectSnapshot('working', {
    projectDir: rootDir,
    lockfile: params.lockfile || 'package-lock.json',
  });
  const configured = loadProjectPolicy(params.config, { projectDir: rootDir });
  const result = await runProjectCheck({
    ...params,
    baseline: path.resolve(rootDir, params.baseline),
    current,
    projectDir: rootDir,
    analyze: params.analyze !== false,
    policy: params.failOn ? { ...configured, failOn: params.failOn } : configured,
    signal: extra.signal,
    onProgress: progressReporter(extra),
  });
  const text =
    params.format === 'sarif'
      ? JSON.stringify(formatPolicyAsSarif(result), null, 2)
      : params.format === 'json'
        ? JSON.stringify(result, null, 2)
        : formatPolicyText(result);
  return toolResponse(result, truncateIfNeeded(text).text, !result.passed);
}

async function handleVersions(params) {
  const [getAllVersions, getLatestVersionAsync] = await Promise.all([
    loadCoreFunction('getAllVersions'),
    loadCoreFunction('getLatestVersionAsync'),
  ]);
  const [versions, latest] = await Promise.all([
    Promise.resolve(getAllVersions(params.package)),
    getLatestVersionAsync(params.package),
  ]);
  const limit = params.limit || 50;
  const structured = {
    schemaVersion: 1,
    kind: 'deplens-versions',
    package: params.package,
    latest,
    versions: versions.slice(-limit).reverse(),
    total: versions.length,
  };
  return toolResponse(
    structured,
    `${params.package}: latest ${latest}, ${versions.length} versions`
  );
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
      'DepLens exposes tools for inspecting npm packages already resolvable from the working directory:\n' +
      '  • deplens_inspect — package exports, types (.d.ts), README docs/sections, examples, JSDoc, source analysis\n' +
      '  • deplens_diff   — semver diff between two versions (uses CHANGELOG.md when available)\n' +
      '  • deplens_doctor — package resolution and type/runtime diagnostics\n' +
      '  • deplens_project_diff — dependency changes between lockfiles or Git refs\n' +
      '  • deplens_check — enforce a saved dependency baseline and policy\n' +
      '  • deplens_versions — list published package versions\n' +
      'Both honor a working directory via the `rootDir` parameter or the DEPLENS_ROOT env var. ' +
      'For ad-hoc inspection of a non-installed package, pass `remote: true` to download it into a local cache.',
  }
);

const inspectToolConfig = {
  title: 'Inspect npm package',
  description: [
    'Inspect an installed (or remotely downloaded) npm package and return its exports, type signatures, README docs/sections, examples, and resolution metadata.',
    '',
    "Resolves the package from `rootDir` (or DEPLENS_ROOT, or process.cwd()) using Node's ESM/CJS resolver. Set `remote: true` to download a specific version into a local cache instead.",
    '',
    'Common parameter shapes:',
    '  - target: "react", "next/server", "@scope/pkg" (use `subpath` to append a subpath separately)',
    '  - filter: substring (case-insensitive) or "/regex/" pattern over export names',
    '  - kind: ["function","class","object","constant","interface","type"]',
    '  - showTypes: true to parse .d.ts (functions/interfaces/classes/types/enums)',
    '  - runtime: true to explicitly import entrypoints (default is static analysis only)',
    '  - includeDocs / docsSections / listSections: control README extraction',
    '  - format: "text" (default human-readable), "json" (stringified payload), or "object" (only structuredContent)',
    '',
    'The structured payload is ALWAYS returned in `structuredContent` regardless of `format`. Use `format: "json"` when you want the structured payload duplicated in the text channel.',
  ].join('\n'),
  inputSchema: inspectInputShape,
  outputSchema: inspectOutputShape,
  annotations: {
    title: 'Inspect npm package',
    readOnlyHint: false,
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
    '  - runtime: true to import package entrypoints (default is static analysis only)',
    '  - preferCdn / offline: control package version fetching',
    '  - includeChangelog: parse CHANGELOG.md entries (default: true)',
    '  - format: "text" (default), "json", or "object"',
    '',
    'The structured payload is ALWAYS returned in `structuredContent` regardless of `format`.',
  ].join('\n'),
  inputSchema: diffInputShape,
  outputSchema: diffOutputShape,
  annotations: {
    title: 'Diff npm package versions',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

const doctorToolConfig = {
  title: 'Diagnose npm package resolution',
  description: 'Run DepLens Doctor and return structured resolution, type, and symbol checks.',
  inputSchema: DoctorInputSchema.shape,
  outputSchema: doctorOutputShape,
  annotations: {
    title: 'Diagnose npm package resolution',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

const projectDiffToolConfig = {
  title: 'Diff project dependencies',
  description:
    'Compare npm or pnpm lockfile snapshots from files or Git refs and optionally analyze API compatibility.',
  inputSchema: projectInputShape,
  outputSchema: projectOutputShape,
  annotations: {
    title: 'Diff project dependencies',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

const checkToolConfig = {
  title: 'Check dependency policy',
  description:
    'Compare the working npm or pnpm lockfile with a DepLens baseline and enforce project policy.',
  inputSchema: CheckInputSchema.shape,
  outputSchema: checkOutputShape,
  annotations: {
    title: 'Check dependency policy',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

const versionsToolConfig = {
  title: 'List npm package versions',
  description: 'Return the latest and recent published versions for an npm package.',
  inputSchema: VersionsInputSchema.shape,
  outputSchema: versionsOutputShape,
  annotations: {
    title: 'List npm package versions',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

// Primary, spec-compliant snake_case names.
server.registerTool('deplens_inspect', inspectToolConfig, async (rawArgs, extra) => {
  try {
    const parsed = InspectInputSchema.parse(rawArgs ?? {});
    return await handleInspect(parsed, extra);
  } catch (error) {
    return buildErrorResponse(error, {
      ...emptyInspectStructured(),
      meta: { target: rawArgs?.target ?? null },
    });
  }
});

server.registerTool('deplens_diff', diffToolConfig, async (rawArgs, extra) => {
  try {
    const parsed = DiffInputSchema.parse(rawArgs ?? {});
    return await handleDiff(parsed, extra);
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

server.registerTool('deplens_doctor', doctorToolConfig, async (rawArgs, extra) => {
  try {
    return await handleDoctor(DoctorInputSchema.parse(rawArgs ?? {}), extra);
  } catch (error) {
    return buildErrorResponse(error, {
      schemaVersion: 1,
      target: rawArgs?.target ?? null,
      package: null,
      version: null,
      status: 'issues',
      summary: {},
      resolution: null,
      checks: [],
      suggestions: [],
      warnings: [],
      symbols: {},
    });
  }
});

server.registerTool('deplens_project_diff', projectDiffToolConfig, async (rawArgs, extra) => {
  try {
    return await handleProjectDiff(ProjectInputSchema.parse(rawArgs ?? {}), extra);
  } catch (error) {
    return buildErrorResponse(error, {
      schemaVersion: 1,
      kind: 'deplens-project-diff',
      from: null,
      to: null,
      summary: {},
      changes: [],
      warnings: [],
    });
  }
});

server.registerTool('deplens_check', checkToolConfig, async (rawArgs, extra) => {
  try {
    return await handleCheck(CheckInputSchema.parse(rawArgs ?? {}), extra);
  } catch (error) {
    return buildErrorResponse(error, {
      schemaVersion: 1,
      kind: 'deplens-policy-result',
      passed: false,
      failOn: rawArgs?.failOn ?? 'breaking',
      summary: {},
      violations: [],
      report: {},
      policy: {},
    });
  }
});

server.registerTool('deplens_versions', versionsToolConfig, async (rawArgs) => {
  try {
    return await handleVersions(VersionsInputSchema.parse(rawArgs ?? {}));
  } catch (error) {
    return buildErrorResponse(error, {
      schemaVersion: 1,
      kind: 'deplens-versions',
      package: rawArgs?.package ?? '',
      latest: '',
      versions: [],
      total: 0,
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
