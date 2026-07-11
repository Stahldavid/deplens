#!/usr/bin/env node
import { runInspect, runDiff, runDoctor } from '@deplens/core';
import { clearCache, getCacheStats, migrateCache, pinCache, pruneCache } from '@deplens/core';
import { listHistory, getHistoryEntry, clearHistory, compareHistoryEntries } from '@deplens/core';
import {
  createProjectBaseline,
  formatPolicyAsSarif,
  formatPolicyText,
  formatProjectDiffText,
  loadProjectPolicy,
  loadProjectSnapshot,
  runProjectCheck,
  runProjectDiff,
} from '@deplens/core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ARGUMENT_ERROR_CODE = 'INVALID_ARGUMENT';
const VALID_INSPECT_FORMATS = new Set(['text', 'json', 'object']);
const VALID_DIFF_FORMATS = new Set(['text', 'json']);
const VALID_PROJECT_FORMATS = new Set(['text', 'json', 'sarif']);
const VALID_POLICY_LEVELS = new Set(['breaking', 'warning', 'change', 'none']);
const VALID_INSPECT_KINDS = new Set([
  'function',
  'class',
  'object',
  'constant',
  'interface',
  'type',
  'enum',
  'namespace',
  'variable',
]);
const VALID_JSDOC_MODES = new Set(['off', 'compact', 'full']);
const VALID_JSDOC_OUTPUTS = new Set(['off', 'section', 'inline', 'only']);
const VALID_JSDOC_SECTIONS = new Set(['summary', 'params', 'returns', 'tags']);
const VALID_JSDOC_TRUNCATE = new Set(['none', 'sentence', 'word']);
const VALID_SOURCE_LANGUAGES = new Set([
  'javascript',
  'typescript',
  'python',
  'java',
  'rust',
  'go',
]);

function cliVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(here, '..', 'package.json');
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
  } catch {
    return 'unknown';
  }
}

function argumentValue(argv, name, fallback = null) {
  return argumentValues(argv, name).at(-1) ?? fallback;
}

function argumentValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === name && argv[index + 1]) {
      values.push(argv[index + 1]);
      index += 1;
    } else if (argument.startsWith(`${name}=`)) {
      values.push(argument.slice(name.length + 1));
    }
  }
  return values;
}

function commaList(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.flatMap((item) =>
    String(item)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  );
}

function parseByteSize(value) {
  if (value == null) return undefined;
  const match = String(value)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i);
  if (!match) throw new Error(`Invalid byte size: ${value}`);
  const units = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
  return Math.floor(Number(match[1]) * units[(match[2] || 'b').toLowerCase()]);
}

function jsonStringify(value) {
  return `${JSON.stringify(value)}\n`;
}

function argumentErrorPayload(message, details = null) {
  return {
    error: message,
    errorInfo: {
      code: ARGUMENT_ERROR_CODE,
      phase: 'arguments',
      retryable: false,
      details,
    },
  };
}

function emitError(
  error,
  { json = false, exitCode = 1, phase = 'arguments', code = 'DEPLENS_ERROR' } = {}
) {
  const payload =
    error && typeof error === 'object' && error.error && error.errorInfo
      ? error
      : {
          error: error instanceof Error ? error.message : String(error),
          errorInfo: {
            code,
            phase,
            retryable: false,
            details: null,
          },
        };
  if (json) {
    process.stdout.write(jsonStringify(payload));
  } else {
    process.stderr.write(`Error: ${payload.error}\n`);
  }
  process.exit(exitCode);
}

function parseIntegerOption(
  argv,
  name,
  { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, fallback = undefined } = {}
) {
  const raw = argumentValue(argv, name);
  if (raw == null) return fallback;
  if (!/^-?\d+$/.test(String(raw).trim())) {
    throw new Error(`Option ${name} must be an integer`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    const range =
      Number.isFinite(min) && Number.isFinite(max)
        ? ` between ${min} and ${max}`
        : Number.isFinite(min)
          ? ` >= ${min}`
          : Number.isFinite(max)
            ? ` <= ${max}`
            : '';
    throw new Error(`Option ${name} must be${range}`);
  }
  return parsed;
}

function parseEnumOption(argv, name, allowed, fallback = null) {
  const raw = argumentValue(argv, name);
  if (raw == null) return fallback;
  const normalized = String(raw).toLowerCase();
  if (!allowed.has(normalized)) {
    throw new Error(`Option ${name} must be one of: ${[...allowed].join(', ')}`);
  }
  return normalized;
}

function assertValidCursor(value, name = '--cursor') {
  if (value == null) return null;
  if (!/^\d+$/.test(String(value))) {
    throw new Error(`Option ${name} must be a non-negative integer cursor`);
  }
  return String(Number(value));
}

function assertValidRegexLiteral(value, label) {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('/') && trimmed.endsWith('/')) {
    try {
      new RegExp(trimmed.slice(1, -1), 'i');
    } catch (error) {
      throw new Error(`Invalid regex for ${label}: ${error.message}`);
    }
  }
}

function assertValidRegexList(values, label) {
  for (const value of values || []) assertValidRegexLiteral(value, label);
}

function validateList(values, allowed, name) {
  for (const value of values || []) {
    if (!allowed.has(value)) {
      throw new Error(
        `Option ${name} contains invalid value '${value}'. Allowed: ${[...allowed].join(', ')}`
      );
    }
  }
}

function parsePackageCursors(values) {
  const cursors = Object.create(null);
  for (const value of values) {
    const delimiter = String(value).lastIndexOf('=');
    if (delimiter <= 0) throw new Error(`Invalid package cursor: ${value}`);
    const packageName = String(value).slice(0, delimiter);
    const cursorRaw = String(value).slice(delimiter + 1);
    if (!/^\d+$/.test(cursorRaw)) {
      throw new Error(`Invalid package cursor: ${value}`);
    }
    const cursor = Number.parseInt(cursorRaw, 10);
    cursors[packageName] = String(cursor);
  }
  return cursors;
}

function parseInspectArgs(argv) {
  const target = argv[0];
  let filter = argv[1] && !argv[1].startsWith('--') ? argv[1].toLowerCase() : null;
  const showTypes = argv.includes('--types');
  let docsFor = null;
  const docsForIndex = argv.indexOf('--docs-for');
  if (docsForIndex !== -1 && argv[docsForIndex + 1]) {
    docsFor = argv[docsForIndex + 1];
  }
  const includeDocs =
    argv.includes('--docs') || argv.includes('--include-docs') || Boolean(docsFor);
  let examplesFor = null;
  const examplesForIndex = argv.indexOf('--examples-for');
  if (examplesForIndex !== -1 && argv[examplesForIndex + 1]) {
    examplesFor = argv[examplesForIndex + 1];
  }
  const includeExamples =
    argv.includes('--examples') || argv.includes('--include-examples') || Boolean(examplesFor);
  const remote = argv.includes('--remote');
  const offline = argv.includes('--offline');
  const explicitRuntime = argv.includes('--runtime');
  const noRuntime = argv.includes('--no-runtime');
  const runtime = !noRuntime && (explicitRuntime || !remote);

  // New options
  const listSections = argv.includes('--list-sections');

  let format = 'text';
  format = parseEnumOption(argv, '--format', VALID_INSPECT_FORMATS, format);
  // --json is a shortcut for --format json
  if (argv.includes('--json')) {
    format = 'json';
  }

  let search = null;
  const searchIndex = argv.indexOf('--search');
  if (searchIndex !== -1 && argv[searchIndex + 1]) {
    search = argv[searchIndex + 1];
  }

  let docsSections = null;
  const docsSectionsIndex = argv.indexOf('--docs-sections');
  if (docsSectionsIndex !== -1 && argv[docsSectionsIndex + 1]) {
    docsSections = argv[docsSectionsIndex + 1].split(',').map((s) => s.trim());
  }

  let maxExports = null;
  maxExports = parseIntegerOption(argv, '--max-exports', {
    min: 1,
    max: 10000,
    fallback: format === 'json' ? 25 : null,
  });

  let maxProps = null;
  maxProps = parseIntegerOption(argv, '--max-props', { min: 1, max: 1000, fallback: null });

  let maxExamples = null;
  maxExamples = parseIntegerOption(argv, '--max-examples', { min: 1, max: 100, fallback: null });

  const analyzeSource = argv.includes('--analyze-source');
  const autoGenerateTypes = !argv.includes('--no-auto-generate-types');
  const sourceIncludeBody =
    argv.includes('--source-include-body') || argv.includes('--include-source-body');
  let sourceMaxFiles = null;
  sourceMaxFiles = parseIntegerOption(argv, '--source-max-files', {
    min: 1,
    max: 500,
    fallback: null,
  });
  let language = null;
  const languageIndex = argv.indexOf('--language');
  if (languageIndex !== -1 && argv[languageIndex + 1]) {
    language = argv[languageIndex + 1].toLowerCase();
    validateList([language], VALID_SOURCE_LANGUAGES, '--language');
  }

  let jsdoc = null;
  jsdoc = parseEnumOption(argv, '--jsdoc', VALID_JSDOC_MODES, null);

  let jsdocOutput = null;
  jsdocOutput = parseEnumOption(argv, '--jsdoc-output', VALID_JSDOC_OUTPUTS, null);

  let jsdocSymbols = null;
  const jsdocSymbolIndex = argv.indexOf('--jsdoc-symbol');
  if (jsdocSymbolIndex !== -1 && argv[jsdocSymbolIndex + 1]) {
    jsdocSymbols = argv[jsdocSymbolIndex + 1];
  }

  let jsdocSections = null;
  const jsdocSectionsIndex = argv.indexOf('--jsdoc-sections');
  if (jsdocSectionsIndex !== -1 && argv[jsdocSectionsIndex + 1]) {
    jsdocSections = argv[jsdocSectionsIndex + 1];
  }

  let jsdocTagsInclude = null;
  const jsdocTagsIndex = argv.indexOf('--jsdoc-tags');
  if (jsdocTagsIndex !== -1 && argv[jsdocTagsIndex + 1]) {
    jsdocTagsInclude = argv[jsdocTagsIndex + 1];
  }

  let jsdocTagsExclude = null;
  const jsdocTagsExcludeIndex = argv.indexOf('--jsdoc-tags-exclude');
  if (jsdocTagsExcludeIndex !== -1 && argv[jsdocTagsExcludeIndex + 1]) {
    jsdocTagsExclude = argv[jsdocTagsExcludeIndex + 1];
  }

  let jsdocTruncate = null;
  jsdocTruncate = parseEnumOption(argv, '--jsdoc-truncate', VALID_JSDOC_TRUNCATE, null);

  let jsdocMaxLen = null;
  jsdocMaxLen = parseIntegerOption(argv, '--jsdoc-max-len', {
    min: 0,
    max: 20000,
    fallback: null,
  });

  let jsdocMaxParams = null;
  jsdocMaxParams = parseIntegerOption(argv, '--jsdoc-max-params', {
    min: 0,
    max: 1000,
    fallback: null,
  });
  let jsdocParamCursor = null;
  jsdocParamCursor = parseIntegerOption(argv, '--jsdoc-param-cursor', {
    min: 0,
    fallback: null,
  });

  const filterIndex = argv.indexOf('--filter');
  if (filterIndex !== -1 && argv[filterIndex + 1]) {
    filter = argv[filterIndex + 1].toLowerCase();
  }
  assertValidRegexLiteral(filter, '--filter');
  assertValidRegexList(jsdocSymbols ? String(jsdocSymbols).split(',') : [], '--jsdoc-symbol');

  let resolveFrom = null;
  const resolveFromIndex = argv.indexOf('--resolve-from');
  if (resolveFromIndex !== -1 && argv[resolveFromIndex + 1]) {
    resolveFrom = argv[resolveFromIndex + 1];
  }

  let remoteVersion = null;
  const remoteVersionIndex = argv.indexOf('--remote-version');
  if (remoteVersionIndex !== -1 && argv[remoteVersionIndex + 1]) {
    remoteVersion = argv[remoteVersionIndex + 1];
  }

  // npm install is the default because API inspection needs the full package tree.
  const preferCdn = argv.includes('--prefer-cdn') && !argv.includes('--prefer-npm');

  // History
  const saveHistory = argv.includes('--save-history');
  const noSaveHistory = argv.includes('--no-save-history');
  const effectiveSaveHistory = saveHistory && !noSaveHistory;
  let historyDir = null;
  const historyDirIndex = argv.indexOf('--history-dir');
  if (historyDirIndex !== -1 && argv[historyDirIndex + 1]) {
    historyDir = argv[historyDirIndex + 1];
  }

  let kindFilter = null;
  const kindIndex = argv.indexOf('--kind');
  if (kindIndex !== -1 && argv[kindIndex + 1]) {
    kindFilter = argv[kindIndex + 1].split(',').map((k) => k.trim().toLowerCase());
    validateList(kindFilter, VALID_INSPECT_KINDS, '--kind');
  }

  const depth = parseIntegerOption(argv, '--depth', { min: 0, max: 5, fallback: 1 });

  let jsdocQuery = null;
  if (
    jsdocSymbols ||
    jsdocSections ||
    jsdocTagsInclude ||
    jsdocTagsExclude ||
    jsdocTruncate ||
    jsdocMaxLen !== null ||
    jsdocMaxParams !== null ||
    jsdocParamCursor !== null
  ) {
    const symbols = jsdocSymbols
      ? jsdocSymbols
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const sections = jsdocSections
      ? jsdocSections
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    validateList(sections, VALID_JSDOC_SECTIONS, '--jsdoc-sections');
    const tagsInclude = jsdocTagsInclude
      ? jsdocTagsInclude
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const tagsExclude = jsdocTagsExclude
      ? jsdocTagsExclude
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    jsdocQuery = {
      symbols: symbols && symbols.length === 1 ? symbols[0] : symbols,
      sections,
      tags: tagsInclude || tagsExclude ? { include: tagsInclude, exclude: tagsExclude } : undefined,
      mode: jsdoc === 'compact' || jsdoc === 'full' ? jsdoc : undefined,
      maxLen: jsdocMaxLen ?? undefined,
      maxParams: jsdocMaxParams ?? undefined,
      paramCursor: jsdocParamCursor ?? undefined,
      truncate: jsdocTruncate ?? undefined,
    };
  }

  const detail = argumentValue(argv, '--detail', format === 'json' ? 'compact' : null);
  const selectedSections = commaList(argumentValues(argv, '--select'));
  const select = selectedSections.length > 0 ? selectedSections : null;
  const cursor = assertValidCursor(argumentValue(argv, '--cursor'));
  const maxSymbolsValue = parseIntegerOption(argv, '--max-symbols', {
    min: 1,
    max: 5000,
    fallback: format === 'json' ? 50 : undefined,
  });
  const timeoutValue = parseIntegerOption(argv, '--timeout', { min: 1, fallback: undefined });
  const conditions = commaList(argumentValue(argv, '--conditions'));
  const cacheDir = argumentValue(argv, '--cache-dir');
  const profile = argv.includes('--profile');

  return {
    target,
    filter,
    showTypes,
    includeDocs,
    docsFor,
    includeExamples,
    examplesFor,
    remote,
    offline,
    remoteVersion,
    kindFilter,
    depth,
    resolveFrom,
    jsdoc,
    jsdocOutput,
    jsdocQuery,
    // New options
    format,
    listSections,
    docsSections,
    search,
    maxExports,
    maxProps,
    maxExamples,
    runtime,
    analyzeSource,
    sourceMaxFiles,
    language,
    sourceIncludeBody,
    preferCdn,
    autoGenerateTypes,
    saveHistory: effectiveSaveHistory,
    historyDir,
    detail,
    select,
    cursor,
    maxSymbols: maxSymbolsValue,
    timeoutMs: timeoutValue,
    conditions,
    cacheDir,
    profile,
  };
}

function parseDiffArgs(argv) {
  const packageName = argv[0];

  let from = 'installed';
  const fromIndex = argv.indexOf('--from');
  if (fromIndex !== -1 && argv[fromIndex + 1]) {
    from = argv[fromIndex + 1];
  }

  let to = 'latest';
  const toIndex = argv.indexOf('--to');
  if (toIndex !== -1 && argv[toIndex + 1]) {
    to = argv[toIndex + 1];
  }

  // npm install is the default because semantic diff needs complete package contents.
  const preferCdn = argv.includes('--prefer-cdn') && !argv.includes('--prefer-npm');
  const offline = argv.includes('--offline');
  const explicitRuntime = argv.includes('--runtime');
  const runtime = explicitRuntime && !argv.includes('--no-runtime');

  let filter = null;
  const filterIndex = argv.indexOf('--filter');
  if (filterIndex !== -1 && argv[filterIndex + 1]) {
    filter = argv[filterIndex + 1];
  }
  assertValidRegexLiteral(filter, '--filter');

  let format = parseEnumOption(argv, '--format', VALID_DIFF_FORMATS, 'text');
  // --json shortcut
  if (argv.includes('--json')) {
    format = 'json';
  }

  const includeSource = argv.includes('--include-source');
  const includeChangelog = !argv.includes('--no-changelog');
  const verbose = argv.includes('--verbose');
  const noColor = argv.includes('--no-color');
  const conditions = commaList(argumentValue(argv, '--conditions'));
  const timeoutValue = parseIntegerOption(argv, '--timeout', { min: 1, fallback: undefined });
  const cacheDir = argumentValue(argv, '--cache-dir');
  const semantic = !argv.includes('--no-semantic');
  const profile = argv.includes('--profile');
  const maxChangesValue = parseIntegerOption(argv, '--max-changes', {
    min: 1,
    max: 10000,
    fallback: undefined,
  });
  const cursor = assertValidCursor(argumentValue(argv, '--cursor'));

  let projectDir = null;
  const projectDirIndex = argv.indexOf('--project-dir');
  if (projectDirIndex !== -1 && argv[projectDirIndex + 1]) {
    projectDir = argv[projectDirIndex + 1];
  }

  return {
    packageName,
    from,
    to,
    filter,
    format,
    preferCdn,
    includeSource,
    includeChangelog,
    verbose,
    noColor,
    projectDir,
    offline,
    runtime,
    conditions,
    timeoutMs: timeoutValue,
    cacheDir,
    semantic,
    maxChanges: maxChangesValue,
    cursor,
    profile,
  };
}

function usage() {
  console.error(
    'Uso:\n' +
      '  deplens <pacote> [filtro] [opções]\n' +
      '  deplens inspect <pacote> [filtro] [opções]\n' +
      '  deplens diff <pacote> [opções]\n' +
      '  deplens doctor <pacote> [opções]\n' +
      '  deplens project-diff [--from REF] [--to REF] [opções]\n' +
      '  deplens check --baseline FILE [opções]\n' +
      '  deplens cache [stats|clear|pin|migrate|prune] [opções]\n\n' +
      'Opções (cache):\n' +
      '  --fast                Fast stats using metadata / directory entries only (default)\n' +
      '  --exact               Recalculate recursive directory sizes\n' +
      '  --cache-dir DIR       Override cache directory for maintenance commands\n' +
      '  --max-age-days N      Remove entries older than N days (prune; default: 90)\n' +
      '  --max-size SIZE       Enforce LRU size cap during prune (for example 2GB)\n' +
      '  --max-entries N       Limit stats pages or enforce LRU entry-count cap during prune\n' +
      '  --max-preview-entries N Limit prune candidate preview page (default: 25)\n' +
      '  --cursor VALUE        Resume cache stats or prune candidate pagination\n' +
      '  --summary             Return cache stats without the package list\n' +
      '  --select LIST         Select cache stats sections, for example packages\n' +
      '  --dry-run             Preview cache migration/prune without modifying files\n' +
      '  --keep-aliases        Keep tag/range cache aliases during maintenance\n' +
      '  --json                Output cache stats as JSON\n\n' +
      'Opções (inspect):\n' +
      '  --filter VALUE         Filter exports by name\n' +
      '  --search QUERY         Semantic search (token matching + JSDoc)\n' +
      '  --types                Show type signatures from .d.ts\n' +
      '  --docs                 Include README preview\n' +
      '  --list-sections        List available README sections\n' +
      '  --docs-sections S1,S2  Extract specific README sections\n' +
      '  --docs-for SYMBOL      Rank README sections for a symbol\n' +
      '  --examples             Include code examples\n' +
      '  --examples-for SYMBOL  Rank examples for a symbol\n' +
      '  --format text|json     Output format (default: text)\n' +
      '  --json                Shorthand for --format json\n' +
      '  --remote               Download package to cache\n' +
      '  --remote-version V     Version for remote download\n' +
      '  --no-runtime           Do not import/require package entrypoint\n' +
      '  --runtime              Force runtime import even when CI would skip it\n' +
      '  --offline              Use cached remote packages only\n' +
      '  --prefer-cdn          Use lightweight CDN download instead of npm install\n' +
      '  --prefer-npm          Force npm install (default)\n' +
      '  --max-exports N        Max exports to show (default: 100)\n' +
      '  --max-props N          Max props per object (default: 10)\n' +
      '  --max-examples N       Max examples to show (default: 10)\n' +
      '  --analyze-source       Analyze source code (JS/TS/Python/Java)\n' +
      '  --language LANG        Force an analysis language\n' +
      '                          Detect-only languages: rust, go\n' +
      '  --source-max-files N   Max source files to analyze\n' +
      '  --source-include-body  Include function body snippets\n' +
      '  --save-history          Save analysis to local history (~/.deplens/history)\n' +
      '  --no-save-history       Disable saving to history\n' +
      '  --history-dir DIR       Custom history directory\n' +
      '  --kind f,c,...         Filter by kind (function,class,object,constant)\n' +
      '  --depth N              Object inspection depth (0-5)\n' +
      '  --resolve-from DIR     Base directory for module resolution\n' +
      '  --jsdoc off|compact|full  JSDoc mode\n' +
      '  --jsdoc-output off|section|inline|only  JSDoc output mode\n' +
      '  --jsdoc-symbol VALUE   Exact name, glob, or /regex/ filter\n' +
      '  --jsdoc-sections LIST  summary,params,returns,tags\n' +
      '  --jsdoc-tags LIST      Include only selected JSDoc tags\n' +
      '  --jsdoc-tags-exclude LIST  Exclude selected JSDoc tags\n' +
      '  --jsdoc-truncate MODE  none|sentence|word\n' +
      '  --jsdoc-max-len N      Maximum JSDoc length per symbol\n' +
      '  --jsdoc-max-params N   Maximum @param tags per symbol\n' +
      '  --jsdoc-param-cursor N Continue @param tags from offset N\n' +
      '  --detail compact|full  Inspect JSON detail (default: compact)\n' +
      '  --select LIST          Select JSON sections (CSV/repeatable/= form)\n' +
      '  --cursor VALUE         Resume symbol pagination\n' +
      '  --max-symbols N        Symbols per JSON page\n' +
      '  --conditions LIST      Export conditions in priority order\n' +
      '  --timeout MS           Operation timeout\n' +
      '  --profile              Include phase timings in metadata\n' +
      '\nOpções (diff):\n' +
      '  --from VERSION         Base version (default: installed)\n' +
      '  --to VERSION           Target version (default: latest)\n' +
      '  --filter VALUE         Filter exports by name\n' +
      '  --format text|json     Output format (default: text)\n' +
      '  --json                Shorthand for --format json\n' +
      '  --prefer-cdn          Use lightweight CDN download instead of npm install\n' +
      '  --offline             Use cached packages only\n' +
      '  --prefer-npm          Force npm install (default)\n' +
      '  --include-source       Compare source complexity\n' +
      '  --no-runtime           Do not import package entrypoints while diffing\n' +
      '  --runtime              Force runtime import even when CI would skip it\n' +
      '  --no-changelog         Skip changelog parsing\n' +
      '  --verbose              Show detailed changes\n' +
      '  --no-color             Disable ANSI colors\n' +
      '  --project-dir DIR      Base directory for installed version\n' +
      '  --max-changes N        Changes per JSON page (default: 100)\n' +
      '  --cursor VALUE         Resume diff pagination\n' +
      '  --conditions LIST      Export conditions in priority order\n' +
      '  --no-semantic          Skip TypeScript assignability checks\n' +
      '\nOpções (project-diff/check):\n' +
      '  --from REF             Git ref used as project baseline\n' +
      '  --to REF               Git ref used as project target (default: working)\n' +
      '  --from-lock FILE       Read the baseline npm/pnpm lockfile\n' +
      '  --to-lock FILE         Read the target npm/pnpm lockfile\n' +
      '  --lockfile FILE        Lockfile path inside refs (default: package-lock.json)\n' +
      '  --baseline FILE        Baseline file for check\n' +
      '  --write-baseline       Write/update a baseline instead of checking\n' +
      '  --config FILE          Policy configuration JSON\n' +
      '  --fail-on LEVEL        breaking|warning|change|none\n' +
      '  --include-transitive   Analyze transitive dependency changes\n' +
      '  --no-api               Compare lockfile versions without package API analysis\n' +
      '  --concurrency N        Concurrent package diffs (default: 4)\n' +
      '  --max-changes-per-package N  Changes returned per enriched package (default: 10)\n' +
      '  --package-cursor PKG=N  Resume changes for one package (repeatable)\n' +
      '  --package-only PKG     Return and analyze only selected packages (repeatable)\n' +
      '  --strict-package-only  Exit non-zero when --package-only matches no changed packages\n' +
      '  --project-snapshot FILE  Reuse compact API analysis across cursor requests\n' +
      '  --detail compact|full  API enrichment detail (default: compact)\n' +
      '  --format text|json|sarif\n'
  );
}

function optionAwareArgs(args, startIndex = 0) {
  const positionals = [];
  for (let i = startIndex; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--history-dir') {
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) continue;
    positionals.push(arg);
  }
  return positionals;
}

function parsePackageVersionSpec(spec) {
  if (!spec) return [null, null];
  const atIndex = spec.startsWith('@') ? spec.indexOf('@', 1) : spec.lastIndexOf('@');
  if (atIndex > 0 && atIndex < spec.length - 1) {
    return [spec.slice(0, atIndex), spec.slice(atIndex + 1)];
  }
  return [spec, null];
}

function shouldExitNonZeroForPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.error) return true;
  if (payload.package === null && Array.isArray(payload.warnings) && payload.warnings.length > 0) {
    return true;
  }
  return false;
}

function markExitCodeForOutput(output, format) {
  if (shouldExitNonZeroForPayload(output)) {
    process.exitCode = 1;
    return;
  }
  if (format === 'json' && typeof output === 'string') {
    try {
      if (shouldExitNonZeroForPayload(JSON.parse(output))) {
        process.exitCode = 1;
      }
    } catch {
      // Leave exit code unchanged for non-JSON text.
    }
  }
}

const VALUE_OPTIONS = new Set([
  '--docs-for',
  '--examples-for',
  '--format',
  '--search',
  '--docs-sections',
  '--max-exports',
  '--max-props',
  '--max-examples',
  '--source-max-files',
  '--language',
  '--jsdoc',
  '--jsdoc-output',
  '--jsdoc-symbol',
  '--jsdoc-sections',
  '--jsdoc-tags',
  '--jsdoc-tags-exclude',
  '--jsdoc-truncate',
  '--jsdoc-max-len',
  '--jsdoc-max-params',
  '--jsdoc-param-cursor',
  '--filter',
  '--resolve-from',
  '--remote-version',
  '--history-dir',
  '--kind',
  '--depth',
  '--from',
  '--to',
  '--project-dir',
  '--cache-dir',
  '--max-age-days',
  '--max-size',
  '--max-entries',
  '--max-preview-entries',
  '--from-lock',
  '--to-lock',
  '--lockfile',
  '--baseline',
  '--config',
  '--fail-on',
  '--output',
  '--conditions',
  '--detail',
  '--select',
  '--cursor',
  '--max-symbols',
  '--max-changes',
  '--max-changes-per-package',
  '--package-cursor',
  '--package-only',
  '--project-snapshot',
  '--timeout',
  '--concurrency',
]);

const FLAG_OPTIONS = new Set([
  '--types',
  '--docs',
  '--include-docs',
  '--examples',
  '--include-examples',
  '--remote',
  '--offline',
  '--runtime',
  '--no-runtime',
  '--json',
  '--list-sections',
  '--analyze-source',
  '--auto-generate-types',
  '--no-auto-generate-types',
  '--source-include-body',
  '--include-source-body',
  '--prefer-cdn',
  '--prefer-npm',
  '--save-history',
  '--no-save-history',
  '--include-source',
  '--no-changelog',
  '--verbose',
  '--no-color',
  '--fast',
  '--exact',
  '--force',
  '--dry-run',
  '--keep-aliases',
  '--write-baseline',
  '--include-transitive',
  '--semantic',
  '--no-semantic',
  '--api',
  '--no-api',
  '--sarif',
  '--profile',
  '--strict-package-only',
  '--summary',
  '--help',
  '--version',
  '-h',
  '-v',
]);

const LIST_VALUE_OPTIONS = new Set([
  '--docs-sections',
  '--jsdoc-symbol',
  '--jsdoc-sections',
  '--jsdoc-tags',
  '--jsdoc-tags-exclude',
  '--kind',
  '--conditions',
  '--select',
]);

const TOKEN_LIST_VALUE_OPTIONS = new Set([
  '--jsdoc-symbol',
  '--jsdoc-sections',
  '--jsdoc-tags',
  '--jsdoc-tags-exclude',
  '--kind',
  '--conditions',
  '--select',
]);

function validateCliArgs(args) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('-')) continue;
    const equalsIndex = argument.indexOf('=');
    const optionName = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    if (VALUE_OPTIONS.has(optionName)) {
      if (equalsIndex !== -1) {
        if (argument.slice(equalsIndex + 1).length === 0) {
          throw new Error(`Option ${optionName} requires a value`);
        }
        continue;
      }
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Option ${optionName} requires a value`);
      }
      index += 1;
      continue;
    }
    if (!FLAG_OPTIONS.has(argument)) throw new Error(`Unknown option: ${argument}`);
  }
}

function normalizeCliArgs(args) {
  const normalizedEquals = args.flatMap((argument) => {
    if (!argument.startsWith('--') || !argument.includes('=')) return [argument];
    const equalsIndex = argument.indexOf('=');
    const optionName = argument.slice(0, equalsIndex);
    if (!VALUE_OPTIONS.has(optionName)) return [argument];
    return [optionName, argument.slice(equalsIndex + 1)];
  });
  const normalizedLists = [];
  for (let index = 0; index < normalizedEquals.length; index += 1) {
    const argument = normalizedEquals[index];
    if (!LIST_VALUE_OPTIONS.has(argument)) {
      normalizedLists.push(argument);
      continue;
    }
    const values = [];
    while (index + 1 < normalizedEquals.length && !normalizedEquals[index + 1].startsWith('-')) {
      values.push(normalizedEquals[index + 1]);
      index += 1;
    }
    const normalizedValues = TOKEN_LIST_VALUE_OPTIONS.has(argument)
      ? values.flatMap((value) => value.split(/\s+/).filter(Boolean))
      : values;
    normalizedLists.push(argument, normalizedValues.join(','));
  }
  return normalizedLists;
}

const argv = normalizeCliArgs(process.argv.slice(2));
if (argv.includes('--version') || argv.includes('-v')) {
  console.log(cliVersion());
  process.exit(0);
}
let command =
  argv[0] === 'diff' ||
  argv[0] === 'inspect' ||
  argv[0] === 'doctor' ||
  argv[0] === 'project-diff' ||
  argv[0] === 'check'
    ? argv[0]
    : 'inspect';
if (argv[0] === 'cache') command = 'cache';
if (argv[0] === 'history') command = 'history';

// Handle help flag (after argv is available)
if (argv.includes('--help') || argv.includes('-h')) {
  usage();
  process.exit(0);
}

try {
  validateCliArgs(argv);
} catch (error) {
  emitError(argumentErrorPayload(error.message), { json: argv.includes('--json'), exitCode: 2 });
}

const commandArgs = command === 'inspect' && argv[0] !== 'inspect' ? argv : argv.slice(1);

let parsed = {};
try {
  parsed =
    command === 'diff'
      ? parseDiffArgs(commandArgs)
      : command === 'inspect' || command === 'doctor'
        ? parseInspectArgs(commandArgs)
        : {};
} catch (error) {
  emitError(argumentErrorPayload(error.message), { json: argv.includes('--json'), exitCode: 2 });
}

// Cache commands
if (command === 'cache') {
  const subcmd = argv[1] || 'stats';
  const cacheDirIndex = argv.indexOf('--cache-dir');
  const cacheDir = cacheDirIndex !== -1 ? argv[cacheDirIndex + 1] : undefined;
  let maxAgeDays;
  let maxEntriesValue;
  let maxPreviewEntries;
  let cacheCursor;
  let maxSizeBytes;
  try {
    maxAgeDays = parseIntegerOption(argv, '--max-age-days', { min: 0, fallback: undefined });
    maxEntriesValue = parseIntegerOption(argv, '--max-entries', {
      min: 0,
      max: 100000,
      fallback: undefined,
    });
    maxPreviewEntries = parseIntegerOption(argv, '--max-preview-entries', {
      min: 0,
      max: 100000,
      fallback: undefined,
    });
    cacheCursor = assertValidCursor(argumentValue(argv, '--cursor'));
    maxSizeBytes = parseByteSize(argumentValue(argv, '--max-size'));
  } catch (error) {
    emitError(argumentErrorPayload(error.message), { json: argv.includes('--json'), exitCode: 2 });
  }
  const maintenanceOptions = {
    cacheDir,
    exact: argv.includes('--exact') && !argv.includes('--fast'),
    dryRun: argv.includes('--dry-run'),
    removeAliases: !argv.includes('--keep-aliases'),
    ...(Number.isFinite(maxAgeDays) ? { maxAgeDays } : {}),
    ...(Number.isFinite(maxEntriesValue) ? { maxEntries: maxEntriesValue } : {}),
    ...(Number.isFinite(maxPreviewEntries) ? { previewMaxEntries: maxPreviewEntries } : {}),
    ...(cacheCursor != null ? { previewCursor: cacheCursor } : {}),
    ...(Number.isFinite(maxSizeBytes) ? { maxSizeBytes } : {}),
  };
  if (subcmd === 'clear' || subcmd === 'clean') {
    const pkg = argv[2] && !argv[2].startsWith('-') ? argv[2] : null;
    const result = clearCache(pkg, { cacheDir });
    if (argv.includes('--json')) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`Cache cleared${pkg ? ` for ${pkg}` : ''}.`);
    }
  } else if (subcmd === 'stats' || subcmd === 'status') {
    const stats = getCacheStats({
      cacheDir,
      exact: argv.includes('--exact') && !argv.includes('--fast'),
      summary: argv.includes('--summary'),
      select: commaList(argumentValues(argv, '--select')),
      cursor: cacheCursor,
      ...(Number.isFinite(maxEntriesValue) ? { maxEntries: maxEntriesValue } : {}),
    });
    if (argv.includes('--json')) {
      console.log(JSON.stringify(stats));
    } else {
      console.log(`📦 Cache entries: ${stats.entries}`);
      console.log(`📊 Total size: ${stats.sizeFormatted || stats.size + ' B'}`);
      if (!stats.exact) {
        console.log('ℹ️  Fast estimate. Use --exact to recalculate recursive sizes.');
      }
      if (stats.packages && stats.packages.length > 0) {
        console.log('\nPackages:');
        for (const p of stats.packages.sort((a, b) => b.size - a.size).slice(0, 10)) {
          const suffix = p.sizeExact ? '' : ' (unknown; run --exact)';
          console.log(`  ${p.name}: ${p.sizeFormatted || p.size + ' B'}${suffix}`);
        }
      }
    }
  } else if (subcmd === 'pin') {
    const spec = argv[2];
    if (!spec || !spec.includes('@') || spec.endsWith('@')) {
      console.error('Usage: deplens cache pin <package>@<version>');
      process.exit(1);
    }
    const atIndex = spec.startsWith('@') ? spec.indexOf('@', 1) : spec.lastIndexOf('@');
    const pkg = spec.slice(0, atIndex);
    const version = spec.slice(atIndex + 1);
    try {
      const result = await pinCache(pkg, version, {
        preferCdn: argv.includes('--prefer-cdn') && !argv.includes('--prefer-npm'),
        projectDir: process.cwd(),
        cacheDir,
      });
      if (argv.includes('--json')) {
        console.log(JSON.stringify(result));
      } else {
        console.log(`Pinned ${result.package}@${result.version}`);
        console.log(`CachePath: ${result.path}`);
        if (result.metadata?.integrity) {
          console.log(`Integrity: ${result.metadata.integrity}`);
        }
      }
    } catch (e) {
      console.error(`Failed to pin cache: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  } else if (subcmd === 'migrate') {
    try {
      const result = migrateCache(maintenanceOptions);
      if (argv.includes('--json')) {
        console.log(JSON.stringify(result));
      } else {
        console.log(
          `Migrated ${result.migrated}/${result.scanned} cache entries (${result.aliasesMoved} aliases moved, ${result.aliasesRemoved} removed, ${result.invalid} invalid, ${result.skippedLocked} locked).`
        );
        if (result.dryRun) console.log('Dry run only; no files were changed.');
      }
    } catch (error) {
      console.error(`Cache migration failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  } else if (subcmd === 'prune') {
    try {
      const result = pruneCache(maintenanceOptions);
      if (argv.includes('--json')) {
        console.log(JSON.stringify(result));
      } else {
        console.log(
          `Pruned ${result.removed}/${result.candidates} cache candidates; reclaimed ${result.reclaimedFormatted}; skipped ${result.skippedLocked} locked entries.`
        );
        if (result.dryRun) console.log('Dry run only; no files were changed.');
      }
    } catch (error) {
      console.error(`Cache prune failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  } else {
    console.error('Usage: deplens cache [clear|stats|pin|migrate|prune] [options]');
    process.exit(1);
  }
  process.exit(0);
}

// History commands
if (command === 'history') {
  const subcmd = argv[1] || 'list';
  const historyArgs = optionAwareArgs(argv, 2);

  // Parse optional --history-dir
  let historyDir = null;
  const hdIdx = argv.indexOf('--history-dir');
  if (hdIdx !== -1 && argv[hdIdx + 1]) {
    historyDir = argv[hdIdx + 1];
  }

  if (subcmd === 'list') {
    const filter = historyArgs[0] || null;
    const entries = listHistory(filter, historyDir);
    if (argv.includes('--json')) {
      console.log(
        JSON.stringify({
          schemaVersion: 1,
          kind: 'deplens-history-list',
          total: entries.length,
          entries,
        })
      );
    } else if (entries.length === 0) {
      console.log('📭 No history entries found.');
    } else {
      console.log(`📜 History (${entries.length} entries):\n`);
      for (const e of entries) {
        const date = new Date(e.timestamp).toISOString().split('T')[0];
        console.log(`  ${e.package}@${e.version}  (${date})`);
      }
    }
  } else if (subcmd === 'show') {
    const spec = historyArgs[0];
    if (!spec) {
      console.error('Usage: deplens history show <package[@version]>');
      process.exit(1);
    }
    const [pkg, ver] = parsePackageVersionSpec(spec);
    let entry;
    if (ver) {
      entry = getHistoryEntry(pkg, ver, historyDir);
    } else {
      const entries = listHistory(pkg, historyDir);
      entry =
        entries.length > 0
          ? getHistoryEntry(entries[0].package, entries[0].version, historyDir)
          : null;
    }
    if (!entry) {
      console.error(`❌ No history found for ${spec}`);
      process.exit(1);
    }
    // Print full entry
    console.log(JSON.stringify(entry));
  } else if (subcmd === 'compare') {
    const pkg = historyArgs[0];
    const v1 = historyArgs[1];
    const v2 = historyArgs[2];
    if (!pkg || !v1 || !v2) {
      console.error('Usage: deplens history compare <package> <version1> <version2>');
      process.exit(1);
    }
    const e1 = getHistoryEntry(pkg, v1, historyDir);
    const e2 = getHistoryEntry(pkg, v2, historyDir);
    if (!e1 || !e2) {
      console.error('❌ One or both versions not found in history.');
      process.exit(1);
    }
    const diff = compareHistoryEntries(e1, e2);
    console.log(JSON.stringify(diff));
  } else if (subcmd === 'clear') {
    const pkg = historyArgs[0] || null;
    const { removed } = clearHistory(pkg, historyDir);
    console.log(
      `🗑️  Cleared ${removed} history entr${removed === 1 ? 'y' : 'ies'}${pkg ? ` for ${pkg}` : ''}.`
    );
  } else {
    console.error('Usage: deplens history [list|show|compare|clear] [args...]');
    console.error('  list [filter]');
    console.error('  show <package[@version]>');
    console.error('  compare <package> <v1> <v2>');
    console.error('  clear [package]');
    process.exit(1);
  }
  process.exit(0);
}

if (command === 'project-diff') {
  const projectDir = path.resolve(argumentValue(argv, '--project-dir', process.cwd()));
  const lockfile = argumentValue(argv, '--lockfile', 'package-lock.json');
  const fromSource = argumentValue(argv, '--from-lock', argumentValue(argv, '--from', 'HEAD~1'));
  const toSource = argumentValue(argv, '--to-lock', argumentValue(argv, '--to', 'working'));
  let format = argv.includes('--json') ? 'json' : 'text';
  try {
    format = argv.includes('--json')
      ? 'json'
      : parseEnumOption(argv, '--format', VALID_PROJECT_FORMATS, 'text');
    const timeoutMs = parseIntegerOption(argv, '--timeout', { min: 1, fallback: undefined });
    const concurrency = parseIntegerOption(argv, '--concurrency', {
      min: 1,
      max: 64,
      fallback: undefined,
    });
    const maxChangesPerPackageValue = parseIntegerOption(argv, '--max-changes-per-package', {
      min: 1,
      max: 10000,
      fallback: parseIntegerOption(argv, '--max-changes', {
        min: 1,
        max: 10000,
        fallback: 10,
      }),
    });
    const packageCursors = parsePackageCursors(argumentValues(argv, '--package-cursor'));
    const packageOnly = commaList(argumentValues(argv, '--package-only'));
    const [fromSnapshot, toSnapshot] = await Promise.all([
      loadProjectSnapshot(fromSource, { projectDir, lockfile, timeoutMs }),
      loadProjectSnapshot(toSource, { projectDir, lockfile, timeoutMs }),
    ]);
    const report = await runProjectDiff({
      from: fromSnapshot,
      to: toSnapshot,
      projectDir,
      cacheDir: argumentValue(argv, '--cache-dir'),
      timeoutMs,
      concurrency,
      conditions: commaList(argumentValue(argv, '--conditions')),
      includeTransitive: argv.includes('--include-transitive'),
      includeSource: argv.includes('--include-source'),
      preferCdn: argv.includes('--prefer-cdn') && !argv.includes('--prefer-npm'),
      offline: argv.includes('--offline'),
      runtime: argv.includes('--runtime') && !argv.includes('--no-runtime'),
      semantic: !argv.includes('--no-semantic'),
      analyze: !argv.includes('--no-api'),
      detail: argumentValue(argv, '--detail', 'compact'),
      maxChangesPerPackage: maxChangesPerPackageValue,
      packageCursors,
      packageOnly,
      strictPackageOnly: argv.includes('--strict-package-only'),
      projectSnapshot: argumentValue(argv, '--project-snapshot'),
      profile: argv.includes('--profile'),
    });
    process.stdout.write(format === 'json' ? jsonStringify(report) : formatProjectDiffText(report));
    if (report.summary.failedPackages > 0) process.exitCode = 1;
    if (report.error) process.exitCode = 1;
  } catch (error) {
    const isArgumentError = /Invalid package cursor|Option --/.test(
      error instanceof Error ? error.message : String(error)
    );
    const payload = isArgumentError
      ? argumentErrorPayload(error instanceof Error ? error.message : String(error))
      : {
          error: error instanceof Error ? error.message : String(error),
          errorInfo: {
            code: 'PROJECT_DIFF_FAILED',
            phase: 'project-diff',
            retryable: false,
            details: null,
          },
        };
    process.stdout.write(format === 'json' ? jsonStringify(payload) : `Error: ${payload.error}`);
    process.exitCode = isArgumentError ? 2 : 1;
  }
} else if (command === 'check') {
  const projectDir = path.resolve(argumentValue(argv, '--project-dir', process.cwd()));
  const lockfile = argumentValue(argv, '--lockfile', 'package-lock.json');
  const baselinePath = path.resolve(
    projectDir,
    argumentValue(argv, '--baseline', argumentValue(argv, '--output', '.deplens-baseline.json'))
  );
  let format = argv.includes('--sarif') ? 'sarif' : argv.includes('--json') ? 'json' : 'text';
  try {
    format = argv.includes('--sarif')
      ? 'sarif'
      : argv.includes('--json')
        ? 'json'
        : parseEnumOption(argv, '--format', VALID_PROJECT_FORMATS, 'text');
    const failOn = parseEnumOption(argv, '--fail-on', VALID_POLICY_LEVELS, null);
    const timeoutMs = parseIntegerOption(argv, '--timeout', { min: 1, fallback: undefined });
    const concurrency = parseIntegerOption(argv, '--concurrency', {
      min: 1,
      max: 64,
      fallback: undefined,
    });
    const current = await loadProjectSnapshot(argumentValue(argv, '--to-lock', 'working'), {
      projectDir,
      lockfile,
    });
    if (argv.includes('--write-baseline')) {
      const baseline = createProjectBaseline(current);
      fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
      process.stdout.write(
        format === 'json' ? jsonStringify(baseline) : `Baseline written: ${baselinePath}`
      );
    } else {
      if (!fs.existsSync(baselinePath)) {
        throw new Error(`Baseline not found: ${baselinePath}. Run check --write-baseline first.`);
      }
      const configuredPolicy = loadProjectPolicy(argumentValue(argv, '--config'), { projectDir });
      const result = await runProjectCheck({
        baseline: baselinePath,
        current,
        policy: failOn ? { ...configuredPolicy, failOn } : configuredPolicy,
        projectDir,
        cacheDir: argumentValue(argv, '--cache-dir'),
        timeoutMs,
        concurrency,
        conditions: commaList(argumentValue(argv, '--conditions')),
        includeTransitive: argv.includes('--include-transitive'),
        includeSource: argv.includes('--include-source'),
        preferCdn: argv.includes('--prefer-cdn') && !argv.includes('--prefer-npm'),
        offline: argv.includes('--offline'),
        runtime: argv.includes('--runtime') && !argv.includes('--no-runtime'),
        semantic: !argv.includes('--no-semantic'),
        analyze: !argv.includes('--no-api'),
        profile: argv.includes('--profile'),
      });
      process.stdout.write(
        format === 'sarif'
          ? JSON.stringify(formatPolicyAsSarif(result), null, 2)
          : format === 'json'
            ? jsonStringify(result)
            : formatPolicyText(result)
      );
      if (!result.passed) process.exitCode = 1;
    }
  } catch (error) {
    const isArgumentError = /Option --/.test(
      error instanceof Error ? error.message : String(error)
    );
    const payload = isArgumentError
      ? argumentErrorPayload(error instanceof Error ? error.message : String(error))
      : {
          error: error instanceof Error ? error.message : String(error),
          errorInfo: {
            code: 'CHECK_FAILED',
            phase: 'check',
            retryable: false,
            details: null,
          },
        };
    process.stdout.write(format === 'text' ? `Error: ${payload.error}` : jsonStringify(payload));
    process.exitCode = isArgumentError ? 2 : 1;
  }
} else if (command === 'diff') {
  if (!parsed.packageName) {
    usage();
    process.exit(1);
  }

  const output = await runDiff({
    package: parsed.packageName,
    from: parsed.from,
    to: parsed.to,
    projectDir: parsed.projectDir || process.cwd(),
    includeSource: parsed.includeSource,
    includeChangelog: parsed.includeChangelog,
    preferCdn: parsed.preferCdn,
    offline: parsed.offline,
    runtime: parsed.runtime,
    filter: parsed.filter,
    format: parsed.format,
    verbose: parsed.verbose,
    colors: !parsed.noColor,
    conditions: parsed.conditions,
    timeoutMs: parsed.timeoutMs,
    cacheDir: parsed.cacheDir,
    semantic: parsed.semantic,
    maxChanges: parsed.maxChanges,
    cursor: parsed.cursor,
    profile: parsed.profile,
  });

  if (typeof output?.output === 'string' && output.output.length > 0) {
    process.stdout.write(output.output);
  }
  markExitCodeForOutput(output, parsed.format);
} else if (command === 'doctor') {
  if (!parsed.target) {
    usage();
    process.exit(1);
  }

  const output = await runDoctor({
    target: parsed.target,
    filter: parsed.filter,
    remote: parsed.remote,
    remoteVersion: parsed.remoteVersion,
    preferCdn: parsed.preferCdn,
    offline: parsed.offline,
    runtime: parsed.runtime,
    resolveFrom: parsed.resolveFrom,
    format: parsed.format,
    cwd: process.cwd(),
    conditions: parsed.conditions,
    profile: parsed.profile,
    timeoutMs: parsed.timeoutMs,
    cacheDir: parsed.cacheDir,
  });

  if (typeof output === 'string' && output.length > 0) {
    process.stdout.write(output);
  }
  markExitCodeForOutput(output, parsed.format);
} else {
  if (!parsed.target) {
    usage();
    process.exit(1);
  }

  const output = await runInspect({
    target: parsed.target,
    filter: parsed.filter,
    showTypes: parsed.showTypes,
    includeDocs: parsed.includeDocs,
    docsFor: parsed.docsFor,
    includeExamples: parsed.includeExamples,
    examplesFor: parsed.examplesFor,
    remote: parsed.remote,
    remoteVersion: parsed.remoteVersion,
    preferCdn: parsed.preferCdn,
    offline: parsed.offline,
    runtime: parsed.runtime,
    jsdoc: parsed.jsdoc,
    jsdocOutput: parsed.jsdocOutput,
    jsdocQuery: parsed.jsdocQuery,
    kind: parsed.kindFilter,
    depth: parsed.depth,
    resolveFrom: parsed.resolveFrom,
    // New options
    format: parsed.format,
    listSections: parsed.listSections,
    docsSections: parsed.docsSections,
    search: parsed.search,
    maxExports: parsed.maxExports,
    maxProps: parsed.maxProps,
    maxExamples: parsed.maxExamples,
    autoGenerateTypes: parsed.autoGenerateTypes,
    analyzeSource: parsed.analyzeSource,
    sourceMaxFiles: parsed.sourceMaxFiles,
    sourceIncludeBody: parsed.sourceIncludeBody,
    language: parsed.language,
    saveHistory: parsed.saveHistory,
    historyDir: parsed.historyDir,
    cwd: process.cwd(),
    write: console.log,
    writeError: console.error,
    detail: parsed.detail,
    select: parsed.select,
    cursor: parsed.cursor,
    maxSymbols: parsed.maxSymbols,
    timeoutMs: parsed.timeoutMs,
    cacheDir: parsed.cacheDir,
    conditions: parsed.conditions,
    profile: parsed.profile,
  });

  if (typeof output === 'string' && output.length > 0) {
    process.stdout.write(output);
  }
  markExitCodeForOutput(output, parsed.format);
}
