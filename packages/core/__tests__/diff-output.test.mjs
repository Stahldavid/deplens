import { describe, expect, it } from 'vitest';
import { serializeDiffForJson } from '../src/diff.mjs';

describe('compact diff JSON', () => {
  it('keeps one compact change list and exposes full symbols only in verbose mode', () => {
    const largeSymbol = {
      exportName: 'Client',
      subpath: '.',
      facets: ['types'],
      types: {
        kind: 'class',
        methods: Object.fromEntries(
          Array.from({ length: 100 }, (_, index) => [`method${index}`, { signature: '(): void' }])
        ),
      },
    };
    const diff = {
      from: { name: 'demo', version: '1.0.0' },
      to: { name: 'demo', version: '2.0.0' },
      breaking: [],
      warnings: [],
      additions: [],
      info: [],
      summary: { breaking: 1, warnings: 0, additions: 0, removals: 0 },
      symbols: {
        fromCount: 1,
        toCount: 1,
        summary: { breaking: 1, warnings: 0, additions: 0, removals: 0 },
        changes: [
          {
            kind: 'method_removed',
            facet: 'types',
            severity: 'breaking',
            identity: '.:Client',
            name: 'Client',
            subpath: '.',
            detail: "Method 'run' was removed",
            from: largeSymbol,
            to: largeSymbol,
          },
        ],
      },
    };

    const compact = serializeDiffForJson(diff, { packageName: 'demo' });
    const verbose = serializeDiffForJson(diff, { packageName: 'demo', verbose: true });

    expect(compact).toMatchObject({ schemaVersion: 2, detailLevel: 'compact', changeCount: 1 });
    expect(compact).not.toHaveProperty('breaking');
    expect(compact.symbols).not.toHaveProperty('changes');
    expect(compact.changes[0]).not.toHaveProperty('from');
    expect(JSON.stringify(compact).length).toBeLessThan(2000);
    expect(verbose).toMatchObject({ schemaVersion: 2, detailLevel: 'verbose' });
    expect(verbose.changes[0]).toHaveProperty('from.types.methods.method0');
  });

  it('paginates large change sets while preserving the total count', () => {
    const changes = Array.from({ length: 240 }, (_, index) => ({
      kind: 'symbol_removed',
      severity: 'breaking',
      name: `symbol${index}`,
      subpath: '.',
      detail: `symbol${index} was removed`,
    }));
    const diff = {
      from: { name: 'demo', version: '1.0.0' },
      to: { name: 'demo', version: '2.0.0' },
      summary: { breaking: 240, warnings: 0, additions: 0, removals: 240 },
      symbols: {
        fromCount: 240,
        toCount: 0,
        summary: { breaking: 240, warnings: 0, additions: 0, removals: 240 },
        changes,
      },
    };

    const first = serializeDiffForJson(diff, { packageName: 'demo', maxChanges: 50 });
    const second = serializeDiffForJson(diff, {
      packageName: 'demo',
      maxChanges: 50,
      cursor: '50',
    });

    expect(first.changeCount).toBe(240);
    expect(first.changes).toHaveLength(50);
    expect(first.pagination.nextCursor).toBe('50');
    expect(second.changes[0].name).toBe('symbol50');
  });

  it('exposes the diagnostics responsible for semantic incompatibility in compact output', () => {
    const diagnostics = Array.from({ length: 12 }, (_, index) => ({
      code: 2322,
      message: index === 0 ? `Type mismatch ${'x'.repeat(300)}` : `Type mismatch ${index}`,
      file: `check-${index}.ts`,
    }));
    const compact = serializeDiffForJson({
      from: { name: 'demo', version: '1.0.0' },
      to: { name: 'demo', version: '2.0.0' },
      summary: { semanticCompatible: false },
      semanticCompatibility: {
        checked: true,
        compatible: false,
        direction: 'from-to',
        diagnostics,
      },
    });

    expect(compact.semanticCompatibility).toMatchObject({
      compatible: false,
      diagnosticCount: 12,
      diagnosticsTruncated: true,
    });
    expect(compact.semanticCompatibility.diagnostics).toHaveLength(3);
    expect(compact.semanticCompatibility.diagnostics[0]).toMatchObject({
      code: 2322,
      messageTruncated: true,
    });
    expect(compact.semanticCompatibility.diagnostics[0]).not.toHaveProperty('file');
    const secondPage = serializeDiffForJson(
      {
        from: { name: 'demo', version: '1.0.0' },
        to: { name: 'demo', version: '2.0.0' },
        summary: { semanticCompatible: false },
        semanticCompatibility: {
          checked: true,
          compatible: false,
          direction: 'from-to',
          diagnostics,
        },
      },
      { cursor: '1' }
    );
    expect(secondPage.semanticCompatibility).toMatchObject({
      diagnosticCount: 12,
      diagnosticsOmitted: true,
    });
  });
});
