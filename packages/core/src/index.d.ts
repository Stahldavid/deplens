export type OutputFormat = 'text' | 'json' | 'object';

export interface OperationOptions {
  cacheDir?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  conditions?: string[];
  profile?: boolean;
}

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
  detail?: 'compact' | 'full';
  select?: string[];
  cursor?: string;
  profile?: boolean;
  maxSymbols?: number;
  cacheDir?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  conditions?: string[];
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
  cacheDir?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  conditions?: string[];
  semantic?: boolean;
  maxChanges?: number;
  cursor?: string;
  profile?: boolean;
}

export function runDiff(options: DiffOptions): Promise<Record<string, unknown>>;
export function runDoctor(options: InspectOptions): Promise<string | Record<string, unknown>>;
export function clearCache(packageName?: string | null, options?: { cacheDir?: string }): void;
export function getCacheStats(options?: {
  exact?: boolean;
  cacheDir?: string;
}): Record<string, unknown>;
export function getDefaultCacheDir(): string;

export interface CacheMaintenanceOptions {
  cacheDir?: string;
  exact?: boolean;
  dryRun?: boolean;
  removeAliases?: boolean;
  removeInvalid?: boolean;
  maxAgeDays?: number;
}

export interface CacheMaintenanceEntry {
  name: string;
  status?: string;
  target?: string;
  reason?: 'invalid' | 'alias' | 'stale';
  size?: number;
  sizeFormatted?: string;
}

export interface CacheMigrationResult {
  cacheDir: string;
  scanned: number;
  migrated: number;
  aliasesMoved: number;
  aliasesRemoved: number;
  invalid: number;
  skippedLocked: number;
  dryRun: boolean;
  entries: CacheMaintenanceEntry[];
}

export interface CachePruneResult {
  cacheDir: string;
  scanned: number;
  candidates: number;
  removed: number;
  reclaimedBytes: number;
  reclaimedFormatted: string;
  maxAgeDays: number;
  dryRun: boolean;
  skippedLocked: number;
  entries: CacheMaintenanceEntry[];
}

export function pinCache(
  packageName: string,
  version: string,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>>;
export function migrateCache(options?: CacheMaintenanceOptions): CacheMigrationResult;
export function pruneCache(options?: CacheMaintenanceOptions): CachePruneResult;
export function getLatestVersion(packageName: string): string;
export function getLatestVersionAsync(
  packageName: string,
  options?: OperationOptions
): Promise<string>;
export function getAllVersions(packageName: string): string[];
export function resolveVersionAsync(
  packageName: string,
  version: string,
  projectDir?: string,
  options?: OperationOptions
): Promise<string>;
export function parseDtsFile(
  path: string,
  filters?: string[] | null
): Record<string, unknown> | null;

export interface ChangelogEntry {
  text: string;
  category: string;
  raw: string;
  version?: string;
}

export interface ChangelogVersion {
  version: string;
  date: string | null;
  sections: Record<string, ChangelogEntry[]>;
  raw: string[];
}

export interface ParsedChangelog {
  file?: string;
  error?: string;
  versions: Record<string, ChangelogVersion>;
}

export function findChangelog(packageDirectory: string): string | null;
export function findChangelogRemote(
  packageName: string,
  version: string,
  timeoutMs?: number
): Promise<string | null>;
export function parseChangelogString(text: string | ParsedChangelog): ParsedChangelog;
export function parseChangelogFile(filePath: string): ParsedChangelog;

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

export interface ProjectPackageSnapshot {
  id: string;
  name: string;
  version: string;
  direct: boolean;
  dependencyType: string | null;
  workspaces: string[];
  resolved?: string | null;
  integrity?: string | null;
}

export interface ProjectSnapshot {
  schemaVersion: 1;
  kind: 'deplens-project-snapshot';
  project: {
    name: string | null;
    version: string | null;
    lockfileVersion: number | null;
    source: string | null;
  };
  packages: Record<string, ProjectPackageSnapshot>;
  instances: ProjectPackageSnapshot[];
}

export interface ProjectChange {
  package: string;
  fromVersion: string | null;
  toVersion: string | null;
  changeType: 'added' | 'removed' | 'upgraded' | 'downgraded' | 'changed';
  direct: boolean;
  dependencyType: string | null;
  workspaces: string[];
  api?: Record<string, unknown>;
  error?: string;
  errorInfo?: Record<string, unknown>;
}

export interface ProjectDiffReport {
  schemaVersion: 1;
  kind: 'deplens-project-diff';
  from: ProjectSnapshot['project'] | null;
  to: ProjectSnapshot['project'] | null;
  summary: Record<string, number>;
  changes: ProjectChange[];
  warnings: string[];
}

export interface ProjectDiffOptions extends OperationOptions {
  from: ProjectSnapshot | Record<string, unknown> | string;
  to: ProjectSnapshot | Record<string, unknown> | string;
  fromSource?: string;
  toSource?: string;
  projectDir?: string;
  concurrency?: number;
  includeTransitive?: boolean;
  includeSource?: boolean;
  preferCdn?: boolean;
  offline?: boolean;
  runtime?: boolean;
  semantic?: boolean;
  analyze?: boolean;
  onProgress?: (progress: { completed: number; total: number; package: string }) => void;
  diffRunner?: (options: DiffOptions) => Promise<Record<string, unknown>>;
}

export function createProjectSnapshot(
  lockfile: Record<string, unknown> | string,
  options?: { name?: string; source?: string }
): ProjectSnapshot;
export function compareProjectSnapshots(
  from: ProjectSnapshot,
  to: ProjectSnapshot
): ProjectDiffReport;
export function runProjectDiff(options: ProjectDiffOptions): Promise<ProjectDiffReport>;
export function loadLockfileFromGit(
  ref: string,
  options?: { projectDir?: string; lockfile?: string; timeoutMs?: number }
): Promise<Record<string, unknown>>;
export function loadProjectSnapshot(
  source?: string | ProjectSnapshot | Record<string, unknown>,
  options?: { projectDir?: string; lockfile?: string; timeoutMs?: number }
): Promise<ProjectSnapshot>;
export function formatProjectDiffText(report: ProjectDiffReport): string;

export interface ProjectBaseline {
  schemaVersion: 1;
  kind: 'deplens-baseline';
  createdAt: string;
  snapshot: ProjectSnapshot;
}

export interface ProjectPolicy {
  failOn?: 'breaking' | 'warning' | 'change' | 'none';
  packages?: Record<string, { ignore?: boolean; allow?: string[] }>;
}

export interface PolicyResult {
  schemaVersion: 1;
  kind: 'deplens-policy-result';
  passed: boolean;
  failOn: string;
  summary: { checked: number; violations: number };
  violations: Array<Record<string, unknown>>;
  report?: ProjectDiffReport;
  policy?: ProjectPolicy;
}

export function createProjectBaseline(
  snapshot: ProjectSnapshot,
  options?: { createdAt?: string }
): ProjectBaseline;
export function evaluateProjectPolicy(
  report: ProjectDiffReport,
  policy?: ProjectPolicy
): PolicyResult;
export function runProjectCheck(
  options: Omit<ProjectDiffOptions, 'from' | 'to'> & {
    baseline: ProjectBaseline | ProjectSnapshot | string;
    current: ProjectSnapshot | Record<string, unknown> | string;
    policy?: ProjectPolicy;
    config?: string;
  }
): Promise<PolicyResult & { report: ProjectDiffReport; policy: ProjectPolicy }>;
export function formatPolicyAsSarif(result: PolicyResult): Record<string, unknown>;
export function formatPolicyText(result: PolicyResult): string;
export function loadProjectPolicy(
  configPath?: string | null,
  options?: { projectDir?: string }
): ProjectPolicy;

export function projectInspectResult(
  payload: Record<string, unknown>,
  options?: {
    detail?: 'compact' | 'full';
    select?: string[];
    maxSymbols?: number;
    cursor?: string;
  }
): Record<string, unknown>;

export interface SemanticCompatibilityResult {
  checked: boolean;
  compatible: boolean | null;
  reason?: string;
  direction?: 'after-assignable-to-before';
  fromEntry?: string;
  toEntry?: string;
  diagnostics: Array<Record<string, unknown>>;
}

export function findPackageTypesEntry(
  packageDir: string,
  options?: { subpath?: string; conditions?: string[] }
): string | null;
export function analyzeSemanticCompatibility(
  fromDir: string,
  toDir: string,
  options?: { subpath?: string; conditions?: string[] }
): SemanticCompatibilityResult;

export function packageExportEntry(
  pkg: Record<string, unknown>,
  subpath?: string
): { found: boolean; entry: unknown; subpath: string };
export function resolveConditionalTarget(
  entry: unknown,
  conditions: string[],
  matched?: string[]
): { path: string; conditions: string[] } | null;
export function resolveExportTarget(
  pkg: Record<string, unknown>,
  options?: { subpath?: string; conditions?: string[] }
): { path: string; conditions: string[]; subpath: string } | null;
export function resolveTypesVersionTarget(
  pkg: Record<string, unknown>,
  subpath?: string,
  typescriptVersion?: string | null
): string | null;
export function listExportSubpaths(pkg: Record<string, unknown>): string[];

export class DepLensError extends Error {
  code: string;
  phase: string;
  retryable: boolean;
  details: Record<string, unknown> | null;
  constructor(
    message: string,
    options?: {
      code?: string;
      phase?: string;
      retryable?: boolean;
      details?: Record<string, unknown>;
      cause?: Error;
    }
  );
}
export function errorPayload(
  error: unknown,
  defaults?: Record<string, unknown>
): Record<string, unknown>;
export function throwIfAborted(signal?: AbortSignal, phase?: string): void;
export function createOperationSignal(
  signal?: AbortSignal,
  timeoutMs?: number,
  phase?: string
): { signal?: AbortSignal; dispose(): void };

export const OUTPUT_SCHEMAS: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
export function getOutputSchema(kind: string, version: number): Record<string, unknown> | null;
