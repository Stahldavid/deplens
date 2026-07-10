export type OutputFormat = 'text' | 'json' | 'object';

export interface InspectOptions {
  target: string;
  filter?: string;
  showTypes?: boolean;
  includeDocs?: boolean;
  includeExamples?: boolean;
  remote?: boolean;
  remoteVersion?: string;
  runtime?: boolean;
  offline?: boolean;
  resolveFrom?: string;
  cwd?: string;
  format?: OutputFormat;
  kind?: string[];
  analyzeSource?: boolean;
  sourceMaxFiles?: number;
  sourceIncludeBody?: boolean;
  language?: 'javascript' | 'typescript' | 'python' | 'java' | 'rust' | 'go';
  saveHistory?: boolean;
  historyDir?: string;
  [option: string]: unknown;
}

export interface InspectResult {
  schemaVersion: number;
  package: string | null;
  version: string | null;
  description: string | null;
  exports: Record<string, unknown> | null;
  staticExports: { total: number; names: string[] } | null;
  types: Record<string, unknown> | null;
  symbols?: Array<Record<string, unknown>> | null;
  resolution: Record<string, unknown> | null;
  warnings: string[];
  error?: string;
  [field: string]: unknown;
}

export function runInspect(options: InspectOptions & { format: 'object' }): Promise<InspectResult>;
export function runInspect(options: InspectOptions): Promise<string>;

export interface DiffOptions {
  package: string;
  from?: string;
  to?: string;
  projectDir?: string;
  filter?: string;
  includeSource?: boolean;
  includeChangelog?: boolean;
  preferCdn?: boolean;
  offline?: boolean;
  runtime?: boolean;
  format?: 'text' | 'json';
  verbose?: boolean;
  colors?: boolean;
}

export function runDiff(options: DiffOptions): Promise<Record<string, unknown>>;
export function runDoctor(options: InspectOptions): Promise<string | Record<string, unknown>>;
export function clearCache(packageName?: string | null): void;
export function getCacheStats(options?: { exact?: boolean }): Record<string, unknown>;
export function pinCache(
  packageName: string,
  version: string,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>>;
export function getLatestVersion(packageName: string): string;
export function getLatestVersionAsync(packageName: string): Promise<string>;
export function getAllVersions(packageName: string): string[];
export function resolveVersionAsync(
  packageName: string,
  version: string,
  projectDir?: string
): Promise<string>;
export function parseDtsFile(
  path: string,
  filters?: string[] | null
): Record<string, unknown> | null;
export function detectLanguage(packageDir: string): string | null;
export function getSourceFiles(packageDir: string, language: string, maxFiles?: number): string[];
export function analyzePythonPackage(
  packageDir: string,
  options?: Record<string, unknown>
): Record<string, unknown>;
export function analyzePythonPackageAsync(
  packageDir: string,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>>;
export function analyzePythonFile(
  content: string,
  options?: Record<string, unknown>
): Record<string, unknown>;
export function resolvePythonPackage(
  target: string,
  options?: Record<string, unknown>
): Record<string, unknown>;
export function analyzeJavaPackage(
  packageDir: string,
  options?: Record<string, unknown>
): Record<string, unknown>;
export function analyzeJavaFile(
  content: string,
  options?: Record<string, unknown>
): Record<string, unknown>;

export function ensureHistoryDir(directory?: string): string;
export function getPackageHistoryDir(packageName: string, baseDir?: string): string;
export function getHistoryFilePath(packageName: string, version: string, baseDir?: string): string;
export function saveHistoryEntry(entry: Record<string, unknown>, baseDir?: string): string;
export function listHistory(
  filterPackage?: string | null,
  baseDir?: string
): Array<Record<string, unknown>>;
export function getHistoryEntry(
  packageName: string,
  version: string,
  baseDir?: string
): Record<string, unknown> | null;
export function clearHistory(
  packageName?: string | null,
  baseDir?: string
): Record<string, unknown>;
export function compareHistoryEntries(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, unknown>;
