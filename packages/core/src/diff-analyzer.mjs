/**
 * diff-analyzer.mjs - Semantic comparison of package versions
 * Detects breaking changes, additions, and modifications
 * Self-contained: no dependencies on inspect.mjs or fast-glob
 */

import ts from 'typescript';
import fs from 'fs';
import path from 'path';

/**
 * Change types and their severity
 */
export const ChangeType = {
  REMOVED: 'removed', // BREAKING
  SIGNATURE_CHANGED: 'changed', // Potentially BREAKING
  ADDED: 'added', // Safe
  DEPRECATED: 'deprecated', // Warning
  COMPLEXITY_INCREASED: 'complexity', // Info
};

export const Severity = {
  BREAKING: 'breaking',
  WARNING: 'warning',
  INFO: 'info',
  SAFE: 'safe',
};

/**
 * Normalize type string for comparison
 */
function normalizeType(type) {
  if (!type) return '';
  return type
    .replace(/\s+/g, ' ')
    .replace(/\s*([,:<>{}()[\]|&])\s*/g, '$1')
    .trim();
}

/**
 * Compare function signatures
 */
function compareFunctionSignatures(from, to) {
  const changes = [];

  // Compare parameters
  const fromParams = from.params || [];
  const toParams = to.params || [];

  // Check for removed required params (BREAKING)
  for (let i = 0; i < fromParams.length; i++) {
    const fromParam = fromParams[i];
    const toParam = toParams[i];

    if (!toParam) {
      // Parameter removed
      if (!fromParam.optional) {
        changes.push({
          type: 'param_removed',
          severity: Severity.BREAKING,
          detail: `Required parameter '${fromParam.name}' removed`,
        });
      }
    } else if (normalizeType(fromParam.type) !== normalizeType(toParam.type)) {
      changes.push({
        type: 'param_type_changed',
        severity: Severity.WARNING,
        detail: `Parameter '${fromParam.name}' type: ${fromParam.type} → ${toParam.type}`,
      });
    }
  }

  // Check for new required params (BREAKING)
  for (let i = fromParams.length; i < toParams.length; i++) {
    const toParam = toParams[i];
    if (!toParam.optional && !toParam.default) {
      changes.push({
        type: 'param_added_required',
        severity: Severity.BREAKING,
        detail: `New required parameter '${toParam.name}: ${toParam.type}'`,
      });
    } else {
      changes.push({
        type: 'param_added_optional',
        severity: Severity.SAFE,
        detail: `New optional parameter '${toParam.name}?: ${toParam.type}'`,
      });
    }
  }

  // Compare return types
  const fromReturn = normalizeType(from.returnType || from.type);
  const toReturn = normalizeType(to.returnType || to.type);

  if (fromReturn && toReturn && fromReturn !== toReturn) {
    // Check if return type was narrowed (safe) or widened (potentially breaking)
    changes.push({
      type: 'return_type_changed',
      severity: Severity.WARNING,
      detail: `Return type: ${fromReturn} → ${toReturn}`,
    });
  }

  return changes;
}

/**
 * Compare interface/type properties
 */
function compareProperties(fromProps, toProps) {
  const changes = [];
  const fromMap = new Map(Object.entries(fromProps || {}));
  const toMap = new Map(Object.entries(toProps || {}));

  // Check removed properties
  for (const [name, prop] of fromMap) {
    if (!toMap.has(name)) {
      changes.push({
        type: 'property_removed',
        severity: prop.optional ? Severity.SAFE : Severity.BREAKING,
        detail: `Property '${name}' removed`,
      });
    }
  }

  // Check added/changed properties
  for (const [name, toProp] of toMap) {
    const fromProp = fromMap.get(name);
    if (!fromProp) {
      changes.push({
        type: 'property_added',
        severity: toProp.optional ? Severity.SAFE : Severity.BREAKING,
        detail: `Property '${name}${toProp.optional ? '?' : ''}: ${toProp.type}' added`,
      });
    } else if (normalizeType(fromProp.type) !== normalizeType(toProp.type)) {
      changes.push({
        type: 'property_type_changed',
        severity: Severity.WARNING,
        detail: `Property '${name}' type: ${fromProp.type} → ${toProp.type}`,
      });
    }
  }

  return changes;
}

/**
 * Analyze types from a package directory - self-contained implementation
 */
async function analyzePackageTypes(packageDir, options = {}) {
  const pkgJsonPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    return { error: 'package.json not found', exports: {} };
  }

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

  const result = {
    version: pkg.version,
    name: pkg.name,
    exports: {
      functions: {},
      classes: {},
      interfaces: {},
      types: {},
      enums: {},
    },
  };

  // Find and parse all .d.ts files, following re-exports
  const visited = new Set();
  const allExports = {
    functions: {},
    classes: {},
    interfaces: {},
    types: {},
    enums: {},
  };

  // Start from the main types entry point
  const entryPoints = [
    pkg.types,
    pkg.typings,
    'index.d.ts',
    'lib/index.d.ts',
    'dist/index.d.ts',
  ].filter(Boolean);

  for (const entry of entryPoints) {
    const fullPath = path.join(packageDir, entry);
    if (fs.existsSync(fullPath)) {
      parseTypesRecursively(fullPath, packageDir, allExports, visited);
      break;
    }
  }

  result.exports = allExports;
  return result;
}

/**
 * Parse a .d.ts file and follow re-exports recursively
 */
function parseTypesRecursively(filePath, baseDir, allExports, visited) {
  if (visited.has(filePath) || !fs.existsSync(filePath)) return;
  visited.add(filePath);

  const content = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    path.basename(filePath),
    content,
    ts.ScriptTarget.Latest,
    true
  );

  const fileDir = path.dirname(filePath);

  ts.forEachChild(sourceFile, (node) => {
    // Handle export declarations: export { x } from './module'
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const modulePath = node.moduleSpecifier.text;
        const resolvedPath = resolveModulePath(modulePath, fileDir, baseDir);
        if (resolvedPath) {
          parseTypesRecursively(resolvedPath, baseDir, allExports, visited);
        }
      }
    }

    // Handle function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      const params =
        node.parameters?.map((p) => ({
          name: p.name.getText(sourceFile),
          type: p.type ? p.type.getText(sourceFile) : 'any',
          optional: !!p.questionToken,
        })) || [];
      const returnType = node.type ? node.type.getText(sourceFile) : 'void';
      allExports.functions[name] = { params, returnType };
    }

    // Handle class declarations
    if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.text;
      const methods = {};
      node.members?.forEach((member) => {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = member.name.getText(sourceFile);
          const params =
            member.parameters?.map((p) => ({
              name: p.name.getText(sourceFile),
              type: p.type ? p.type.getText(sourceFile) : 'any',
              optional: !!p.questionToken,
            })) || [];
          const returnType = member.type ? member.type.getText(sourceFile) : 'void';
          methods[methodName] = { params, returnType };
        }
      });
      allExports.classes[name] = { methods };
    }

    // Handle interface declarations
    if (ts.isInterfaceDeclaration(node) && node.name) {
      const name = node.name.text;
      const properties = {};
      node.members?.forEach((member) => {
        if (ts.isPropertySignature(member) && member.name) {
          const propName = member.name.getText(sourceFile);
          properties[propName] = {
            type: member.type ? member.type.getText(sourceFile) : 'any',
            optional: !!member.questionToken,
          };
        }
      });
      allExports.interfaces[name] = { properties };
    }

    // Handle type aliases
    if (ts.isTypeAliasDeclaration(node) && node.name) {
      const name = node.name.text;
      allExports.types[name] = {
        type: node.type ? node.type.getText(sourceFile) : 'unknown',
      };
    }

    // Handle enum declarations
    if (ts.isEnumDeclaration(node) && node.name) {
      const name = node.name.text;
      const members = node.members?.map((m) => m.name.getText(sourceFile)) || [];
      allExports.enums[name] = { members };
    }
  });
}

/**
 * Resolve a module path to an actual file path
 */
function resolveModulePath(modulePath, fromDir, baseDir) {
  // Handle relative paths
  if (modulePath.startsWith('.')) {
    const candidates = [
      path.join(fromDir, modulePath + '.d.ts'),
      path.join(fromDir, modulePath, 'index.d.ts'),
      path.join(fromDir, modulePath + '.ts'),
      path.join(fromDir, modulePath),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Compare two package versions
 */
export async function compareVersions(fromDir, toDir, options = {}) {
  const { filter, includeSource = false } = options;

  // Analyze both versions
  const [fromAnalysis, toAnalysis] = await Promise.all([
    analyzePackageTypes(fromDir, { filter, includeSource }),
    analyzePackageTypes(toDir, { filter, includeSource }),
  ]);

  const diff = {
    from: {
      version: fromAnalysis.version,
      name: fromAnalysis.name,
    },
    to: {
      version: toAnalysis.version,
      name: toAnalysis.name,
    },
    breaking: [],
    warnings: [],
    additions: [],
    info: [],
    summary: {
      breaking: 0,
      warnings: 0,
      additions: 0,
      removals: 0,
    },
  };

  // Compare each export category
  const categories = ['functions', 'classes', 'interfaces', 'types', 'enums'];

  for (const category of categories) {
    const fromExports = fromAnalysis.exports[category] || {};
    const toExports = toAnalysis.exports[category] || {};

    // Find removed exports (BREAKING)
    for (const [name, fromItem] of Object.entries(fromExports)) {
      if (!(name in toExports)) {
        diff.breaking.push({
          category,
          name,
          type: ChangeType.REMOVED,
          severity: Severity.BREAKING,
          detail: `${category.slice(0, -1)} '${name}' was removed`,
          from: fromItem,
          to: null,
        });
        diff.summary.breaking++;
        diff.summary.removals++;
      }
    }

    // Find added exports
    for (const [name, toItem] of Object.entries(toExports)) {
      if (!(name in fromExports)) {
        diff.additions.push({
          category,
          name,
          type: ChangeType.ADDED,
          severity: Severity.SAFE,
          detail: `${category.slice(0, -1)} '${name}' was added`,
          from: null,
          to: toItem,
        });
        diff.summary.additions++;
      }
    }

    // Find changed exports
    for (const [name, fromItem] of Object.entries(fromExports)) {
      const toItem = toExports[name];
      if (!toItem) continue;

      let changes = [];

      if (category === 'functions') {
        changes = compareFunctionSignatures(fromItem, toItem);
      } else if (category === 'interfaces' || category === 'types') {
        if (fromItem.properties && toItem.properties) {
          changes = compareProperties(fromItem.properties, toItem.properties);
        }
      } else if (category === 'classes') {
        // Compare class methods and properties
        if (fromItem.methods && toItem.methods) {
          for (const [methodName, fromMethod] of Object.entries(fromItem.methods)) {
            const toMethod = toItem.methods[methodName];
            if (!toMethod) {
              changes.push({
                type: 'method_removed',
                severity: Severity.BREAKING,
                detail: `Method '${methodName}' removed from class '${name}'`,
              });
            } else {
              const methodChanges = compareFunctionSignatures(fromMethod, toMethod);
              changes.push(
                ...methodChanges.map((c) => ({
                  ...c,
                  detail: `${name}.${methodName}: ${c.detail}`,
                }))
              );
            }
          }
          // Check for new methods
          for (const methodName of Object.keys(toItem.methods || {})) {
            if (!fromItem.methods?.[methodName]) {
              changes.push({
                type: 'method_added',
                severity: Severity.SAFE,
                detail: `Method '${methodName}' added to class '${name}'`,
              });
            }
          }
        }
      }

      // Categorize changes by severity
      for (const change of changes) {
        const entry = {
          category,
          name,
          ...change,
          from: fromItem,
          to: toItem,
        };

        if (change.severity === Severity.BREAKING) {
          diff.breaking.push(entry);
          diff.summary.breaking++;
        } else if (change.severity === Severity.WARNING) {
          diff.warnings.push(entry);
          diff.summary.warnings++;
        } else {
          diff.info.push(entry);
        }
      }
    }
  }

  // Compare source complexity if available
  if (includeSource && fromAnalysis.sourceAnalysis && toAnalysis.sourceAnalysis) {
    const fromAvg = fromAnalysis.sourceAnalysis.summary?.avgComplexity || 0;
    const toAvg = toAnalysis.sourceAnalysis.summary?.avgComplexity || 0;

    if (toAvg > fromAvg * 1.5) {
      // 50% increase
      diff.warnings.push({
        category: 'source',
        name: 'complexity',
        type: ChangeType.COMPLEXITY_INCREASED,
        severity: Severity.WARNING,
        detail: `Average complexity increased significantly: ${fromAvg} → ${toAvg}`,
      });
    }

    diff.sourceComparison = {
      from: fromAnalysis.sourceAnalysis.summary,
      to: toAnalysis.sourceAnalysis.summary,
    };
  }

  return diff;
}

/**
 * Format diff result as text
 */
export function formatDiffAsText(diff, options = {}) {
  const { colors = true, verbose = false } = options;

  const lines = [];
  const red = colors ? '\x1b[31m' : '';
  const green = colors ? '\x1b[32m' : '';
  const yellow = colors ? '\x1b[33m' : '';
  const reset = colors ? '\x1b[0m' : '';
  const bold = colors ? '\x1b[1m' : '';

  lines.push(`${bold}📦 ${diff.from.name}: ${diff.from.version} → ${diff.to.version}${reset}`);
  lines.push('');

  // Breaking changes
  if (diff.breaking.length > 0) {
    lines.push(`${red}${bold}🔴 BREAKING CHANGES (${diff.breaking.length}):${reset}`);
    for (const change of diff.breaking) {
      lines.push(`${red}   - ${change.detail}${reset}`);
    }
    lines.push('');
  }

  // Warnings
  if (diff.warnings.length > 0) {
    lines.push(`${yellow}${bold}🟡 WARNINGS (${diff.warnings.length}):${reset}`);
    for (const change of diff.warnings) {
      lines.push(`${yellow}   ~ ${change.detail}${reset}`);
    }
    lines.push('');
  }

  // Additions
  if (diff.additions.length > 0) {
    lines.push(`${green}${bold}🟢 ADDED (${diff.additions.length}):${reset}`);
    for (const change of diff.additions) {
      lines.push(`${green}   + ${change.name} (${change.category.slice(0, -1)})${reset}`);
    }
    lines.push('');
  }

  // Info (only in verbose mode)
  if (verbose && diff.info.length > 0) {
    lines.push(`ℹ️  INFO (${diff.info.length}):`);
    for (const change of diff.info) {
      lines.push(`   · ${change.detail}`);
    }
    lines.push('');
  }

  // Summary
  lines.push(`${bold}📊 Summary:${reset}`);
  lines.push(`   Breaking: ${diff.summary.breaking}`);
  lines.push(`   Warnings: ${diff.summary.warnings}`);
  lines.push(`   Additions: ${diff.summary.additions}`);
  lines.push(`   Removals: ${diff.summary.removals}`);

  // Source comparison if available
  if (diff.sourceComparison) {
    lines.push('');
    lines.push(`${bold}📝 Source Analysis:${reset}`);
    lines.push(
      `   Functions: ${diff.sourceComparison.from?.totalFunctions || 0} → ${diff.sourceComparison.to?.totalFunctions || 0}`
    );
    lines.push(
      `   Avg Complexity: ${diff.sourceComparison.from?.avgComplexity || 0} → ${diff.sourceComparison.to?.avgComplexity || 0}`
    );
  }

  return lines.join('\n');
}

/**
 * Format diff result as JSON
 */
export function formatDiffAsJson(diff) {
  return JSON.stringify(diff, null, 2);
}

export default {
  compareVersions,
  formatDiffAsText,
  formatDiffAsJson,
  ChangeType,
  Severity,
};
