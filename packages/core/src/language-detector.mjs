// language-detector.mjs
import fs from 'fs';
import path from 'path';

/**
 * Detecta o ecossistema/linguagem de um pacote
 * @param {string} pkgDir - diretório raiz do pacote
 * @returns {string|null} 'javascript' | 'python' | 'rust' | 'go' | 'java' | null
 */
export function detectLanguage(pkgDir) {
  if (!fs.existsSync(pkgDir)) return null;

  const entries = fs.readdirSync(pkgDir, { withFileTypes: true });

  // Python: setup.py, pyproject.toml, ou arquivos .py
  const hasPythonConfig = entries.some(
    (e) => e.isFile() && (e.name === 'setup.py' || e.name === 'pyproject.toml')
  );
  if (hasPythonConfig) return 'python';

  const hasPyFiles =
    entries.some((e) => e.isFile() && e.name.endsWith('.py')) ||
    getSourceFiles(pkgDir, 'python', 1).length > 0;
  if (hasPyFiles) return 'python';

  // Rust: Cargo.toml
  if (entries.some((e) => e.isFile() && e.name === 'Cargo.toml')) {
    return 'rust';
  }

  // Go: go.mod
  if (entries.some((e) => e.isFile() && e.name === 'go.mod')) {
    return 'go';
  }

  // Java: pom.xml, build.gradle(.kts), ou arquivos .java
  const hasJavaConfig = entries.some(
    (e) =>
      e.isFile() &&
      (e.name === 'pom.xml' || e.name === 'build.gradle' || e.name === 'build.gradle.kts')
  );
  if (hasJavaConfig) return 'java';

  const hasJavaFiles =
    entries.some((e) => e.isFile() && e.name.endsWith('.java')) ||
    getSourceFiles(pkgDir, 'java', 1).length > 0;
  if (hasJavaFiles) return 'java';

  // Default: assume JavaScript/TypeScript se tiver package.json
  if (entries.some((e) => e.isFile() && e.name === 'package.json')) {
    return 'javascript';
  }

  return null;
}

/**
 * Retorna lista de arquivos fonte para uma linguagem
 */
export function getSourceFiles(pkgDir, language, maxFiles = 50) {
  const files = [];
  if (!fs.existsSync(pkgDir)) return files;

  const walk = (dir, depth = 0) => {
    if (depth > 10 || files.length >= maxFiles) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const full = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        entry.name !== 'node_modules' &&
        entry.name !== '__pycache__' &&
        entry.name !== 'target' &&
        entry.name !== 'build' &&
        entry.name !== 'out' &&
        entry.name !== 'dist'
      ) {
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        let ok = false;
        switch (language) {
          case 'python':
            ok = entry.name.endsWith('.py');
            break;
          case 'rust':
            ok = entry.name.endsWith('.rs');
            break;
          case 'go':
            ok = entry.name.endsWith('.go');
            break;
          case 'java':
            ok = entry.name.endsWith('.java');
            break;
          case 'javascript':
            ok =
              entry.name.endsWith('.js') ||
              entry.name.endsWith('.ts') ||
              entry.name.endsWith('.jsx') ||
              entry.name.endsWith('.tsx');
            break;
        }
        if (ok) files.push(full);
      }
    }
  };

  walk(pkgDir);
  return files;
}

export default {
  detectLanguage,
  getSourceFiles,
};
