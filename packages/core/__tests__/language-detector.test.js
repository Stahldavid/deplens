// __tests__/language-detector.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectLanguage, getSourceFiles } from '../src/language-detector.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';
import os from 'os';

const TMP_PREFIX = path.join(os.tmpdir(), 'deplens-lang-test-');

describe('language-detector', () => {
  let testRoot;

  beforeEach(() => {
    testRoot = mkdtempSync(TMP_PREFIX);
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  function writeFile(relPath, content = '') {
    const full = path.join(testRoot, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
    return full;
  }

  describe('detectLanguage', () => {
    it('should detect Python from setup.py', () => {
      writeFile('setup.py', '');
      expect(detectLanguage(testRoot)).toBe('python');
    });

    it('should detect Python from pyproject.toml', () => {
      writeFile('pyproject.toml', '[project]\nname = "test"');
      expect(detectLanguage(testRoot)).toBe('python');
    });

    it('should detect Python from .py files', () => {
      writeFile('main.py', 'print("hello")');
      expect(detectLanguage(testRoot)).toBe('python');
    });

    it('should detect Rust from Cargo.toml', () => {
      writeFile('Cargo.toml', '[package]\nname = "test"');
      expect(detectLanguage(testRoot)).toBe('rust');
    });

    it('should detect Go from go.mod', () => {
      writeFile('go.mod', 'module test\n');
      expect(detectLanguage(testRoot)).toBe('go');
    });

    it('should detect JavaScript from package.json', () => {
      writeFile('package.json', '{"name": "test"}');
      expect(detectLanguage(testRoot)).toBe('javascript');
    });

    it('should return null for empty directory', () => {
      expect(detectLanguage(testRoot)).toBeNull();
    });

    it('should prioritize Python config over JS', () => {
      writeFile('setup.py', '');
      writeFile('package.json', '{"name": "test"}');
      expect(detectLanguage(testRoot)).toBe('python');
    });

    it('should handle mixed sources without known config', () => {
      writeFile('main.py', '');
      writeFile('main.rs', '');
      expect(detectLanguage(testRoot)).toBe('python');
    });

    it('should not crash on non-existent directory', () => {
      expect(detectLanguage(path.join(os.tmpdir(), 'definitely-does-not-exist-deplens'))).toBeNull();
    });
  });

  describe('getSourceFiles', () => {
    it('should find Python files', () => {
      writeFile('module1.py', 'def one(): pass');
      writeFile('subdir/module2.py', 'def two(): pass');
      writeFile('readme.md', 'docs');

      const files = getSourceFiles(testRoot, 'python', 10);
      expect(files.length).toBe(2);
      expect(files.every(f => f.endsWith('.py'))).toBe(true);
    });

    it('should respect maxFiles limit', () => {
      for (let i = 0; i < 20; i++) {
        writeFile(`file${i}.py`, `def f{i}(): pass`);
      }
      const files = getSourceFiles(testRoot, 'python', 10);
      expect(files.length).toBe(10);
    });

    it('should find Rust files', () => {
      writeFile('main.rs', 'fn main() {}');
      writeFile('lib.rs', 'pub fn lib() {}');
      const files = getSourceFiles(testRoot, 'rust', 10);
      expect(files.length).toBe(2);
    });

    it('should find Go files', () => {
      writeFile('main.go', 'package main');
      writeFile('utils.go', 'package utils');
      const files = getSourceFiles(testRoot, 'go', 10);
      expect(files.length).toBe(2);
    });

    it('should find JS/TS files', () => {
      writeFile('index.js', '');
      writeFile('index.ts', '');
      writeFile('app.tsx', '');
      writeFile('component.jsx', '');
      const files = getSourceFiles(testRoot, 'javascript', 10);
      expect(files.length).toBe(4);
    });

    it('should skip hidden dirs and node_modules', () => {
      writeFile('src/main.py', '');
      writeFile('node_modules/evil.py', '');
      writeFile('.git/hooks/install', '');
      writeFile('__pycache__/cache.pyc', '');

      const files = getSourceFiles(testRoot, 'python', 10);
      expect(files.length).toBe(1);
      expect(files[0]).toContain(path.join('src', 'main.py'));
    });
  });
});
