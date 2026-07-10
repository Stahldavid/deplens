import { describe, expect, it } from 'vitest';
import { projectInspectResult } from '../src/output-projector.mjs';

describe('inspect output projection', () => {
  const payload = {
    schemaVersion: 1,
    package: 'demo',
    version: '1.0.0',
    symbols: [
      { exportName: 'a', facets: ['types'], types: { signature: 'a(): void' } },
      { exportName: 'b', facets: ['types'], types: { signature: 'b(): void' } },
      { exportName: 'c', facets: ['types'], types: { signature: 'c(): void' } },
    ],
    types: { very: 'large' },
    docs: { content: 'large readme' },
    sections: [{ title: 'Usage' }],
    examples: { ranked: [{ code: 'a()' }] },
    staticExports: { total: 3, names: ['a', 'b', 'c'] },
    exports: { total: 3, functions: ['a', 'b', 'c'], classes: [], objects: [], constants: [] },
    meta: { target: 'demo' },
    warnings: [],
  };

  it('returns a compact, cursor-paginated representation', () => {
    const projected = projectInspectResult(payload, { detail: 'compact', maxSymbols: 2 });

    expect(projected.schemaVersion).toBe(2);
    expect(projected.detailLevel).toBe('compact');
    expect(projected.symbols).toHaveLength(2);
    expect(projected.pagination).toMatchObject({ total: 3, returned: 2, nextCursor: '2' });
    expect(projected).not.toHaveProperty('types');
    expect(projected).not.toHaveProperty('docs');
    expect(projected.staticExports).toEqual({ total: 3 });
  });

  it('keeps rich sections explicitly requested in compact mode', () => {
    const projected = projectInspectResult(payload, {
      detail: 'compact',
      select: ['types', 'docs', 'sections', 'examples', 'symbols'],
      maxSymbols: 1,
    });

    expect(projected.types).toEqual(payload.types);
    expect(projected.docs).toEqual(payload.docs);
    expect(projected.sections).toEqual(payload.sections);
    expect(projected.examples).toEqual(payload.examples);
    expect(projected.symbols).toHaveLength(1);
  });

  it('does not repeat full export inventories after the first symbol page', () => {
    const first = projectInspectResult(payload, { detail: 'compact', maxSymbols: 1 });
    const next = projectInspectResult(payload, {
      detail: 'compact',
      maxSymbols: 1,
      cursor: '1',
    });

    expect(first.exports).toEqual(payload.exports);
    expect(first.staticExports).toEqual({ total: 3 });
    expect(next).not.toHaveProperty('exports');
    expect(next).not.toHaveProperty('staticExports');
    expect(next.pagination).toMatchObject({ offset: 1, returned: 1, nextCursor: '2' });
  });

  it('omits inventories for focused documentation requests', () => {
    const projected = projectInspectResult(payload, {
      detail: 'compact',
      include: ['sections'],
      focused: true,
    });

    expect(projected.sections).toEqual(payload.sections);
    expect(projected).not.toHaveProperty('symbols');
    expect(projected).not.toHaveProperty('pagination');
    expect(projected).not.toHaveProperty('exports');
    expect(projected).not.toHaveProperty('staticExports');
  });

  it('honors explicit symbol selection for focused requests', () => {
    const projected = projectInspectResult(payload, {
      detail: 'compact',
      include: ['sourceAnalysis'],
      select: ['sourceAnalysis', 'symbols'],
      focused: true,
      maxSymbols: 1,
    });

    expect(projected.symbols).toHaveLength(1);
    expect(projected.pagination).toMatchObject({ total: 3, returned: 1 });
  });

  it('keeps only a source summary in compact output', () => {
    const projected = projectInspectResult(
      {
        ...payload,
        sourceAnalysis: {
          files: [{ path: 'src/index.ts', functions: [{ name: 'run' }] }],
          summary: { totalFiles: 1, totalFunctions: 1, avgComplexity: 2 },
        },
      },
      { detail: 'compact', include: ['sourceAnalysis'] }
    );

    expect(projected.sourceAnalysis).toEqual({
      files: 1,
      summary: { totalFiles: 1, totalFunctions: 1, avgComplexity: 2 },
    });
  });

  it('selects sections and resumes from a cursor', () => {
    const projected = projectInspectResult(payload, {
      detail: 'full',
      select: ['symbols', 'types'],
      maxSymbols: 2,
      cursor: '2',
    });

    expect(projected.symbols.map((symbol) => symbol.exportName)).toEqual(['c']);
    expect(projected.types).toEqual(payload.types);
    expect(projected.package).toBe('demo');
    expect(projected.meta).toEqual(payload.meta);
    expect(projected.warnings).toEqual([]);
    expect(projected).not.toHaveProperty('docs');
  });

  it('never hides structured errors behind an explicit selection', () => {
    const projected = projectInspectResult(
      { ...payload, error: 'resolution failed', errorInfo: { code: 'RESOLVE_FAILED' } },
      { detail: 'compact', select: ['symbols'] }
    );

    expect(projected).toMatchObject({
      package: 'demo',
      error: 'resolution failed',
      errorInfo: { code: 'RESOLVE_FAILED' },
    });
  });
});
