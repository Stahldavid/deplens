export function createInspectSnapshot(meta = {}) {
  return {
    schemaVersion: 1,
    package: null,
    version: null,
    description: null,
    exports: null,
    staticExports: null,
    types: null,
    docs: null,
    sections: null,
    examples: null,
    jsdoc: null,
    symbols: null,
    sourceAnalysis: null,
    languageAnalysis: null,
    resolution: null,
    pkgDir: null,
    meta: { ...meta },
    warnings: [],
  };
}

export function recordTiming(snapshot, phase, startedAt) {
  if (!snapshot?.meta) return;
  snapshot.meta.timings ??= {};
  snapshot.meta.timings[phase] = Number((performance.now() - startedAt).toFixed(2));
}
