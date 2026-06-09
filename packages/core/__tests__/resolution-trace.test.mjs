import { describe, it, expect } from 'vitest';
import { buildResolutionTrace } from '../src/resolution-trace.mjs';

describe('buildResolutionTrace', () => {
  it('records conditional export choices for import runtime and types', () => {
    const trace = buildResolutionTrace({
      pkg: {
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.mjs',
            require: './dist/index.cjs',
          },
        },
      },
      resolver: 'import-meta-resolve',
      runtimePath: 'dist/index.mjs',
      runtimeAvailable: true,
      typesPath: 'dist/index.d.ts',
      typesSource: 'exports',
    });

    expect(trace).toMatchObject({
      targetSubpath: '.',
      hasExportsMap: true,
      exportEntryFound: true,
      runtime: {
        conditionsTried: ['node', 'import', 'default'],
        conditionsMatched: ['import'],
        exportPath: './dist/index.mjs',
        resolvedPath: 'dist/index.mjs',
        available: true,
      },
      types: {
        source: 'exports',
        conditionsMatched: ['types'],
        exportPath: './dist/index.d.ts',
        resolvedPath: 'dist/index.d.ts',
      },
    });
  });

  it('records resolver fallback when no exports map is present', () => {
    const trace = buildResolutionTrace({
      pkg: {},
      subpath: 'server',
      resolver: 'import-meta-resolve',
      runtimePath: 'server',
      runtimeAvailable: false,
      typesPath: 'server.d.ts',
      typesSource: 'subpath',
    });

    expect(trace).toMatchObject({
      targetSubpath: './server',
      hasExportsMap: false,
      exportEntryFound: false,
      runtime: {
        source: 'resolver',
        conditionsMatched: [],
        resolvedPath: 'server',
        available: false,
      },
      types: {
        source: 'subpath',
        conditionsMatched: [],
        resolvedPath: 'server.d.ts',
      },
    });
  });
});
