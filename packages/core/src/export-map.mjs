import semver from 'semver';

function normalizeSubpath(subpath) {
  if (!subpath || subpath === '.') return '.';
  return subpath.startsWith('./') ? subpath : `./${subpath}`;
}

export function packageExportEntry(pkg, subpath = '.') {
  const exportsField = pkg?.exports;
  const normalized = normalizeSubpath(subpath);
  if (!exportsField) return { found: false, entry: null, subpath: normalized };
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
    return {
      found: normalized === '.',
      entry: normalized === '.' ? exportsField : null,
      subpath: normalized,
    };
  }
  if (typeof exportsField !== 'object') {
    return { found: false, entry: null, subpath: normalized };
  }
  if (Object.hasOwn(exportsField, normalized)) {
    return { found: true, entry: exportsField[normalized], subpath: normalized };
  }
  const hasSubpathKeys = Object.keys(exportsField).some((key) => key.startsWith('.'));
  if (normalized === '.' && !hasSubpathKeys) {
    return { found: true, entry: exportsField, subpath: normalized };
  }
  return { found: false, entry: null, subpath: normalized };
}

export function resolveConditionalTarget(entry, conditions, matched = []) {
  if (!entry) return null;
  if (typeof entry === 'string') return { path: entry, conditions: matched };
  if (Array.isArray(entry)) {
    for (const candidate of entry) {
      const resolved = resolveConditionalTarget(candidate, conditions, matched);
      if (resolved) return resolved;
    }
    return null;
  }
  if (typeof entry !== 'object') return null;
  for (const condition of conditions) {
    if (!Object.hasOwn(entry, condition)) continue;
    const resolved = resolveConditionalTarget(entry[condition], conditions, [
      ...matched,
      condition,
    ]);
    if (resolved) return resolved;
  }
  return null;
}

export function resolveExportTarget(pkg, options = {}) {
  const subpath = normalizeSubpath(options.subpath);
  const exportEntry = packageExportEntry(pkg, subpath);
  if (!exportEntry.found) return null;
  const conditions =
    Array.isArray(options.conditions) && options.conditions.length > 0
      ? [...new Set(options.conditions.map(String))]
      : ['node', 'import', 'default'];
  const resolved = resolveConditionalTarget(exportEntry.entry, conditions);
  return resolved ? { ...resolved, subpath } : null;
}

function matchPattern(pattern, request) {
  if (pattern === request) return '';
  const star = pattern.indexOf('*');
  if (star === -1) return null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!request.startsWith(prefix) || !request.endsWith(suffix)) return null;
  return request.slice(prefix.length, request.length - suffix.length);
}

export function resolveTypesVersionTarget(pkg, subpath = '', typescriptVersion = null) {
  const versions = pkg?.typesVersions;
  if (!versions || typeof versions !== 'object') return null;
  const activeVersion = semver.coerce(typescriptVersion)?.version;
  const range = Object.keys(versions).find((candidate) => {
    if (candidate === '*') return true;
    return activeVersion && semver.satisfies(activeVersion, candidate, { includePrerelease: true });
  });
  if (!range) return null;
  const mappings = versions[range];
  const request = String(subpath || '').replace(/^\.\//, '');
  for (const [pattern, targets] of Object.entries(mappings || {})) {
    const wildcard = matchPattern(pattern, request);
    if (wildcard === null) continue;
    const target = Array.isArray(targets) ? targets[0] : targets;
    if (typeof target !== 'string') continue;
    return target.includes('*') ? target.replaceAll('*', wildcard) : target;
  }
  return null;
}

export function listExportSubpaths(pkg) {
  if (!pkg?.exports || typeof pkg.exports !== 'object' || Array.isArray(pkg.exports)) return ['.'];
  const subpaths = Object.keys(pkg.exports).filter(
    (key) => key.startsWith('.') && !key.includes('*')
  );
  return subpaths.length > 0 ? subpaths : ['.'];
}
