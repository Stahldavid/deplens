import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { runInspectCore } from '../src/inspect-core.mjs';

function writeDemoPackage(root) {
  const pkgDir = path.join(root, 'node_modules', 'demo-examples');
  mkdirSync(path.join(pkgDir, 'examples'), { recursive: true });
  writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({
      name: 'demo-examples',
      version: '1.0.0',
      main: 'index.js',
      types: 'index.d.ts',
    })
  );
  writeFileSync(
    path.join(pkgDir, 'index.js'),
    'exports.parseThing = function parseThing(value) { return String(value); };\n'
  );
  writeFileSync(
    path.join(pkgDir, 'index.d.ts'),
    `
/**
 * Parse a thing.
 * @example const value = parseThing("docs")
 */
export function parseThing(value: string): string;
export interface AlphaUnrelated { value: number }
`
  );
  writeFileSync(
    path.join(pkgDir, 'README.md'),
    `
# demo

\`\`\`ts
parseThing("readme")
\`\`\`

\`\`\`ts
formatThing("less relevant")
\`\`\`
`
  );
  writeFileSync(path.join(pkgDir, 'examples', 'parse.ts'), 'parseThing("file example");\n');
  return pkgDir;
}

describe('examples-for', () => {
  it('returns ranked examples without removing legacy example buckets', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-examples-for-'));
    try {
      writeDemoPackage(root);
      const result = await runInspectCore({
        target: 'demo-examples',
        resolveFrom: root,
        includeExamples: true,
        examplesFor: 'parseThing',
        showTypes: true,
        format: 'object',
        maxExamples: 3,
      });

      expect(result.examples.target).toBe('parseThing');
      expect(result.examples.ranked).toHaveLength(3);
      expect(result.examples.ranked[0].code).toContain('parseThing');
      expect(result.examples.ranked[0].score).toBeGreaterThan(0);
      expect(result.examples.readme.length).toBeGreaterThan(0);
      expect(result.examples.files.length).toBeGreaterThan(0);
      expect(result.examples.jsdoc).toEqual(expect.any(Array));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns README sections ranked for a symbol', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-docs-for-'));
    try {
      writeDemoPackage(root);
      const result = await runInspectCore({
        target: 'demo-examples',
        resolveFrom: root,
        includeDocs: true,
        docsFor: 'parseThing',
        format: 'object',
      });

      expect(result.docs.target).toBe('parseThing');
      expect(result.docs.rankedSections.length).toBeGreaterThan(0);
      expect(result.docs.rankedSections[0]).toMatchObject({
        title: 'demo',
        score: expect.any(Number),
      });
      expect(result.docs.rankedSections[0].content).toContain('parseThing');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ranks an exact camel-case symbol example above unrelated setup snippets', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-example-ranking-'));
    try {
      const pkgDir = writeDemoPackage(root);
      writeFileSync(
        path.join(pkgDir, 'README.md'),
        "# demo\n\n```bash\nnpm install demo-examples\n```\n\n```ts\nconst result = parseThing('value');\n```\n"
      );

      const result = await runInspectCore({
        target: 'demo-examples',
        resolveFrom: root,
        includeExamples: true,
        examplesFor: 'parseThing',
        format: 'object',
      });

      expect(result.examples.ranked[0].code).toContain('parseThing');
      expect(result.examples.ranked[0].score).toBeGreaterThan(result.examples.ranked.at(-1).score);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('applies semantic search to the symbols array and preserves ranking', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-symbol-search-'));
    try {
      writeDemoPackage(root);

      const result = await runInspectCore({
        target: 'demo-examples',
        resolveFrom: root,
        search: 'parse thing',
        format: 'object',
        runtime: false,
      });

      expect(result.symbols.map((symbol) => symbol.exportName)).toEqual(['parseThing']);
      expect(result.staticExports.names).toEqual(['parseThing']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
