/**
 * diff.mjs - Main entry point for package version diff
 * Combines version resolution, diff analysis, and changelog parsing
 */

import {
  downloadVersionPair,
  resolveVersion,
  clearCache,
  getCacheStats,
} from "./version-resolver.mjs";
import {
  compareVersions,
  formatDiffAsText,
  formatDiffAsJson,
} from "./diff-analyzer.mjs";
import {
  findChangelog,
  parseChangelogFile,
  getChangesBetweenVersions,
  formatChangelogDiff,
} from "./changelog-parser.mjs";

/**
 * Run a complete diff between two package versions
 */
export async function runDiff(options = {}) {
  const {
    package: packageName,
    from = "installed",
    to = "latest",
    projectDir = process.cwd(),
    includeSource = false,
    includeChangelog = true,
    filter,
    format = "text", // "text" | "json"
    verbose = false,
    colors = true,
  } = options;

  if (!packageName) {
    throw new Error("Package name is required");
  }

  const output = [];
  const log = (msg) => output.push(msg);

  try {
    // Resolve and download versions
    log(`🔍 Resolving versions for ${packageName}...`);

    const versionPair = await downloadVersionPair(packageName, from, to, {
      projectDir,
    });

    log(
      `   From: ${versionPair.from.version}${versionPair.from.cached ? " (cached)" : ""}`,
    );
    log(
      `   To: ${versionPair.to.version}${versionPair.to.cached ? " (cached)" : ""}`,
    );
    log("");

    // Run semantic diff
    log(`📊 Analyzing differences...`);
    const diff = await compareVersions(
      versionPair.from.packageDir,
      versionPair.to.packageDir,
      { filter, includeSource },
    );
    log("");

    // Parse changelog if available
    let changelogDiff = null;
    if (includeChangelog) {
      const changelogPath = findChangelog(versionPair.to.packageDir);
      if (changelogPath) {
        log(`📜 Parsing changelog...`);
        const changelog = parseChangelogFile(changelogPath);
        changelogDiff = getChangesBetweenVersions(
          changelog,
          versionPair.from.version,
          versionPair.to.version,
        );
      }
    }

    // Format output
    if (format === "json") {
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

    if (format === "object") {
      return {
        output: null,
        diff,
        changelog: changelogDiff,
      };
    }

    // Text format
    log(formatDiffAsText(diff, { colors, verbose }));

    if (changelogDiff) {
      log("");
      log(formatChangelogDiff(changelogDiff));
    }

    return {
      output: output.join("\n"),
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
