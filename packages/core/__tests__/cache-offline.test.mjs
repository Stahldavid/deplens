import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import path from 'path';
import { runDiff } from '../src/diff.mjs';
import {
  clearCache,
  downloadVersion,
  getCacheStats,
  migrateCache,
  pruneCache,
  safePackageRelativePath,
} from '../src/version-resolver.mjs';

function writeLegacyCacheEntry(cacheDir, entryName, packageName, version, cachedAt = null) {
  const entryDir = path.join(cacheDir, entryName);
  const packageDir = path.join(entryDir, 'node_modules', packageName);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name: packageName, version })
  );
  writeFileSync(path.join(packageDir, 'index.js'), 'export const value = 1;\n');
  if (cachedAt) {
    writeFileSync(
      path.join(entryDir, '.deplens-cache.json'),
      JSON.stringify({ schemaVersion: 1, package: packageName, version, cachedAt, size: null })
    );
  }
  return entryDir;
}

describe('cache offline mode', () => {
  it('fails fast when an exact package version is not cached', async () => {
    await expect(
      downloadVersion('deplens-offline-fixture-does-not-exist', '0.0.0', { offline: true })
    ).rejects.toThrow('--offline was requested');
  });

  it('uses an explicit cache directory across download, stats, and clear', async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'deplens-cache-context-'));
    try {
      writeLegacyCacheEntry(cacheDir, 'demo-pkg@1.2.3', 'demo-pkg', '1.2.3');

      const cached = await downloadVersion('demo-pkg', '1.2.3', { offline: true, cacheDir });
      expect(cached.cached).toBe(true);
      expect(getCacheStats({ cacheDir })).toMatchObject({
        schemaVersion: 1,
        kind: 'deplens-cache-stats',
        cacheDir,
        entries: 1,
      });

      expect(clearCache('demo-pkg', { cacheDir })).toMatchObject({
        schemaVersion: 1,
        kind: 'deplens-cache-clear',
        package: 'demo-pkg',
        removed: 1,
      });
      expect(getCacheStats({ cacheDir }).entries).toBe(0);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('honors cancellation before starting a download', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      downloadVersion('cancelled-pkg', '1.0.0', { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'ABORTED', phase: 'download' });
  });

  it('does not resolve latest in offline diff mode', async () => {
    const result = await runDiff({
      package: 'zod',
      from: 'installed',
      to: 'latest',
      offline: true,
      format: 'json',
    });

    expect(result.error).toBe('--offline diff requires exact versions, except --from installed');
    expect(JSON.parse(result.output).meta.offline).toBe(true);
  });

  it('confines package metadata paths to the package directory', () => {
    const packageDir = path.resolve('safe-package-root');

    expect(safePackageRelativePath(packageDir, './dist/index.d.ts')?.destination).toBe(
      path.join(packageDir, 'dist', 'index.d.ts')
    );
    expect(safePackageRelativePath(packageDir, '../../outside.txt')).toBeNull();
    expect(safePackageRelativePath(packageDir, 'C:\\outside.txt')).toBeNull();
    expect(safePackageRelativePath(packageDir, 'C:/outside.txt')).toBeNull();
    expect(safePackageRelativePath(packageDir, '\\\\server\\share\\outside.txt')).toBeNull();
    expect(safePackageRelativePath(packageDir, '/outside.txt')).toBeNull();
    expect(safePackageRelativePath(packageDir, 'file:///outside.txt')).toBeNull();
  });

  it('migrates legacy tag entries to exact versions and writes exact metadata', () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'deplens-cache-migrate-'));
    try {
      writeLegacyCacheEntry(cacheDir, 'demo-pkg@latest', 'demo-pkg', '1.2.3');

      const result = migrateCache({ cacheDir, exact: true });
      const exactDir = path.join(cacheDir, 'demo-pkg@1.2.3');
      const metadata = JSON.parse(readFileSync(path.join(exactDir, '.deplens-cache.json'), 'utf8'));

      expect(result).toMatchObject({
        schemaVersion: 1,
        kind: 'deplens-cache-migrate',
        scanned: 1,
        migrated: 1,
        aliasesMoved: 1,
        invalid: 0,
      });
      expect(metadata).toMatchObject({
        schemaVersion: 1,
        package: 'demo-pkg',
        version: '1.2.3',
      });
      expect(metadata.size).toBeGreaterThan(0);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('prunes stale and invalid entries with dry-run support', () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'deplens-cache-prune-'));
    try {
      const staleDir = writeLegacyCacheEntry(
        cacheDir,
        'stale-pkg@1.0.0',
        'stale-pkg',
        '1.0.0',
        '2000-01-01T00:00:00.000Z'
      );
      mkdirSync(path.join(cacheDir, 'invalid-entry'));

      const preview = pruneCache({ cacheDir, maxAgeDays: 30, dryRun: true });
      expect(preview).toMatchObject({
        schemaVersion: 1,
        kind: 'deplens-cache-prune',
        removed: 0,
        candidates: 2,
        dryRun: true,
      });
      expect(preview.entries.map((entry) => entry.reason).sort()).toEqual(['invalid', 'stale']);
      expect(() =>
        readFileSync(path.join(staleDir, 'node_modules', 'stale-pkg', 'package.json'))
      ).not.toThrow();

      const result = pruneCache({ cacheDir, maxAgeDays: 30 });
      expect(result).toMatchObject({ removed: 2, candidates: 2, dryRun: false });
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
