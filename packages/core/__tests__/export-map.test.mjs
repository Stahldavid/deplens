import { describe, expect, it } from 'vitest';
import { resolveExportTarget, resolveTypesVersionTarget } from '../src/export-map.mjs';

describe('export map resolution', () => {
  it('resolves explicit environment conditions in caller order', () => {
    const pkg = {
      exports: {
        '.': {
          browser: './browser.js',
          node: './node.js',
          default: './index.js',
        },
      },
    };

    expect(resolveExportTarget(pkg, { conditions: ['browser', 'default'] })).toEqual({
      path: './browser.js',
      conditions: ['browser'],
      subpath: '.',
    });
  });

  it('resolves typesVersions mappings for the active TypeScript range', () => {
    const pkg = {
      typesVersions: {
        '>=5.0': { '*': ['ts5/*'] },
        '*': { '*': ['legacy/*'] },
      },
    };

    expect(resolveTypesVersionTarget(pkg, 'helpers', '5.8.2')).toBe('ts5/helpers');
    expect(resolveTypesVersionTarget(pkg, 'helpers', '4.9.5')).toBe('legacy/helpers');
  });
});
