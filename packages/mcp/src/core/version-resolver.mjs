/**
 * version-resolver.mjs - Download and manage npm package versions for comparison
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// Use user's home directory for more reliable caching
const CACHE_DIR = path.join(os.homedir(), ".deplens-cache", "versions");

/**
 * Ensure cache directory exists
 */
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  return CACHE_DIR;
}

/**
 * Get cache path for a specific package version
 */
function getCachePath(packageName, version) {
  const safeName = packageName.replace(/[/@]/g, "_");
  return path.join(ensureCacheDir(), `${safeName}@${version}`);
}

/**
 * Check if version is already cached
 */
function isCached(packageName, version) {
  const cachePath = getCachePath(packageName, version);
  return (
    fs.existsSync(cachePath) &&
    fs.existsSync(path.join(cachePath, "node_modules"))
  );
}

/**
 * Get latest version from npm registry
 */
export function getLatestVersion(packageName) {
  try {
    const result = execSync(`npm view ${packageName} version`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch (e) {
    throw new Error(
      `Failed to get latest version for ${packageName}: ${e.message}`,
    );
  }
}

/**
 * Get all available versions from npm registry
 */
export function getAllVersions(packageName) {
  try {
    const result = execSync(`npm view ${packageName} versions --json`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(result);
  } catch (e) {
    throw new Error(`Failed to get versions for ${packageName}: ${e.message}`);
  }
}

/**
 * Get installed version in a project
 */
export function getInstalledVersion(packageName, projectDir) {
  try {
    const pkgPath = path.join(
      projectDir,
      "node_modules",
      packageName,
      "package.json",
    );
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      return pkg.version;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Download a specific package version to cache
 */
export function downloadVersion(packageName, version, options = {}) {
  const { force = false, timeout = 60000 } = options;

  const cachePath = getCachePath(packageName, version);

  // Return cached if available
  if (!force && isCached(packageName, version)) {
    return {
      path: cachePath,
      packageDir: path.join(cachePath, "node_modules", packageName),
      cached: true,
    };
  }

  // Create fresh directory
  if (fs.existsSync(cachePath)) {
    fs.rmSync(cachePath, { recursive: true, force: true });
  }
  fs.mkdirSync(cachePath, { recursive: true });

  // Install package to cache directory
  try {
    execSync(
      `npm install ${packageName}@${version} --prefix "${cachePath}" --ignore-scripts --no-audit --no-fund`,
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout,
        cwd: cachePath,
      },
    );
  } catch (e) {
    throw new Error(
      `Failed to download ${packageName}@${version}: ${e.message}`,
    );
  }

  const packageDir = path.join(cachePath, "node_modules", packageName);

  if (!fs.existsSync(packageDir)) {
    throw new Error(`Package directory not found after install: ${packageDir}`);
  }

  return {
    path: cachePath,
    packageDir,
    cached: false,
  };
}

/**
 * Resolve version string to actual version
 * Supports: "latest", "installed", "^1.0.0", "1.2.3", etc.
 */
export function resolveVersion(
  packageName,
  versionSpec,
  projectDir = process.cwd(),
) {
  if (versionSpec === "latest") {
    return getLatestVersion(packageName);
  }

  if (versionSpec === "installed") {
    const installed = getInstalledVersion(packageName, projectDir);
    if (!installed) {
      throw new Error(`${packageName} is not installed in ${projectDir}`);
    }
    return installed;
  }

  // If it's a range, resolve to max satisfying
  if (
    versionSpec.startsWith("^") ||
    versionSpec.startsWith("~") ||
    versionSpec.includes("x")
  ) {
    try {
      const result = execSync(
        `npm view ${packageName}@"${versionSpec}" version`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );
      // npm may return multiple versions, take the last (highest)
      const versions = result.trim().split("\n");
      return versions[versions.length - 1].trim();
    } catch (e) {
      throw new Error(
        `Failed to resolve version ${versionSpec} for ${packageName}`,
      );
    }
  }

  // Assume it's an exact version
  return versionSpec;
}

/**
 * Download two versions for comparison
 */
export async function downloadVersionPair(
  packageName,
  fromSpec,
  toSpec,
  options = {},
) {
  const { projectDir = process.cwd() } = options;

  // Resolve version specs to actual versions
  const fromVersion = resolveVersion(packageName, fromSpec, projectDir);
  const toVersion = resolveVersion(packageName, toSpec, projectDir);

  if (fromVersion === toVersion) {
    throw new Error(
      `Both versions resolve to the same version: ${fromVersion}`,
    );
  }

  // Download both versions (can be parallelized)
  const [fromResult, toResult] = await Promise.all([
    Promise.resolve(downloadVersion(packageName, fromVersion, options)),
    Promise.resolve(downloadVersion(packageName, toVersion, options)),
  ]);

  return {
    package: packageName,
    from: {
      version: fromVersion,
      ...fromResult,
    },
    to: {
      version: toVersion,
      ...toResult,
    },
  };
}

/**
 * Clear version cache
 */
export function clearCache(packageName = null) {
  if (packageName) {
    const safeName = packageName.replace(/[/@]/g, "_");
    const entries = fs.readdirSync(CACHE_DIR);
    for (const entry of entries) {
      if (entry.startsWith(safeName + "@")) {
        fs.rmSync(path.join(CACHE_DIR, entry), {
          recursive: true,
          force: true,
        });
      }
    }
  } else {
    if (fs.existsSync(CACHE_DIR)) {
      fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    }
  }
}

/**
 * Get cache stats
 */
export function getCacheStats() {
  if (!fs.existsSync(CACHE_DIR)) {
    return { entries: 0, size: 0, packages: [] };
  }

  const entries = fs.readdirSync(CACHE_DIR);
  let totalSize = 0;
  const packages = [];

  for (const entry of entries) {
    const entryPath = path.join(CACHE_DIR, entry);
    const stats = fs.statSync(entryPath);
    if (stats.isDirectory()) {
      const size = getDirSize(entryPath);
      totalSize += size;
      packages.push({ name: entry, size });
    }
  }

  return {
    entries: packages.length,
    size: totalSize,
    sizeFormatted: formatBytes(totalSize),
    packages,
  };
}

function getDirSize(dirPath) {
  let size = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(fullPath);
    } else {
      size += fs.statSync(fullPath).size;
    }
  }
  return size;
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default {
  getLatestVersion,
  getAllVersions,
  getInstalledVersion,
  downloadVersion,
  resolveVersion,
  downloadVersionPair,
  clearCache,
  getCacheStats,
};
