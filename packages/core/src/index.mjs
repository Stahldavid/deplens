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
