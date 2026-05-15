// analyze-python.mjs
import fs from 'fs';
import path from 'path';

/**
 * Analisa código Python em um diretório de pacote
 */
export function analyzePythonPackage(pkgDir, options = {}) {
  const { filter, maxFiles = 5, includeBody = false } = options;

  const files = [];
  function walk(dir, depth = 0) {
    if (depth > 10 || files.length >= maxFiles) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const full = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        entry.name !== '__pycache__' &&
        entry.name !== 'node_modules' &&
        entry.name !== 'target' &&
        entry.name !== 'dist' &&
        entry.name !== '.git'
      ) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.py')) {
        files.push(full);
      }
    }
  }
  walk(pkgDir);

  if (files.length === 0) {
    return { error: 'No Python files found', files: [] };
  }

  const results = {
    files: [],
    summary: {
      totalFiles: files.length,
      totalFunctions: 0,
      totalClasses: 0,
      totalMethods: 0,
      avgComplexity: 0,
    },
  };

  let totalComplexity = 0;

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const relPath = path.relative(pkgDir, file);
      const analysis = analyzePythonFile(content, { filter, includeBody });
      results.files.push({
        path: relPath,
        functions: analysis.functions,
        classes: analysis.classes,
        imports: analysis.imports,
      });

      results.summary.totalFunctions += analysis.functions.length;
      results.summary.totalClasses += analysis.classes.length;
      results.summary.totalMethods += (analysis.methods || []).length;

      for (const fn of analysis.functions) {
        let complexity = 1;
        if (fn.body) {
          const keywords = (
            fn.body.match(/\b(if|elif|else|for|while|try|except|finally|with|match|case)\b/g) || []
          ).length;
          complexity += keywords;
        }
        totalComplexity += complexity;
      }
      for (const cls of analysis.classes) {
        for (const meth of cls.methods || []) {
          let complexity = 1;
          if (meth.body) {
            const keywords = (
              meth.body.match(/\b(if|elif|else|for|while|try|except|finally|with|match|case)\b/g) ||
              []
            ).length;
            complexity += keywords;
          }
          totalComplexity += complexity;
        }
      }
    } catch (e) {}
  }

  const totalItems =
    results.summary.totalFunctions + results.summary.totalClasses + results.summary.totalMethods;
  results.summary.avgComplexity =
    totalItems > 0 ? Math.round((totalComplexity / totalItems) * 10) / 10 : 0;

  return results;
}

function analyzePythonFile(content, { filter, includeBody = false }) {
  const functions = [];
  const classes = [];
  const imports = [];
  const lines = content.split('\n');

  // Collect imports
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m = line.match(/^import\s+([\w\.]+)/);
    if (m) imports.push({ type: 'module', name: m[1], line: i + 1 });
    m = line.match(/^from\s+([\w\.]+)\s+import\s+([\w\.\*, ]+)/);
    if (m) {
      const names = m[2].split(',').map((s) => s.trim());
      for (const name of names) {
        if (name && name !== '*') {
          imports.push({ type: 'from', module: m[1], name, line: i + 1 });
        }
      }
    }
  }

  const funcRegex = /^(\s*)def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?\s*:/;
  const classRegex = /^(\s*)class\s+(\w+)(?:\(([^)]+)\))?\s*:/;

  let currentClass = null;
  let classIndent = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const baseIndent = line.match(/^\s*/)[0].length;

    const classMatch = line.match(classRegex);
    if (classMatch) {
      const indent = classMatch[1].length;
      if (currentClass) {
        classes.push(currentClass);
      }
      currentClass = {
        name: classMatch[2],
        bases: classMatch[3] ? classMatch[3].split(',').map((s) => s.trim()) : [],
        line: i + 1,
        methods: [],
      };
      classIndent = indent;
      continue;
    }

    if (currentClass && baseIndent <= classIndent) {
      classes.push(currentClass);
      currentClass = null;
      classIndent = null;
    }

    if (currentClass) {
      const methodMatch = line.match(/^(\s+)def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?\s*:/);
      if (methodMatch) {
        const indent = methodMatch[1].length;
        if (indent > classIndent) {
          const methodName = methodMatch[2];
          const params = methodMatch[3];
          const body = includeBody ? collectBody(lines, i) : null;
          currentClass.methods.push({
            name: methodName,
            params: params || '',
            line: i + 1,
            body: body ? body.substring(0, 200) : null,
          });
        }
      }
    }

    if (!currentClass) {
      const funcMatch = line.match(funcRegex);
      if (funcMatch) {
        const indent = funcMatch[1].length;
        if (indent === 0) {
          const funcName = funcMatch[2];
          // Filter by name if provided
          if (filter && !funcName.includes(filter)) {
            continue;
          }
          const params = funcMatch[3];
          const body = includeBody ? collectBody(lines, i) : null;
          functions.push({
            name: funcName,
            params: params || '',
            line: i + 1,
            body: body ? body.substring(0, 200) : null,
          });
        }
      }
    }
  }

  if (currentClass) classes.push(currentClass);

  return { functions, classes, imports };
}

function collectBody(lines, startIdx) {
  if (startIdx >= lines.length) return '';
  const first = lines[startIdx];
  const baseIndent = first.match(/^\s*/)[0].length;
  const bodyLines = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= baseIndent && trimmed !== '' && !trimmed.startsWith('#')) {
      break;
    }
    bodyLines.push(line);
  }
  return bodyLines.join('\n');
}

export default {
  analyzePythonPackage,
  analyzePythonFile,
};
