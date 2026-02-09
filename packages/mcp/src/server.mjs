#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
let corePromise = null;
let diffPromise = null;

async function loadCore() {
  if (!corePromise) {
    corePromise = import("@deplens/core").catch(async (error) => {
      try {
        const fallbackUrl = new URL("./core/inspect.mjs", import.meta.url);
        return await import(fallbackUrl.href);
      } catch (fallbackError) {
        const message =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        const err = new Error(
          `Failed to load @deplens/core. Fallback also failed: ${message}`,
        );
        err.cause = error;
        throw err;
      }
    });
  }
  return corePromise;
}

async function loadDiff() {
  if (!diffPromise) {
    diffPromise = (async () => {
      // Try @deplens/core first
      try {
        const core = await import("@deplens/core");
        if (core.runDiff) return core.runDiff;
        if (core.default?.runDiff) return core.default.runDiff;
      } catch {
        // @deplens/core not available, try fallback
      }

      // Fallback to local module
      try {
        const fallbackUrl = new URL("./core/diff.mjs", import.meta.url);
        const mod = await import(fallbackUrl.href);
        return mod.runDiff || mod.default?.runDiff;
      } catch (e) {
        console.error("Failed to load diff module:", e);
        return null;
      }
    })();
  }
  return diffPromise;
}

const inspectToolSchema = {
  type: "object",
  properties: {
    target: {
      type: "string",
      description: "Package name or import path (e.g. react, next/server)",
    },
    subpath: {
      type: "string",
      description: "Optional subpath (e.g. server for next/server)",
    },
    filter: { type: "string", description: "Substring filter for exports" },
    kind: {
      type: "array",
      items: {
        type: "string",
        enum: ["function", "class", "object", "constant", "interface", "type"],
      },
      description: "Filter by export kind",
    },
    showTypes: {
      type: "boolean",
      description: "Show type signatures from .d.ts",
    },
    includeDocs: {
      type: "boolean",
      description: "Include README preview (docs)",
    },
    includeExamples: {
      type: "boolean",
      description: "Include README/examples/@example snippets",
    },
    remote: {
      type: "boolean",
      description: "Download package to cache and inspect that version",
    },
    remoteVersion: {
      type: "string",
      description: "Version for remote download (default: latest)",
    },
    format: {
      type: "string",
      enum: ["text", "json", "object"],
      description: "Output format (default: text)",
    },
    listSections: {
      type: "boolean",
      description: "List available README sections",
    },
    docsSections: {
      type: "array",
      items: { type: "string" },
      description: "Extract specific README sections by name",
    },
    search: {
      type: "string",
      description: "Semantic search query (token matching + JSDoc)",
    },
    maxExports: {
      type: "number",
      description: "Max exports to show (default: 100)",
    },
    maxProps: {
      type: "number",
      description: "Max props per object (default: 10)",
    },
    maxExamples: {
      type: "number",
      description: "Max examples to show (default: 10)",
    },
    depth: { type: "number", description: "Depth for object inspection (0-5)" },
    resolveFrom: {
      type: "string",
      description: "Base directory for module resolution",
    },
    rootDir: {
      type: "string",
      description: "Working directory for the inspection (default: cwd)",
    },
    jsdoc: {
      type: "string",
      enum: ["off", "compact", "full"],
      description: "JSDoc mode",
    },
    jsdocOutput: {
      type: "string",
      enum: ["off", "section", "inline", "only"],
      description: "Where to print JSDoc",
    },
    jsdocQuery: {
      type: "object",
      properties: {
        symbols: {
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        sections: {
          type: "array",
          items: {
            type: "string",
            enum: ["summary", "params", "returns", "tags"],
          },
        },
        tags: {
          type: "object",
          properties: {
            include: { type: "array", items: { type: "string" } },
            exclude: { type: "array", items: { type: "string" } },
          },
        },
        mode: { type: "string", enum: ["compact", "full"] },
        maxLen: { type: "number" },
        truncate: { type: "string", enum: ["none", "sentence", "word"] },
      },
    },
    analyzeSource: {
      type: "boolean",
      description:
        "Analyze source code (.ts/.js) for implementation details, complexity, patterns",
    },
    sourceMaxFiles: {
      type: "number",
      description: "Max source files to analyze (default: 5)",
    },
    sourceIncludeBody: {
      type: "boolean",
      description: "Include function body snippets in output",
    },
  },
  required: ["target"],
};

const diffToolSchema = {
  type: "object",
  properties: {
    package: {
      type: "string",
      description: "Package name to compare (e.g. react, zod)",
    },
    from: {
      type: "string",
      description:
        "Source version (e.g. '3.22.0', 'installed'). Default: 'installed'",
    },
    to: {
      type: "string",
      description:
        "Target version (e.g. '3.24.0', 'latest'). Default: 'latest'",
    },
    includeSource: {
      type: "boolean",
      description: "Include source code complexity analysis",
    },
    includeChangelog: {
      type: "boolean",
      description: "Parse and include CHANGELOG.md entries (default: true)",
    },
    filter: {
      type: "string",
      description: "Filter exports by name",
    },
    format: {
      type: "string",
      enum: ["text", "json", "object"],
      description: "Output format: 'text' (default) or 'json'",
    },

    verbose: {
      type: "boolean",
      description: "Show detailed changes",
    },
  },
  required: ["package"],
};

const inspectToolOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "number" },
    package: { type: ["string", "null"] },
    version: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    resolution: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        target: { type: ["string", "null"] },
        resolveFrom: { type: ["string", "null"] },
        resolveCwd: { type: ["string", "null"] },
        resolved: { type: ["string", "null"] },
        entrypointPath: { type: ["string", "null"] },
        entrypointExists: { type: "boolean" },
      },
      required: [
        "target",
        "resolveFrom",
        "resolveCwd",
        "resolved",
        "entrypointPath",
        "entrypointExists",
      ],
    },
    exports: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        total: { type: "number" },
        functions: { type: "array", items: { type: "string" } },
        classes: { type: "array", items: { type: "string" } },
        objects: { type: "array", items: { type: "string" } },
        constants: { type: "array", items: { type: "string" } },
      },
      required: ["total", "functions", "classes", "objects", "constants"],
    },
    types: {
      type: ["object", "null"],
      additionalProperties: true,
    },
    docs: {
      type: ["object", "null"],
      additionalProperties: true,
    },
    sections: {
      type: ["array", "null"],
      items: { type: "object" },
    },
    examples: {
      type: ["object", "null"],
      additionalProperties: true,
    },
    meta: {
      type: ["object", "null"],
      additionalProperties: true,
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: [
    "schemaVersion",
    "package",
    "version",
    "description",
    "exports",
    "types",
    "docs",
    "sections",
    "examples",
    "resolution",
    "meta",
    "warnings",
  ],
};

const diffToolOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "number" },
    package: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    output: { type: ["string", "null"] },
    summary: { type: ["object", "null"], additionalProperties: true },
    changes: { type: ["array", "null"], items: { type: "object" } },
  },
  required: [
    "schemaVersion",
    "package",
    "from",
    "to",
    "output",
    "summary",
    "changes",
  ],
};

function formatInspectSummary(result) {
  if (!result) return "No results";

  const lines = [];

  if (result.package) {
    lines.push(
      `📦 ${result.package}${result.version ? ` v${result.version}` : ""}`,
    );
  }

  if (result.description) {
    lines.push(`   ${result.description}`);
  }

  if (result.exports) {
    const parts = [];
    if (result.exports.functions?.length)
      parts.push(`${result.exports.functions.length} functions`);
    if (result.exports.classes?.length)
      parts.push(`${result.exports.classes.length} classes`);
    if (result.exports.objects?.length)
      parts.push(`${result.exports.objects.length} objects`);
    if (result.exports.constants?.length)
      parts.push(`${result.exports.constants.length} constants`);
    if (parts.length) {
      lines.push(`   🔑 ${result.exports.total} exports: ${parts.join(", ")}`);
    }
  }

  if (result.types) {
    const hasTypes = Object.values(result.types).some(
      (v) => v && Object.keys(v).length > 0,
    );
    if (hasTypes) {
      lines.push(`   🔬 Type definitions available`);
    }
  }

  if (result.warnings?.length) {
    lines.push(`   ⚠️  ${result.warnings.length} warning(s)`);
  }

  return lines.join("\n") || "Inspection complete";
}

function formatDiffSummary(summary, packageName) {
  const lines = [];

  if (packageName) {
    lines.push(`📦 ${packageName}`);
  }

  if (summary) {
    const parts = [];
    if (summary.breaking) parts.push(`${summary.breaking} breaking`);
    if (summary.warnings) parts.push(`${summary.warnings} warnings`);
    if (summary.additions) parts.push(`${summary.additions} additions`);
    if (summary.removals) parts.push(`${summary.removals} removals`);
    if (parts.length) {
      lines.push(`   📊 ${parts.join(", ")}`);
    } else {
      lines.push(`   📊 No changes detected`);
    }
  }

  return lines.join("\n") || "Diff complete";
}

const tools = [
  {
    name: "deplens.inspect",
    description:
      "Inspect a package to get types, exports, docs, examples, and resolution info.",
    inputSchema: inspectToolSchema,
    outputSchema: inspectToolOutputSchema,
  },
  {
    name: "deplens.diff",
    description:
      "Compare two versions of an npm package. Detects breaking changes, additions, and modifications. Parses CHANGELOG.md when available.",
    inputSchema: diffToolSchema,
    outputSchema: diffToolOutputSchema,
  },
];

const server = new Server(
  { name: "deplens", version: "0.1.6" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    // Handle inspect tool
    if (name === "deplens.inspect" || name === "deplens_inspect") {
      const DEBUG = process.env.DEPLENS_DEBUG === "true";
      if (DEBUG) {
        console.error("[DEPLENS DEBUG] inspect args:", JSON.stringify(args, null, 2));
      }
      const rootDir =
        args?.rootDir || process.env.DEPLENS_ROOT || process.cwd();
      const target = args?.subpath
        ? `${args.target}/${args.subpath}`
        : args?.target;
      if (!target) throw new Error("Missing required field: target");

      const core = await loadCore();
      const runInspect = core.runInspect || core.default?.runInspect;
      if (!runInspect) {
        throw new Error("Failed to load runInspect from @deplens/core");
      }
      // Always get structured output first
      const structuredOutput = await runInspect({
        target,
        filter: args?.filter,
        showTypes: args?.showTypes,
        includeDocs: args?.includeDocs,
        includeExamples: args?.includeExamples,
        remote: args?.remote,
        remoteVersion: args?.remoteVersion,
        jsdoc: args?.jsdoc,
        jsdocOutput: args?.jsdocOutput,
        jsdocQuery: args?.jsdocQuery,
        kind: args?.kind,
        depth: args?.depth,
        resolveFrom: args?.resolveFrom,
        cwd: rootDir,
        analyzeSource: args?.analyzeSource,
        sourceMaxFiles: args?.sourceMaxFiles,
        sourceIncludeBody: args?.sourceIncludeBody,
        // It's always safe to return object in MCP
        format: "object",
        listSections: args?.listSections,
        docsSections: args?.docsSections,
        search: args?.search,
        maxExports: args?.maxExports,
        maxProps: args?.maxProps,
        maxExamples: args?.maxExamples,
      });

      // Generate text output based on requested format
      let text;
      if (args?.format === "json") {
        // Return JSON string
        text = JSON.stringify(structuredOutput, null, 2);
      } else if (args?.format === "text" || !args?.format) {
        // Return pretty formatted text
        text = await runInspect({
          target,
          filter: args?.filter,
          showTypes: args?.showTypes,
          includeDocs: args?.includeDocs,
          includeExamples: args?.includeExamples,
          remote: args?.remote,
          remoteVersion: args?.remoteVersion,
          jsdoc: args?.jsdoc,
          jsdocOutput: args?.jsdocOutput,
          jsdocQuery: args?.jsdocQuery,
          kind: args?.kind,
          depth: args?.depth,
          resolveFrom: args?.resolveFrom,
          cwd: rootDir,
          analyzeSource: args?.analyzeSource,
          sourceMaxFiles: args?.sourceMaxFiles,
          sourceIncludeBody: args?.sourceIncludeBody,
          format: "text",
          listSections: args?.listSections,
          docsSections: args?.docsSections,
          search: args?.search,
          maxExports: args?.maxExports,
          maxProps: args?.maxProps,
          maxExamples: args?.maxExamples,
        });
      } else {
        // Default: summary
        text = formatInspectSummary(structuredOutput);
      }

      // MCP best practice: ensure text is always a valid string
      const validText = typeof text === "string" ? text : String(text || "");

      // MCP best practice: ensure structuredContent is always an object, never a string
      const validStructured =
        typeof structuredOutput === "object" && structuredOutput !== null
          ? structuredOutput
          : {
              schemaVersion: 1,
              package: null,
              version: null,
              description: null,
              exports: null,
              types: null,
              docs: null,
              sections: null,
              examples: null,
              resolution: null,
              meta: { target: target || null },
              warnings: [
                "Invalid output format received from runInspect",
              ],
            };

      // Final validation before returning (critical for MCP spec compliance)
      if (typeof validStructured !== "object" || validStructured === null) {
        throw new Error(
          `CRITICAL: structuredContent is not an object (type: ${typeof validStructured})`
        );
      }

      if (DEBUG) {
        console.error("[DEPLENS DEBUG] Response:", {
          textType: typeof validText,
          textLength: validText.length,
          structuredType: typeof validStructured,
          structuredKeys: Object.keys(validStructured),
        });
      }

      return {
        content: [{ type: "text", text: validText }],
        structuredContent: validStructured,
        isError: false,
      };
    }

    // Handle diff tool
    if (name === "deplens.diff" || name === "deplens_diff") {
      const packageName = args?.package;
      if (!packageName) throw new Error("Missing required field: package");

      const runDiff = await loadDiff();
      if (!runDiff) {
        throw new Error(
          "Diff functionality not available. Missing diff.mjs module.",
        );
      }

      const rootDir =
        args?.rootDir || process.env.DEPLENS_ROOT || process.cwd();
      const result = await runDiff({
        package: packageName,
        from: args?.from || "installed",
        to: args?.to || "latest",
        projectDir: rootDir,
        includeSource: args?.includeSource || false,
        includeChangelog: args?.includeChangelog !== false,
        filter: args?.filter,
        format: args?.format || "text",
        verbose: args?.verbose || false,
        colors: false, // No ANSI colors in MCP output
      });

      const diffSummary = result?.diff?.summary ?? result?.summary ?? null;
      const diffChanges = result?.changes
        ? result.changes
        : result?.diff
          ? [
              ...(result.diff.breaking || []),
              ...(result.diff.warnings || []),
              ...(result.diff.additions || []),
              ...(result.diff.info || []),
            ]
          : null;

      const textOutput =
        args?.format === "text" || !args?.format
          ? result?.output || ""
          : formatDiffSummary(diffSummary, packageName);

      const structured =
        typeof result === "object" && result
          ? {
              schemaVersion: 1,
              package: result.package || packageName,
              from: result.from || args?.from || "installed",
              to: result.to || args?.to || "latest",
              output: result.output || null,
              summary: diffSummary,
              changes: diffChanges,
            }
          : {
              schemaVersion: 1,
              package: packageName,
              from: args?.from || "installed",
              to: args?.to || "latest",
              output: result?.output || String(result),
              summary: null,
              changes: null,
            };

      return {
        content: [{ type: "text", text: textOutput }],
        structuredContent: structured,
        isError: false,
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // MCP best practice: always return structuredContent as an object
    const errorStructured = {
      schemaVersion: 1,
      error: message,
      package: null,
      version: null,
      description: null,
      exports: null,
      types: null,
      docs: null,
      sections: null,
      examples: null,
      resolution: null,
      meta: null,
      warnings: [message],
    };

    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      structuredContent: errorStructured,
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
