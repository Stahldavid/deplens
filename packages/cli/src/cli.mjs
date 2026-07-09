#!/usr/bin/env node
import { runInspect, runDiff, runDoctor } from '@deplens/core';
import { clearCache, getCacheStats, pinCache } from '@deplens/core';
import { listHistory, getHistoryEntry, clearHistory, compareHistoryEntries } from '@deplens/core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function cliVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(here, '..', 'package.json');
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
  } catch {
    return 'unknown';
  }
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
  const includeDocs = argv.includes('--docs') || argv.includes('--include-docs') || Boolean(docsFor);
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
  const formatIndex = argv.indexOf('--format');
  if (formatIndex !== -1 && argv[formatIndex + 1]) {
    format = argv[formatIndex + 1].toLowerCase();
  }
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
  const maxExportsIndex = argv.indexOf('--max-exports');
  if (maxExportsIndex !== -1 && argv[maxExportsIndex + 1]) {
    const parsed = parseInt(argv[maxExportsIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0) maxExports = parsed;
  }

  let maxProps = null;
  const maxPropsIndex = argv.indexOf('--max-props');
  if (maxPropsIndex !== -1 && argv[maxPropsIndex + 1]) {
    const parsed = parseInt(argv[maxPropsIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0) maxProps = parsed;
  }

  let maxExamples = null;
  const maxExamplesIndex = argv.indexOf('--max-examples');
  if (maxExamplesIndex !== -1 && argv[maxExamplesIndex + 1]) {
    const parsed = parseInt(argv[maxExamplesIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0) maxExamples = parsed;
  }

  const analyzeSource = argv.includes('--analyze-source');
  const autoGenerateTypes = !argv.includes('--no-auto-generate-types');
  const sourceIncludeBody =
    argv.includes('--source-include-body') || argv.includes('--include-source-body');
  let sourceMaxFiles = null;
  const sourceMaxFilesIndex = argv.indexOf('--source-max-files');
  if (sourceMaxFilesIndex !== -1 && argv[sourceMaxFilesIndex + 1]) {
    const parsed = parseInt(argv[sourceMaxFilesIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0) sourceMaxFiles = parsed;
  }
  let language = null;
  const languageIndex = argv.indexOf('--language');
  if (languageIndex !== -1 && argv[languageIndex + 1]) {
    language = argv[languageIndex + 1].toLowerCase();
  }

  let jsdoc = null;
  const jsdocIndex = argv.indexOf('--jsdoc');
  if (jsdocIndex !== -1 && argv[jsdocIndex + 1]) {
    jsdoc = argv[jsdocIndex + 1].toLowerCase();
  }

  let jsdocOutput = null;
  const jsdocOutputIndex = argv.indexOf('--jsdoc-output');
  if (jsdocOutputIndex !== -1 && argv[jsdocOutputIndex + 1]) {
    jsdocOutput = argv[jsdocOutputIndex + 1].toLowerCase();
  }

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
  const jsdocTruncateIndex = argv.indexOf('--jsdoc-truncate');
  if (jsdocTruncateIndex !== -1 && argv[jsdocTruncateIndex + 1]) {
    jsdocTruncate = argv[jsdocTruncateIndex + 1].toLowerCase();
  }

  let jsdocMaxLen = null;
  const jsdocMaxLenIndex = argv.indexOf('--jsdoc-max-len');
  if (jsdocMaxLenIndex !== -1 && argv[jsdocMaxLenIndex + 1]) {
    const parsed = parseInt(argv[jsdocMaxLenIndex + 1], 10);
    if (!isNaN(parsed) && parsed >= 0) jsdocMaxLen = parsed;
  }

  const filterIndex = argv.indexOf('--filter');
  if (filterIndex !== -1 && argv[filterIndex + 1]) {
    filter = argv[filterIndex + 1].toLowerCase();
  }

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
  }

  let depth = 1;
  const depthIndex = argv.indexOf('--depth');
  if (depthIndex !== -1 && argv[depthIndex + 1]) {
    depth = parseInt(argv[depthIndex + 1], 10);
    if (isNaN(depth) || depth < 0 || depth > 5) {
      depth = 1;
    }
  }

  let jsdocQuery = null;
  if (
    jsdocSymbols ||
    jsdocSections ||
    jsdocTagsInclude ||
    jsdocTagsExclude ||
    jsdocTruncate ||
    jsdocMaxLen !== null
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
      truncate: jsdocTruncate ?? undefined,
    };
  }

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

  let format = 'text';
  const formatIndex = argv.indexOf('--format');
  if (formatIndex !== -1 && argv[formatIndex + 1]) {
    format = argv[formatIndex + 1].toLowerCase();
  }
  // --json shortcut
  if (argv.includes('--json')) {
    format = 'json';
  }

  const includeSource = argv.includes('--include-source');
  const includeChangelog = !argv.includes('--no-changelog');
  const verbose = argv.includes('--verbose');
  const noColor = argv.includes('--no-color');

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
  };
}

function usage() {
  console.error(
    'Uso:\n' +
      '  deplens <pacote> [filtro] [opções]\n' +
      '  deplens inspect <pacote> [filtro] [opções]\n' +
      '  deplens diff <pacote> [opções]\n' +
      '  deplens doctor <pacote> [opções]\n' +
      '  deplens cache [stats|clear|pin] [opções]\n\n' +
      'Opções (cache):\n' +
      '  --fast                Fast stats using metadata / directory entries only (default)\n' +
      '  --exact               Recalculate recursive directory sizes\n' +
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
      '  --analyze-source       Analyze source code (JS/TS/Python/Java/Rust/Go)\n' +
      '  --source-max-files N   Max source files to analyze\n' +
      '  --source-include-body  Include function body snippets\n' +
      '  --save-history          Save analysis to local history (~/.deplens/history)\n' +
      '  --no-save-history       Disable saving to history\n' +
      '  --history-dir DIR       Custom history directory\n' +
      '  --language LANG         Force language detection (javascript, typescript, python, java, rust, go)\n' +
      '  --kind f,c,...         Filter by kind (function,class,object,constant)\n' +
      '  --depth N              Object inspection depth (0-5)\n' +
      '  --resolve-from DIR     Base directory for module resolution\n' +
      '  --jsdoc off|compact|full  JSDoc mode\n' +
      '  --jsdoc-output off|section|inline|only  JSDoc output mode\n' +
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
      '  --project-dir DIR      Base directory for installed version\n'
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

const argv = process.argv.slice(2);
if (argv.includes('--version') || argv.includes('-v')) {
  console.log(cliVersion());
  process.exit(0);
}
let command = argv[0] === 'diff' || argv[0] === 'inspect' || argv[0] === 'doctor' ? argv[0] : 'inspect';
if (argv[0] === 'cache') command = 'cache';
if (argv[0] === 'history') command = 'history';

// Handle help flag (after argv is available)
if (argv.includes('--help') || argv.includes('-h')) {
  usage();
  process.exit(0);
}

const commandArgs = command === 'inspect' && argv[0] !== 'inspect' ? argv : argv.slice(1);

const parsed = command === 'diff' ? parseDiffArgs(commandArgs) : parseInspectArgs(commandArgs);

// Cache commands
if (command === 'cache') {
  const subcmd = argv[1] || 'stats';
  if (subcmd === 'clear' || subcmd === 'clean') {
    const pkg = argv[2] || null;
    clearCache(pkg);
    console.log(`Cache cleared${pkg ? ` for ${pkg}` : ''}.`);
  } else if (subcmd === 'stats' || subcmd === 'status') {
    const stats = getCacheStats({ exact: argv.includes('--exact') && !argv.includes('--fast') });
    if (argv.includes('--json')) {
      console.log(JSON.stringify(stats, null, 2));
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
      });
      console.log(`Pinned ${result.package}@${result.version}`);
      console.log(`CachePath: ${result.path}`);
      if (result.metadata?.integrity) {
        console.log(`Integrity: ${result.metadata.integrity}`);
      }
    } catch (e) {
      console.error(`Failed to pin cache: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  } else {
    console.error('Usage: deplens cache [clear|stats|pin] [package?]');
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
    if (entries.length === 0) {
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
    console.log(JSON.stringify(entry, null, 2));
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
    console.log(JSON.stringify(diff, null, 2));
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

if (command === 'diff') {
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
  });

  if (typeof output === 'string' && output.length > 0) {
    process.stdout.write(output);
  }
  markExitCodeForOutput(output, parsed.format);
}
