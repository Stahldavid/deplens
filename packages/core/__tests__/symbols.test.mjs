import { describe, it, expect } from 'vitest';
import { buildSymbols, enrichSymbolsWithSource } from '../src/symbols.mjs';

describe('buildSymbols', () => {
  it('merges runtime and type facets without collapsing kind', () => {
    const symbols = buildSymbols({
      packageName: 'demo',
      subpath: null,
      runtimeNames: ['Thing'],
      categorized: { functions: ['Thing'], classes: [], objects: [], constants: [] },
      runtimePath: 'index.js',
      runtimeAvailable: true,
      typeInfo: {
        functions: {},
        interfaces: { Thing: ['id: string'] },
        types: {},
        classes: {},
        enums: {},
        namespaces: {},
        jsdoc: { Thing: { summary: 'A useful thing.', tags: { example: ['new Thing()'] } } },
      },
      typesPath: 'index.d.ts',
      typesSource: 'package',
    });

    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({
      name: 'Thing',
      exportName: 'Thing',
      package: 'demo',
      subpath: '.',
      availability: 'runtime+types+docs',
      runtime: { kind: 'function', path: 'index.js' },
      types: { kind: 'interface', path: 'index.d.ts', properties: ['id: string'] },
      docs: { source: 'jsdoc', summary: 'A useful thing.' },
    });
    expect(symbols[0].facets).toContain('runtime');
    expect(symbols[0].facets).toContain('types');
    expect(symbols[0].facets).toContain('docs');
  });

  it('keeps type-only symbols explicit', () => {
    const symbols = buildSymbols({
      packageName: 'demo',
      subpath: 'server',
      runtimeNames: [],
      typeInfo: {
        functions: {},
        interfaces: {},
        types: {},
        classes: { NextRequest: 'Request' },
        enums: {},
        namespaces: {},
      },
      typesPath: 'server.d.ts',
      typesSource: 'subpath',
      typesCondition: 'types',
    });

    expect(symbols).toEqual([
      expect.objectContaining({
        name: 'NextRequest',
        subpath: './server',
        facets: ['types'],
        availability: 'types-only',
        types: expect.objectContaining({
          kind: 'class',
          path: 'server.d.ts',
          source: 'subpath',
          condition: 'types',
          extends: 'Request',
        }),
      }),
    ]);
  });

  it('adds source facets without removing runtime/type facets', () => {
    const symbols = buildSymbols({
      packageName: 'demo',
      runtimeNames: ['parseThing'],
      categorized: { functions: ['parseThing'] },
      runtimePath: 'index.js',
      runtimeAvailable: true,
      typeInfo: {
        functions: { parseThing: { params: 'value: string', returnType: 'string' } },
      },
      typesPath: 'index.d.ts',
      typesSource: 'package',
    });

    const enriched = enrichSymbolsWithSource(symbols, {
      files: [
        {
          path: 'src/index.ts',
          functions: {
            parseThing: {
              exported: true,
              async: false,
              params: [{ name: 'value', type: 'string', optional: false }],
              returnType: 'string',
              complexity: 1,
              lines: 3,
              dependencies: ['zod'],
              patterns: ['parse'],
            },
          },
        },
      ],
    });

    expect(enriched[0]).toMatchObject({
      exportName: 'parseThing',
      facets: ['runtime', 'types', 'source'],
      availability: 'runtime+types+source',
      source: {
        path: 'src/index.ts',
        kind: 'function',
        exported: true,
        complexity: 1,
      },
    });
  });
});
