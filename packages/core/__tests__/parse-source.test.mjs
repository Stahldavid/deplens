import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findSourceFiles, parseSourceFile } from '../src/parse-source.mjs';

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

describe('parseSourceFile', () => {
  it('detects default and CommonJS exported functions', () => {
    const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deplens-source-cjs-'));
    const filePath = path.join(pkgDir, 'index.js');
    fs.writeFileSync(
      filePath,
      [
        'export default function createClient(url) { return { url }; }',
        'exports.parse = function parse(input) { return input; };',
        'module.exports.format = (value) => String(value);',
        'module.exports = {',
        '  validate(value) { return Boolean(value); }',
        '};',
      ].join('\n')
    );

    const result = parseSourceFile(filePath, { includeBody: false });

    expect(result.functions.default.exported).toBe(true);
    expect(result.functions.parse.exported).toBe(true);
    expect(result.functions.format.exported).toBe(true);
    expect(result.functions.validate.exported).toBe(true);

    fs.rmSync(pkgDir, { recursive: true, force: true });
  });
});
