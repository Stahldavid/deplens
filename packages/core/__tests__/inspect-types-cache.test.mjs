import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { getCachedDtsParse } from '../src/inspect-types.mjs';

describe('getCachedDtsParse', () => {
  it('invalidates cached parses when the declaration file changes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-dts-cache-'));
    try {
      const dtsPath = path.join(root, 'index.d.ts');
      writeFileSync(dtsPath, 'export function before(): string;\n');
      const first = await getCachedDtsParse(dtsPath);
      expect(first.functions).toHaveProperty('before');

      writeFileSync(dtsPath, 'export function after(): number;\n');
      const second = await getCachedDtsParse(dtsPath);
      expect(second.functions).not.toHaveProperty('before');
      expect(second.functions.after.returnType).toBe('number');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
