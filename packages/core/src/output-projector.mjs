const DEFAULT_COMPACT_SECTIONS = new Set([
  'package',
  'version',
  'pkgDir',
  'resolution',
  'staticExports',
  'exports',
  'symbols',
  'meta',
  'warnings',
  'error',
  'errorInfo',
]);
const REQUIRED_ENVELOPE_SECTIONS = [
  'package',
  'version',
  'pkgDir',
  'resolution',
  'meta',
  'warnings',
  'error',
  'errorInfo',
];
const REPEATED_PAGE_SECTIONS = new Set(['exports', 'staticExports']);

function isEmptyObject(value) {
  return (
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0
  );
}

function compactValue(value) {
  if (Array.isArray(value)) {
    return value.map(compactValue).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') {
    if (value === null || value === false || value === undefined) return undefined;
    return value;
  }
  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'trace') continue;
    const compacted = compactValue(nested);
    if (compacted === undefined) continue;
    if (Array.isArray(compacted) && compacted.length === 0) continue;
    if (isEmptyObject(compacted)) continue;
    result[key] = compacted;
  }
  return result;
}

function compactResolution(value) {
  const compacted = compactValue(value) || {};
  if (
    compacted.entrypointPath &&
    compacted.resolved &&
    compacted.entrypointPath === compacted.resolved
  ) {
    delete compacted.resolved;
  }
  if (
    compacted.resolveCwd &&
    compacted.resolveFrom &&
    compacted.resolveCwd === compacted.resolveFrom
  ) {
    delete compacted.resolveFrom;
  }
  return compacted;
}

function normalizeSelect(select, include, detail, focused) {
  if (Array.isArray(select) && select.length > 0) {
    return new Set([...REQUIRED_ENVELOPE_SECTIONS, ...select.map(String)]);
  }
  if (detail !== 'compact' && !focused) return null;
  const selected = new Set([...DEFAULT_COMPACT_SECTIONS, ...(include || []).map(String)]);
  if (focused) {
    selected.delete('symbols');
    selected.delete('exports');
    selected.delete('staticExports');
  }
  return selected;
}

function compactSymbol(symbol) {
  return compactValue({
    exportName: symbol.exportName,
    subpath: symbol.subpath || '.',
    facets: symbol.facets || [],
    availability: symbol.availability || 'unknown',
    kind: symbol.types?.kind || symbol.runtime?.kind || symbol.source?.kind || null,
    signature: symbol.types?.signature || symbol.types?.definition || null,
  });
}

function compactStaticExports(value, options, offset, maxSymbols) {
  const names = Array.isArray(value?.names) ? value.names : [];
  if (!options.select?.includes('staticExports')) {
    return { total: Number(value?.total) || names.length };
  }
  const page = names.slice(offset, offset + maxSymbols);
  return {
    total: Number(value?.total) || names.length,
    names: page,
    pagination: {
      total: names.length,
      offset,
      returned: page.length,
      nextCursor: offset + page.length < names.length ? String(offset + page.length) : null,
    },
  };
}

function compactSourceAnalysis(value) {
  const files = Array.isArray(value?.files)
    ? value.files.length
    : Number(value?.files ?? value?.summary?.totalFiles) || 0;
  return { files, summary: value?.summary || {} };
}

export function projectInspectResult(payload, options = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const detail = options.detail === 'full' ? 'full' : 'compact';
  const selected = normalizeSelect(options.select, options.include, detail, options.focused);
  const maxSymbols = Math.max(1, Number(options.maxSymbols) || 50);
  const cursorNumber = Number.parseInt(options.cursor || '0', 10);
  const offset = Number.isFinite(cursorNumber) && cursorNumber >= 0 ? cursorNumber : 0;
  const symbols = Array.isArray(payload.symbols) ? payload.symbols : [];
  const page = symbols.slice(offset, offset + maxSymbols);
  const result = {
    schemaVersion: 2,
    kind: 'deplens-inspect',
    detailLevel: detail,
  };

  for (const [key, value] of Object.entries(payload)) {
    if (key === 'schemaVersion' || key === 'symbols') continue;
    if (selected && !selected.has(key)) continue;
    if (
      detail === 'compact' &&
      offset > 0 &&
      !options.select?.includes(key) &&
      REPEATED_PAGE_SECTIONS.has(key)
    ) {
      continue;
    }
    if (detail === 'compact' && key === 'staticExports') {
      result[key] = compactStaticExports(value, options, offset, maxSymbols);
    } else if (detail === 'compact' && key === 'resolution') {
      result[key] = compactResolution(value);
    } else if (detail === 'compact' && key === 'sourceAnalysis') {
      result[key] = compactSourceAnalysis(value);
    } else if (detail === 'compact' && key === 'warnings') {
      result[key] = Array.isArray(value) ? value : [];
    } else {
      result[key] = detail === 'compact' ? compactValue(value) : value;
    }
  }
  if (!selected || selected.has('symbols')) {
    result.symbols = detail === 'compact' ? page.map(compactSymbol) : page;
    result.pagination = {
      total: symbols.length,
      offset,
      returned: page.length,
      nextCursor: offset + page.length < symbols.length ? String(offset + page.length) : null,
    };
  }
  return result;
}
