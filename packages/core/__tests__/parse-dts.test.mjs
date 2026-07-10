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

  it('should preserve class constructors, methods, and properties', () => {
    const result = parseDtsFile(fixturePath, null);
    expect(result.classes).toBeDefined();
    expect(result.classes).toHaveProperty('Calculator');
    expect(result.classes.Calculator).toEqual(
      expect.objectContaining({
        methods: expect.any(Object),
        properties: expect.any(Object),
        constructors: expect.any(Array),
      })
    );
  });

  it('should treat prototype-like member names as ordinary API names', () => {
    const tempPath = path.join(import.meta.dirname, 'fixtures', 'prototype-member-names.d.ts');
    fs.writeFileSync(
      tempPath,
      [
        'export interface PrototypeNames {',
        '  constructor(input: string): string;',
        '  toString(): string;',
        '  __proto__(): boolean;',
        '}',
      ].join('\n')
    );

    try {
      const result = parseDtsFile(tempPath, null);
      const methods = result.interfaceDetails.PrototypeNames.methods;

      expect(methods.constructor).toHaveLength(1);
      expect(methods.toString).toHaveLength(1);
      expect(methods.__proto__).toHaveLength(1);
    } finally {
      fs.unlinkSync(tempPath);
    }
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
    fs.writeFileSync(targetPath, 'export declare function reexported(value: string): number;');

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

  it('should preserve exported aliases when following named re-exports', () => {
    const pkgDir = path.join(import.meta.dirname, 'fixtures', 'alias-reexport');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), 'export { Foo as Bar } from "./foo";');
    fs.writeFileSync(path.join(pkgDir, 'foo.d.ts'), 'export interface Foo { ok: boolean }');

    const result = parseDtsFile(path.join(pkgDir, 'index.d.ts'), ['Bar']);

    expect(result.interfaces).toHaveProperty('Bar');
    expect(result.interfaces.Bar).toContain('ok: boolean');
    expect(result.interfaces).not.toHaveProperty('Foo');

    fs.rmSync(pkgDir, { recursive: true, force: true });
  });

  it('should keep full structured interface and enum data', () => {
    const tempPath = path.join(import.meta.dirname, 'fixtures', 'wide-types.d.ts');
    fs.writeFileSync(
      tempPath,
      [
        'export interface Big {',
        '  a: string;',
        '  b: string;',
        '  c: string;',
        '  d: string;',
        '  e: string;',
        '  f: string;',
        '}',
        'export enum Many { A, B, C, D, E, F }',
      ].join('\n')
    );

    const result = parseDtsFile(tempPath, null);

    expect(result.interfaces.Big).toContain('f: string');
    expect(result.enums.Many).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);

    fs.unlinkSync(tempPath);
  });

  it('should expose named default declarations as the default export', () => {
    const tempPath = path.join(import.meta.dirname, 'fixtures', 'default-export.d.ts');
    fs.writeFileSync(
      tempPath,
      'export default function create(input: string): number;\nexport default class Client {}\n'
    );

    const result = parseDtsFile(tempPath, null);

    expect(result.functions.default).toEqual(
      expect.objectContaining({ params: 'input: string', returnType: 'number' })
    );
    expect(result.functions.default.localName).toBe('create');
    expect(result.classes.default).toEqual(
      expect.objectContaining({ extends: null, localName: 'Client' })
    );

    fs.unlinkSync(tempPath);
  });

  it('should match named default declarations by local name filters', () => {
    const tempPath = path.join(import.meta.dirname, 'fixtures', 'default-export-filter.d.ts');
    fs.writeFileSync(
      tempPath,
      'export default function createClient(url: string): Client;\nexport interface Client { id: string }\n'
    );

    const result = parseDtsFile(tempPath, ['createClient']);

    expect(result.functions.default).toEqual(
      expect.objectContaining({
        params: 'url: string',
        returnType: 'Client',
        localName: 'createClient',
      })
    );

    fs.unlinkSync(tempPath);
  });

  it('should not truncate structured type data', () => {
    const tempPath = path.join(import.meta.dirname, 'fixtures', 'long-types.d.ts');
    fs.writeFileSync(
      tempPath,
      [
        'export interface Big {',
        '  alpha: { aReallyLongPropertyName: string; anotherLongPropertyName: number; nested: { flag: boolean } };',
        '  run(input: { nestedValue: string; anotherNestedValue: number }): Promise<{ ok: true; value: string }>',
        '}',
        'export function many(one: string, two: number, three: boolean, four: Date, five: RegExp): Promise<{ ok: true; value: string }>;',
        'export type LongAlias = { aReallyLongPropertyName: string; anotherLongPropertyName: number; nested: { flag: boolean } };',
      ].join('\n')
    );

    const result = parseDtsFile(tempPath, null);

    expect(result.interfaces.Big).toContain(
      'alpha: { aReallyLongPropertyName: string; anotherLongPropertyName: number; nested: { flag: boolean } }'
    );
    expect(result.interfaces.Big).toContain(
      'run(input: { nestedValue: string; anotherNestedValue: number }): Promise<{ ok: true; value: string }>'
    );
    expect(result.functions.many.returnType).toBe('Promise<{ ok: true; value: string }>');
    expect(result.types.LongAlias).toBe(
      '{ aReallyLongPropertyName: string; anotherLongPropertyName: number; nested: { flag: boolean } }'
    );

    fs.unlinkSync(tempPath);
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

  it('should expose only public exports, follow barrels, and preserve overloads', () => {
    const pkgDir = path.join(import.meta.dirname, 'fixtures', 'semantic-exports');
    fs.mkdirSync(pkgDir, { recursive: true });
    try {
      fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), 'export * from "./api";\n');
      fs.writeFileSync(
        path.join(pkgDir, 'api.d.ts'),
        [
          'declare function hidden(value: boolean): void;',
          'export function visible(value: string): string;',
          'export function overloaded(value: string): string;',
          'export function overloaded(value: number): number;',
        ].join('\n')
      );

      const result = parseDtsFile(path.join(pkgDir, 'index.d.ts'), null);

      expect(result.functions).toHaveProperty('visible');
      expect(result.functions).toHaveProperty('overloaded');
      expect(result.functions).not.toHaveProperty('hidden');
      expect(result.functions.overloaded.overloads).toHaveLength(2);
    } finally {
      fs.rmSync(pkgDir, { recursive: true, force: true });
    }
  });
});
