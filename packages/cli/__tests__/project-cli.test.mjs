import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

const CLI = path.resolve(import.meta.dirname, '..', 'src', 'cli.mjs');

function writeLock(filePath, zodVersion) {
  writeFileSync(
    filePath,
    JSON.stringify({
      name: 'cli-project',
      lockfileVersion: 3,
      packages: {
        '': { name: 'cli-project', dependencies: { zod: '*' } },
        'node_modules/zod': { version: zodVersion },
      },
    })
  );
}

describe('project CLI workflows', () => {
  it('compares two lockfiles without registry access', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-project-cli-'));
    try {
      const before = path.join(root, 'before-lock.json');
      const after = path.join(root, 'after-lock.json');
      writeLock(before, '3.22.4');
      writeLock(after, '4.3.6');

      const result = spawnSync(
        process.execPath,
        [CLI, 'project-diff', '--from-lock', before, '--to-lock', after, '--no-api', '--json'],
        { cwd: root, encoding: 'utf8' }
      );

      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.changes[0]).toMatchObject({ package: 'zod', changeType: 'upgraded' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('compares pnpm lockfiles without registry access', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-pnpm-project-cli-'));
    try {
      const before = path.join(root, 'before-pnpm-lock.yaml');
      const after = path.join(root, 'after-pnpm-lock.yaml');
      const pnpmLock = (version) =>
        `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      zod:\n        specifier: '*'\n        version: ${version}\npackages:\n  zod@${version}: {}\n`;
      writeFileSync(before, pnpmLock('3.22.4'));
      writeFileSync(after, pnpmLock('4.3.6'));

      const result = spawnSync(
        process.execPath,
        [CLI, 'project-diff', '--from-lock', before, '--to-lock', after, '--no-api', '--json'],
        { cwd: root, encoding: 'utf8' }
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).changes[0]).toMatchObject({
        package: 'zod',
        changeType: 'upgraded',
        direct: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exits non-zero when strict package-only matches no changed packages', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-strict-project-cli-'));
    try {
      const before = path.join(root, 'before-lock.json');
      const after = path.join(root, 'after-lock.json');
      writeLock(before, '3.22.4');
      writeLock(after, '4.3.6');

      const result = spawnSync(
        process.execPath,
        [
          CLI,
          'project-diff',
          '--from-lock',
          before,
          '--to-lock',
          after,
          '--no-api',
          '--package-only',
          'missing-pkg',
          '--strict-package-only',
          '--json',
        ],
        { cwd: root, encoding: 'utf8' }
      );

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: 'Requested packages not changed',
        errorInfo: { code: 'PACKAGE_ONLY_NOT_FOUND' },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes a baseline and fails a policy check on later changes', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-check-cli-'));
    try {
      const lockfile = path.join(root, 'package-lock.json');
      const baseline = path.join(root, '.deplens-baseline.json');
      writeLock(lockfile, '3.22.4');
      const writeResult = spawnSync(
        process.execPath,
        [CLI, 'check', '--write-baseline', '--baseline', baseline, '--json'],
        { cwd: root, encoding: 'utf8' }
      );
      expect(writeResult.status).toBe(0);

      writeLock(lockfile, '4.3.6');
      const checkResult = spawnSync(
        process.execPath,
        [CLI, 'check', '--baseline', baseline, '--fail-on', 'change', '--no-api', '--json'],
        { cwd: root, encoding: 'utf8' }
      );

      expect(checkResult.status).toBe(1);
      expect(JSON.parse(checkResult.stdout)).toMatchObject({
        passed: false,
        summary: { violations: 1 },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
