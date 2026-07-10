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
import { errorPayload, throwIfAborted } from './errors.mjs';

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
  const allChanges = [...sourceChanges, ...symbolChanges].map((change) =>
    serializeChange(change, verbose)
  );
  const maxChanges = Math.max(
    1,
    Number(options.maxChanges) || (verbose ? allChanges.length || 1 : 100)
  );
  const parsedCursor = Number.parseInt(options.cursor || '0', 10);
  const offset = Number.isFinite(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;
  const changes = allChanges.slice(offset, offset + maxChanges);

  return {
    schemaVersion: 2,
    detailLevel: verbose ? 'verbose' : 'compact',
    package: packageName,
    from: diff?.from || null,
    to: diff?.to || null,
    summary: diff?.summary || null,
    changes,
    changeCount: allChanges.length,
    pagination: {
      total: allChanges.length,
      offset,
      returned: changes.length,
      nextCursor:
        offset + changes.length < allChanges.length ? String(offset + changes.length) : null,
    },
    symbols: diff?.symbols
      ? {
          fromCount: diff.symbols.fromCount,
          toCount: diff.symbols.toCount,
          summary: diff.symbols.summary,
        }
      : null,
    sourceComparison: diff?.sourceComparison || null,
    semanticCompatibility: diff?.semanticCompatibility
      ? verbose
        ? diff.semanticCompatibility
        : {
            checked: diff.semanticCompatibility.checked,
            compatible: diff.semanticCompatibility.compatible,
            direction: diff.semanticCompatibility.direction || null,
            diagnosticCount: diff.semanticCompatibility.diagnostics?.length || 0,
            diagnostics: (diff.semanticCompatibility.diagnostics || []).slice(0, 10),
            diagnosticsTruncated: (diff.semanticCompatibility.diagnostics?.length || 0) > 10,
          }
      : null,
    changelog: options.changelog || null,
    meta: options.meta || null,
    warnings: options.warnings || [],
  };
}

/**
 * Run a complete diff between two package versions
 */
export async function runDiff(options = {}) {
  const startedAt = performance.now();
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
    cacheDir,
    timeoutMs = 120000,
    signal,
    conditions,
    semantic = true,
    maxChanges,
    cursor,
    profile = false,
  } = options;

  if (!packageName) {
    throw new Error('Package name is required');
  }
  throwIfAborted(signal, 'diff');

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
      cacheDir,
      timeout: timeoutMs,
      signal,
    });
    const resolvedAt = performance.now();

    log(`   From: ${versionPair.from.version}${versionPair.from.cached ? ' (cached)' : ''}`);
    log(`   To: ${versionPair.to.version}${versionPair.to.cached ? ' (cached)' : ''}`);
    log('');

    // Run semantic diff
    log('📊 Analyzing differences...');
    const diff = await compareVersions(versionPair.from.packageDir, versionPair.to.packageDir, {
      filter,
      includeSource,
      runtime,
      conditions,
      semantic,
      signal,
    });
    const analyzedAt = performance.now();
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
        ...(profile
          ? {
              timings: {
                resolutionMs: Number((resolvedAt - startedAt).toFixed(2)),
                analysisMs: Number((analyzedAt - resolvedAt).toFixed(2)),
                totalMs: Number((performance.now() - startedAt).toFixed(2)),
              },
            }
          : {}),
      };
      const payload = serializeDiffForJson(diff, {
        packageName,
        verbose,
        maxChanges,
        cursor,
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
    const structuredError = errorPayload(error, { phase: 'diff', code: 'DIFF_FAILED' });
    if (format === 'json') {
      return {
        output: formatDiffAsJson({
          schemaVersion: 2,
          detailLevel: 'compact',
          package: packageName,
          ...structuredError,
          warnings: [structuredError.error],
          meta: {
            package: packageName,
            from,
            to,
            analyzedAt: new Date().toISOString(),
          },
        }),
        ...structuredError,
      };
    }
    return {
      output: `❌ Error: ${structuredError.error}`,
      ...structuredError,
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
