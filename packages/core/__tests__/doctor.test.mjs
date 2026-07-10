import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { buildDoctorReport, runDoctor } from '../src/doctor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

describe('buildDoctorReport', () => {
  it('reports ok when package, runtime, types, and symbols are available', () => {
    const report = buildDoctorReport(
      {
        package: 'demo',
        version: '1.0.0',
        pkgDir: '/repo/node_modules/demo',
        warnings: [],
        resolution: {
          target: 'demo',
          runtimePath: 'index.js',
          typesPath: 'index.d.ts',
          typesSource: 'exports',
          entrypointExists: true,
          trace: {
            runtime: { resolver: 'import-meta-resolve', conditionsMatched: ['import'] },
            types: { conditionsMatched: ['types'] },
          },
        },
        symbols: [{ name: 'foo', facets: ['runtime', 'types'], availability: 'runtime+types' }],
      },
      { target: 'demo' }
    );

    expect(report.status).toBe('ok');
    expect(report.summary.failed).toBe(0);
    expect(report.symbols).toMatchObject({ total: 1, runtime: 1, types: 1 });
  });

  it('suggests --types when runtime is unavailable but types exist', () => {
    const report = buildDoctorReport(
      {
        package: 'next',
        version: '16.0.0',
        warnings: ['Runtime export introspection unavailable; type definitions were found.'],
        resolution: {
          target: 'next/server',
          runtimePath: 'server',
          typesPath: 'server.d.ts',
          typesSource: 'subpath',
          entrypointExists: false,
          runtimeTypesDiverge: true,
          trace: {
            runtime: {
              resolver: 'import-meta-resolve',
              conditionsMatched: [],
              resolvedPath: 'server',
            },
            types: { conditionsMatched: [], resolvedPath: 'server.d.ts' },
          },
        },
        symbols: [{ name: 'NextRequest', facets: ['types'], availability: 'types-only' }],
      },
      { target: 'next/server' }
    );

    expect(report.status).toBe('issues');
    expect(report.suggestions).toContain(
      'Use --types for this target; runtime introspection is unavailable.'
    );
    expect(report.symbols).toMatchObject({ runtime: 0, types: 1 });
  });

  it('suggests resolve-from or remote when package resolution fails', () => {
    const report = buildDoctorReport(
      {
        package: null,
        warnings: ["Não foi possível resolver 'missing-pkg'"],
        resolution: { target: 'missing-pkg', resolveFrom: '/repo', entrypointExists: false },
        symbols: [],
      },
      { target: 'missing-pkg' }
    );

    expect(report.status).toBe('issues');
    expect(report.suggestions).toContain(
      'Try --resolve-from pointing at the package workspace or project root.'
    );
    expect(report.suggestions).toContain('If the package is not installed locally, try --remote.');
  });

  it('normalizes workspace links before comparing runtime and type entrypoints', async () => {
    const report = await runDoctor({
      target: '@deplens/core',
      cwd: repoRoot,
      runtime: false,
      format: 'object',
    });

    expect(report.resolution.runtimePath.replace(/\\/g, '/')).toBe('src/index.mjs');
    expect(report.resolution.typesPath.replace(/\\/g, '/')).toBe('src/index.d.ts');
    expect(report.resolution.runtimeTypesDiverge).toBe(false);
    expect(report.suggestions).not.toContainEqual(expect.stringContaining('different files'));
  });
});
