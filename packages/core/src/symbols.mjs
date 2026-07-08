function addSymbol(symbolMap, key, seed) {
  if (!symbolMap.has(key)) {
    symbolMap.set(key, {
      name: seed.name,
      exportName: seed.exportName,
      package: seed.packageName || null,
      subpath: seed.subpath || '.',
      facets: [],
      availability: 'unknown',
    });
  }
  return symbolMap.get(key);
}

function addFacet(symbol, facet) {
  if (!symbol.facets.includes(facet)) {
    symbol.facets.push(facet);
  }
}

function runtimeKindForName(name, categorized) {
  if (categorized.functions?.includes(name)) return 'function';
  if (categorized.classes?.includes(name)) return 'class';
  if (categorized.objects?.includes(name)) return 'object';
  if (categorized.constants?.includes(name)) return 'constant';
  return 'primitive';
}

function typeEntries(typeInfo) {
  const entries = [];
  for (const [name, info] of Object.entries(typeInfo?.functions || {})) {
    entries.push({
      name,
      kind: 'function',
      signature: `${name}(${info.params || ''}): ${info.returnType || 'unknown'}`,
      params: info.params || '',
      returnType: info.returnType || null,
    });
  }
  for (const [name, properties] of Object.entries(typeInfo?.interfaces || {})) {
    entries.push({ name, kind: 'interface', properties });
  }
  for (const [name, info] of Object.entries(typeInfo?.types || {})) {
    const definition =
      typeof info === 'string' ? info : info?.type || info?.definition || info?.signature || null;
    entries.push({ name, kind: 'type', signature: definition, definition });
  }
  for (const [name, extendsClause] of Object.entries(typeInfo?.classes || {})) {
    entries.push({ name, kind: 'class', extends: extendsClause || null });
  }
  for (const [name, members] of Object.entries(typeInfo?.enums || {})) {
    entries.push({ name, kind: 'enum', members });
  }
  for (const [name, members] of Object.entries(typeInfo?.namespaces || {})) {
    entries.push({ name, kind: 'namespace', members });
  }
  return entries;
}

function normalizeJsdoc(doc) {
  if (!doc) return null;
  return {
    summary: doc.summary || '',
    tags: doc.tags || {},
  };
}

function availabilityFor(symbol) {
  const hasRuntime = symbol.facets.includes('runtime');
  const hasTypes = symbol.facets.includes('types');
  const hasDocs = symbol.facets.includes('docs');
  const hasSource = symbol.facets.includes('source');
  if (hasRuntime && hasTypes && hasSource && hasDocs) return 'runtime+types+source+docs';
  if (hasRuntime && hasTypes && hasSource) return 'runtime+types+source';
  if (hasRuntime && hasTypes && hasDocs) return 'runtime+types+docs';
  if (hasRuntime && hasTypes) return 'runtime+types';
  if (hasTypes && hasSource) return hasDocs ? 'types+source+docs' : 'types+source';
  if (hasRuntime && hasSource) return hasDocs ? 'runtime+source+docs' : 'runtime+source';
  if (hasRuntime) return hasDocs ? 'runtime+docs' : 'runtime-only';
  if (hasTypes) return hasDocs ? 'types+docs' : 'types-only';
  if (hasSource) return hasDocs ? 'source+docs' : 'source-only';
  if (hasDocs) return 'docs-only';
  return 'unknown';
}

function sourceEntries(sourceAnalysis) {
  const entries = [];
  for (const file of sourceAnalysis?.files || []) {
    for (const [name, info] of Object.entries(file.functions || {})) {
      entries.push({
        name,
        path: file.path,
        kind: name.includes('.') ? 'method' : 'function',
        exported: Boolean(info.exported),
        async: Boolean(info.async),
        params: info.params || [],
        returnType: info.returnType || null,
        complexity: info.complexity,
        lines: info.lines,
        dependencies: info.dependencies || [],
        patterns: info.patterns || [],
      });
    }
  }
  return entries;
}

export function buildSymbols({
  packageName,
  subpath,
  runtimeNames = [],
  categorized = {},
  runtimePath = null,
  runtimeAvailable = false,
  runtimeCondition = null,
  typeInfo = null,
  typesPath = null,
  typesSource = null,
  typesCondition = null,
}) {
  const symbolMap = new Map();
  const normalizedSubpath = subpath ? `./${subpath}` : '.';

  for (const name of runtimeNames) {
    const symbol = addSymbol(symbolMap, name, {
      name,
      exportName: name,
      packageName,
      subpath: normalizedSubpath,
    });
    addFacet(symbol, 'runtime');
    symbol.runtime = {
      kind: runtimeKindForName(name, categorized),
      path: runtimePath,
      condition: runtimeCondition,
      available: runtimeAvailable,
    };
  }

  for (const entry of typeEntries(typeInfo)) {
    const symbol = addSymbol(symbolMap, entry.name, {
      name: entry.name,
      exportName: entry.name,
      packageName,
      subpath: normalizedSubpath,
    });
    addFacet(symbol, 'types');
    symbol.types = {
      kind: entry.kind,
      path: typesPath,
      source: typesSource || null,
      condition: typesCondition,
      signature: entry.signature || null,
      params: entry.params,
      returnType: entry.returnType,
      properties: entry.properties,
      definition: entry.definition,
      extends: entry.extends,
      members: entry.members,
    };
  }

  for (const [name, doc] of Object.entries(typeInfo?.jsdoc || {})) {
    const symbol = addSymbol(symbolMap, name, {
      name,
      exportName: name,
      packageName,
      subpath: normalizedSubpath,
    });
    addFacet(symbol, 'docs');
    symbol.docs = {
      source: 'jsdoc',
      ...normalizeJsdoc(doc),
    };
  }

  const symbols = [...symbolMap.values()].map((symbol) => ({
    ...symbol,
    availability: availabilityFor(symbol),
  }));

  symbols.sort((a, b) => a.exportName.localeCompare(b.exportName));
  return symbols;
}

export function enrichSymbolsWithSource(symbols = [], sourceAnalysis = null) {
  if (!sourceAnalysis || sourceAnalysis.error) return symbols;
  const symbolMap = new Map(symbols.map((symbol) => [symbol.exportName || symbol.name, { ...symbol }]));

  for (const entry of sourceEntries(sourceAnalysis)) {
    const exportName = entry.name.includes('.') ? entry.name.split('.')[0] : entry.name;
    const symbol = symbolMap.get(exportName) || {
      name: exportName,
      exportName,
      package: symbols[0]?.package || null,
      subpath: symbols[0]?.subpath || '.',
      facets: [],
      availability: 'unknown',
    };
    addFacet(symbol, 'source');
    symbol.source = {
      kind: entry.kind,
      path: entry.path,
      exported: entry.exported,
      async: entry.async,
      params: entry.params,
      returnType: entry.returnType,
      complexity: entry.complexity,
      lines: entry.lines,
      dependencies: entry.dependencies,
      patterns: entry.patterns,
      implementationName: entry.name,
    };
    symbol.availability = availabilityFor(symbol);
    symbolMap.set(exportName, symbol);
  }

  return [...symbolMap.values()].sort((a, b) => a.exportName.localeCompare(b.exportName));
}

export default {
  buildSymbols,
  enrichSymbolsWithSource,
};
