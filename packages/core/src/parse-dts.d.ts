export interface ParsedDtsResult {
  functions: Record<string, unknown>;
  interfaces: Record<string, string[]>;
  interfaceDetails: Record<string, unknown>;
  types: Record<string, string>;
  classes: Record<string, unknown>;
  enums: Record<string, string[]>;
  enumDetails: Record<string, Record<string, string | null>>;
  namespaces: Record<string, unknown>;
  variables: Record<string, unknown>;
  defaults: string[];
  jsdoc: Record<string, unknown>;
}

export function parseDtsFile(path: string, filters?: string[] | null): ParsedDtsResult | null;
export function parseDtsFileWithMetadata(
  path: string,
  filters?: string[] | null
): {
  result: ParsedDtsResult;
  dependencies: string[];
} | null;
export function findReExports(
  path: string,
  filters?: string[] | null
): {
  named: Map<string, { sourcePath: string; localName: string }>;
  wildcards: string[];
};
