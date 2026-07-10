import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { runInspect } from '../src/index.mjs';

describe('runtime loading controls', () => {
  it('returns JSDoc-only output in text and structured modes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-jsdoc-only-'));
    try {
      const pkgDir = path.join(root, 'node_modules', 'documented-pkg');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({
          name: 'documented-pkg',
          version: '1.0.0',
          main: 'index.js',
          types: 'index.d.ts',
        })
      );
      writeFileSync(path.join(pkgDir, 'index.js'), 'exports.generateText = () => "ok";\n');
      writeFileSync(
        path.join(pkgDir, 'index.d.ts'),
        '/** Generate text from a prompt.\n * @param prompt User input.\n * @returns Generated text.\n */\nexport function generateText(prompt: string): Promise<string>;\n'
      );

      const options = {
        target: 'documented-pkg',
        cwd: root,
        filter: 'generateText',
        jsdoc: 'full',
        jsdocOutput: 'only',
        jsdocQuery: { symbols: 'generateText' },
        runtime: false,
      };
      const structured = await runInspect({
        ...options,
        format: 'object',
        detail: 'compact',
      });
      const text = await runInspect({ ...options, format: 'text' });

      expect(structured.jsdoc).toMatchObject({
        mode: 'full',
        entries: [
          expect.objectContaining({
            name: 'generateText',
            summary: 'Generate text from a prompt.',
          }),
        ],
      });
      expect(structured.jsdoc.entries).toHaveLength(1);
      expect(structured.jsdoc.entries[0]).not.toHaveProperty('text');
      expect(structured).not.toHaveProperty('symbols');
      expect(structured).not.toHaveProperty('types');
      expect(structured).not.toHaveProperty('staticExports');
      expect(text).toContain('JSDoc:');
      expect(text).toContain('generateText: Generate text from a prompt.');
      expect(text).not.toContain('Exports Encontrados');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('marks package metadata fallback as non-importable for binary-only packages', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-bin-only-'));
    try {
      const pkgDir = path.join(root, 'node_modules', 'binary-pkg');
      mkdirSync(path.join(pkgDir, 'bin'), { recursive: true });
      writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'binary-pkg', version: '1.0.0', bin: 'bin/cli.js' })
      );
      writeFileSync(path.join(pkgDir, 'bin', 'cli.js'), '#!/usr/bin/env node\n');

      const result = await runInspect({
        target: 'binary-pkg',
        cwd: root,
        resolveFrom: pkgDir,
        format: 'object',
        detail: 'compact',
        runtime: false,
      });

      expect(result.resolution).toMatchObject({
        entrypointPath: null,
        entrypointExists: false,
        metadataOnly: true,
      });
      expect(result.warnings).toContainEqual(expect.stringContaining('no importable runtime'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('can inspect types without executing the package entrypoint', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-no-runtime-'));
    try {
      const pkgDir = path.join(root, 'node_modules', 'side-effect-pkg');
      const marker = path.join(root, 'executed.txt');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({
          name: 'side-effect-pkg',
          version: '1.0.0',
          type: 'module',
          main: 'index.js',
          types: 'index.d.ts',
        })
      );
      writeFileSync(
        path.join(pkgDir, 'index.js'),
        `import { writeFileSync } from 'fs';\nwriteFileSync(${JSON.stringify(marker)}, 'executed');\nexport const value = 1;\n`
      );
      writeFileSync(path.join(pkgDir, 'index.d.ts'), 'export function typed(): string;\n');

      const result = await runInspect({
        target: 'side-effect-pkg',
        cwd: root,
        format: 'object',
        showTypes: true,
        runtime: false,
      });

      expect(result.exports.total).toBe(0);
      expect(result.types.functions).toHaveProperty('typed');
      expect(result.warnings).not.toContainEqual(expect.stringContaining('runtime'));
      expect(result.meta).toMatchObject({
        runtime: false,
        runtimeSkipped: true,
        runtimeSkipReason: 'disabled',
      });

      expect(() => readFileSync(marker, 'utf-8')).toThrow();
    } finally {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Windows can briefly hold module-resolution directories during tests.
      }
    }
  });

  it('resolves extensionless subpath export targets to existing runtime files', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-subpath-runtime-'));
    try {
      const pkgDir = path.join(root, 'node_modules', 'subpath-pkg');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({
          name: 'subpath-pkg',
          version: '1.0.0',
          type: 'module',
          exports: { './server': './server' },
        })
      );
      writeFileSync(path.join(pkgDir, 'server.js'), 'export const serve = () => true;\n');
      writeFileSync(path.join(pkgDir, 'server.d.ts'), 'export function serve(): boolean;\n');

      const result = await runInspect({
        target: 'subpath-pkg/server',
        cwd: root,
        format: 'object',
        runtime: false,
      });

      expect(result.resolution.entrypointExists).toBe(true);
      expect(result.resolution.entrypointPath).toBe(path.join(pkgDir, 'server.js'));
      expect(result.resolution.typesPath).toBe('server.d.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
