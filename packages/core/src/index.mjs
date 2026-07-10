/**
 * @deplens/core — Main entry point (barrel)
 * Re-exports public APIs
 */

export { runInspect } from './inspect.mjs';
export { runDiff } from './diff.mjs';
export { runDoctor } from './doctor.mjs';
export {
  clearCache,
  getCacheStats,
  getDefaultCacheDir,
  pinCache,
  migrateCache,
  pruneCache,
  getLatestVersion,
  getLatestVersionAsync,
  getAllVersions,
  resolveVersionAsync,
} from './version-resolver.mjs';
export { parseDtsFile } from './parse-dts.mjs';
export {
  parseChangelogFile,
  findChangelog,
  findChangelogRemote,
  parseChangelogString,
} from './changelog-parser.mjs';
export {
  ensureHistoryDir,
  getPackageHistoryDir,
  getHistoryFilePath,
  saveHistoryEntry,
  listHistory,
  getHistoryEntry,
  clearHistory,
  compareHistoryEntries,
} from './history-manager.mjs';

export { detectLanguage, getSourceFiles } from './language-detector.mjs';
export {
  analyzePythonPackage,
  analyzePythonPackageAsync,
  analyzePythonFile,
  resolvePythonPackage,
} from './analyze-python.mjs';
export { analyzeJavaPackage, analyzeJavaFile } from './analyze-java.mjs';
export {
  compareProjectSnapshots,
  createProjectSnapshot,
  formatProjectDiffText,
  loadLockfileFromGit,
  loadProjectSnapshot,
  runProjectDiff,
} from './project-diff.mjs';
export {
  createProjectBaseline,
  evaluateProjectPolicy,
  formatPolicyAsSarif,
  formatPolicyText,
  loadProjectPolicy,
  runProjectCheck,
} from './policy.mjs';
export { projectInspectResult } from './output-projector.mjs';
export { analyzeSemanticCompatibility, findPackageTypesEntry } from './semantic-compatibility.mjs';
export {
  listExportSubpaths,
  packageExportEntry,
  resolveConditionalTarget,
  resolveExportTarget,
  resolveTypesVersionTarget,
} from './export-map.mjs';
export { DepLensError, createOperationSignal, errorPayload, throwIfAborted } from './errors.mjs';
export { OUTPUT_SCHEMAS, getOutputSchema } from './schemas.mjs';
