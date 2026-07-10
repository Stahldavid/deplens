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

function serializeChange(change, verbose) {
  const serialized = {
    category: change.category || 'symbol',
    type: change.type || change.kind || 'changed',
    severity: change.severity || 'warning',
    name: change.name || null,
    subpath: change.subpath || '.',
    identity: change.identity || null,
    facet: change.facet || null,
    detail: change.detail || null,
  };
  if (verbose) {
    serialized.from = change.from ?? null;
    serialized.to = change.to ?? null;
  }
  return serialized;
}

export function serializeDiffForJson(diff, options = {}) {
  const { packageName = diff?.to?.name || diff?.from?.name || null, verbose = false } = options;
  const sourceChanges = (diff?.warnings || []).filter((change) => change.category === 'source');
  const symbolChanges = diff?.symbols?.changes || [];
  const changes = [...sourceChanges, ...symbolChanges].map((change) =>
    serializeChange(change, verbose)
  );

  return {
    schemaVersion: 2,
    detailLevel: verbose ? 'verbose' : 'compact',
    package: packageName,
    from: diff?.from || null,
    to: diff?.to || null,
    summary: diff?.summary || null,
    changes,
    changeCount: changes.length,
    symbols: diff?.symbols
      ? {
          fromCount: diff.symbols.fromCount,
          toCount: diff.symbols.toCount,
          summary: diff.symbols.summary,
        }
      : null,
    sourceComparison: diff?.sourceComparison || null,
    changelog: options.changelog || null,
    meta: options.meta || null,
    warnings: options.warnings || [],
  };
}

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
    preferCdn = false,
    offline = false,
    filter,
    format = 'text', // "text" | "json"
    verbose = false,
    colors = true,
    runtime = false,
  } = options;

  if (!packageName) {
    throw new Error('Package name is required');
  }

  const isExactOfflineSpec = (spec) =>
    spec === 'installed' || /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(spec));
  if (offline && (!isExactOfflineSpec(from) || !isExactOfflineSpec(to))) {
    const message = '--offline diff requires exact versions, except --from installed';
    if (format === 'json') {
      return {
        output: formatDiffAsJson({
          package: packageName,
          error: message,
          warnings: [message],
          meta: {
            package: packageName,
            from,
            to,
            analyzedAt: new Date().toISOString(),
            offline: true,
          },
        }),
        error: message,
      };
    }
    return {
      output: `❌ Error: ${message}`,
      error: message,
    };
  }

  const output = [];
  const log = (msg) => output.push(msg);

  try {
    // Resolve and download versions
    log(`🔍 Resolving versions for ${packageName}...`);

    const versionPair = await downloadVersionPair(packageName, from, to, {
      projectDir,
      preferCdn,
      offline,
      timeout: 120000,
    });

    log(`   From: ${versionPair.from.version}${versionPair.from.cached ? ' (cached)' : ''}`);
    log(`   To: ${versionPair.to.version}${versionPair.to.cached ? ' (cached)' : ''}`);
    log('');

    // Run semantic diff
    log('📊 Analyzing differences...');
    const diff = await compareVersions(versionPair.from.packageDir, versionPair.to.packageDir, {
      filter,
      includeSource,
      runtime,
    });
    log('');

    // Parse changelog if available (local or remote)
    let changelogDiff = null;
    if (includeChangelog) {
      let changelog = null;
      let changelogSource = null;

      // Try local file first
      const changelogPath = findChangelog(versionPair.to.packageDir);
      if (changelogPath) {
        log('📜 Parsing local changelog...');
        changelog = parseChangelogFile(changelogPath);
        changelogSource = 'local';
      } else {
        // Try remote CDN fetch
        log('📦 No local changelog, trying remote...');
        try {
          const changelogText = await findChangelogRemote(
            versionPair.package,
            versionPair.to.version,
            30000
          );
          if (changelogText) {
            changelog = parseChangelogString(changelogText);
            changelogSource = 'remote (CDN)';
          }
        } catch (e) {
          // ignore, continue without changelog
        }
      }

      if (changelog) {
        log(`📜 Parsing changelog (${changelogSource})...`);
        changelogDiff = getChangesBetweenVersions(
          changelog,
          versionPair.from.version,
          versionPair.to.version
        );
      }
    }

    // Format output
    if (format === 'json') {
      const meta = {
        package: packageName,
        from: versionPair.from.version,
        to: versionPair.to.version,
        runtime,
        analyzedAt: new Date().toISOString(),
      };
      const payload = serializeDiffForJson(diff, {
        packageName,
        verbose,
        changelog: changelogDiff,
        meta,
      });
      return {
        output: formatDiffAsJson(payload),
        diff,
        ...payload,
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
    if (format === 'json') {
      return {
        output: formatDiffAsJson({
          schemaVersion: 2,
          detailLevel: 'compact',
          package: packageName,
          error: error.message,
          warnings: [error.message],
          meta: {
            package: packageName,
            from,
            to,
            analyzedAt: new Date().toISOString(),
          },
        }),
        error: error.message,
      };
    }
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
  serializeDiffForJson,
  resolveVersion,
  clearCache,
  getCacheStats,
};
