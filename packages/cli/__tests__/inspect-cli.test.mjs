import { execFileSync, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(here, '..', 'bin', 'deplens.js');
const repoRoot = path.resolve(here, '..', '..', '..');

function runCliJson(args) {
  const output = execFileSync(process.execPath, [cliPath, ...args, '--json'], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  return JSON.parse(output);
}

describe('inspect CLI', () => {
  it('filters runtime exports by requested kind', () => {
    const output = runCliJson(['zod', '--kind', 'class']);

    expect(output.exports.total).toBe(output.exports.classes.length);
    expect(output.exports.functions).toHaveLength(0);
    expect(output.exports.objects).toHaveLength(0);
    expect(output.exports.constants).toHaveLength(0);
  });

  it('exits non-zero when JSON output contains an error', () => {
    const result = spawnSync(
      process.execPath,
      [cliPath, 'diff', 'zod', '--from', '3.22.0', '--to', '3.22.0', '--json'],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
      }
    );

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).error).toContain('Both versions resolve to the same version');
  });

  it('exits non-zero for unresolved inspect JSON payloads', () => {
    const result = spawnSync(
      process.execPath,
      [cliPath, 'definitely-not-a-real-deplens-pkg', '--json'],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
      }
    );

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).package).toBeNull();
  });

  it('rejects unknown options and missing option values', () => {
    const unknown = spawnSync(process.execPath, [cliPath, 'zod', '--formt', 'json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const missing = spawnSync(process.execPath, [cliPath, 'zod', '--filter', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('Unknown option: --formt');
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('Option --filter requires a value');
  });
});
