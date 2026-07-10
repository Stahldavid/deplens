import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseDtsFile } from '../src/parse-dts.mjs';

function generatedDeclaration(index) {
  const name = `Generated${index}`;
  const type = index % 3 === 0 ? 'string' : index % 3 === 1 ? 'number' : 'boolean';
  return [
    `export interface ${name} { value${index}?: ${type}; run${index}(input: ${type}): Promise<${type}>; }`,
    `export declare function function${index}(input: ${name}): ${type};`,
    `export type Alias${index} = ${name} | null;`,
  ].join('\n');
}

describe('declaration parser robustness corpus', () => {
  it('parses a wide deterministic declaration surface without truncation or key collisions', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-parser-corpus-'));
    const declarationPath = path.join(root, 'index.d.ts');
    try {
      writeFileSync(
        declarationPath,
        [
          'export interface HostileNames { constructor(): string; toString(): string; __proto__(): string; }',
          ...Array.from({ length: 120 }, (_, index) => generatedDeclaration(index)),
        ].join('\n')
      );

      const result = parseDtsFile(declarationPath, null);

      expect(Object.keys(result.interfaces)).toHaveLength(121);
      expect(Object.keys(result.functions)).toHaveLength(120);
      expect(Object.keys(result.types)).toHaveLength(120);
      expect(result.interfaceDetails.HostileNames.methods.constructor).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
