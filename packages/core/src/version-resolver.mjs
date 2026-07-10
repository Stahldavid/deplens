/**
 * version-resolver.mjs - Download and manage npm package versions for comparison
 */

import { execFile, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const activeDownloads = new Map();

class UnsafePackagePathError extends Error {}

// Use user's home directory for more reliable caching
const CACHE_DIR = path.join(os.homedir(), '.deplens-cache', 'versions');

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
  const safeName = packageName.replace(/[/@]/g, '_');
  return path.join(ensureCacheDir(), `${safeName}@${version}`);
}

/**
 * Check if version is already cached
 */
function isCached(packageName, version) {
  const cachePath = getCachePath(packageName, version);
  const packageJsonPath = path.join(cachePath, 'node_modules', packageName, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return false;
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.name === packageName && packageJson.version === version;
  } catch {
    return false;
  }
}

function isNpmInstallCache(cachePath) {
  return (
    fs.existsSync(path.join(cachePath, 'package-lock.json')) ||
    fs.existsSync(path.join(cachePath, 'node_modules', '.package-lock.json'))
  );
}

function cacheMetadataPath(cachePath) {
  return path.join(cachePath, '.deplens-cache.json');
}

function hashDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return null;
  const hash = crypto.createHash('sha256');
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  };
  visit(dirPath);
  files.sort();
  for (const file of files) {
    const rel = path.relative(dirPath, file).replace(/\\/g, '/');
    hash.update(rel);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return `sha256-${hash.digest('hex')}`;
}

function writeCacheMetadata(cachePath, packageDir, packageName, version, source, options = {}) {
  const { exact = false } = options;
  const size = exact ? getDirSize(cachePath) : null;
  const metadata = {
    schemaVersion: 1,
    package: packageName,
    version,
    source,
    cachedAt: new Date().toISOString(),
    size,
    sizeFormatted: Number.isFinite(size) ? formatBytes(size) : null,
    integrity: exact ? hashDirectory(packageDir) : null,
  };
  fs.writeFileSync(cacheMetadataPath(cachePath), JSON.stringify(metadata, null, 2));
  return metadata;
}

function readCacheMetadata(cachePath) {
  try {
    return JSON.parse(fs.readFileSync(cacheMetadataPath(cachePath), 'utf-8'));
  } catch {
    return null;
  }
}

function assertValidPackageName(packageName) {
  if (typeof packageName !== 'string' || packageName.length === 0) {
    throw new Error('Package name is required');
  }
  const validName = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
  if (!validName.test(packageName)) {
    throw new Error(`Invalid npm package name: ${packageName}`);
  }
}

function assertSafeVersionSpec(versionSpec, label = 'version') {
  if (typeof versionSpec !== 'string' || versionSpec.length === 0) {
    throw new Error(`${label} is required`);
  }
  const safeVersion = /^[A-Za-z0-9._~+^*xX-]+$/;
  if (!safeVersion.test(versionSpec)) {
    throw new Error(`Invalid npm ${label}: ${versionSpec}`);
  }
}

function runNpm(args, options = {}) {
  const candidates = [
    process.env.npm_execpath,
    path.resolve(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(
      path.dirname(process.execPath),
      '..',
      'lib',
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js'
    ),
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => fs.existsSync(candidate));
  if (npmCli) {
    return execFileSync(process.execPath, [npmCli, ...args], options);
  }
  return execFileSync('npm', args, options);
}

async function runNpmAsync(args, options = {}) {
  const candidates = [
    process.env.npm_execpath,
    path.resolve(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(
      path.dirname(process.execPath),
      '..',
      'lib',
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js'
    ),
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => fs.existsSync(candidate));
  const command = npmCli ? process.execPath : 'npm';
  const commandArgs = npmCli ? [npmCli, ...args] : args;
  return execFileAsync(command, commandArgs, options);
}

/**
 * Get latest version from npm registry
 */
export function getLatestVersion(packageName) {
  assertValidPackageName(packageName);
  try {
    const result = runNpm(['view', packageName, 'version'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch (e) {
    throw new Error(`Failed to get latest version for ${packageName}: ${summarizeProcessError(e)}`);
  }
}

/**
 * Get all available versions from npm registry
 */
export function getAllVersions(packageName) {
  assertValidPackageName(packageName);
  try {
    const result = runNpm(['view', packageName, 'versions', '--json'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(result);
  } catch (e) {
    throw new Error(`Failed to get versions for ${packageName}: ${summarizeProcessError(e)}`);
  }
}

/**
 * Get installed version in a project
 */
export function getInstalledVersion(packageName, projectDir) {
  assertValidPackageName(packageName);
  try {
    const pkgPath = path.join(projectDir, 'node_modules', packageName, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
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
function normalizePackageForUrl(packageName) {
  // unpkg/jsdelivr preserve scope with @ and /
  return packageName;
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLatestVersionAsync(packageName) {
  assertValidPackageName(packageName);
  try {
    const { stdout } = await runNpmAsync(['view', packageName, 'version'], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    throw new Error(
      `Failed to get latest version for ${packageName}: ${summarizeProcessError(error)}`
    );
  }
}

function resolveConditionalExport(entry, preferred = ['types', 'import', 'require', 'default']) {
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const resolved = resolveConditionalExport(item, preferred);
      if (resolved) return resolved;
    }
    return null;
  }
  if (typeof entry !== 'object') return null;
  for (const condition of preferred) {
    if (condition in entry) {
      const resolved = resolveConditionalExport(entry[condition], preferred);
      if (resolved) return resolved;
    }
  }
  for (const value of Object.values(entry)) {
    const resolved = resolveConditionalExport(value, preferred);
    if (resolved) return resolved;
  }
  return null;
}

function rootExport(pkg) {
  if (!pkg.exports) return null;
  if (typeof pkg.exports === 'string') return pkg.exports;
  if (typeof pkg.exports === 'object') return pkg.exports['.'] || pkg.exports;
  return null;
}

export function safePackageRelativePath(packageDir, candidate) {
  if (typeof candidate !== 'string' || !candidate) return null;
  const normalized = candidate.replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    !normalized ||
    normalized.includes('\0') ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(candidate) ||
    /^[A-Za-z]:/.test(normalized) ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(normalized)
  ) {
    return null;
  }
  const destination = path.resolve(packageDir, normalized);
  const relative = path.relative(path.resolve(packageDir), destination);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return { normalized, destination };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireCacheLock(cachePath, timeoutMs) {
  const lockPath = `${cachePath}.lock`;
  const startedAt = Date.now();
  while (true) {
    try {
      const descriptor = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      return () => {
        try {
          fs.closeSync(descriptor);
        } catch {}
        try {
          fs.unlinkSync(lockPath);
        } catch {}
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > timeoutMs * 2) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {}
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for cache lock: ${cachePath}`);
      }
      await delay(100);
    }
  }
}

function commitStagedCache(stagingPath, cachePath) {
  if (fs.existsSync(cachePath)) fs.rmSync(cachePath, { recursive: true, force: true });
  fs.renameSync(stagingPath, cachePath);
}

function summarizeProcessError(error) {
  const raw = String(error?.stderr || error?.stdout || error?.message || error);
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.toLowerCase().includes('complete log of this run') &&
        !line.toLowerCase().startsWith('command failed:')
    )
    .slice(0, 6)
    .join(' ');
}

async function tryFetchPackageFromCdn(packageName, version, cachePath, timeoutMs) {
  // Strategy:
  // 1) Read package.json from CDN
  // 2) Determine types entry (types/typings) or fallback index.d.ts
  // 3) Fetch .d.ts + minimal entrypoint (main/module/exports) best-effort

  const pkgForUrl = normalizePackageForUrl(packageName);
  const baseUrls = [
    `https://unpkg.com/${pkgForUrl}@${version}`,
    `https://cdn.jsdelivr.net/npm/${pkgForUrl}@${version}`,
  ];

  for (const base of baseUrls) {
    try {
      const pkgJsonText = await fetchText(`${base}/package.json`, timeoutMs);
      const pkg = JSON.parse(pkgJsonText);

      const packageDir = path.join(cachePath, 'node_modules', packageName);
      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(path.join(packageDir, 'package.json'), pkgJsonText, 'utf-8');

      const exportRoot = rootExport(pkg);
      const typesFile =
        pkg.types ||
        pkg.typings ||
        resolveConditionalExport(exportRoot, ['types', 'typings', 'default']) ||
        'index.d.ts';
      const safeTypesFile = safePackageRelativePath(packageDir, typesFile);
      if (!safeTypesFile) {
        throw new UnsafePackagePathError(`Unsafe types path in package metadata: ${typesFile}`);
      }
      const dtsUrl = `${base}/${safeTypesFile.normalized}`;

      try {
        const dtsText = await fetchText(dtsUrl, timeoutMs);
        const dtsPath = safeTypesFile.destination;
        fs.mkdirSync(path.dirname(dtsPath), { recursive: true });
        fs.writeFileSync(dtsPath, dtsText, 'utf-8');
      } catch {
        // If types file missing, still allow inspecting package.json / exports only
      }

      // Best-effort: fetch entrypoint JS if it exists
      const entryCandidates = [
        resolveConditionalExport(exportRoot, ['import', 'require', 'node', 'default']),
        pkg.module,
        pkg.main,
        typeof pkg.exports === 'string' ? pkg.exports : null,
      ].filter(Boolean);

      for (const entry of entryCandidates) {
        try {
          const safeEntry = safePackageRelativePath(packageDir, entry);
          if (!safeEntry) continue;
          const entryText = await fetchText(`${base}/${safeEntry.normalized}`, timeoutMs);
          const entryPath = safeEntry.destination;
          fs.mkdirSync(path.dirname(entryPath), { recursive: true });
          fs.writeFileSync(entryPath, entryText, 'utf-8');
          break;
        } catch {
          // ignore
        }
      }

      // Minimal node_modules structure to satisfy resolution
      fs.mkdirSync(path.join(cachePath, 'node_modules'), { recursive: true });

      return {
        path: cachePath,
        packageDir,
        cached: false,
        fetched: true,
      };
    } catch (error) {
      if (error instanceof UnsafePackagePathError) throw error;
      // try next base
    }
  }

  return null;
}

async function downloadVersionUnlocked(packageName, version, options = {}) {
  assertValidPackageName(packageName);
  assertSafeVersionSpec(version);
  const { force = false, timeout = 60000, preferCdn = false, offline = false } = options;

  const cachePath = getCachePath(packageName, version);

  // Return cached if available
  if (!force && isCached(packageName, version)) {
    if (offline || preferCdn || isNpmInstallCache(cachePath)) {
      const packageDir = path.join(cachePath, 'node_modules', packageName);
      const metadata =
        readCacheMetadata(cachePath) ||
        writeCacheMetadata(cachePath, packageDir, packageName, version, 'existing-cache');
      return {
        path: cachePath,
        packageDir,
        cached: true,
        metadata,
      };
    }
  }

  if (offline) {
    throw new Error(`${packageName}@${version} is not cached and --offline was requested`);
  }
  const releaseLock = await acquireCacheLock(cachePath, timeout);
  let stagingPath = null;
  try {
    if (!force && isCached(packageName, version)) {
      const packageDir = path.join(cachePath, 'node_modules', packageName);
      return {
        path: cachePath,
        packageDir,
        cached: true,
        metadata:
          readCacheMetadata(cachePath) ||
          writeCacheMetadata(cachePath, packageDir, packageName, version, 'existing-cache'),
      };
    }

    stagingPath = `${cachePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    fs.mkdirSync(stagingPath, { recursive: true });

    if (preferCdn && typeof fetch === 'function') {
      const fetched = await tryFetchPackageFromCdn(packageName, version, stagingPath, timeout);
      if (fetched) {
        const metadata = writeCacheMetadata(
          stagingPath,
          fetched.packageDir,
          packageName,
          version,
          'cdn'
        );
        commitStagedCache(stagingPath, cachePath);
        stagingPath = null;
        return {
          path: cachePath,
          packageDir: path.join(cachePath, 'node_modules', packageName),
          cached: false,
          fetched: true,
          metadata,
        };
      }
    }

    try {
      await runNpmAsync(
        [
          'install',
          `${packageName}@${version}`,
          '--prefix',
          stagingPath,
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
        ],
        {
          encoding: 'utf8',
          timeout,
          cwd: stagingPath,
          maxBuffer: 10 * 1024 * 1024,
        }
      );
    } catch (error) {
      throw new Error(
        `Failed to download ${packageName}@${version}: ${summarizeProcessError(error)}`
      );
    }

    const stagedPackageDir = path.join(stagingPath, 'node_modules', packageName);
    const stagedPackageJson = path.join(stagedPackageDir, 'package.json');
    if (!fs.existsSync(stagedPackageJson)) {
      throw new Error(`Package directory not found after install: ${stagedPackageDir}`);
    }
    const installedPackage = JSON.parse(fs.readFileSync(stagedPackageJson, 'utf8'));
    if (installedPackage.name !== packageName || installedPackage.version !== version) {
      throw new Error(
        `Downloaded package identity mismatch: expected ${packageName}@${version}, received ${installedPackage.name}@${installedPackage.version}`
      );
    }
    const metadata = writeCacheMetadata(stagingPath, stagedPackageDir, packageName, version, 'npm');
    commitStagedCache(stagingPath, cachePath);
    stagingPath = null;
    return {
      path: cachePath,
      packageDir: path.join(cachePath, 'node_modules', packageName),
      cached: false,
      fetched: false,
      metadata,
    };
  } finally {
    if (stagingPath) fs.rmSync(stagingPath, { recursive: true, force: true });
    releaseLock();
  }
}

export async function downloadVersion(packageName, version, options = {}) {
  const key = `${packageName}@${version}`;
  if (activeDownloads.has(key)) return activeDownloads.get(key);
  const download = downloadVersionUnlocked(packageName, version, options).finally(() => {
    activeDownloads.delete(key);
  });
  activeDownloads.set(key, download);
  return download;
}

/**
 * Resolve version string to actual version
 * Supports: "latest", "installed", "^1.0.0", "1.2.3", etc.
 */
export function resolveVersion(packageName, versionSpec, projectDir = process.cwd()) {
  assertValidPackageName(packageName);
  if (versionSpec === 'latest') {
    return getLatestVersion(packageName);
  }

  if (versionSpec === 'installed') {
    const installed = getInstalledVersion(packageName, projectDir);
    if (!installed) {
      throw new Error(`${packageName} is not installed in ${projectDir}`);
    }
    return installed;
  }

  assertSafeVersionSpec(versionSpec);

  // If it's a range, resolve to max satisfying
  if (versionSpec.startsWith('^') || versionSpec.startsWith('~') || versionSpec.includes('x')) {
    try {
      const result = runNpm(['view', `${packageName}@${versionSpec}`, 'version'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // npm may return multiple versions, take the last (highest)
      const versions = result.trim().split('\n');
      return versions[versions.length - 1].trim();
    } catch (e) {
      throw new Error(`Failed to resolve version ${versionSpec} for ${packageName}`);
    }
  }

  // Assume it's an exact version
  return versionSpec;
}

export async function resolveVersionAsync(packageName, versionSpec, projectDir = process.cwd()) {
  assertValidPackageName(packageName);
  if (versionSpec === 'latest') return getLatestVersionAsync(packageName);
  if (versionSpec === 'installed') {
    const installed = getInstalledVersion(packageName, projectDir);
    if (!installed) throw new Error(`${packageName} is not installed in ${projectDir}`);
    return installed;
  }
  assertSafeVersionSpec(versionSpec);
  if (versionSpec.startsWith('^') || versionSpec.startsWith('~') || versionSpec.includes('x')) {
    try {
      const { stdout } = await runNpmAsync(['view', `${packageName}@${versionSpec}`, 'version'], {
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return stdout.trim().split(/\r?\n/).at(-1).trim();
    } catch {
      throw new Error(`Failed to resolve version ${versionSpec} for ${packageName}`);
    }
  }
  return versionSpec;
}

export async function pinCache(packageName, versionSpec, options = {}) {
  const version = await resolveVersionAsync(
    packageName,
    versionSpec,
    options.projectDir || process.cwd()
  );
  const result = await downloadVersion(packageName, version, {
    ...options,
    force: options.force || false,
  });
  return {
    package: packageName,
    version,
    ...result,
  };
}

/**
 * Download two versions for comparison
 */
export async function downloadVersionPair(packageName, fromSpec, toSpec, options = {}) {
  const { projectDir = process.cwd() } = options;

  // Resolve version specs to actual versions
  const [fromVersion, toVersion] = await Promise.all([
    resolveVersionAsync(packageName, fromSpec, projectDir),
    resolveVersionAsync(packageName, toSpec, projectDir),
  ]);

  if (fromVersion === toVersion) {
    throw new Error(`Both versions resolve to the same version: ${fromVersion}`);
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
    if (!fs.existsSync(CACHE_DIR)) return;
    const safeName = packageName.replace(/[/@]/g, '_');
    const entries = fs.readdirSync(CACHE_DIR);
    for (const entry of entries) {
      if (entry.startsWith(safeName + '@')) {
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
export function getCacheStats(options = {}) {
  const { exact = false } = options;
  if (!fs.existsSync(CACHE_DIR)) {
    return { entries: 0, size: 0, packages: [], exact: true };
  }

  const entries = fs.readdirSync(CACHE_DIR);
  let totalSize = 0;
  const packages = [];

  for (const entry of entries) {
    const entryPath = path.join(CACHE_DIR, entry);
    const stats = fs.statSync(entryPath);
    if (stats.isDirectory()) {
      const metadata = readCacheMetadata(entryPath);
      const hasMetadataSize = Number.isFinite(metadata?.size);
      const size = exact ? getDirSize(entryPath) : hasMetadataSize ? metadata.size : 0;
      if (exact) {
        const nextMetadata = {
          ...(metadata || { schemaVersion: 1 }),
          size,
          sizeFormatted: formatBytes(size),
          sizeMeasuredAt: new Date().toISOString(),
        };
        fs.writeFileSync(cacheMetadataPath(entryPath), JSON.stringify(nextMetadata, null, 2));
      }
      totalSize += size;
      packages.push({
        name: entry,
        size,
        sizeFormatted: exact || hasMetadataSize ? formatBytes(size) : 'unknown',
        sizeExact: Boolean(exact || hasMetadataSize),
        sizeUnknown: Boolean(!exact && !hasMetadataSize),
      });
    }
  }

  const unknownEntries = packages.filter((pkg) => pkg.sizeUnknown).length;
  const sizeFormatted =
    unknownEntries === 0
      ? formatBytes(totalSize)
      : totalSize > 0
        ? `${formatBytes(totalSize)} known + ${unknownEntries} unknown`
        : 'unknown';

  return {
    entries: packages.length,
    unknownEntries,
    size: totalSize,
    sizeFormatted,
    exact: packages.every((pkg) => pkg.sizeExact),
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
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default {
  getLatestVersion,
  getLatestVersionAsync,
  getAllVersions,
  getInstalledVersion,
  downloadVersion,
  resolveVersion,
  resolveVersionAsync,
  pinCache,
  downloadVersionPair,
  clearCache,
  getCacheStats,
};
