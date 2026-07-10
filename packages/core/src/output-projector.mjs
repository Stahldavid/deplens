const DEFAULT_COMPACT_SECTIONS = new Set([
  'package',
  'version',
  'resolution',
  'staticExports',
  'exports',
  'symbols',
  'meta',
  'warnings',
  'error',
  'errorInfo',
]);

function normalizeSelect(select, detail) {
  if (Array.isArray(select) && select.length > 0) return new Set(select.map(String));
  return detail === 'compact' ? DEFAULT_COMPACT_SECTIONS : null;
}

function compactSymbol(symbol) {
  return {
    exportName: symbol.exportName,
    subpath: symbol.subpath || '.',
    facets: symbol.facets || [],
    availability: symbol.availability || 'unknown',
    kind: symbol.types?.kind || symbol.runtime?.kind || symbol.source?.kind || null,
    signature: symbol.types?.signature || symbol.types?.definition || null,
  };
}

export function projectInspectResult(payload, options = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const detail = options.detail === 'full' ? 'full' : 'compact';
  const selected = normalizeSelect(options.select, detail);
  const maxSymbols = Math.max(1, Number(options.maxSymbols) || 250);
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
    result[key] = value;
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
