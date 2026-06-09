import { runInspectCore } from './inspect-core.mjs';

function addCheck(checks, id, ok, message, details = null) {
  const passed = Boolean(ok);
  checks.push({
    id,
    ok: passed,
    status: passed ? 'pass' : 'fail',
    message,
    ...(details ? { details } : {}),
  });
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function buildDoctorReport(inspectResult, options = {}) {
  const warnings = inspectResult?.warnings || [];
  const resolution = inspectResult?.resolution || {};
  const trace = resolution.trace || null;
  const checks = [];
  const suggestions = [];

  const hasPackage = Boolean(inspectResult?.package);
  const hasEntrypoint = Boolean(resolution.entrypointExists);
  const hasTypes = Boolean(resolution.typesPath || inspectResult?.types);
  const hasRuntimeSymbols = (inspectResult?.symbols || []).some((symbol) =>
    symbol.facets?.includes('runtime')
  );
  const hasTypeSymbols = (inspectResult?.symbols || []).some((symbol) =>
    symbol.facets?.includes('types')
  );

  addCheck(
    checks,
    'package-resolution',
    hasPackage,
    hasPackage
      ? `Resolved package ${inspectResult.package}${inspectResult.version ? `@${inspectResult.version}` : ''}`
      : `Could not resolve package for ${options.target || resolution.target || 'target'}`,
    {
      resolveFrom: resolution.resolveFrom || null,
      resolveCwd: resolution.resolveCwd || null,
      pkgDir: inspectResult?.pkgDir || null,
    }
  );

  addCheck(
    checks,
    'runtime-entrypoint',
    hasEntrypoint,
    hasEntrypoint
      ? `Runtime entrypoint exists at ${resolution.runtimePath || resolution.entrypointPath}`
      : 'Runtime entrypoint is unavailable on disk',
    {
      resolved: resolution.resolved || null,
      entrypointPath: resolution.entrypointPath || null,
      runtimePath: resolution.runtimePath || null,
      resolver: trace?.runtime?.resolver || null,
      conditionsMatched: trace?.runtime?.conditionsMatched || [],
    }
  );

  addCheck(
    checks,
    'type-resolution',
    hasTypes,
    hasTypes
      ? `Type declarations resolved from ${resolution.typesSource || 'package'}`
      : 'Type declarations were not found',
    {
      typesPath: resolution.typesPath || null,
      typesSource: resolution.typesSource || null,
      conditionsMatched: trace?.types?.conditionsMatched || [],
    }
  );

  addCheck(
    checks,
    'symbol-correlation',
    hasRuntimeSymbols || hasTypeSymbols,
    hasRuntimeSymbols && hasTypeSymbols
      ? 'Runtime and type symbols are available for correlation'
      : hasRuntimeSymbols
        ? 'Runtime symbols are available, but no type symbols were found'
        : hasTypeSymbols
          ? 'Type symbols are available, but runtime symbols were not found'
          : 'No runtime or type symbols were found',
    {
      runtimeSymbols: (inspectResult?.symbols || []).filter((symbol) =>
        symbol.facets?.includes('runtime')
      ).length,
      typeSymbols: (inspectResult?.symbols || []).filter((symbol) => symbol.facets?.includes('types'))
        .length,
    }
  );

  if (resolution.runtimeTypesDiverge) {
    suggestions.push(
      'Runtime and type declarations point to different files; inspect resolution.trace before assuming symbol parity.'
    );
  }

  if (!hasEntrypoint && hasTypes) {
    suggestions.push('Use --types for this target; runtime introspection is unavailable.');
  }

  if (!hasPackage) {
    suggestions.push('Try --resolve-from pointing at the package workspace or project root.');
    suggestions.push('If the package is not installed locally, try --remote.');
  }

  if (!hasTypes && hasPackage) {
    suggestions.push('Try --types with a package that ships declarations or install the matching @types package.');
  }

  if (trace?.hasExportsMap && !trace.exportEntryFound) {
    suggestions.push(
      `The package has an exports map but no entry for ${trace.targetSubpath}; check available subpath exports.`
    );
  }

  return {
    schemaVersion: 1,
    target: options.target || resolution.target || null,
    package: inspectResult?.package || null,
    version: inspectResult?.version || null,
    status: checks.every((check) => check.ok) ? 'ok' : 'issues',
    summary: {
      checks: checks.length,
      passed: checks.filter((check) => check.ok).length,
      failed: checks.filter((check) => !check.ok).length,
      warnings: warnings.length,
    },
    resolution,
    checks,
    suggestions: unique(suggestions),
    warnings,
    symbols: {
      total: inspectResult?.symbols?.length || 0,
      runtime: (inspectResult?.symbols || []).filter((symbol) => symbol.facets?.includes('runtime'))
        .length,
      types: (inspectResult?.symbols || []).filter((symbol) => symbol.facets?.includes('types'))
        .length,
      docs: (inspectResult?.symbols || []).filter((symbol) => symbol.facets?.includes('docs'))
        .length,
    },
  };
}

export function formatDoctorText(report) {
  const lines = [];
  lines.push(`🩺 DepLens Doctor: ${report.target || 'unknown target'}`);
  lines.push(`Status: ${report.status}`);
  if (report.package) {
    lines.push(`Package: ${report.package}${report.version ? `@${report.version}` : ''}`);
  }
  lines.push('');
  lines.push('Checks:');
  for (const check of report.checks) {
    lines.push(`  ${check.ok ? '✓' : '✗'} ${check.message}`);
  }
  if (report.resolution?.trace) {
    const runtime = report.resolution.trace.runtime;
    const types = report.resolution.trace.types;
    lines.push('');
    lines.push('Resolution Trace:');
    lines.push(
      `  Runtime: ${runtime.source || 'unknown'}${
        runtime.conditionsMatched?.length ? ` via ${runtime.conditionsMatched.join(' > ')}` : ''
      } -> ${runtime.resolvedPath || 'unresolved'}`
    );
    lines.push(
      `  Types: ${types.source || 'unknown'}${
        types.conditionsMatched?.length ? ` via ${types.conditionsMatched.join(' > ')}` : ''
      } -> ${types.resolvedPath || 'unresolved'}`
    );
  }
  if (report.suggestions.length > 0) {
    lines.push('');
    lines.push('Suggestions:');
    for (const suggestion of report.suggestions) {
      lines.push(`  - ${suggestion}`);
    }
  }
  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of report.warnings) {
      lines.push(`  - ${warning}`);
    }
  }
  return lines.join('\n');
}

export async function runDoctor(options = {}) {
  const inspectResult = await runInspectCore({
    ...options,
    format: 'object',
    showTypes: options.showTypes !== false,
  });
  const report = buildDoctorReport(inspectResult, options);
  if (options.format === 'json' || options.format === 'object') {
    return options.format === 'object' ? report : JSON.stringify(report, null, 2);
  }
  return formatDoctorText(report);
}

export default {
  runDoctor,
  buildDoctorReport,
  formatDoctorText,
};
