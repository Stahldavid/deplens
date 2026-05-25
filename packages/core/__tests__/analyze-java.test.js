import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { analyzeJavaPackage, analyzeJavaFile } from '../src/analyze-java.mjs';

describe('analyzeJavaPackage', () => {
  const fixturesDir = path.join(process.cwd(), '__tests__', 'fixtures', 'java_pkg');

  it('should analyze Java package files', () => {
    const result = analyzeJavaPackage(fixturesDir, { maxFiles: 10 });
    expect(result.error).toBeUndefined();
    expect(result.files.length).toBeGreaterThan(0);

    const serviceFile = result.files.find((file) => file.path.endsWith('CalculatorService.java'));
    expect(serviceFile).toBeDefined();
    expect(serviceFile.packageName).toBe('com.example.demo');
    expect(serviceFile.imports.map((imp) => imp.path)).toContain('java.util.List');
  });

  it('should detect classes, constructors, and methods', () => {
    const result = analyzeJavaPackage(fixturesDir, { maxFiles: 10 });
    const serviceFile = result.files.find((file) => file.path.endsWith('CalculatorService.java'));
    expect(serviceFile.classes).toHaveLength(1);
    expect(serviceFile.classes[0].name).toBe('CalculatorService');
    expect(serviceFile.classes[0].constructors.map((fn) => fn.name)).toContain('CalculatorService');
    expect(serviceFile.classes[0].methods.map((fn) => fn.name)).toContain('add');
    expect(serviceFile.classes[0].methods.map((fn) => fn.name)).toContain('run');
  });

  it('should detect interfaces and enums', () => {
    const result = analyzeJavaPackage(fixturesDir, { maxFiles: 10 });
    const typesFile = result.files.find((file) => file.path.endsWith('MessagingTypes.java'));
    expect(typesFile.interfaces).toHaveLength(1);
    expect(typesFile.interfaces[0].name).toBe('MessageBus');
    expect(typesFile.interfaces[0].methods.map((fn) => fn.name)).toContain('publish');
    expect(typesFile.enums).toHaveLength(1);
    expect(typesFile.enums[0].name).toBe('Status');
    expect(typesFile.enums[0].constants).toEqual(['READY', 'FAILED']);
  });

  it('should compute summary metrics', () => {
    const result = analyzeJavaPackage(fixturesDir, { maxFiles: 10 });
    expect(result.summary.totalFunctions).toBeGreaterThan(0);
    expect(result.summary.totalClasses).toBeGreaterThan(0);
    expect(result.summary.avgComplexity).toBeGreaterThanOrEqual(1);
  });

  it('should respect maxFiles limit', () => {
    const result = analyzeJavaPackage(fixturesDir, { maxFiles: 1 });
    expect(result.files.length).toBeLessThanOrEqual(1);
  });

  it('should return error when no Java files are found', () => {
    const emptyDir = path.join(fixturesDir, 'empty_none');
    fs.mkdirSync(emptyDir, { recursive: true });
    const result = analyzeJavaPackage(emptyDir);
    expect(result.error).toBe('No Java files found');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});

describe('analyzeJavaFile', () => {
  const fixturesDir = path.join(process.cwd(), '__tests__', 'fixtures', 'java_samples');

  it('should parse class methods and parameters', () => {
    const code = fs.readFileSync(path.join(fixturesDir, 'class_simple.java'), 'utf-8');
    const result = analyzeJavaFile(code, {});
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe('Service');
    expect(result.functions.map((fn) => fn.name)).toContain('calculate');
    const calculate = result.functions.find((fn) => fn.name === 'calculate');
    expect(calculate.params.map((param) => param.name)).toEqual(['left', 'right']);
    expect(calculate.returnType).toBe('int');
  });

  it('should parse interfaces and enums', () => {
    const code = fs.readFileSync(path.join(fixturesDir, 'interface_enum.java'), 'utf-8');
    const result = analyzeJavaFile(code, {});
    expect(result.interfaces).toHaveLength(1);
    expect(result.enums).toHaveLength(1);
    expect(result.enums[0].methods.map((fn) => fn.name)).toContain('isTerminal');
  });

  it('should handle syntax errors gracefully', () => {
    const code = fs.readFileSync(path.join(fixturesDir, 'malformed.java'), 'utf-8');
    const result = analyzeJavaFile(code, {});
    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
    expect(result.error).toBeDefined();
  });

  it('should filter methods by name', () => {
    const code = fs.readFileSync(path.join(fixturesDir, 'filter_test.java'), 'utf-8');
    const result = analyzeJavaFile(code, { filter: 'bet' });
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe('beta');
  });

  it('should include body snippets when requested', () => {
    const code = fs.readFileSync(path.join(fixturesDir, 'body_test.java'), 'utf-8');
    const result = analyzeJavaFile(code, { includeBody: true });
    expect(result.functions[0].body).toBeDefined();
    expect(result.functions[0].body).toContain('return 42;');
  });

  it('should omit body snippets by default', () => {
    const code = fs.readFileSync(path.join(fixturesDir, 'body_test.java'), 'utf-8');
    const result = analyzeJavaFile(code, {});
    expect(result.functions[0].body).toBeNull();
  });
});
