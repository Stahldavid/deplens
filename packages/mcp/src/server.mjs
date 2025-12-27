#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
let corePromise = null;

async function loadCore() {
  if (!corePromise) {
    corePromise = import("@deplens/core").catch(async (error) => {
      try {
        const fallbackUrl = new URL("./core/inspect.mjs", import.meta.url);
        return await import(fallbackUrl.href);
      } catch (fallbackError) {
        const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        const err = new Error(`Failed to load @deplens/core. Fallback also failed: ${message}`);
        err.cause = error;
        throw err;
      }
    });
  }
  return corePromise;
}

const tools = [
  {
    name: "deplens.inspect",
    description: "Inspect exports and types for an installed npm package.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Package name or import path (e.g. react, next/server)" },
        subpath: { type: "string", description: "Optional subpath (e.g. server for next/server)" },
        filter: { type: "string", description: "Substring filter for exports" },
        kind: {
          type: "array",
          items: { type: "string", enum: ["function", "class", "object", "constant", "interface", "type"] },
          description: "Filter by export kind",
        },
        showTypes: { type: "boolean", description: "Show type signatures from .d.ts" },
        depth: { type: "number", description: "Depth for object inspection (0-5)" },
        resolveFrom: { type: "string", description: "Base directory for module resolution" },
        rootDir: { type: "string", description: "Working directory for the inspection (default: cwd)" },
        jsdoc: { type: "string", enum: ["off", "compact", "full"], description: "JSDoc mode" },
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
                { type: "array", items: { type: "string" } }
              ]
            },
            sections: {
              type: "array",
              items: { type: "string", enum: ["summary", "params", "returns", "tags"] }
            },
            tags: {
              type: "object",
              properties: {
                include: { type: "array", items: { type: "string" } },
                exclude: { type: "array", items: { type: "string" } }
              }
            },
            mode: { type: "string", enum: ["compact", "full"] },
            maxLen: { type: "number" },
            truncate: { type: "string", enum: ["none", "sentence", "word"] }
          }
        }
      },
      required: ["target"]
    }
  }
];

const server = new Server(
  { name: "deplens", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name !== "deplens.inspect") {
      throw new Error(`Unknown tool: ${name}`);
    }

    const rootDir = args?.rootDir || process.env.DEPLENS_ROOT || process.cwd();
    const target = args?.subpath ? `${args.target}/${args.subpath}` : args?.target;
    if (!target) throw new Error("Missing required field: target");

    const core = await loadCore();
    const runInspect = core.runInspect || core.default?.runInspect;
    if (!runInspect) {
      throw new Error("Failed to load runInspect from @deplens/core");
    }
    const output = await runInspect({
      target,
      filter: args?.filter,
      showTypes: args?.showTypes,
      jsdoc: args?.jsdoc,
      jsdocOutput: args?.jsdocOutput,
      jsdocQuery: args?.jsdocQuery,
      kind: args?.kind,
      depth: args?.depth,
      resolveFrom: args?.resolveFrom,
      cwd: rootDir,
    });

    return { content: [{ type: "text", text: output }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
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
