import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { analyzeSemanticCompatibility } from '../src/semantic-compatibility.mjs';

function writePackage(root, version, declaration) {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'semantic-demo', version, types: 'index.d.ts' })
  );
  writeFileSync(path.join(root, 'index.d.ts'), declaration);
}

function writeBrandedDependency(packageRoot) {
  const dependencyRoot = path.join(packageRoot, 'node_modules', 'branded-dependency');
  mkdirSync(dependencyRoot, { recursive: true });
  writeFileSync(
    path.join(dependencyRoot, 'package.json'),
    JSON.stringify({ name: 'branded-dependency', version: '1.0.0', types: 'index.d.ts' })
  );
  writeFileSync(
    path.join(dependencyRoot, 'index.d.ts'),
    'declare const brand: unique symbol;\nexport interface Branded { readonly [brand]: true }\n'
  );
}

describe('semantic compatibility', () => {
  it('detects when the new module is not assignable to the old API', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-semantic-'));
    try {
      const before = path.join(root, 'before');
      const after = path.join(root, 'after');
      writePackage(before, '1.0.0', 'export function parse(input: string): string;\n');
      writePackage(after, '2.0.0', 'export function parse(input: number): string;\n');

      const result = analyzeSemanticCompatibility(before, after);

      expect(result.compatible).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts additive APIs and optional parameters', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-semantic-'));
    try {
      const before = path.join(root, 'before');
      const after = path.join(root, 'after');
      writePackage(before, '1.0.0', 'export function parse(input: string): string;\n');
      writePackage(
        after,
        '1.1.0',
        'export function parse(input: string, fallback?: string): string;\nexport const added: boolean;\n'
      );

      expect(analyzeSemanticCompatibility(before, after).compatible).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('separates isolated unique-symbol and private-class identity noise', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-semantic-nominal-'));
    try {
      const before = path.join(root, 'before');
      const after = path.join(root, 'after');
      const declaration = [
        "import type { Branded } from 'branded-dependency';",
        'export declare const branded: Branded;',
        'export declare class Client { private config; }',
      ].join('\n');
      writePackage(before, '1.0.0', declaration);
      writePackage(after, '1.0.1', declaration);
      writeBrandedDependency(before);
      writeBrandedDependency(after);

      const result = analyzeSemanticCompatibility(before, after);

      expect(result.compatible).toBe(true);
      expect(result.diagnostics).toEqual([]);
      expect(result.ignoredDiagnosticCount).toBeGreaterThan(0);
      expect(result.ignoredDiagnostics[0]).toMatchObject({
        reason: 'isolated-nominal-identity',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
