/**
 * diff-analyzer.mjs - Semantic comparison of package versions
 * Detects breaking changes, additions, and modifications
 * Self-contained: no dependencies on inspect.mjs or fast-glob
 */

import ts from 'typescript';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { buildSymbols } from './symbols.mjs';

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

function normalizeParams(params) {
  if (!params) return [];
  if (typeof params === 'string') {
    return params
      .split(',')
      .map((param) => param.trim())
      .filter(Boolean);
  }
  return params.map((param) => ({
    name: param.name || '',
    type: normalizeType(param.type || ''),
    optional: Boolean(param.optional),
  }));
}

function normalizeSymbolFacet(facet) {
  if (!facet) return null;
  return {
    kind: facet.kind || null,
    signature: normalizeType(facet.signature || ''),
    params: normalizeParams(facet.params),
    returnType: normalizeType(facet.returnType || ''),
    properties: facet.properties || null,
    definition: normalizeType(facet.definition || ''),
    extends: facet.extends || null,
    members: facet.members || null,
  };
}

function symbolIdentity(symbol) {
  return `${symbol.subpath || '.'}:${symbol.exportName || symbol.name}`;
}

function compareSymbolFacets(fromSymbol, toSymbol) {
  const changes = [];
  const fromFacets = new Set(fromSymbol.facets || []);
  const toFacets = new Set(toSymbol.facets || []);

  for (const facet of fromFacets) {
    if (!toFacets.has(facet)) {
      changes.push({
        kind: 'facet_removed',
        facet,
        severity: facet === 'runtime' || facet === 'types' ? Severity.BREAKING : Severity.WARNING,
        detail: `${facet} facet was removed`,
      });
    }
  }

  for (const facet of toFacets) {
    if (!fromFacets.has(facet)) {
      changes.push({
        kind: 'facet_added',
        facet,
        severity: Severity.SAFE,
        detail: `${facet} facet was added`,
      });
    }
  }

  for (const facet of ['runtime', 'types']) {
    if (!fromFacets.has(facet) || !toFacets.has(facet)) continue;
    const fromFacet = normalizeSymbolFacet(fromSymbol[facet]);
    const toFacet = normalizeSymbolFacet(toSymbol[facet]);
    if (fromFacet.kind !== toFacet.kind) {
      changes.push({
        kind: 'kind_changed',
        facet,
        severity: facet === 'types' ? Severity.WARNING : Severity.BREAKING,
        detail: `${facet} kind changed: ${fromFacet.kind || 'unknown'} → ${toFacet.kind || 'unknown'}`,
      });
    }
    if (JSON.stringify(fromFacet.params) !== JSON.stringify(toFacet.params)) {
      changes.push({
        kind: 'params_changed',
        facet,
        severity: Severity.WARNING,
        detail: `${facet} parameters changed`,
      });
    }
    if (fromFacet.returnType !== toFacet.returnType) {
      changes.push({
        kind: 'return_changed',
        facet,
        severity: Severity.WARNING,
        detail: `${facet} return type changed: ${fromFacet.returnType || 'unknown'} → ${toFacet.returnType || 'unknown'}`,
      });
    }
    if (fromFacet.definition !== toFacet.definition) {
      changes.push({
        kind: 'definition_changed',
        facet,
        severity: Severity.WARNING,
        detail: `${facet} definition changed`,
      });
    }
  }

  return changes;
}

function compareSymbols(fromSymbols, toSymbols) {
  const fromMap = new Map(fromSymbols.map((symbol) => [symbolIdentity(symbol), symbol]));
  const toMap = new Map(toSymbols.map((symbol) => [symbolIdentity(symbol), symbol]));
  const changes = [];

  for (const [id, fromSymbol] of fromMap) {
    const toSymbol = toMap.get(id);
    if (!toSymbol) {
      changes.push({
        kind: 'symbol_removed',
        severity: Severity.BREAKING,
        identity: id,
        name: fromSymbol.exportName,
        subpath: fromSymbol.subpath,
        detail: `Symbol '${fromSymbol.exportName}' was removed`,
        from: fromSymbol,
        to: null,
      });
      continue;
    }

    for (const facetChange of compareSymbolFacets(fromSymbol, toSymbol)) {
      changes.push({
        ...facetChange,
        identity: id,
        name: fromSymbol.exportName,
        subpath: fromSymbol.subpath,
        detail: `Symbol '${fromSymbol.exportName}': ${facetChange.detail}`,
        from: fromSymbol,
        to: toSymbol,
      });
    }
  }

  for (const [id, toSymbol] of toMap) {
    if (fromMap.has(id)) continue;
    changes.push({
      kind: 'symbol_added',
      severity: Severity.SAFE,
      identity: id,
      name: toSymbol.exportName,
      subpath: toSymbol.subpath,
      detail: `Symbol '${toSymbol.exportName}' was added`,
      from: null,
      to: toSymbol,
    });
  }

  return {
    fromCount: fromSymbols.length,
    toCount: toSymbols.length,
    changes,
    summary: {
      breaking: changes.filter((change) => change.severity === Severity.BREAKING).length,
      warnings: changes.filter((change) => change.severity === Severity.WARNING).length,
      additions: changes.filter((change) => change.kind === 'symbol_added' || change.kind === 'facet_added')
        .length,
      removals: changes.filter((change) => change.kind === 'symbol_removed' || change.kind === 'facet_removed')
        .length,
    },
  };
}

function resolveConditionalExport(entry, preferred = ['types', 'import', 'require', 'default']) {
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const resolved = resolveConditionalExport(item, preferred);
      if (resolved) return resolved;
    }
    return null;
  }
  if (typeof entry !== 'object') return null;
  for (const condition of preferred) {
    if (condition in entry) {
      const resolved = resolveConditionalExport(entry[condition], preferred);
      if (resolved) return resolved;
    }
  }
  for (const value of Object.values(entry)) {
    const resolved = resolveConditionalExport(value, preferred);
    if (resolved) return resolved;
  }
  return null;
}

function findTypesEntry(pkg) {
  const candidates = [pkg.types, pkg.typings];
  const rootExport = typeof pkg.exports === 'object' ? pkg.exports['.'] || pkg.exports : null;
  const exportTypes = resolveConditionalExport(rootExport, ['types', 'typings', 'default']);
  if (exportTypes) candidates.push(exportTypes);
  candidates.push('index.d.ts', 'index.d.cts', 'index.d.mts', 'lib/index.d.ts', 'dist/index.d.ts');
  return candidates.filter(Boolean);
}

function findRuntimeEntry(pkg) {
  const rootExport = typeof pkg.exports === 'object' ? pkg.exports['.'] || pkg.exports : null;
  const exportRuntime = resolveConditionalExport(rootExport, ['import', 'require', 'node', 'default']);
  return [exportRuntime, pkg.module, pkg.main, 'index.js', 'index.mjs', 'index.cjs'].filter(Boolean);
}

function runtimeKind(name, value) {
  if (typeof value === 'function') {
    const source = Function.prototype.toString.call(value);
    return source.startsWith('class ') ? 'class' : 'function';
  }
  if (value && typeof value === 'object') return 'object';
  return 'constant';
}

async function inspectRuntimeExports(packageDir, pkg) {
  const entry = findRuntimeEntry(pkg).find((candidate) =>
    fs.existsSync(path.join(packageDir, candidate))
  );
  if (!entry) return { runtimeNames: [], categorized: {}, runtimePath: null, runtimeAvailable: false };
  try {
    const mod = await import(pathToFileURL(path.join(packageDir, entry)).href);
    const names = Object.keys(mod);
    if ('default' in mod && mod.default && typeof mod.default === 'object') {
      for (const key of Object.keys(mod.default)) {
        if (!names.includes(key)) names.push(key);
      }
    }
    const valueFor = (name) => (name in mod ? mod[name] : mod.default?.[name]);
    return {
      runtimeNames: names,
      categorized: {
        functions: names.filter((name) => runtimeKind(name, valueFor(name)) === 'function'),
        classes: names.filter((name) => runtimeKind(name, valueFor(name)) === 'class'),
        objects: names.filter((name) => runtimeKind(name, valueFor(name)) === 'object'),
        constants: names.filter((name) => runtimeKind(name, valueFor(name)) === 'constant'),
      },
      runtimePath: entry,
      runtimeAvailable: true,
    };
  } catch {
    return { runtimeNames: [], categorized: {}, runtimePath: entry, runtimeAvailable: false };
  }
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
    namespaces: {},
    jsdoc: {},
  };

  // Start from the main types entry point
  const entryPoints = findTypesEntry(pkg);

  let selectedTypesEntry = null;
  for (const entry of entryPoints) {
    const fullPath = path.join(packageDir, entry);
    if (fs.existsSync(fullPath)) {
      selectedTypesEntry = entry;
      parseTypesRecursively(fullPath, packageDir, allExports, visited);
      break;
    }
  }

  result.exports = allExports;
  const runtime = await inspectRuntimeExports(packageDir, pkg);
  result.symbols = buildSymbols({
    packageName: pkg.name,
    subpath: null,
    runtimeNames: runtime.runtimeNames,
    categorized: runtime.categorized,
    runtimePath: runtime.runtimePath,
    runtimeAvailable: runtime.runtimeAvailable,
    typeInfo: allExports,
    typesPath: selectedTypesEntry,
    typesSource: selectedTypesEntry ? 'package' : null,
  });
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
    symbols: compareSymbols(fromAnalysis.symbols || [], toAnalysis.symbols || []),
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
