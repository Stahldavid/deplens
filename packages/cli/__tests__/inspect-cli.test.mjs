import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
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
  it('uses the compact schema v2 projection for JSON by default', () => {
    const output = runCliJson(['zod', '--no-runtime', '--max-symbols', '2']);

    expect(output).toMatchObject({
      schemaVersion: 2,
      kind: 'deplens-inspect',
      detailLevel: 'compact',
    });
    expect(output.symbols).toHaveLength(2);
    expect(output.pagination).toMatchObject({ offset: 0, returned: 2, nextCursor: '2' });
    expect(output.staticExports).toEqual({ total: expect.any(Number) });
  });

  it('keeps schema v2 when full JSON detail is requested', () => {
    const output = runCliJson(['zod', '--no-runtime', '--detail', 'full', '--max-symbols', '1']);

    expect(output).toMatchObject({
      schemaVersion: 2,
      kind: 'deplens-inspect',
      detailLevel: 'full',
    });
    expect(output.symbols).toHaveLength(1);
  });

  it('accepts repeated and equals-form select options', () => {
    const repeated = runCliJson([
      'zod',
      '--no-runtime',
      '--types',
      '--select',
      'types',
      '--select',
      'symbols',
    ]);
    const equalsForm = runCliJson(['zod', '--no-runtime', '--types', '--select=types,symbols']);

    for (const output of [repeated, equalsForm]) {
      expect(output).toHaveProperty('types');
      expect(output).toHaveProperty('symbols');
    }
  });

  it('supports equals-form values consistently across inspect options', () => {
    const output = runCliJson([
      'zod',
      '--no-runtime',
      '--types',
      '--filter=ZodString',
      '--max-symbols=2',
    ]);

    expect(output.symbols).toHaveLength(2);
    expect(output.symbols.every((symbol) => /zodstring/i.test(symbol.exportName))).toBe(true);
  });

  it('reassembles CSV values split by the global PowerShell shim', () => {
    const output = runCliJson([
      'zod',
      '--no-runtime',
      '--types',
      '--select=types symbols',
      '--max-symbols=2',
    ]);

    expect(output.types).toEqual(expect.any(Object));
    expect(output.symbols).toHaveLength(2);
  });

  it('includes requested docs sections and profile timings in compact JSON', () => {
    const sections = runCliJson(['zod', '--no-runtime', '--list-sections']);
    const profiled = runCliJson(['zod', '--no-runtime', '--profile']);

    expect(sections.sections).toEqual(expect.any(Array));
    expect(sections).not.toHaveProperty('symbols');
    expect(sections).not.toHaveProperty('staticExports');
    expect(profiled.meta.timings).toMatchObject({
      inspectCoreMs: expect.any(Number),
      totalMs: expect.any(Number),
    });
  });

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

  it('preserves unresolved errors and exit status with --select', () => {
    const result = spawnSync(
      process.execPath,
      [cliPath, 'definitely-not-a-real-deplens-pkg', '--select', 'symbols', '--json'],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
      }
    );

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      package: null,
      warnings: expect.any(Array),
    });
  });

  it('rejects unknown options before command execution', () => {
    const unknown = spawnSync(process.execPath, [cliPath, 'zod', '--formt', 'json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('Unknown option: --formt');
  }, 10000);

  it('rejects options with missing values before command execution', () => {
    const missing = spawnSync(process.execPath, [cliPath, 'zod', '--filter', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('Option --filter requires a value');
  }, 10000);

  it('describes Rust and Go as detection-only languages', () => {
    const result = spawnSync(process.execPath, [cliPath, '--help'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const help = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(0);
    expect(help).toContain('Analyze source code (JS/TS/Python/Java)');
    expect(help).toContain('Detect-only languages: rust, go');
    expect(help).toContain('stats|clear|pin|migrate|prune');
    expect(help).toContain('--jsdoc-symbol');
    expect(help).toContain('--jsdoc-sections');
    expect(help).toContain('--jsdoc-tags-exclude');
    expect(help).toContain('--cursor VALUE         Resume diff pagination');
    expect(help).toContain('--max-changes-per-package');
    expect(help).toContain('--package-cursor');
    expect(help).toContain('--package-only');
    expect(help).toContain('--strict-package-only');
    expect(help).toContain('--project-snapshot');
    expect(help).toContain('--jsdoc-max-params');
    expect(help).toContain('--jsdoc-param-cursor');
    expect(help).toContain('--summary');
    expect(help).not.toContain('Analyze source code (JS/TS/Python/Java/Rust/Go)');
  });

  it('validates cache maintenance values before command execution', () => {
    const result = spawnSync(process.execPath, [cliPath, 'cache', 'prune', '--cache-dir'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Option --cache-dir requires a value');
  });

  it('returns versioned cache envelopes and honors an explicit cache directory', () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'deplens-cli-cache-'));
    try {
      const stats = runCliJson(['cache', 'stats', '--cache-dir', cacheDir]);
      const cleared = runCliJson(['cache', 'clear', '--cache-dir', cacheDir]);
      const pruned = runCliJson([
        'cache',
        'prune',
        '--cache-dir',
        cacheDir,
        '--max-size',
        '1KB',
        '--max-entries',
        '2',
        '--dry-run',
      ]);

      expect(stats).toMatchObject({
        schemaVersion: 1,
        kind: 'deplens-cache-stats',
        cacheDir,
        pagination: { total: 0, returned: 0 },
      });
      expect(cleared).toMatchObject({
        schemaVersion: 1,
        kind: 'deplens-cache-clear',
        cacheDir,
      });
      expect(pruned).toMatchObject({
        schemaVersion: 1,
        kind: 'deplens-cache-prune',
        maxSizeBytes: 1024,
        maxEntries: 2,
        wouldRemove: 0,
        limitSatisfied: true,
      });
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
