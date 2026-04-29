#!/usr/bin/env node
import { runInspect, runDiff } from '@deplens/core';
import { clearCache, getCacheStats } from '@deplens/core';

function parseInspectArgs(argv) {
  const target = argv[0];
  let filter = argv[1] && !argv[1].startsWith('--') ? argv[1].toLowerCase() : null;
  const showTypes = argv.includes('--types');
  const includeDocs = argv.includes('--docs') || argv.includes('--include-docs');
  const includeExamples = argv.includes('--examples') || argv.includes('--include-examples');
  const remote = argv.includes('--remote');

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
  let sourceMaxFiles = null;
  const sourceMaxFilesIndex = argv.indexOf('--source-max-files');
  if (sourceMaxFilesIndex !== -1 && argv[sourceMaxFilesIndex + 1]) {
    const parsed = parseInt(argv[sourceMaxFilesIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0) sourceMaxFiles = parsed;
  }
  const sourceIncludeBody = argv.includes('--source-include-body');

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

  // CDN vs npm preference (default: prefer CDN)
  const preferCdn = !argv.includes('--prefer-npm');
  const preferCdnExplicit = argv.includes('--prefer-cdn');

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
    includeExamples,
    remote,
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
    analyzeSource,
    sourceMaxFiles,
    sourceIncludeBody,
    preferCdn,
    preferCdnExplicit,
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

  // CDN preference
  const preferCdn = !argv.includes('--prefer-npm');

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
  };
}

function usage() {
  console.error(
    'Uso:\n' +
      '  deplens <pacote> [filtro] [opções]\n' +
      '  deplens inspect <pacote> [filtro] [opções]\n' +
      '  deplens diff <pacote> [opções]\n\n' +
      'Opções (inspect):\n' +
      '  --filter VALUE         Filter exports by name\n' +
      '  --search QUERY         Semantic search (token matching + JSDoc)\n' +
      '  --types                Show type signatures from .d.ts\n' +
      '  --docs                 Include README preview\n' +
      '  --list-sections        List available README sections\n' +
      '  --docs-sections S1,S2  Extract specific README sections\n' +
      '  --examples             Include code examples\n' +
      '  --format text|json     Output format (default: text)\n' +
      '  --json                Shorthand for --format json\n' +
      '  --remote               Download package to cache\n' +
      '  --remote-version V     Version for remote download\n' +
      '  --prefer-cdn          Prefer CDN download (default)\n' +
      '  --prefer-npm          Force npm install (no CDN)\n' +
      '  --max-exports N        Max exports to show (default: 100)\n' +
      '  --max-props N          Max props per object (default: 10)\n' +
      '  --max-examples N       Max examples to show (default: 10)\n' +
      '  --analyze-source       Analyze source for complexity\n' +
      '  --source-max-files N   Max source files to analyze\n' +
      '  --source-include-body  Include function body snippets\n' +
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
      '  --prefer-cdn          Prefer CDN download (default)\n' +
      '  --prefer-npm          Force npm install (no CDN)\n' +
      '  --include-source       Compare source complexity\n' +
      '  --no-changelog         Skip changelog parsing\n' +
      '  --verbose              Show detailed changes\n' +
      '  --no-color             Disable ANSI colors\n' +
      '  --project-dir DIR      Base directory for installed version\n'
  );
}

const argv = process.argv.slice(2);
let command = argv[0] === 'diff' || argv[0] === 'inspect' ? argv[0] : 'inspect';
if (argv[0] === 'cache') command = 'cache';

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
    const stats = getCacheStats();
    console.log(`📦 Cache entries: ${stats.entries}`);
    console.log(`📊 Total size: ${stats.sizeFormatted || stats.size + ' B'}`);
    if (stats.packages && stats.packages.length > 0) {
      console.log('\nPackages:');
      for (const p of stats.packages.sort((a, b) => b.size - a.size).slice(0, 10)) {
        console.log(`  ${p.name}: ${p.sizeFormatted || p.size + ' B'}`);
      }
    }
  } else {
    console.error('Usage: deplens cache [clear|stats] [package?]');
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
    filter: parsed.filter,
    format: parsed.format,
    verbose: parsed.verbose,
    colors: !parsed.noColor,
  });

  if (typeof output?.output === 'string' && output.output.length > 0) {
    process.stdout.write(output.output);
  }
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
    includeExamples: parsed.includeExamples,
    remote: parsed.remote,
    remoteVersion: parsed.remoteVersion,
    preferCdn: parsed.preferCdn,
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
    analyzeSource: parsed.analyzeSource,
    sourceMaxFiles: parsed.sourceMaxFiles,
    sourceIncludeBody: parsed.sourceIncludeBody,
    cwd: process.cwd(),
    write: console.log,
    writeError: console.error,
  });

  if (typeof output === 'string' && output.length > 0) {
    process.stdout.write(output);
  }
}
