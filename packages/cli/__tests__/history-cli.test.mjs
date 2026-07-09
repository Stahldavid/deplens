import { execFileSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(here, '..', 'bin', 'deplens.js');
const repoRoot = path.resolve(here, '..', '..', '..');

function runCli(args) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
}

function writeHistoryEntry(historyDir, packageName, version) {
  const packageDir = path.join(historyDir, packageName.replace(/[^a-zA-Z0-9_-]/g, '_'));
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    path.join(packageDir, `${version}.json`),
    JSON.stringify({ package: packageName, version, timestamp: 1 }, null, 2)
  );
}

describe('history CLI', () => {
  it('saves inspect history in text mode', () => {
    const projectDir = path.join(tmpdir(), `deplens-cli-history-project-${process.pid}-${Date.now()}`);
    const historyDir = path.join(tmpdir(), `deplens-cli-history-save-${process.pid}-${Date.now()}`);
    const packageDir = path.join(projectDir, 'node_modules', 'deplens-history-fixture');
    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(packageDir, 'package.json'),
        JSON.stringify(
          {
            name: 'deplens-history-fixture',
            version: '1.2.3',
            main: 'index.js',
          },
          null,
          2
        )
      );
      writeFileSync(path.join(packageDir, 'index.js'), 'exports.answer = 42;\n');

      runCli([
        'deplens-history-fixture',
        '--resolve-from',
        projectDir,
        '--save-history',
        '--history-dir',
        historyDir,
      ]);
      const output = runCli(['history', 'list', '--history-dir', historyDir]);

      expect(output).toContain('deplens-history-fixture@1.2.3');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(historyDir, { recursive: true, force: true });
    }
  });

  it('does not treat --history-dir as the history list filter', () => {
    const historyDir = path.join(tmpdir(), `deplens-cli-history-${process.pid}-${Date.now()}`);
    try {
      writeHistoryEntry(historyDir, 'zod', '4.3.6');

      const output = runCli(['history', 'list', '--history-dir', historyDir]);

      expect(output).toContain('zod@4.3.6');
    } finally {
      rmSync(historyDir, { recursive: true, force: true });
    }
  });

  it('clears custom history dirs without treating --history-dir as a package name', () => {
    const historyDir = path.join(tmpdir(), `deplens-cli-history-clear-${process.pid}-${Date.now()}`);
    try {
      writeHistoryEntry(historyDir, 'zod', '4.3.6');

      const output = runCli(['history', 'clear', '--history-dir', historyDir]);
      const listOutput = runCli(['history', 'list', '--history-dir', historyDir]);

      expect(output).toContain('Cleared 1 history entry');
      expect(listOutput).toContain('No history entries found');
    } finally {
      rmSync(historyDir, { recursive: true, force: true });
    }
  });

  it('shows scoped package history without mistaking the leading @ for a version separator', () => {
    const historyDir = path.join(tmpdir(), `deplens-cli-history-scoped-${process.pid}-${Date.now()}`);
    try {
      writeHistoryEntry(historyDir, '@posthog/convex', '2.0.32');

      const output = runCli(['history', 'show', '@posthog/convex', '--history-dir', historyDir]);
      const parsed = JSON.parse(output);

      expect(parsed.package).toBe('@posthog/convex');
      expect(parsed.version).toBe('2.0.32');
    } finally {
      rmSync(historyDir, { recursive: true, force: true });
    }
  });
});
