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
  pinCache,
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
