import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { runInspect } from '../src/index.mjs';

describe('runtime loading controls', () => {
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
      expect(result.warnings).toContain('Runtime export loading skipped by runtime=false/--no-runtime.');

      expect(() => readFileSync(marker, 'utf-8')).toThrow();
    } finally {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Windows can briefly hold module-resolution directories during tests.
      }
    }
  });
});
