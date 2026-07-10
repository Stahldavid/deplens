import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import { resolveExportTarget, resolveTypesVersionTarget } from './export-map.mjs';

function declarationCandidates(candidate) {
  if (!candidate || typeof candidate !== 'string') return [];
  const clean = candidate.replace(/^\.\//, '');
  if (/\.d\.(?:ts|cts|mts)$/i.test(clean)) return [clean];
  const converted = clean
    .replace(/\.mjs$/i, '.d.mts')
    .replace(/\.cjs$/i, '.d.cts')
    .replace(/\.js$/i, '.d.ts');
  return [converted, `${clean}.d.ts`, `${clean}.d.mts`, `${clean}.d.cts`];
}

export function findPackageTypesEntry(packageDir, options = {}) {
  const packageJson = path.join(packageDir, 'package.json');
  if (!fs.existsSync(packageJson)) return null;
  const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
  const subpath = options.subpath || '.';
  const versioned = resolveTypesVersionTarget(pkg, subpath === '.' ? '' : subpath, ts.version);
  const exported = resolveExportTarget(pkg, {
    subpath,
    conditions: ['types', 'typings', ...(options.conditions || []), 'default'],
  })?.path;
  const candidates = [
    versioned,
    exported,
    pkg.types,
    pkg.typings,
    'index.d.ts',
    'index.d.mts',
    'index.d.cts',
    'dist/index.d.ts',
  ];
  for (const candidate of candidates.flatMap(declarationCandidates)) {
    const absolute = path.resolve(packageDir, candidate);
    if (absolute.startsWith(path.resolve(packageDir)) && fs.existsSync(absolute)) return absolute;
  }
  return null;
}

function diagnosticRecord(diagnostic) {
  const record = {
    code: diagnostic.code,
    category: ts.DiagnosticCategory[diagnostic.category]?.toLowerCase() || 'error',
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  };
  if (diagnostic.file && Number.isFinite(diagnostic.start)) {
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    record.file = diagnostic.file.fileName;
    record.line = position.line + 1;
    record.column = position.character + 1;
  }
  return record;
}

function isIsolatedNominalIdentityDiagnostic(diagnostic) {
  const message = diagnostic.message || '';
  if (/separate declarations of (?:a )?private property/i.test(message)) return true;
  if (!/Property '\[[^\]]+\]' is missing/i.test(message)) return false;
  return (message.match(/node_modules[\\/]/gi) || []).length >= 2;
}

function classifyDiagnostics(diagnostics) {
  const actionable = [];
  const ignored = [];
  for (const diagnostic of diagnostics) {
    if (isIsolatedNominalIdentityDiagnostic(diagnostic)) {
      ignored.push({ ...diagnostic, reason: 'isolated-nominal-identity' });
    } else {
      actionable.push(diagnostic);
    }
  }
  return { actionable, ignored };
}

export function analyzeSemanticCompatibility(fromDir, toDir, options = {}) {
  const fromEntry = findPackageTypesEntry(fromDir, options);
  const toEntry = findPackageTypesEntry(toDir, options);
  if (!fromEntry || !toEntry) {
    return {
      checked: false,
      compatible: null,
      reason: 'Type declarations are unavailable for one or both versions',
      diagnostics: [],
    };
  }
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deplens-semantic-'));
  const sourcePath = path.join(temporaryDir, 'compatibility.ts');
  const source = [
    'type BeforeModule = typeof import("@deplens/before");',
    'type AfterModule = typeof import("@deplens/after");',
    'declare const afterModule: AfterModule;',
    'const compatibleModule: BeforeModule = afterModule;',
  ].join('\n');
  fs.writeFileSync(sourcePath, source, 'utf8');
  try {
    const compilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      baseUrl: temporaryDir,
      paths: {
        '@deplens/before': [fromEntry],
        '@deplens/after': [toEntry],
      },
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
    };
    const program = ts.createProgram([sourcePath], compilerOptions);
    const allDiagnostics = ts.getPreEmitDiagnostics(program).map(diagnosticRecord);
    const diagnostics = classifyDiagnostics(allDiagnostics);
    return {
      checked: true,
      compatible: diagnostics.actionable.length === 0,
      direction: 'after-assignable-to-before',
      fromEntry,
      toEntry,
      diagnostics: diagnostics.actionable,
      ignoredDiagnosticCount: diagnostics.ignored.length,
      ignoredDiagnostics: diagnostics.ignored,
    };
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}
