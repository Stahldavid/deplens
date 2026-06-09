import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { compareVersions } from '../src/diff-analyzer.mjs';

function writePackage(root, version, dts) {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'demo-pkg', version, types: 'index.d.ts' }, null, 2)
  );
  writeFileSync(path.join(root, 'index.d.ts'), dts);
}

function writeExportsTypesPackage(root, version, dts) {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'exports-types-pkg',
        version,
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
          },
        },
      },
      null,
      2
    )
  );
  mkdirSync(path.join(root, 'dist'), { recursive: true });
  writeFileSync(path.join(root, 'dist', 'index.d.ts'), dts);
  writeFileSync(path.join(root, 'dist', 'index.js'), 'export const runtimeValue = 1;\n');
}

describe('symbol diff', () => {
  it('compares package versions through canonical symbols', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-diff-symbols-'));
    try {
      const fromDir = path.join(root, 'from');
      const toDir = path.join(root, 'to');
      writePackage(
        fromDir,
        '1.0.0',
        `
export function parse(input: string): string;
export interface Options { strict: boolean }
`
      );
      writePackage(
        toDir,
        '1.1.0',
        `
export function parse(input: string, fallback?: string): number;
export function format(value: string): string;
export interface Options { strict: boolean }
`
      );

      const diff = await compareVersions(fromDir, toDir);

      expect(diff.symbols.fromCount).toBe(2);
      expect(diff.symbols.toCount).toBe(3);
      expect(diff.symbols.summary.additions).toBe(1);
      expect(diff.symbols.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'symbol_added', name: 'format' }),
          expect.objectContaining({ kind: 'params_changed', name: 'parse', facet: 'types' }),
          expect.objectContaining({ kind: 'return_changed', name: 'parse', facet: 'types' }),
        ])
      );
      expect(diff.additions).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'format' })]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses exports map type entries when building diff symbols', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-diff-exports-types-'));
    try {
      const fromDir = path.join(root, 'from');
      const toDir = path.join(root, 'to');
      writeExportsTypesPackage(fromDir, '1.0.0', 'export function oldName(): string;\n');
      writeExportsTypesPackage(
        toDir,
        '1.1.0',
        'export function oldName(): string;\nexport function newName(): string;\n'
      );

      const diff = await compareVersions(fromDir, toDir);

      expect(diff.symbols.fromCount).toBeGreaterThan(0);
      expect(diff.symbols.toCount).toBeGreaterThan(0);
      expect(diff.symbols.changes).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'symbol_added', name: 'newName' })])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
