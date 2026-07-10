import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { compareVersions } from '../src/diff-analyzer.mjs';

function writePackage(root, version, dts, js = '') {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      { name: 'demo-pkg', version, types: 'index.d.ts', type: 'module', main: 'index.js' },
      null,
      2
    )
  );
  writeFileSync(path.join(root, 'index.d.ts'), dts);
  writeFileSync(path.join(root, 'index.js'), js);
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

function writeAliasPackage(root, version, localName) {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'alias-pkg', version, types: 'index.d.ts' }, null, 2)
  );
  writeFileSync(path.join(root, 'index.d.ts'), `export { ${localName} as Bar } from './foo';\n`);
  writeFileSync(path.join(root, 'foo.d.ts'), `export interface ${localName} { id: string }\n`);
}

function writeCtsReexportPackage(root, version) {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'cts-pkg', version, types: 'index.d.cts' }, null, 2)
  );
  writeFileSync(path.join(root, 'index.d.cts'), "export * from './foo.cjs';\n");
  writeFileSync(path.join(root, 'foo.d.cts'), 'export interface CjsType { id: string }\n');
}

function writeSubpathPackage(root, version, rootDts, subpathDts) {
  mkdirSync(path.join(root, 'subpath'), { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'subpath-pkg',
      version,
      exports: {
        '.': { types: './index.d.ts' },
        './subpath': { types: './subpath/index.d.ts' },
      },
    })
  );
  writeFileSync(path.join(root, 'index.d.ts'), rootDts);
  writeFileSync(path.join(root, 'subpath', 'index.d.ts'), subpathDts);
}

describe('symbol diff', () => {
  it('diffs interfaces whose method names collide with Object.prototype', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-diff-prototype-names-'));
    try {
      const fromDir = path.join(root, 'from');
      const toDir = path.join(root, 'to');
      writePackage(
        fromDir,
        '1.0.0',
        'export interface Schema { constructor(input: string): string; toString(): string; }\n'
      );
      writePackage(
        toDir,
        '2.0.0',
        'export interface Schema { constructor(input: number): string; toString(): string; }\n'
      );

      const diff = await compareVersions(fromDir, toDir, { runtime: false });

      expect(diff.symbols.changes).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Schema', facet: 'types' })])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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
      expect(diff.additions).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'format' })])
      );
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

  it('normalizes object-shaped type alias entries in symbol diffs', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-diff-type-alias-'));
    try {
      const fromDir = path.join(root, 'from');
      const toDir = path.join(root, 'to');
      writePackage(fromDir, '1.0.0', 'export type Config = { apiKey: string };\n');
      writePackage(toDir, '1.1.0', 'export type Config = { apiKey: string; host?: string };\n');

      const diff = await compareVersions(fromDir, toDir);

      expect(diff.symbols.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'definition_changed',
            name: 'Config',
            facet: 'types',
          }),
        ])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('applies filter to top-level changes and symbol changes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-diff-filter-'));
    try {
      const fromDir = path.join(root, 'from');
      const toDir = path.join(root, 'to');
      writePackage(
        fromDir,
        '1.0.0',
        `
export function parse(input: string): string;
export function format(value: string): string;
export interface Options { strict: boolean }
`
      );
      writePackage(
        toDir,
        '1.1.0',
        `
export function parse(input: string, fallback?: string): number;
export function format(value: string): string;
export interface Options { strict: boolean; mode?: string }
`
      );

      const diff = await compareVersions(fromDir, toDir, { filter: 'parse' });

      const changedNames = [
        ...diff.breaking,
        ...diff.warnings,
        ...diff.additions,
        ...diff.info,
        ...diff.symbols.changes,
      ].map((change) => change.name);
      expect(changedNames.length).toBeGreaterThan(0);
      expect(changedNames.every((name) => name === 'parse')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('populates source comparison when includeSource is enabled', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-diff-source-'));
    try {
      const fromDir = path.join(root, 'from');
      const toDir = path.join(root, 'to');
      writePackage(
        fromDir,
        '1.0.0',
        'export function parse(input: string): string;\n',
        'export function parse(input) { return input; }\n'
      );
      writePackage(
        toDir,
        '1.1.0',
        'export function parse(input: string): string;\n',
        'export function parse(input) { if (input) return input; return ""; }\n'
      );

      const diff = await compareVersions(fromDir, toDir, { includeSource: true });

      expect(diff.sourceComparison).toBeDefined();
      expect(diff.sourceComparison.from.totalFunctions).toBeGreaterThan(0);
      expect(diff.sourceComparison.to.totalFunctions).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('diffs exported const function declarations from shared d.ts parsing', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-diff-const-fn-'));
    try {
      const fromDir = path.join(root, 'from');
      const toDir = path.join(root, 'to');
      writePackage(fromDir, '1.0.0', 'export const parse: (input: string) => string;\n');
      writePackage(toDir, '1.1.0', 'export const parse: (input: number) => string;\n');

      const diff = await compareVersions(fromDir, toDir);

      expect(diff.symbols.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'params_changed', name: 'parse', facet: 'types' }),
        ])
      );
      expect(diff.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'parse', type: 'param_type_changed' }),
        ])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips runtime imports when runtime analysis is disabled', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-diff-no-runtime-'));
    try {
      const fromDir = path.join(root, 'from');
      const toDir = path.join(root, 'to');
      const marker = path.join(root, 'executed.txt');
      const js = `import { writeFileSync } from 'fs';\nwriteFileSync(${JSON.stringify(marker)}, 'executed');\nexport const value = 1;\n`;
      writePackage(fromDir, '1.0.0', 'export function parse(input: string): string;\n', js);
      writePackage(toDir, '1.1.0', 'export function parse(input: number): string;\n', js);

      const diff = await compareVersions(fromDir, toDir, { runtime: false });

      expect(diff.symbols.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'params_changed', name: 'parse', facet: 'types' }),
        ])
      );
      expect(() => readFileSync(marker, 'utf-8')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('diffs public aliases by exported name, not private local names', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-diff-alias-'));
    try {
      const fromDir = path.join(root, 'from');
      const toDir = path.join(root, 'to');
      writeAliasPackage(fromDir, '1.0.0', 'Foo');
      writeAliasPackage(toDir, '2.0.0', 'Baz');

      const diff = await compareVersions(fromDir, toDir, { runtime: false });

      expect(diff.symbols.fromCount).toBe(1);
      expect(diff.symbols.toCount).toBe(1);
      expect(diff.breaking).toHaveLength(0);
      expect(diff.additions).toHaveLength(0);
      expect(diff.symbols.changes).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('follows cts/mts declaration re-export targets in diffs', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-diff-cts-'));
    try {
      const fromDir = path.join(root, 'from');
      const toDir = path.join(root, 'to');
      writeCtsReexportPackage(fromDir, '1.0.0');
      writeCtsReexportPackage(toDir, '2.0.0');

      const diff = await compareVersions(fromDir, toDir, { runtime: false });

      expect(diff.symbols.fromCount).toBe(1);
      expect(diff.symbols.toCount).toBe(1);
      expect(diff.symbols.changes).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('compares every explicit public subpath', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-diff-subpaths-'));
    try {
      const fromDir = path.join(root, 'from');
      const toDir = path.join(root, 'to');
      writeSubpathPackage(
        fromDir,
        '1.0.0',
        'export function root(): void;\n',
        'export function removed(): void;\n'
      );
      writeSubpathPackage(
        toDir,
        '2.0.0',
        'export function root(): void;\n',
        'export function added(): void;\n'
      );

      const diff = await compareVersions(fromDir, toDir, { runtime: false });

      expect(diff.symbols.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'symbol_removed',
            name: 'removed',
            subpath: './subpath',
          }),
          expect.objectContaining({ kind: 'symbol_added', name: 'added', subpath: './subpath' }),
        ])
      );
      expect(diff.summary.breaking).toBe(1);
      expect(diff.summary.additions).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects breaking optionality, enum, and class member changes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-diff-member-shapes-'));
    try {
      const fromDir = path.join(root, 'from');
      const toDir = path.join(root, 'to');
      writePackage(
        fromDir,
        '1.0.0',
        'export function parse(value?: string): void;\nexport interface Config { value?: string }\nexport enum Mode { A, B }\nexport class Client { run(): void }\n'
      );
      writePackage(
        toDir,
        '2.0.0',
        'export function parse(value: string): void;\nexport interface Config { value: string }\nexport enum Mode { A }\nexport class Client {}\n'
      );

      const diff = await compareVersions(fromDir, toDir, { runtime: false });
      const changes = [...diff.breaking, ...diff.warnings, ...diff.symbols.changes];

      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'parse', severity: 'breaking' }),
          expect.objectContaining({ name: 'Config', severity: 'breaking' }),
          expect.objectContaining({ name: 'Mode', severity: 'breaking' }),
          expect.objectContaining({ name: 'Client', severity: 'breaking' }),
        ])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
