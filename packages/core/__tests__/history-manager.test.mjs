import { describe, expect, it } from 'vitest';
import { compareHistoryEntries } from '../src/history-manager.mjs';

describe('compareHistoryEntries', () => {
  it('compares current symbol-shaped history entries', () => {
    const before = {
      package: 'demo',
      version: '1.0.0',
      symbols: [
        { exportName: 'parse', runtime: { kind: 'function' }, types: { kind: 'function' } },
        { exportName: 'Config', types: { kind: 'interface' } },
      ],
      exports: {
        total: 1,
        functions: ['parse'],
        classes: [],
        objects: [],
        constants: [],
      },
    };
    const after = {
      package: 'demo',
      version: '1.1.0',
      symbols: [
        { exportName: 'parse', runtime: { kind: 'function' }, types: { kind: 'function' } },
        { exportName: 'format', runtime: { kind: 'function' }, types: { kind: 'function' } },
      ],
      exports: {
        total: 2,
        functions: ['parse', 'format'],
        classes: [],
        objects: [],
        constants: [],
      },
    };

    const diff = compareHistoryEntries(before, after);

    expect(diff.exports).toEqual({ added: 1, removed: 0, changed: 0 });
    expect(diff.symbols).toEqual({ added: 1, removed: 1, changed: 0 });
    expect(diff.summary).toContain('+1 exports');
    expect(diff.summary).toContain('-1 symbol removals');
  });
});
