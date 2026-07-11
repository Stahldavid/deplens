import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  compareProjectSnapshots,
  createProjectSnapshot,
  runProjectDiff,
} from '../src/project-diff.mjs';

function lockfile(version, dependencies = {}) {
  const packages = {
    '': {
      name: 'demo-project',
      version: '1.0.0',
      dependencies: Object.fromEntries(Object.keys(dependencies).map((name) => [name, '*'])),
    },
  };
  for (const [name, packageVersion] of Object.entries(dependencies)) {
    packages[`node_modules/${name}`] = { version: packageVersion };
  }
  return { name: 'demo-project', version, lockfileVersion: 3, packages };
}

describe('project diff', () => {
  it('creates deterministic npm lockfile snapshots', () => {
    const snapshot = createProjectSnapshot(lockfile('1.0.0', { zod: '3.22.4', semver: '7.7.4' }));

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      kind: 'deplens-project-snapshot',
      project: { name: 'demo-project', lockfileVersion: 3 },
    });
    expect(snapshot.packages.zod).toMatchObject({ version: '3.22.4', direct: true });
  });

  it('creates snapshots from pnpm lockfiles with workspace direct dependencies', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-pnpm-lock-'));
    const lockPath = path.join(root, 'pnpm-lock.yaml');
    try {
      writeFileSync(
        lockPath,
        "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      zod:\n        specifier: ^3.22.0\n        version: 3.22.4\n  packages/app:\n    dependencies:\n      semver:\n        specifier: ^7.7.0\n        version: 7.7.4\npackages:\n  zod@3.22.4:\n    resolution: {integrity: sha512-zod}\n  semver@7.7.4:\n    resolution: {integrity: sha512-semver}\n"
      );

      const snapshot = createProjectSnapshot(lockPath);

      expect(snapshot.project.lockfileVersion).toBe('9.0');
      expect(snapshot.packages.zod).toMatchObject({ version: '3.22.4', direct: true });
      expect(snapshot.packages.semver).toMatchObject({
        version: '7.7.4',
        direct: true,
        workspaces: ['packages/app'],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('strips nested pnpm peer suffixes without treating peer names as npm aliases', () => {
    const snapshot = createProjectSnapshot({
      lockfileVersion: '9.0',
      importers: {
        '.': {
          dependencies: {
            '@clerk/shared': {
              specifier: '^4.25.0',
              version: '4.25.2(react-dom@19.2.7(react@19.2.7))(react@19.2.7)',
            },
          },
        },
      },
      packages: {
        '@clerk/shared@4.25.2': { resolution: { integrity: 'sha512-shared' } },
        'react-dom@19.2.7': { resolution: { integrity: 'sha512-react-dom' } },
      },
    });

    expect(snapshot.packages['@clerk/shared']).toMatchObject({
      version: '4.25.2',
      direct: true,
    });
    expect(snapshot.instances).not.toContainEqual(
      expect.objectContaining({ name: '@clerk/shared', version: '19.2.7)' })
    );
  });

  it('classifies additions, removals, upgrades and downgrades', () => {
    const from = createProjectSnapshot(lockfile('1.0.0', { zod: '3.22.4', old: '2.0.0' }));
    const to = createProjectSnapshot(lockfile('1.0.1', { zod: '4.3.6', added: '1.0.0' }));

    const report = compareProjectSnapshots(from, to);

    expect(report.summary).toEqual({ total: 3, added: 1, removed: 1, upgraded: 1, downgraded: 0 });
    expect(report.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ package: 'zod', changeType: 'upgraded' }),
        expect.objectContaining({ package: 'old', changeType: 'removed' }),
        expect.objectContaining({ package: 'added', changeType: 'added' }),
      ])
    );
  });

  it('enriches changed dependencies with API diffs and progress', async () => {
    const diffRunner = vi.fn(async ({ package: packageName }) => ({
      schemaVersion: 2,
      package: packageName,
      summary: { breaking: 1, warnings: 0, additions: 2, removals: 1 },
      changes: [],
    }));
    const progress = vi.fn();

    const report = await runProjectDiff({
      from: createProjectSnapshot(lockfile('1.0.0', { zod: '3.22.4' })),
      to: createProjectSnapshot(lockfile('1.0.1', { zod: '4.3.6' })),
      diffRunner,
      onProgress: progress,
    });

    expect(diffRunner).toHaveBeenCalledWith(
      expect.objectContaining({ package: 'zod', from: '3.22.4', to: '4.3.6' })
    );
    expect(report.changes[0].api.summary.breaking).toBe(1);
    expect(report.summary.breakingPackages).toBe(1);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 1, total: 1 }));
  });

  it('returns only direct dependency changes unless transitive changes are requested', async () => {
    const from = createProjectSnapshot(lockfile('1.0.0', { direct: '1.0.0' }));
    const to = createProjectSnapshot(lockfile('1.0.1', { direct: '2.0.0' }));
    from.packages.transitive = { name: 'transitive', version: '1.0.0', direct: false };
    to.packages.transitive = { name: 'transitive', version: '2.0.0', direct: false };

    const defaultReport = await runProjectDiff({ from, to, analyze: false });
    const completeReport = await runProjectDiff({
      from,
      to,
      analyze: false,
      includeTransitive: true,
    });

    expect(defaultReport.changes.map((change) => change.package)).toEqual(['direct']);
    expect(defaultReport.summary.total).toBe(1);
    expect(completeReport.changes.map((change) => change.package)).toEqual([
      'direct',
      'transitive',
    ]);
    expect(completeReport.summary.total).toBe(2);
  });

  it('compacts enriched API diffs by default and preserves full detail on request', async () => {
    const from = createProjectSnapshot(lockfile('1.0.0', { zod: '3.22.4' }));
    const to = createProjectSnapshot(lockfile('1.0.1', { zod: '4.3.6' }));
    const richApi = {
      output: 'x'.repeat(1_000_000),
      diff: { symbols: Array.from({ length: 1000 }, (_, index) => ({ index })) },
      schemaVersion: 2,
      detailLevel: 'compact',
      package: 'zod',
      summary: { breaking: 1, warnings: 2 },
      changes: Array.from({ length: 30 }, (_, index) => ({
        type: 'symbol_changed',
        name: `symbol${index}`,
      })),
      semanticCompatibility: { compatible: false, diagnostics: [{ code: 2322 }] },
      symbols: { fromCount: 100, toCount: 101 },
      warnings: [],
    };
    const diffRunner = vi.fn(async () => richApi);

    const compact = await runProjectDiff({
      from,
      to,
      diffRunner,
      maxChangesPerPackage: 10,
    });
    const nextPage = await runProjectDiff({
      from,
      to,
      diffRunner,
      maxChangesPerPackage: 10,
      packageCursors: { zod: '10' },
    });
    const full = await runProjectDiff({ from, to, diffRunner, detail: 'full' });

    expect(compact).toMatchObject({ detailLevel: 'compact' });
    expect(compact.changes[0].api).toMatchObject({
      package: 'zod',
      summary: { breaking: 1, warnings: 2 },
      changes: Array.from({ length: 10 }, (_, index) => ({
        type: 'symbol_changed',
        name: `symbol${index}`,
      })),
      semanticCompatibility: { compatible: false, diagnostics: [{ code: 2322 }] },
      pagination: {
        total: 30,
        offset: 0,
        returned: 10,
        nextCursor: '10',
        truncated: true,
      },
    });
    expect(nextPage.changes[0].api.changes[0]).toMatchObject({ name: 'symbol10' });
    expect(nextPage.changes[0].api.pagination).toMatchObject({
      offset: 10,
      returned: 10,
      nextCursor: '20',
      truncated: true,
    });
    expect(diffRunner).toHaveBeenCalledWith(
      expect.objectContaining({ maxChanges: 10, cursor: '10' })
    );
    expect(JSON.stringify(compact).length).toBeLessThan(4_000);
    expect(full.detailLevel).toBe('full');
    expect(full.changes[0].api).toBe(richApi);
  });

  it('filters packages and reuses a compact analysis snapshot across cursor requests', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-project-snapshot-'));
    const snapshotFile = path.join(root, 'analysis.json');
    const from = createProjectSnapshot(lockfile('1.0.0', { zod: '3.22.4', semver: '7.7.3' }));
    const to = createProjectSnapshot(lockfile('1.0.1', { zod: '4.3.6', semver: '7.7.4' }));
    const changes = Array.from({ length: 25 }, (_, index) => ({
      type: 'symbol_changed',
      name: `symbol${index}`,
    }));
    const diffRunner = vi.fn(async ({ package: packageName }) => ({
      package: packageName,
      summary: { breaking: 0, warnings: 25 },
      changes,
      changeCount: changes.length,
      semanticCompatibility: { compatible: true },
    }));

    try {
      const first = await runProjectDiff({
        from,
        to,
        projectDir: root,
        projectSnapshot: snapshotFile,
        packageOnly: ['zod'],
        cacheDir: path.join(root, 'cache'),
        diffRunner,
      });
      const secondRunner = vi.fn(async () => {
        throw new Error('snapshot should avoid analysis');
      });
      const second = await runProjectDiff({
        from,
        to,
        projectDir: root,
        projectSnapshot: snapshotFile,
        packageOnly: ['zod'],
        packageCursors: { zod: '10' },
        diffRunner: secondRunner,
      });

      expect(first.changes).toHaveLength(1);
      expect(first.changes[0].package).toBe('zod');
      expect(first.changes[0].api.pagination).toMatchObject({ returned: 10, nextCursor: '10' });
      expect(diffRunner).toHaveBeenCalledWith(
        expect.objectContaining({ cacheDir: path.join(root, 'cache'), maxChanges: 10 })
      );
      expect(first.snapshot).toMatchObject({ reusedPackages: 0, writtenPackages: 1 });
      expect(secondRunner).not.toHaveBeenCalled();
      expect(second.changes[0].api.changes[0].name).toBe('symbol10');
      expect(second.snapshot).toMatchObject({ reusedPackages: 1, writtenPackages: 0 });

      const changedRunner = vi.fn(async ({ package: packageName }) => ({
        package: packageName,
        summary: { breaking: 0, warnings: 0 },
        changes: [],
      }));
      await runProjectDiff({
        from,
        to: createProjectSnapshot(lockfile('1.0.2', { zod: '4.3.7', semver: '7.7.4' })),
        projectDir: root,
        projectSnapshot: snapshotFile,
        packageOnly: ['zod'],
        diffRunner: changedRunner,
      });
      expect(changedRunner).toHaveBeenCalledOnce();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports a structured error when strict package-only matches nothing', async () => {
    const from = createProjectSnapshot(lockfile('1.0.0', { zod: '3.22.4' }));
    const to = createProjectSnapshot(lockfile('1.0.1', { zod: '4.3.6' }));
    const diffRunner = vi.fn();
    const report = await runProjectDiff({
      from,
      to,
      packageOnly: ['missing-pkg'],
      strictPackageOnly: true,
      diffRunner,
    });

    expect(diffRunner).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      error: 'Requested packages not changed',
      errorInfo: {
        code: 'PACKAGE_ONLY_NOT_FOUND',
        phase: 'project-diff',
        retryable: false,
        requested: ['missing-pkg'],
      },
      packageSelection: {
        requested: ['missing-pkg'],
        matched: [],
        missing: ['missing-pkg'],
      },
    });
  });
});
