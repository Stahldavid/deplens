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

  it('reports a newly installed npm package as fetched', async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'deplens-cache-fetch-state-'));
    try {
      const result = await downloadVersion('downloaded-pkg', '1.0.0', {
        cacheDir,
        npmRunner: async (args) => {
          const prefix = args[args.indexOf('--prefix') + 1];
          const packageDir = path.join(prefix, 'node_modules', 'downloaded-pkg');
          mkdirSync(packageDir, { recursive: true });
          writeFileSync(
            path.join(packageDir, 'package.json'),
            JSON.stringify({ name: 'downloaded-pkg', version: '1.0.0' })
          );
        },
      });

      expect(result).toMatchObject({ cached: false, fetched: true });
      expect(result.metadata).toMatchObject({ size: expect.any(Number) });
      expect(result.metadata.size).toBeGreaterThan(0);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('updates last-used metadata when a cached package is read', async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'deplens-cache-last-used-'));
    try {
      const entryDir = writeLegacyCacheEntry(
        cacheDir,
        'demo-pkg@1.2.3',
        'demo-pkg',
        '1.2.3',
        '2000-01-01T00:00:00.000Z'
      );

      const result = await downloadVersion('demo-pkg', '1.2.3', { offline: true, cacheDir });
      const metadata = JSON.parse(readFileSync(path.join(entryDir, '.deplens-cache.json'), 'utf8'));

      expect(result.cached).toBe(true);
      expect(Date.parse(metadata.lastUsedAt)).toBeGreaterThan(Date.parse(metadata.cachedAt));
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
        wouldRemove: 2,
        candidates: 2,
        dryRun: true,
      });
      expect(preview.entries.map((entry) => entry.reason).sort()).toEqual(['invalid', 'stale']);
      expect(preview.candidatesPreview).toHaveLength(2);
      expect(() =>
        readFileSync(path.join(staleDir, 'node_modules', 'stale-pkg', 'package.json'))
      ).not.toThrow();

      const result = pruneCache({ cacheDir, maxAgeDays: 30 });
      expect(result).toMatchObject({ removed: 2, candidates: 2, dryRun: false });
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('selects least-recently-used entries for count and size limits', () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'deplens-cache-lru-'));
    try {
      for (const [index, lastUsedAt] of [
        '2026-01-01T00:00:00.000Z',
        '2026-02-01T00:00:00.000Z',
        '2026-03-01T00:00:00.000Z',
      ].entries()) {
        const name = `demo-${index}`;
        const entryDir = writeLegacyCacheEntry(cacheDir, `${name}@1.0.0`, name, '1.0.0');
        writeFileSync(
          path.join(entryDir, '.deplens-cache.json'),
          JSON.stringify({
            schemaVersion: 1,
            package: name,
            version: '1.0.0',
            cachedAt: lastUsedAt,
            lastUsedAt,
            size: 100,
          })
        );
      }

      const byCount = pruneCache({
        cacheDir,
        maxAgeDays: Number.POSITIVE_INFINITY,
        maxEntries: 2,
        dryRun: true,
      });
      const bySize = pruneCache({
        cacheDir,
        maxAgeDays: Number.POSITIVE_INFINITY,
        maxSizeBytes: 150,
        dryRun: true,
      });

      expect(byCount.entries).toEqual([
        expect.objectContaining({ name: 'demo-0@1.0.0', reason: 'lru-count' }),
      ]);
      expect(byCount).toMatchObject({ candidates: 1, limitSatisfied: true });
      expect(bySize.entries.map((entry) => entry.name)).toEqual(['demo-0@1.0.0', 'demo-1@1.0.0']);
      expect(bySize).toMatchObject({
        candidates: 2,
        maxSizeBytes: 150,
        remainingBytes: 100,
        limitSatisfied: true,
      });
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('paginates and summarizes cache stats package lists', () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'deplens-cache-stats-page-'));
    try {
      for (const name of ['alpha', 'beta', 'gamma']) {
        const entryDir = writeLegacyCacheEntry(cacheDir, `${name}@1.0.0`, name, '1.0.0');
        writeFileSync(
          path.join(entryDir, '.deplens-cache.json'),
          JSON.stringify({
            schemaVersion: 1,
            package: name,
            version: '1.0.0',
            size: 10,
          })
        );
      }

      const summary = getCacheStats({ cacheDir, summary: true });
      expect(summary).toMatchObject({
        kind: 'deplens-cache-stats',
        entries: 3,
        pagination: { total: 3, returned: 0, nextCursor: null },
      });
      expect(summary).not.toHaveProperty('packages');

      const firstPage = getCacheStats({ cacheDir, maxEntries: 2 });
      expect(firstPage.packages.map((pkg) => pkg.name)).toEqual(['alpha@1.0.0', 'beta@1.0.0']);
      expect(firstPage.pagination).toMatchObject({
        total: 3,
        offset: 0,
        returned: 2,
        nextCursor: '2',
      });

      const secondPage = getCacheStats({ cacheDir, maxEntries: 2, cursor: '2' });
      expect(secondPage.packages.map((pkg) => pkg.name)).toEqual(['gamma@1.0.0']);
      expect(secondPage.pagination).toMatchObject({ offset: 2, returned: 1, nextCursor: null });
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
