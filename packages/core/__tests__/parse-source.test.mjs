import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findSourceFiles } from '../src/parse-source.mjs';

describe('findSourceFiles', () => {
  it('prioritizes implementation files over barrel entrypoints', () => {
    const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deplens-source-rank-'));
    const write = (rel, body = '') => {
      const full = path.join(pkgDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
      return full;
    };

    write('index.js', 'export * from "./src/index.js";');
    write('src/index.ts', 'export * from "./helpers/parseUtil.js";');
    const parseUtil = write('src/helpers/parseUtil.ts', 'export function parseValue() {}');
    const errorUtil = write('src/helpers/errorUtil.ts', 'export function formatError() {}');
    write('src/locales/index.ts', 'export const locale = {};');

    const files = findSourceFiles(pkgDir, { maxFiles: 2 });
    expect(files).toEqual([errorUtil, parseUtil]);

    fs.rmSync(pkgDir, { recursive: true, force: true });
  });
});
