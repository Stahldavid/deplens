/**
 * parse-source.mjs - Source code analysis for .ts/.js files
 * Extracts implementation details beyond type signatures
 */

import ts from 'typescript';
import fs from 'fs';
import path from 'path';

/**
 * Calculate cyclomatic complexity of a function
 * Counts decision points: if, for, while, case, catch, &&, ||, ?:
 */
function calculateComplexity(node) {
  let complexity = 1; // Base complexity

  function visit(n) {
    switch (n.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CaseClause:
      case ts.SyntaxKind.CatchClause:
      case ts.SyntaxKind.ConditionalExpression: // ternary ?:
        complexity++;
        break;
      case ts.SyntaxKind.BinaryExpression:
        const op = n.operatorToken.kind;
        if (
          op === ts.SyntaxKind.AmpersandAmpersandToken ||
          op === ts.SyntaxKind.BarBarToken ||
          op === ts.SyntaxKind.QuestionQuestionToken
        ) {
          complexity++;
        }
        break;
    }
    ts.forEachChild(n, visit);
  }

  ts.forEachChild(node, visit);
  return complexity;
}

/**
 * Extract imports from source file
 */
function extractImports(sourceFile) {
  const imports = [];

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier.text;
      const importClause = node.importClause;

      const importInfo = {
        module: moduleSpecifier,
        default: null,
        named: [],
        namespace: null,
      };

      if (importClause) {
        // Default import
        if (importClause.name) {
          importInfo.default = importClause.name.text;
        }
        // Named imports or namespace
        if (importClause.namedBindings) {
          if (ts.isNamespaceImport(importClause.namedBindings)) {
            importInfo.namespace = importClause.namedBindings.name.text;
          } else if (ts.isNamedImports(importClause.namedBindings)) {
            importClause.namedBindings.elements.forEach((el) => {
              importInfo.named.push(el.name.text);
            });
          }
        }
      }

      imports.push(importInfo);
    }
  });

  return imports;
}

/**
 * Extract dependencies used within a function body
 */
function extractDependencies(node, imports) {
  const deps = new Set();
  const builtins = new Set([
    'console',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'Promise',
    'Array',
    'Object',
    'String',
    'Number',
    'Boolean',
    'Date',
    'Math',
    'JSON',
    'Error',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Symbol',
    'Proxy',
    'Reflect',
  ]);

  const importedNames = new Set();
  imports.forEach((imp) => {
    if (imp.default) importedNames.add(imp.default);
    if (imp.namespace) importedNames.add(imp.namespace);
    imp.named.forEach((n) => importedNames.add(n));
  });

  function visit(n) {
    if (ts.isIdentifier(n)) {
      const name = n.text;
      if (importedNames.has(name)) {
        deps.add(name);
      } else if (builtins.has(name)) {
        deps.add(`[builtin] ${name}`);
      }
    }
    ts.forEachChild(n, visit);
  }

  ts.forEachChild(node, visit);
  return Array.from(deps);
}

/**
 * Detect patterns and edge case handling
 */
function detectPatterns(node) {
  const patterns = [];

  function visit(n) {
    // Try-catch
    if (ts.isTryStatement(n)) {
      patterns.push('error-handling');
    }
    // Null checks
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (
        op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsEqualsToken
      ) {
        const left = n.left.getText ? n.left.getText() : '';
        const right = n.right.getText ? n.right.getText() : '';
        if (left === 'null' || right === 'null' || left === 'undefined' || right === 'undefined') {
          patterns.push('null-check');
        }
      }
      // Optional chaining check via ??
      if (op === ts.SyntaxKind.QuestionQuestionToken) {
        patterns.push('nullish-coalescing');
      }
    }
    // Optional chaining
    if (n.kind === ts.SyntaxKind.PropertyAccessExpression && n.questionDotToken) {
      patterns.push('optional-chaining');
    }
    // Type guards
    if (
      ts.isTypeOfExpression(n) ||
      (ts.isCallExpression(n) && n.expression.getText?.() === 'typeof')
    ) {
      patterns.push('type-guard');
    }
    // Async/await
    if (ts.isAwaitExpression(n)) {
      patterns.push('async-await');
    }
    // Generators
    if (ts.isYieldExpression(n)) {
      patterns.push('generator');
    }
    // Closures (arrow functions or function expressions inside)
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      patterns.push('closure');
    }
    // Recursion detection (function calling itself)
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      // Will be checked later with function name context
    }

    ts.forEachChild(n, visit);
  }

  ts.forEachChild(node, visit);
  return [...new Set(patterns)]; // Dedupe
}

/**
 * Get function body as string (truncated)
 */
function getFunctionBody(node, sourceFile, maxLines = 15) {
  if (!node.body) return null;

  const bodyText = node.body.getText(sourceFile);
  const lines = bodyText.split('\n');

  if (lines.length <= maxLines) {
    return bodyText;
  }

  return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
}

/**
 * Count lines of code in a node
 */
function countLines(node, sourceFile) {
  const text = node.getText(sourceFile);
  return text.split('\n').length;
}

/**
 * Parse source file and extract detailed analysis
 */
export function parseSourceFile(filePath, options = {}) {
  const { filter, maxBodyLines = 15, includeBody = true } = options;

  if (!fs.existsSync(filePath)) {
    return { error: `File not found: ${filePath}`, functions: {} };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    path.basename(filePath),
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
      ? ts.ScriptKind.TSX
      : filePath.endsWith('.ts')
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS
  );

  const imports = extractImports(sourceFile);
  const functions = {};

  function shouldInclude(name) {
    if (!filter) return true;
    return name.toLowerCase().includes(filter.toLowerCase());
  }

  function analyzeFunction(node, name, isExported, isAsync) {
    if (!shouldInclude(name)) return;

    const complexity = calculateComplexity(node);
    const lines = countLines(node, sourceFile);
    const deps = extractDependencies(node, imports);
    const patterns = detectPatterns(node);
    const body = includeBody ? getFunctionBody(node, sourceFile, maxBodyLines) : null;

    // Get parameters
    const params = node.parameters
      ? node.parameters.map((p) => {
          const paramName = p.name.getText(sourceFile);
          const paramType = p.type ? p.type.getText(sourceFile) : 'any';
          const optional = !!p.questionToken;
          const defaultValue = p.initializer ? p.initializer.getText(sourceFile) : null;
          return {
            name: paramName,
            type: paramType,
            optional,
            default: defaultValue,
          };
        })
      : [];

    // Get return type
    const returnType = node.type ? node.type.getText(sourceFile) : 'inferred';

    functions[name] = {
      exported: isExported,
      async: isAsync,
      params,
      returnType,
      complexity,
      lines,
      dependencies: deps,
      patterns,
      ...(body && { body }),
    };
  }

  function visit(node) {
    // Function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      const isAsync = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      analyzeFunction(node, name, isExported, isAsync);
    }

    // Arrow functions assigned to variables
    if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

      node.declarationList.declarations.forEach((decl) => {
        if (decl.initializer && ts.isArrowFunction(decl.initializer)) {
          const name = decl.name.getText(sourceFile);
          const isAsync = decl.initializer.modifiers?.some(
            (m) => m.kind === ts.SyntaxKind.AsyncKeyword
          );
          analyzeFunction(decl.initializer, name, isExported, isAsync);
        }
        // Function expressions
        if (decl.initializer && ts.isFunctionExpression(decl.initializer)) {
          const name = decl.name.getText(sourceFile);
          const isAsync = decl.initializer.modifiers?.some(
            (m) => m.kind === ts.SyntaxKind.AsyncKeyword
          );
          analyzeFunction(decl.initializer, name, isExported, isAsync);
        }
      });
    }

    // Class methods
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const isClassExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

      node.members.forEach((member) => {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = `${className}.${member.name.getText(sourceFile)}`;
          const isAsync = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
          analyzeFunction(member, methodName, isClassExported, isAsync);
        }
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return {
    file: filePath,
    imports,
    functions,
    totalFunctions: Object.keys(functions).length,
  };
}

/**
 * Find source files for a package
 */
export function findSourceFiles(pkgDir, options = {}) {
  const {
    maxFiles = 10,
    include = [
      'src/**/*.ts',
      'src/**/*.js',
      'lib/**/*.ts',
      'lib/**/*.js',
      'dist/**/*.js',
      '*.ts',
      '*.js',
    ],
  } = options;

  const sourceFiles = new Set();

  for (const pattern of include) {
    let baseDir;
    const fullPattern = path.join(pkgDir, pattern);
    if (!pattern.includes('/')) {
      baseDir = pkgDir;
    } else {
      baseDir = path.dirname(fullPattern.split('*')[0]);
    }
    if (!fs.existsSync(baseDir)) continue;

    (function walkDir(dir, depth = 0) {
      if (depth > 5 || sourceFiles.size >= maxFiles) return;

      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        return;
      }
      for (const entry of entries) {
        if (sourceFiles.size >= maxFiles) break;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          walkDir(fullPath, depth + 1);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.ts') ||
            entry.name.endsWith('.tsx') ||
            entry.name.endsWith('.js') ||
            entry.name.endsWith('.jsx'))
        ) {
          if (!entry.name.endsWith('.d.ts')) {
            sourceFiles.add(fullPath);
          }
        }
      }
    })(baseDir);
  }

  return Array.from(sourceFiles);
}

/**
 * Analyze a package's source code
 */
export function analyzePackageSource(pkgDir, options = {}) {
  const { filter, maxFiles = 5, maxBodyLines = 10, includeBody = false } = options;

  const sourceFiles = findSourceFiles(pkgDir, { maxFiles });

  if (sourceFiles.length === 0) {
    return { error: 'No source files found', files: [] };
  }

  const results = {
    files: [],
    summary: {
      totalFiles: sourceFiles.length,
      totalFunctions: 0,
      avgComplexity: 0,
      highComplexityFunctions: [],
    },
  };

  let totalComplexity = 0;
  let functionCount = 0;

  for (const file of sourceFiles) {
    const analysis = parseSourceFile(file, {
      filter,
      maxBodyLines,
      includeBody,
    });

    if (analysis.error) continue;

    results.files.push({
      path: path.relative(pkgDir, file),
      functions: analysis.functions,
      imports: analysis.imports,
    });

    for (const [name, info] of Object.entries(analysis.functions)) {
      functionCount++;
      totalComplexity += info.complexity;

      if (info.complexity >= 10) {
        results.summary.highComplexityFunctions.push({
          name,
          file: path.relative(pkgDir, file),
          complexity: info.complexity,
        });
      }
    }
  }

  results.summary.totalFunctions = functionCount;
  results.summary.avgComplexity =
    functionCount > 0 ? Math.round((totalComplexity / functionCount) * 10) / 10 : 0;
  results.summary.highComplexityFunctions.sort((a, b) => b.complexity - a.complexity);

  return results;
}

export default {
  parseSourceFile,
  findSourceFiles,
  analyzePackageSource,
};
