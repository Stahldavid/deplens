// __tests__/analyze-python.test.js
import { describe, it, expect } from 'vitest';
import analyzer from '../src/analyze-python.mjs';
import path from 'path';
import fs from 'fs';

const { analyzePythonPackage, analyzePythonFile, resolvePythonPackage } = analyzer;

describe('analyzePythonPackage', () => {
  const fixturesDir = path.join(process.cwd(), '__tests__', 'fixtures');

  it('should analyze simple Python files', () => {
    const result = analyzePythonPackage(fixturesDir, { maxFiles: 10 });
    expect(result.error).toBeUndefined();
    expect(result.files.length).toBeGreaterThan(0);

    const simple = result.files.find(f => f.path.endsWith('py_simple.py'));
    expect(simple).toBeDefined();
    expect(simple.functions.map(fn => fn.name)).toContain('add');
    expect(simple.functions.map(fn => fn.name)).toContain('multiply');
  });

  it('should detect classes and methods', () => {
    const result = analyzePythonPackage(fixturesDir, { maxFiles: 10 });
    const simple = result.files.find(f => f.path.endsWith('py_simple.py'));
    expect(simple.classes).toHaveLength(1);
    expect(simple.classes[0].name).toBe('Calculator');
    expect(simple.classes[0].methods.map(m => m.name)).toContain('compute');
  });

  it('should find py_complex.py file (parser may skip complex constructs)', () => {
    const result = analyzePythonPackage(fixturesDir, { maxFiles: 10 });
    const complexFile = result.files.find(f => f.path.endsWith('py_complex.py'));
    expect(complexFile).toBeDefined();
  });

  it('should detect imports', () => {
    const result = analyzePythonPackage(fixturesDir, { maxFiles: 10 });
    const complexFile = result.files.find(f => f.path.endsWith('py_complex.py'));
    expect(complexFile.imports.length).toBeGreaterThan(0);
  });

  it('should compute summary metrics', () => {
    const result = analyzePythonPackage(fixturesDir, { maxFiles: 10 });
    expect(result.summary.totalFunctions).toBeGreaterThan(0);
    expect(result.summary.avgComplexity).toBeGreaterThanOrEqual(1);
  });

  it('should respect maxFiles limit', () => {
    const result = analyzePythonPackage(fixturesDir, { maxFiles: 1 });
    expect(result.files.length).toBeLessThanOrEqual(1);
  });

  it('should return error when no Python files found', () => {
    const emptyDir = path.join(fixturesDir, 'empty_none');
    fs.mkdirSync(emptyDir, { recursive: true });
    const result = analyzePythonPackage(emptyDir);
    expect(result.error).toBe('No Python files found');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('should skip excluded directories', () => {
    const pkg = path.join(fixturesDir, 'pkg_with_dirs');
    fs.mkdirSync(pkg, { recursive: true });
    fs.mkdirSync(path.join(pkg, '__pycache__'), { recursive: true });
    fs.mkdirSync(path.join(pkg, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'good.py'), 'def good(): pass');
    fs.writeFileSync(path.join(pkg, '__pycache__', 'bad.pyc'), '');
    fs.writeFileSync(path.join(pkg, 'node_modules', 'evil.js'), '');

    const result = analyzePythonPackage(pkg, { maxFiles: 10 });
    expect(result.files.length).toBe(1);

    fs.rmSync(pkg, { recursive: true, force: true });
  });
});

describe('analyzePythonFile', () => {
  const fixturesDir = path.join(process.cwd(), '__tests__', 'fixtures', 'python_samples');

  it('should parse top-level function definitions', () => {
    const code = fs.readFileSync(path.join(fixturesDir, 'function_simple.py'), 'utf-8');
    const result = analyzePythonFile(code, {});
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe('calculate');
    expect(result.functions[0].params).toBe('x, y');
  });

  it('should parse class with methods', () => {
    const code = fs.readFileSync(path.join(fixturesDir, 'class_simple.py'), 'utf-8');
    const result = analyzePythonFile(code, {});
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe('Service');
    expect(result.classes[0].methods.map(m => m.name)).toContain('__init__');
    expect(result.classes[0].methods.map(m => m.name)).toContain('run');
  });

  it('should handle syntax errors gracefully', () => {
    const code = fs.readFileSync(path.join(fixturesDir, 'malformed.py'), 'utf-8');
    const result = analyzePythonFile(code, {});
    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
  });

  it('should filter functions by name', () => {
    const code = fs.readFileSync(path.join(fixturesDir, 'filter_test.py'), 'utf-8');
    const result = analyzePythonFile(code, { filter: 'bet' });
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe('beta');
  });

  it('should include function body when requested', () => {
    const code = fs.readFileSync(path.join(fixturesDir, 'body_test.py'), 'utf-8');
    const result = analyzePythonFile(code, { includeBody: true });
    expect(result.functions[0].body).toBeDefined();
    expect(result.functions[0].body).toContain('return 42');
  });

  it('should not include body by default', () => {
    const code = fs.readFileSync(path.join(fixturesDir, 'body_test.py'), 'utf-8');
    const result = analyzePythonFile(code, {});
    expect(result.functions[0].body).toBeNull();
  });

  it('should capture parameter signatures including type hints', () => {
    const code = fs.readFileSync(path.join(fixturesDir, 'typehints.py'), 'utf-8');
    const result = analyzePythonFile(code, {});
    expect(result.functions[0].params).toContain('a: int');
    expect(result.functions[0].params).toContain('b: str');
  });

  it('should extract import statements', () => {
    const code = fs.readFileSync(path.join(fixturesDir, 'imports_test.py'), 'utf-8');
    const result = analyzePythonFile(code, {});
    expect(result.imports.some(i => i.type === 'module' && i.name === 'os')).toBe(true);
    expect(result.imports.some(i => i.type === 'from' && i.module === 'typing')).toBe(true);
  });
});

describe('resolvePythonPackage', () => {
  const fixturesDir = path.join(process.cwd(), '__tests__', 'fixtures', 'python_project');

  it('should resolve a local Python project path without relying on installation', () => {
    const result = resolvePythonPackage(fixturesDir);
    expect(result.error).toBeUndefined();
    expect(result.package).toBe('demo-pkg');
    expect(result.version).toBe('0.1.0');
    expect(result.pkgDir.replace(/\\/g, '/')).toContain('/python_project/src/demo_pkg');
    expect(result.source).toBe('local-path');
  });
});
