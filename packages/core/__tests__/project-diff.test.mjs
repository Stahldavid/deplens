import { describe, expect, it, vi } from 'vitest';
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
});
