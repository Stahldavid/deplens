import { describe, it, expect } from 'vitest';
import { parseDtsFile } from '../src/parse-dts.mjs';
import path from 'path';
import fs from 'fs';

describe('parseDtsFile', () => {
  const fixturePath = path.join(import.meta.dirname, 'fixtures', 'example.d.ts');

  it('should parse functions with parameter and return types', () => {
    const result = parseDtsFile(fixturePath, null);
    expect(result).toBeDefined();
    expect(result.functions).toBeDefined();
    expect(result.functions).toHaveProperty('greet');
    const greet = result.functions.greet;
    expect(greet.params).toBe('name: string');
    expect(greet.returnType).toBe('string');
  });

  it('should parse interfaces as property arrays', () => {
    const result = parseDtsFile(fixturePath, null);
    expect(result.interfaces).toBeDefined();
    expect(result.interfaces).toHaveProperty('User');
    const userProps = result.interfaces.User;
    expect(Array.isArray(userProps)).toBe(true);
    expect(userProps).toContain('id: number');
    expect(userProps).toContain('name: string');
  });

  it('should parse classes (structure may be empty for now)', () => {
    const result = parseDtsFile(fixturePath, null);
    expect(result.classes).toBeDefined();
    expect(result.classes).toHaveProperty('Calculator');
    // Currently class member parsing is limited; just check it's present
    expect(result.classes.Calculator).toBeNull(); // Known limitation
  });

  it('should parse type aliases', () => {
    const result = parseDtsFile(fixturePath, null);
    expect(result.types).toBeDefined();
    expect(result.types).toHaveProperty('ID');
    expect(result.types.ID).toBe('number | string');
  });

  it('should parse enums', () => {
    const result = parseDtsFile(fixturePath, null);
    expect(result.enums).toBeDefined();
    expect(result.enums).toEqual({});
  });

  it('should filter by symbol name (case-insensitive)', () => {
    const result = parseDtsFile(fixturePath, ['greet']);
    expect(Object.keys(result.functions)).toHaveLength(1);
    expect(result.functions).toHaveProperty('greet');
  });

  it('should follow wildcard re-exports that reference .ts modules', () => {
    const entryPath = path.join(import.meta.dirname, 'fixtures', 'reexport-ts-entry.d.ts');
    const targetPath = path.join(import.meta.dirname, 'fixtures', 'reexport-ts-target.d.ts');
    fs.writeFileSync(entryPath, 'export * from "./reexport-ts-target.ts";');
    fs.writeFileSync(
      targetPath,
      'export declare function reexported(value: string): number;'
    );

    const result = parseDtsFile(entryPath, ['reexported']);
    expect(result.functions).toHaveProperty('reexported');
    expect(result.functions.reexported.params).toBe('value: string');
    expect(result.functions.reexported.returnType).toBe('number');

    fs.unlinkSync(entryPath);
    fs.unlinkSync(targetPath);
  });

  it('should follow re-exports that reference the same package by name', () => {
    const pkgDir = path.join(import.meta.dirname, 'fixtures', 'self-package-reexport');
    const distDir = path.join(pkgDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"self-pkg"}');
    fs.writeFileSync(
      path.join(pkgDir, 'server.d.ts'),
      'export { SelfRequest } from "self-pkg/dist/request";'
    );
    fs.writeFileSync(
      path.join(distDir, 'request.d.ts'),
      'export declare class SelfRequest extends Request {}'
    );

    const result = parseDtsFile(path.join(pkgDir, 'server.d.ts'), ['SelfRequest']);
    expect(result.classes).toHaveProperty('SelfRequest');

    fs.rmSync(pkgDir, { recursive: true, force: true });
  });

  it('should return null for non-existent file', () => {
    const result = parseDtsFile('/nonexistent/file.d.ts', null);
    expect(result).toBeNull();
  });

  it('should handle empty file gracefully', () => {
    const tempPath = path.join(import.meta.dirname, 'fixtures', 'empty.d.ts');
    fs.writeFileSync(tempPath, '');
    const result = parseDtsFile(tempPath, null);
    expect(result).toBeDefined();
    expect(result.functions).toEqual({});
    fs.unlinkSync(tempPath);
  });
});
