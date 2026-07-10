function normalizeSubpath(subpath) {
  if (!subpath) return '.';
  return subpath.startsWith('.') ? subpath : `./${subpath}`;
}

function getExportEntry(exportsField, subpath) {
  if (!exportsField) return { found: false, entry: null, key: normalizeSubpath(subpath) };
  const key = normalizeSubpath(subpath);
  if (typeof exportsField === 'string') {
    return { found: key === '.', entry: key === '.' ? exportsField : null, key };
  }
  if (typeof exportsField !== 'object') return { found: false, entry: null, key };
  if (Object.prototype.hasOwnProperty.call(exportsField, key)) {
    return { found: true, entry: exportsField[key], key };
  }
  if (key === '.' && Object.prototype.hasOwnProperty.call(exportsField, './')) {
    return { found: true, entry: exportsField['./'], key: './' };
  }
  return { found: false, entry: null, key };
}

function resolveConditionalEntry(entry, allowedConditions, path = []) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    return { path: entry, conditions: path };
  }
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const resolved = resolveConditionalEntry(item, allowedConditions, path);
      if (resolved) return resolved;
    }
    return null;
  }
  if (typeof entry !== 'object') return null;

  for (const [condition, value] of Object.entries(entry)) {
    if (!allowedConditions.includes(condition)) continue;
    const resolved = resolveConditionalEntry(value, allowedConditions, [...path, condition]);
    if (resolved) return resolved;
  }

  return null;
}

function runtimeConditionsForResolver(resolver, overrideConditions = null) {
  if (Array.isArray(overrideConditions) && overrideConditions.length > 0) {
    return overrideConditions;
  }
  if (resolver === 'require') return ['node', 'require', 'default'];
  return ['node', 'import', 'default'];
}

function normalizePath(value) {
  if (!value) return null;
  return String(value).replace(/\\/g, '/');
}

export function buildResolutionTrace({
  pkg = null,
  subpath = null,
  resolver = null,
  runtimePath = null,
  runtimeAvailable = false,
  typesPath = null,
  typesSource = null,
  explicitConditions = null,
}) {
  const normalizedSubpath = normalizeSubpath(subpath);
  const exportEntry = getExportEntry(pkg?.exports, normalizedSubpath);
  const runtimeConditions = runtimeConditionsForResolver(resolver, explicitConditions);
  const typesConditions = [
    'types',
    'typings',
    ...(Array.isArray(explicitConditions) ? explicitConditions : []),
    'default',
  ];
  const runtimeFromExports = exportEntry.found
    ? resolveConditionalEntry(exportEntry.entry, runtimeConditions)
    : null;
  const typesFromExports = exportEntry.found
    ? resolveConditionalEntry(exportEntry.entry, typesConditions)
    : null;

  return {
    targetSubpath: normalizedSubpath,
    hasExportsMap: Boolean(pkg?.exports),
    exportEntryFound: exportEntry.found,
    exportEntryKey: exportEntry.key,
    runtime: {
      resolver: resolver || null,
      source: runtimeFromExports ? 'exports' : runtimePath ? 'resolver' : null,
      conditionsTried: runtimeConditions,
      conditionsMatched: runtimeFromExports?.conditions || [],
      exportPath: normalizePath(runtimeFromExports?.path),
      resolvedPath: normalizePath(runtimePath),
      available: Boolean(runtimeAvailable),
    },
    types: {
      source: typesSource || null,
      conditionsTried: typesConditions,
      conditionsMatched: typesFromExports?.conditions || [],
      exportPath: normalizePath(typesFromExports?.path),
      resolvedPath: normalizePath(typesPath),
    },
  };
}

export default {
  buildResolutionTrace,
};
