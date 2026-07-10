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
    expect(projected).not.toHaveProperty('docs');
  });
});
