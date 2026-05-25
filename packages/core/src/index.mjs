/**
 * @deplens/core — Main entry point (barrel)
 * Re-exports public APIs
 */

export { runInspect } from './inspect.mjs';
export { runDiff } from './diff.mjs';
export {
  clearCache,
  getCacheStats,
  getLatestVersion,
  getAllVersions,
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
export { analyzePythonPackage, analyzePythonFile, resolvePythonPackage } from './analyze-python.mjs';
export { analyzeJavaPackage, analyzeJavaFile } from './analyze-java.mjs';
