/**
 * diff.mjs - Main entry point for package version diff
 * Combines version resolution, diff analysis, and changelog parsing
 */

import {
  downloadVersionPair,
  resolveVersion,
  clearCache,
  getCacheStats,
} from './version-resolver.mjs';
import { compareVersions, formatDiffAsText, formatDiffAsJson } from './diff-analyzer.mjs';
import {
  findChangelog,
  findChangelogRemote,
  parseChangelogFile,
  parseChangelogString,
  getChangesBetweenVersions,
  formatChangelogDiff,
} from './changelog-parser.mjs';

/**
 * Run a complete diff between two package versions
 */
export async function runDiff(options = {}) {
  const {
    package: packageName,
    from = 'installed',
    to = 'latest',
    projectDir = process.cwd(),
    includeSource = false,
    includeChangelog = true,
    preferCdn = true,
    filter,
    format = 'text', // "text" | "json"
    verbose = false,
    colors = true,
  } = options;

  if (!packageName) {
    throw new Error('Package name is required');
  }

  const output = [];
  const log = (msg) => output.push(msg);

  try {
    // Resolve and download versions
    log(`🔍 Resolving versions for ${packageName}...`);

    const versionPair = await downloadVersionPair(packageName, from, to, {
      projectDir,
      preferCdn,
      timeout: 30000,
    });

    log(`   From: ${versionPair.from.version}${versionPair.from.cached ? ' (cached)' : ''}`);
    log(`   To: ${versionPair.to.version}${versionPair.to.cached ? ' (cached)' : ''}`);
    log('');

    // Run semantic diff
    log('📊 Analyzing differences...');
    const diff = await compareVersions(versionPair.from.packageDir, versionPair.to.packageDir, {
      filter,
      includeSource,
    });
    log('');

    // Parse changelog if available (local or remote)
    let changelogDiff = null;
    if (includeChangelog) {
      let changelogText = null;
      let changelogSource = null;

      // Try local file first
      const changelogPath = findChangelog(versionPair.to.packageDir);
      if (changelogPath) {
        log('📜 Parsing local changelog...');
        changelogText = parseChangelogFile(changelogPath);
        changelogSource = 'local';
      } else {
        // Try remote CDN fetch
        log('📦 No local changelog, trying remote...');
        try {
          changelogText = await findChangelogRemote(
            versionPair.package,
            versionPair.to.version,
            30000
          );
          if (changelogText) {
            changelogSource = 'remote (CDN)';
          }
        } catch (e) {
          // ignore, continue without changelog
        }
      }

      if (changelogText) {
        log(`📜 Parsing changelog (${changelogSource})...`);
        const changelog = parseChangelogString(changelogText);
        changelogDiff = getChangesBetweenVersions(
          changelog,
          versionPair.from.version,
          versionPair.to.version
        );
      }
    }

    // Format output
    if (format === 'json') {
      return {
        output: formatDiffAsJson({
          ...diff,
          changelog: changelogDiff,
          meta: {
            package: packageName,
            from: versionPair.from.version,
            to: versionPair.to.version,
            analyzedAt: new Date().toISOString(),
          },
        }),
        diff,
        changelog: changelogDiff,
      };
    }

    // Text format
    log(formatDiffAsText(diff, { colors, verbose }));

    if (changelogDiff) {
      log('');
      log(formatChangelogDiff(changelogDiff));
    }

    return {
      output: output.join('\n'),
      diff,
      changelog: changelogDiff,
    };
  } catch (error) {
    return {
      output: `❌ Error: ${error.message}`,
      error: error.message,
    };
  }
}

/**
 * Get available versions for a package
 */
export { resolveVersion, clearCache, getCacheStats };

export default {
  runDiff,
  resolveVersion,
  clearCache,
  getCacheStats,
};
