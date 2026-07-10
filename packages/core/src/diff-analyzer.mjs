/**
 * diff-analyzer.mjs - Semantic comparison of package versions
 * Detects breaking changes, additions, and modifications
 * Self-contained: no dependencies on inspect.mjs or fast-glob
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { getCachedDtsParse } from './inspect-types.mjs';
import { buildSymbols } from './symbols.mjs';
import { runSourceAnalysis } from './inspect-source.mjs';

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
  const text =
    typeof type === 'string'
      ? type
      : type.type || type.definition || type.signature || String(type);
  return text
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
  const fromParams = Array.isArray(from.params) ? from.params : parseParamText(from.params || '');
  const toParams = Array.isArray(to.params) ? to.params : parseParamText(to.params || '');

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
    } else if (fromParam.optional && !toParam.optional) {
      changes.push({
        type: 'param_became_required',
        severity: Severity.BREAKING,
        detail: `Parameter '${toParam.name}' became required`,
      });
    } else if (!fromParam.optional && toParam.optional) {
      changes.push({
        type: 'param_became_optional',
        severity: Severity.SAFE,
        detail: `Parameter '${toParam.name}' became optional`,
      });
    } else if (Boolean(fromParam.rest) !== Boolean(toParam.rest)) {
      changes.push({
        type: 'param_rest_changed',
        severity: Severity.BREAKING,
        detail: `Parameter '${toParam.name}' rest modifier changed`,
      });
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

  const fromOverloads = from.overloads || [];
  const toOverloads = to.overloads || [];
  if (toOverloads.length < fromOverloads.length) {
    changes.push({
      type: 'overload_removed',
      severity: Severity.BREAKING,
      detail: `Function overload count decreased: ${fromOverloads.length} → ${toOverloads.length}`,
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
    } else if (fromProp.optional && !toProp.optional) {
      changes.push({
        type: 'property_became_required',
        severity: Severity.BREAKING,
        detail: `Property '${name}' became required`,
      });
    } else if (!fromProp.optional && toProp.optional) {
      changes.push({
        type: 'property_became_optional',
        severity: Severity.WARNING,
        detail: `Property '${name}' became optional`,
      });
    } else if (Boolean(fromProp.readonly) !== Boolean(toProp.readonly)) {
      changes.push({
        type: 'property_readonly_changed',
        severity: Severity.WARNING,
        detail: `Property '${name}' readonly modifier changed`,
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
    return parseParamText(params);
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
    memberValues: facet.memberValues || null,
    overloads: facet.overloads || [],
    constructors: facet.constructors || [],
    methods: facet.methods || null,
    typeParameters: facet.typeParameters || [],
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
        severity: Severity.BREAKING,
        detail: `${facet} kind changed: ${fromFacet.kind || 'unknown'} → ${toFacet.kind || 'unknown'}`,
      });
    }
    if (JSON.stringify(fromFacet.params) !== JSON.stringify(toFacet.params)) {
      const parameterChanges = compareFunctionSignatures(
        { params: fromFacet.params, returnType: fromFacet.returnType },
        { params: toFacet.params, returnType: toFacet.returnType }
      ).filter((change) => change.type.startsWith('param_'));
      changes.push({
        kind: 'params_changed',
        facet,
        severity: parameterChanges.some((change) => change.severity === Severity.BREAKING)
          ? Severity.BREAKING
          : Severity.WARNING,
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
    for (const propertyChange of compareProperties(fromFacet.properties, toFacet.properties)) {
      changes.push({
        kind: propertyChange.type,
        facet,
        severity: propertyChange.severity,
        detail: propertyChange.detail,
      });
    }
    if (JSON.stringify(fromFacet.extends) !== JSON.stringify(toFacet.extends)) {
      changes.push({
        kind: 'extends_changed',
        facet,
        severity: Severity.BREAKING,
        detail: `${facet} inheritance changed`,
      });
    }
    const fromMembers = Array.isArray(fromFacet.members) ? fromFacet.members : [];
    const toMembers = Array.isArray(toFacet.members) ? toFacet.members : [];
    for (const member of fromMembers) {
      if (!toMembers.includes(member)) {
        changes.push({
          kind: 'member_removed',
          facet,
          severity: Severity.BREAKING,
          detail: `Member '${member}' was removed`,
        });
      }
    }
    const changedEnumValue = Object.entries(fromFacet.memberValues || {}).some(
      ([name, value]) =>
        Object.prototype.hasOwnProperty.call(toFacet.memberValues || {}, name) &&
        toFacet.memberValues[name] !== value
    );
    if (changedEnumValue) {
      changes.push({
        kind: 'enum_values_changed',
        facet,
        severity: Severity.BREAKING,
        detail: `${facet} enum values changed`,
      });
    }
    const fromMethods = fromFacet.methods || {};
    const toMethods = toFacet.methods || {};
    for (const methodName of Object.keys(fromMethods)) {
      if (!(methodName in toMethods)) {
        changes.push({
          kind: 'method_removed',
          facet,
          severity: Severity.BREAKING,
          detail: `Method '${methodName}' was removed`,
        });
      } else if (
        JSON.stringify(fromMethods[methodName]) !== JSON.stringify(toMethods[methodName])
      ) {
        changes.push({
          kind: 'method_changed',
          facet,
          severity: Severity.WARNING,
          detail: `Method '${methodName}' changed`,
        });
      }
    }
    for (const methodName of Object.keys(toMethods)) {
      if (!(methodName in fromMethods)) {
        changes.push({
          kind: 'method_added',
          facet,
          severity: Severity.SAFE,
          detail: `Method '${methodName}' was added`,
        });
      }
    }
    if (toFacet.constructors.length < fromFacet.constructors.length) {
      changes.push({
        kind: 'constructor_removed',
        facet,
        severity: Severity.BREAKING,
        detail: 'A public constructor overload was removed',
      });
    } else if (JSON.stringify(fromFacet.constructors) !== JSON.stringify(toFacet.constructors)) {
      changes.push({
        kind: 'constructors_changed',
        facet,
        severity: Severity.WARNING,
        detail: 'Public constructors changed',
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
      additions: changes.filter(
        (change) => change.kind === 'symbol_added' || change.kind === 'facet_added'
      ).length,
      removals: changes.filter(
        (change) => change.kind === 'symbol_removed' || change.kind === 'facet_removed'
      ).length,
    },
  };
}

function buildNameMatcher(filter) {
  if (!filter) return null;
  const raw = String(filter);
  if (raw.startsWith('/') && raw.endsWith('/') && raw.length > 2) {
    try {
      const regex = new RegExp(raw.slice(1, -1), 'i');
      return (name) => regex.test(String(name));
    } catch {
      // fall through to substring matching
    }
  }
  if (raw.includes('*')) {
    const escaped = raw.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`, 'i');
    return (name) => regex.test(String(name));
  }
  const needle = raw.toLowerCase();
  return (name) => String(name).toLowerCase().includes(needle);
}

function filterMapByName(map, matcher) {
  if (!matcher) return map;
  return Object.fromEntries(Object.entries(map || {}).filter(([name]) => matcher(name)));
}

function filterAnalysisByName(analysis, matcher) {
  if (!matcher || !analysis?.exports) return analysis;
  const exports = {};
  for (const category of [
    'functions',
    'classes',
    'interfaces',
    'types',
    'enums',
    'namespaces',
    'jsdoc',
  ]) {
    exports[category] = filterMapByName(analysis.exports[category], matcher);
  }
  return {
    ...analysis,
    exports,
    symbols: (analysis.symbols || []).filter((symbol) => matcher(symbol.exportName || symbol.name)),
  };
}

function parseParamText(params) {
  if (!params || typeof params !== 'string') return [];
  if (/^\d+ params?$/.test(params)) return [];
  return splitTopLevel(params)
    .map((rawParam, index) => {
      const trimmed = rawParam.trim();
      if (!trimmed) return null;
      const colonIndex = trimmed.indexOf(':');
      const rawName = colonIndex === -1 ? trimmed : trimmed.slice(0, colonIndex).trim();
      const rawType = colonIndex === -1 ? 'any' : trimmed.slice(colonIndex + 1).trim();
      return {
        name: rawName.replace(/^\.\.\./, '').replace(/\?$/, '') || `arg${index + 1}`,
        type: rawType || 'any',
        optional: rawName.endsWith('?'),
        rest: rawName.startsWith('...'),
      };
    })
    .filter(Boolean);
}

function splitTopLevel(text) {
  const parts = [];
  let current = '';
  let quote = null;
  const depth = { '<': 0, '(': 0, '[': 0, '{': 0 };
  const pairs = { '>': '<', ')': '(', ']': '[', '}': '{' };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      current += char;
      if (char === quote && text[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char in depth) depth[char] += 1;
    if (char in pairs) depth[pairs[char]] = Math.max(0, depth[pairs[char]] - 1);
    if (char === ',' && Object.values(depth).every((value) => value === 0)) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function propertiesFromList(properties) {
  if (!Array.isArray(properties)) return null;
  return Object.fromEntries(
    properties
      .map((rawProperty) => {
        const text = String(rawProperty).trim();
        const colonIndex = text.indexOf(':');
        if (colonIndex === -1) return null;
        const rawName = text.slice(0, colonIndex).trim();
        const name = rawName.replace(/\?$/, '');
        return [
          name,
          {
            type: text.slice(colonIndex + 1).trim() || 'any',
            optional: rawName.endsWith('?'),
          },
        ];
      })
      .filter(Boolean)
  );
}

function mergeParsedDtsExports(target, parsed) {
  if (!parsed) return;
  for (const [name, info] of Object.entries(parsed.functions || {})) {
    if (target.functions[name]) continue;
    target.functions[name] = {
      params: info.parameters || parseParamText(info.params),
      returnType: info.returnType || 'void',
      overloads: info.overloads || [],
    };
  }
  for (const [name, properties] of Object.entries(parsed.interfaces || {})) {
    if (target.interfaces[name]) continue;
    const details = parsed.interfaceDetails?.[name];
    target.interfaces[name] = {
      properties: details?.properties || propertiesFromList(properties) || {},
      methods: details?.methods || {},
      extends: details?.extends || [],
    };
  }
  for (const [name, type] of Object.entries(parsed.types || {})) {
    if (target.types[name]) continue;
    target.types[name] = { type: typeof type === 'string' ? type : normalizeType(type) };
  }
  for (const [name, classInfo] of Object.entries(parsed.classes || {})) {
    if (target.classes[name]) continue;
    target.classes[name] = {
      extends:
        classInfo && typeof classInfo === 'object' ? classInfo.extends || null : classInfo || null,
      localName: classInfo && typeof classInfo === 'object' ? classInfo.localName || null : null,
      methods: {},
      properties: classInfo && typeof classInfo === 'object' ? classInfo.properties || {} : {},
      constructors: classInfo && typeof classInfo === 'object' ? classInfo.constructors || [] : [],
    };
    if (classInfo && typeof classInfo === 'object') {
      target.classes[name].methods = classInfo.methods || {};
    }
  }
  for (const [name, members] of Object.entries(parsed.enums || {})) {
    if (target.enums[name]) continue;
    target.enums[name] = {
      members: Array.isArray(members) ? members : [],
      memberValues: parsed.enumDetails?.[name] || {},
    };
  }
  Object.assign(target.namespaces, parsed.namespaces || {});
  Object.assign(target.jsdoc, parsed.jsdoc || {});
  Object.assign(target.variables, parsed.variables || {});
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

function declarationCandidates(entry) {
  if (!entry || typeof entry !== 'string') return [];
  const normalized = entry
    .replace(/\.cjs$/i, '.d.cts')
    .replace(/\.mjs$/i, '.d.mts')
    .replace(/\.js$/i, '.d.ts');
  return /\.d\.(?:ts|cts|mts)$/i.test(normalized)
    ? [normalized]
    : [`${normalized}.d.ts`, `${normalized}.d.cts`, `${normalized}.d.mts`];
}

function findTypeEntrypoints(pkg) {
  const entries = [{ subpath: '.', candidates: findTypesEntry(pkg) }];
  if (!pkg.exports || typeof pkg.exports !== 'object' || Array.isArray(pkg.exports)) {
    return entries;
  }
  const exportKeys = Object.keys(pkg.exports).filter((key) => key.startsWith('.'));
  for (const subpath of exportKeys) {
    if (subpath === '.' || subpath === './' || subpath.includes('*')) continue;
    const target = resolveConditionalExport(pkg.exports[subpath], [
      'types',
      'typings',
      'import',
      'require',
      'default',
    ]);
    if (target) entries.push({ subpath, candidates: declarationCandidates(target) });
  }
  return entries;
}

function findRuntimeEntry(pkg) {
  const rootExport = typeof pkg.exports === 'object' ? pkg.exports['.'] || pkg.exports : null;
  const exportRuntime = resolveConditionalExport(rootExport, [
    'import',
    'require',
    'node',
    'default',
  ]);
  return [exportRuntime, pkg.module, pkg.main, 'index.js', 'index.mjs', 'index.cjs'].filter(
    Boolean
  );
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
  if (pkg?.__deplensRuntimeDisabled) {
    return { runtimeNames: [], categorized: {}, runtimePath: null, runtimeAvailable: false };
  }
  const entry = findRuntimeEntry(pkg).find((candidate) =>
    fs.existsSync(path.join(packageDir, candidate))
  );
  if (!entry)
    return { runtimeNames: [], categorized: {}, runtimePath: null, runtimeAvailable: false };
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
  if (options.runtime === false || options.noRuntime === true) {
    pkg.__deplensRuntimeDisabled = true;
  }

  const result = {
    version: pkg.version,
    name: pkg.name,
    exports: {
      functions: {},
      classes: {},
      interfaces: {},
      types: {},
      enums: {},
      variables: {},
    },
  };

  const allExports = {
    functions: {},
    classes: {},
    interfaces: {},
    types: {},
    enums: {},
    namespaces: {},
    jsdoc: {},
    variables: {},
  };

  const typeEntrypoints = findTypeEntrypoints(pkg);
  let selectedTypesEntry = null;
  let rootTypeInfo = null;
  const subpathSymbols = [];
  for (const typeEntrypoint of typeEntrypoints) {
    const entry = typeEntrypoint.candidates.find((candidate) =>
      fs.existsSync(path.resolve(packageDir, candidate))
    );
    if (!entry) continue;
    const fullPath = path.resolve(packageDir, entry);
    const parsed = await getCachedDtsParse(fullPath);
    if (!parsed) continue;
    if (typeEntrypoint.subpath === '.') {
      selectedTypesEntry = entry;
      rootTypeInfo = parsed;
      mergeParsedDtsExports(allExports, parsed);
    } else {
      subpathSymbols.push(
        ...buildSymbols({
          packageName: pkg.name,
          subpath: typeEntrypoint.subpath.slice(2),
          typeInfo: parsed,
          typesPath: entry,
          typesSource: 'exports',
        })
      );
    }
  }

  result.exports = allExports;
  if (options.includeSource) {
    const sourceResult = await runSourceAnalysis({
      pkgDir: packageDir,
      filterRaw: options.filter || null,
      sourceMaxFiles: options.sourceMaxFiles || 100,
      sourceIncludeBody: Boolean(options.sourceIncludeBody),
      forcedLanguage: options.language || null,
      log: () => {},
    });
    const sourceAnalysis = sourceResult.sourceAnalysis || sourceResult.languageAnalysis || null;
    if (sourceAnalysis && !sourceAnalysis.error) {
      result.sourceAnalysis = sourceAnalysis;
    }
  }
  const runtime = await inspectRuntimeExports(packageDir, pkg);
  result.symbols = [
    ...buildSymbols({
      packageName: pkg.name,
      subpath: null,
      runtimeNames: runtime.runtimeNames,
      categorized: runtime.categorized,
      runtimePath: runtime.runtimePath,
      runtimeAvailable: runtime.runtimeAvailable,
      typeInfo: rootTypeInfo,
      typesPath: selectedTypesEntry,
      typesSource: selectedTypesEntry ? 'package' : null,
    }),
    ...subpathSymbols,
  ];
  return result;
}

/**
 * Compare two package versions
 */
export async function compareVersions(fromDir, toDir, options = {}) {
  const { filter, includeSource = false, runtime = true } = options;
  const matcher = buildNameMatcher(filter);

  // Analyze both versions
  let [fromAnalysis, toAnalysis] = await Promise.all([
    analyzePackageTypes(fromDir, { filter, includeSource, runtime }),
    analyzePackageTypes(toDir, { filter, includeSource, runtime }),
  ]);
  fromAnalysis = filterAnalysisByName(fromAnalysis, matcher);
  toAnalysis = filterAnalysisByName(toAnalysis, matcher);

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

  const legacySummary = { ...diff.summary };
  if (diff.symbols.fromCount > 0 || diff.symbols.toCount > 0) {
    const sourceWarnings = diff.warnings.filter((change) => change.category === 'source').length;
    diff.summary = {
      breaking: diff.symbols.summary.breaking,
      warnings: diff.symbols.summary.warnings + sourceWarnings,
      additions: diff.symbols.summary.additions,
      removals: diff.symbols.summary.removals,
      legacy: legacySummary,
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

  const subpathChanges = (diff.symbols?.changes || []).filter(
    (change) => change.subpath && change.subpath !== '.'
  );
  if (subpathChanges.length > 0) {
    lines.push(`${bold}PUBLIC SUBPATH CHANGES (${subpathChanges.length}):${reset}`);
    for (const change of subpathChanges) {
      const marker = change.severity === Severity.BREAKING ? '-' : '+';
      lines.push(`   ${marker} ${change.subpath}: ${change.detail}`);
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
