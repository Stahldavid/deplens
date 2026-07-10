// inspect.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fg from 'fast-glob';
import { resolve as importMetaResolve } from 'import-meta-resolve';
import { detectLanguage } from './language-detector.mjs';
import { analyzePythonPackage, resolvePythonPackage } from './analyze-python.mjs';
import { downloadVersion, resolveVersionAsync } from './version-resolver.mjs';
import { getCachedDtsParse, generateDts, filterTypeInfo } from './inspect-types.mjs';
import { buildSymbols } from './symbols.mjs';
import { buildResolutionTrace } from './resolution-trace.mjs';
import { errorPayload, throwIfAborted } from './errors.mjs';
import { isProbablyClass, loadModuleExports } from './runtime-analyzer.mjs';
import { createInspectSnapshot } from './analysis-snapshot.mjs';
import {
  expandSynonyms,
  extractMarkdownCodeFences,
  extractSectionsByName,
  listReadmeSections,
  looksLikeCodeBlock,
  rankReadmeSections,
  tokenizeSymbolName,
} from './docs-analyzer.mjs';

function getPackageName(target) {
  if (!target) return target;
  if (target.startsWith('@')) {
    const parts = target.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : target;
  }
  return target.split('/')[0];
}

function getPackageSubpath(target) {
  if (!target) return null;
  const base = getPackageName(target);
  if (!base) return null;
  if (target === base) return null;
  const prefix = `${base}/`;
  return target.startsWith(prefix) ? target.slice(prefix.length) : null;
}

async function findWorkspaceRoot(startDir) {
  if (!startDir) return null;
  let dir = path.resolve(startDir);
  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg?.workspaces) return { dir, pkg };
      } catch (e) {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function listWorkspacePackageDirs(rootDir, workspaces, targetPackage) {
  const patterns = Array.isArray(workspaces) ? workspaces : workspaces?.packages;
  if (!Array.isArray(patterns) || patterns.length === 0) return [];
  const dirs = [];
  const target = getPackageName(targetPackage);

  for (const pattern of patterns) {
    if (!pattern) continue;
    const normalized = String(pattern).replace(/\\/g, '/').replace(/\/?$/, '/');
    const globPattern = `${normalized}package.json`;
    const matches =
      typeof Bun !== 'undefined' && Bun.Glob
        ? await Array.fromAsync(
            new Bun.Glob(globPattern).scan({
              cwd: rootDir,
              absolute: false,
              onlyFiles: true,
              followSymlinks: false,
              dot: false,
            })
          )
        : await fg(globPattern, {
            cwd: rootDir,
            onlyFiles: true,
            dot: false,
            followSymbolicLinks: false,
          });
    for (const match of matches) {
      const pkgPath = path.join(rootDir, match);
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const depTables = [
          pkg?.dependencies,
          pkg?.devDependencies,
          pkg?.peerDependencies,
          pkg?.optionalDependencies,
        ];
        const hasTarget =
          Boolean(target) &&
          depTables.some((deps) => deps && Object.prototype.hasOwnProperty.call(deps, target));
        if (hasTarget) {
          dirs.push(path.dirname(pkgPath));
        }
      } catch (e) {}
    }
  }

  return dirs;
}

async function resolveTargetModule(target, cwd, resolveFrom, explicitResolveFrom) {
  const baseDir = resolveFrom || cwd;
  if (!baseDir) return { resolved: null, resolveCwd: baseDir, resolver: null };

  const tryResolve = async (dir) => {
    if (!dir) return null;
    if (typeof Bun !== 'undefined' && Bun.resolve) {
      try {
        const resolved = await Bun.resolve(target, dir);
        return { resolved, resolver: 'bun', resolveCwd: dir };
      } catch (e) {}
    }
    try {
      const parentUrl = pathToFileURL(path.join(dir, 'noop.js')).href;
      const resolvedUrl = await importMetaResolve(target, parentUrl);
      const resolvedPath = resolvedUrl.startsWith('file://')
        ? fileURLToPath(resolvedUrl)
        : resolvedUrl;
      return {
        resolved: resolvedPath,
        resolver: 'import-meta-resolve',
        resolveCwd: dir,
      };
    } catch (e) {}
    try {
      const req = createRequire(path.join(dir, 'noop.js'));
      const resolved = req.resolve(target);
      return { resolved, resolver: 'require', resolveCwd: dir };
    } catch (e) {
      return null;
    }
  };

  const direct = await tryResolve(baseDir);
  if (direct) return direct;

  const workspace = await findWorkspaceRoot(baseDir);
  if (workspace?.pkg?.workspaces) {
    const dirs = await listWorkspacePackageDirs(workspace.dir, workspace.pkg.workspaces, target);
    for (const dir of dirs) {
      const resolved = await tryResolve(dir);
      if (resolved) return resolved;
    }
  }

  // Fallback: when the user explicitly passed --resolve-from pointing at a directory
  // that has a package.json (e.g. for non-JS language inspection or a local copy),
  // surface that directory so downstream stages can still inspect it.
  if (explicitResolveFrom && fs.existsSync(path.join(explicitResolveFrom, 'package.json'))) {
    return {
      resolved: path.join(explicitResolveFrom, 'package.json'),
      resolveCwd: explicitResolveFrom,
      resolver: 'direct-resolve-from',
      metadataOnly: true,
    };
  }

  return { resolved: null, resolveCwd: baseDir, resolver: null };
}

function existingEntrypointPath(resolvedPath) {
  if (!resolvedPath || typeof resolvedPath !== 'string') return resolvedPath;
  const candidates = [
    resolvedPath,
    ...(!path.extname(resolvedPath)
      ? [
          `${resolvedPath}.js`,
          `${resolvedPath}.mjs`,
          `${resolvedPath}.cjs`,
          path.join(resolvedPath, 'index.js'),
          path.join(resolvedPath, 'index.mjs'),
          path.join(resolvedPath, 'index.cjs'),
        ]
      : []),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || resolvedPath;
}

function findPackageJsonFromPath(startPath) {
  if (!startPath) return null;
  let dir = path.dirname(startPath);
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findPackageJsonInNodeModules(startDir, basePkg) {
  if (!startDir || !basePkg) return null;
  const segments = basePkg.split('/');
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, 'node_modules', ...segments, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolvePackageInfo(basePkg, require, resolveFrom, resolvedPath) {
  let pkgPath;
  let pkgDir;
  try {
    pkgPath = require.resolve(`${basePkg}/package.json`);
    pkgDir = path.dirname(pkgPath);
  } catch (e) {
    try {
      const mainPath = require.resolve(basePkg);
      let dir = path.dirname(mainPath);
      for (let i = 0; i < 5; i++) {
        const candidate = path.join(dir, 'package.json');
        if (fs.existsSync(candidate)) {
          pkgPath = candidate;
          pkgDir = dir;
          break;
        }
        dir = path.dirname(dir);
      }
    } catch (err) {}
  }

  if (!pkgPath && resolveFrom && basePkg) {
    const fallback = findPackageJsonInNodeModules(resolveFrom, basePkg);
    if (fallback) {
      pkgPath = fallback;
      pkgDir = path.dirname(fallback);
    }
  }

  if (!pkgPath && resolvedPath) {
    const fallback = findPackageJsonFromPath(resolvedPath);
    if (fallback) {
      pkgPath = fallback;
      pkgDir = path.dirname(fallback);
    }
  }

  if (resolveFrom && basePkg) {
    const rootCandidate = findPackageJsonInNodeModules(resolveFrom, basePkg);
    if (rootCandidate && rootCandidate !== pkgPath) {
      pkgPath = rootCandidate;
      pkgDir = path.dirname(rootCandidate);
    }
  }

  if (!pkgPath || !fs.existsSync(pkgPath)) return null;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  return { pkg, pkgPath, pkgDir };
}

function resolveTypesFromExportEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object') {
    // First try explicit types field
    if (typeof entry.types === 'string') return entry.types;

    // Then try import/require/default but look for their types too
    for (const key of ['import', 'require', 'default']) {
      const value = entry[key];
      if (typeof value === 'string') {
        // Try to find corresponding .d.ts
        return value;
      } else if (value && typeof value === 'object' && typeof value.types === 'string') {
        return value.types;
      }
    }
  }
  return null;
}

function coerceTypesPath(typesPath) {
  if (!typesPath) return typesPath;
  if (typesPath.endsWith('.d.ts') || typesPath.endsWith('.d.cts') || typesPath.endsWith('.d.mts')) {
    return typesPath;
  }
  if (typesPath.endsWith('.mjs')) return typesPath.replace(/\.mjs$/, '.d.mts');
  if (typesPath.endsWith('.cjs')) return typesPath.replace(/\.cjs$/, '.d.cts');
  if (typesPath.endsWith('.js')) return typesPath.replace(/\.js$/, '.d.ts');
  return typesPath;
}

function tryResolveTypesPackage(basePkgName, require) {
  if (!basePkgName || basePkgName.startsWith('@types/')) return null;

  // Convert package name to @types format
  // react -> @types/react
  // @foo/bar -> @types/foo__bar
  let typesPackageName;
  if (basePkgName.startsWith('@')) {
    const [scope, name] = basePkgName.slice(1).split('/');
    typesPackageName = `@types/${scope}__${name}`;
  } else {
    typesPackageName = `@types/${basePkgName}`;
  }

  try {
    // Try to resolve the @types package
    const typesPkgJsonPath = require.resolve(`${typesPackageName}/package.json`);
    if (typesPkgJsonPath && fs.existsSync(typesPkgJsonPath)) {
      const typesPkg = JSON.parse(fs.readFileSync(typesPkgJsonPath, 'utf-8'));
      const typesPkgDir = path.dirname(typesPkgJsonPath);

      // Find the types file in @types package
      const typesEntry = typesPkg.types || typesPkg.typings || 'index.d.ts';
      const typesFullPath = path.resolve(typesPkgDir, typesEntry);

      if (fs.existsSync(typesFullPath)) {
        return {
          typesFile: typesEntry,
          dtsPath: typesFullPath,
          source: '@types',
          pkgDir: typesPkgDir,
        };
      }
    }
  } catch (e) {
    // @types package not found or not resolvable
  }

  return null;
}

function getTypesCandidatesFromResolvedPath(resolvedPath) {
  if (!resolvedPath) return [];
  const candidates = [];
  const resolvedDir = path.dirname(resolvedPath);
  const resolvedExt = path.extname(resolvedPath);
  if (resolvedExt) {
    candidates.push(coerceTypesPath(resolvedPath));
  } else {
    candidates.push(`${resolvedPath}.d.ts`, `${resolvedPath}.d.cts`, `${resolvedPath}.d.mts`);
    candidates.push(path.join(resolvedPath, 'index.d.ts'));
    candidates.push(path.join(resolvedPath, 'index.d.cts'));
    candidates.push(path.join(resolvedPath, 'index.d.mts'));
  }
  candidates.push(path.join(resolvedDir, 'index.d.ts'));
  candidates.push(path.join(resolvedDir, 'index.d.cts'));
  candidates.push(path.join(resolvedDir, 'index.d.mts'));
  return candidates;
}

function resolveTypesFile(pkg, pkgDir, subpath, basePkgName, require, resolvedPath = null) {
  if (!pkg || !pkgDir) return { typesFile: null, dtsPath: null, source: null };
  let typesFile = null;
  let source = null;

  if (pkg.exports) {
    let entry = null;
    if (subpath) {
      const key = subpath.startsWith('.') ? subpath : `./${subpath}`;
      if (typeof pkg.exports === 'object') {
        entry = pkg.exports[key];
      }
    } else if (typeof pkg.exports === 'string') {
      entry = pkg.exports;
    } else if (typeof pkg.exports === 'object') {
      entry = pkg.exports['.'] ?? pkg.exports['./'];
    }

    const typesFromExport = resolveTypesFromExportEntry(entry);
    if (typesFromExport) {
      typesFile = coerceTypesPath(typesFromExport);
      source = 'exports';
    }
  }

  if (!typesFile && subpath) {
    const candidates = [
      `${subpath}.d.ts`,
      `${subpath}.d.cts`,
      `${subpath}.d.mts`,
      path.join(subpath, 'index.d.ts'),
      path.join(subpath, 'index.d.cts'),
      path.join(subpath, 'index.d.mts'),
    ];
    for (const candidate of candidates) {
      const candidatePath = path.resolve(pkgDir, candidate);
      if (fs.existsSync(candidatePath)) {
        typesFile = candidate;
        source = 'subpath';
        break;
      }
    }
  }

  if (!typesFile && subpath && resolvedPath) {
    const resolvedCandidates = getTypesCandidatesFromResolvedPath(resolvedPath);
    for (const candidate of resolvedCandidates) {
      if (candidate && fs.existsSync(candidate)) {
        typesFile = path.relative(pkgDir, candidate);
        source = 'subpath';
        break;
      }
    }
  }

  if (!typesFile) {
    typesFile = pkg.types || pkg.typings || null;
    if (typesFile) source = 'package';
  }

  if (!typesFile) {
    const candidates = [
      subpath ? `${subpath}.d.ts` : null,
      subpath ? `${subpath}.d.cts` : null,
      subpath ? `${subpath}.d.mts` : null,
      subpath ? path.join(subpath, 'index.d.ts') : null,
      subpath ? path.join(subpath, 'index.d.cts') : null,
      subpath ? path.join(subpath, 'index.d.mts') : null,
      'index.d.ts',
      'index.d.cts',
      'index.d.mts',
      'dist/index.d.ts',
      'dist/index.d.cts',
      'dist/index.d.mts',
      'lib/index.d.ts',
      'lib/index.d.cts',
      'lib/index.d.mts',
      'types/index.d.ts',
      'types/index.d.cts',
      'types/index.d.mts',
      'src/index.d.ts',
      'dist/types/index.d.ts',
      'build/index.d.ts',
    ];
    for (const candidate of candidates.filter(Boolean)) {
      const candidatePath = path.resolve(pkgDir, candidate);
      if (fs.existsSync(candidatePath)) {
        typesFile = candidate;
        source = 'fallback';
        break;
      }
    }
  }

  // Last resort: search for any .d.ts file in package root or common directories
  if (!typesFile) {
    const searchDirs = ['.', 'dist', 'lib', 'types', 'build'];
    for (const dir of searchDirs) {
      const searchPath = path.resolve(pkgDir, dir);
      if (!fs.existsSync(searchPath)) continue;

      try {
        const files = fs.readdirSync(searchPath);
        const dtsFile = files.find(
          (f) => f.endsWith('.d.ts') || f.endsWith('.d.mts') || f.endsWith('.d.cts')
        );
        if (dtsFile) {
          typesFile = path.join(dir === '.' ? '' : dir, dtsFile);
          source = 'search';
          break;
        }
      } catch (e) {
        // Skip directories we can't read
      }
    }
  }

  if (!typesFile && resolvedPath) {
    const resolvedCandidates = getTypesCandidatesFromResolvedPath(resolvedPath);
    for (const candidate of resolvedCandidates) {
      if (candidate && fs.existsSync(candidate)) {
        typesFile = path.relative(pkgDir, candidate);
        source = 'fallback';
        break;
      }
    }
  }

  if (!typesFile) {
    // Try @types/* package before giving up
    if (basePkgName && require) {
      const typesPackageResult = tryResolveTypesPackage(basePkgName, require);
      if (typesPackageResult) {
        return typesPackageResult;
      }
    }
    return { typesFile: null, dtsPath: null, source: null };
  }

  const resolved = path.isAbsolute(typesFile) ? typesFile : path.resolve(pkgDir, typesFile);
  let dtsPath = resolved;
  if (!fs.existsSync(dtsPath)) {
    const mapped = coerceTypesPath(dtsPath);
    if (mapped !== dtsPath && fs.existsSync(mapped)) {
      dtsPath = mapped;
    } else {
      const replacements = ['.d.ts', '.d.cts', '.d.mts'];
      for (const ext of replacements) {
        if (dtsPath.endsWith(ext)) continue;
        const candidate = `${dtsPath}${ext}`;
        if (fs.existsSync(candidate)) {
          dtsPath = candidate;
          break;
        }
      }
      if (!fs.existsSync(dtsPath) && dtsPath.endsWith('.d.ts')) {
        const ctsPath = dtsPath.replace('.d.ts', '.d.cts');
        const mtsPath = dtsPath.replace('.d.ts', '.d.mts');
        if (fs.existsSync(ctsPath)) dtsPath = ctsPath;
        else if (fs.existsSync(mtsPath)) dtsPath = mtsPath;
      }
    }
  }

  if (!fs.existsSync(dtsPath)) {
    const altDir = path.dirname(dtsPath);
    const altCandidates = [
      'types.d.ts',
      'types.d.mts',
      'types.d.cts',
      'index.d.ts',
      'index.d.mts',
      'index.d.cts',
    ];
    for (const candidate of altCandidates) {
      const altPath = path.join(altDir, candidate);
      if (fs.existsSync(altPath)) {
        dtsPath = altPath;
        typesFile = path.relative(pkgDir, altPath);
        if (!source || source === 'exports' || source === 'package') {
          source = 'fallback';
        }
        break;
      }
    }
  }

  if ((!dtsPath || !fs.existsSync(dtsPath)) && resolvedPath) {
    for (const candidate of getTypesCandidatesFromResolvedPath(resolvedPath)) {
      if (candidate && fs.existsSync(candidate)) {
        dtsPath = candidate;
        typesFile = path.relative(pkgDir, candidate);
        if (!source || source === 'exports' || source === 'package') {
          source = 'fallback';
        }
        break;
      }
    }
  }

  // Final fallback: If declared types file doesn't exist, try @types/* package
  if (!fs.existsSync(dtsPath) && basePkgName && require) {
    const typesPackageResult = tryResolveTypesPackage(basePkgName, require);
    if (typesPackageResult) {
      return typesPackageResult;
    }
  }

  return { typesFile, dtsPath, source };
}

function buildSymbolMatcher(symbols, fallbackFilter) {
  const patterns = [];
  const addPattern = (value) => {
    if (!value) return;
    if (value.startsWith('/') && value.endsWith('/') && value.length > 2) {
      try {
        patterns.push({
          type: 'regex',
          value: new RegExp(value.slice(1, -1), 'i'),
        });
        return;
      } catch (e) {
        patterns.push({ type: 'substring', value: value.toLowerCase() });
        return;
      }
    }
    if (value.includes('*')) {
      const escaped = value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      patterns.push({ type: 'regex', value: new RegExp(`^${escaped}$`, 'i') });
      return;
    }
    patterns.push({ type: 'exact', value: value.toLowerCase() });
  };

  if (Array.isArray(symbols)) {
    symbols.forEach(addPattern);
  } else if (typeof symbols === 'string') {
    addPattern(symbols);
  } else if (fallbackFilter) {
    addPattern(fallbackFilter);
  }

  if (patterns.length === 0) return null;
  return (name) => {
    const lower = name.toLowerCase();
    return patterns.some((pattern) => {
      if (pattern.type === 'regex') return pattern.value.test(name);
      return lower === pattern.value;
    });
  };
}

/**
 * Calculate token match score between query and symbol
 * Returns 0-1 score
 */
function tokenMatchScore(queryTokens, symbolName, jsdocText = '') {
  if (!queryTokens || queryTokens.length === 0) return 0;
  const symbolTokens = tokenizeSymbolName(symbolName);
  const jsdocLower = (jsdocText || '').toLowerCase();

  let matchedTokens = 0;
  for (const qt of queryTokens) {
    // Check exact token match in symbol
    if (symbolTokens.includes(qt)) {
      matchedTokens += 1;
      continue;
    }
    // Check partial match in symbol name
    if (symbolName.toLowerCase().includes(qt)) {
      matchedTokens += 0.8;
      continue;
    }
    // Check match in JSDoc
    if (jsdocLower.includes(qt)) {
      matchedTokens += 0.5;
    }
  }
  return matchedTokens / queryTokens.length;
}

/**
 * Search exports by semantic query (token matching + JSDoc)
 */
function searchExports(exports, typeInfo, query, minScore = 0.3) {
  if (!query || !exports) return exports;
  const queryTokens = expandSynonyms(tokenizeSymbolName(query));
  if (queryTokens.length === 0) return exports;

  const scored = [];
  for (const exp of exports) {
    const name = exp.name || exp;
    const jsdoc = typeInfo?.jsdoc?.[name];
    const jsdocText = [jsdoc?.summary, ...(jsdoc?.params || []), ...(jsdoc?.returns || [])]
      .filter(Boolean)
      .join(' ');
    const score = tokenMatchScore(queryTokens, name, jsdocText);
    if (score >= minScore) {
      scored.push({ ...exp, _searchScore: score });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b._searchScore - a._searchScore);
  return scored;
}

function hasTypeSymbols(typeInfo) {
  if (!typeInfo) return false;
  return ['functions', 'interfaces', 'types', 'classes', 'enums', 'variables'].some(
    (key) => Object.keys(typeInfo[key] || {}).length > 0
  );
}

function typeSymbolNames(typeInfo) {
  return [
    'functions',
    'interfaces',
    'types',
    'classes',
    'enums',
    'namespaces',
    'variables',
  ].flatMap((key) => Object.keys(typeInfo?.[key] || {}));
}

function filterTypeInfoForOutput(typeInfo, filter, kindFilter, allowedNames = null) {
  const filtered = filterTypeInfo(typeInfo, filter, kindFilter);
  if (!allowedNames) return filtered;
  const allowed = new Set(allowedNames);
  const result = { ...filtered };
  for (const key of [
    'functions',
    'interfaces',
    'interfaceDetails',
    'types',
    'classes',
    'enums',
    'enumDetails',
    'namespaces',
    'variables',
    'jsdoc',
  ]) {
    result[key] = Object.fromEntries(
      Object.entries(filtered?.[key] || {}).filter(([name]) => allowed.has(name))
    );
  }
  return result;
}

function comparableModuleStem(filePath) {
  if (!filePath) return null;
  return String(filePath)
    .replace(/\\/g, '/')
    .replace(/\.d\.(?:ts|cts|mts)$/i, '')
    .replace(/\.(?:js|cjs|mjs|ts|cts|mts)$/i, '');
}

function realPathIfAvailable(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function packageRelativeModulePath(filePath, pkgDir) {
  if (!filePath) return null;
  if (!pkgDir) return filePath;
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(pkgDir, filePath);
  const realPackageDir = realPathIfAvailable(pkgDir);
  const realFilePath = realPathIfAvailable(absolutePath);
  const relativePath = path.relative(realPackageDir, realFilePath);
  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return realFilePath;
}

function readPackageTextFile(pkgDir, filenameCandidates) {
  if (!pkgDir) return null;
  for (const candidate of filenameCandidates) {
    const full = path.join(pkgDir, candidate);
    if (!fs.existsSync(full)) continue;
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch {
      // ignore
    }
  }
  return null;
}

function listExamplesFromDirs(pkgDir, maxFiles = 12) {
  if (!pkgDir) return [];
  const dirs = ['examples', 'example', 'demo', 'demos'];
  const result = [];
  for (const dirName of dirs) {
    const fullDir = path.join(pkgDir, dirName);
    if (!fs.existsSync(fullDir)) continue;
    try {
      const entries = fs.readdirSync(fullDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        // keep small set of likely relevant examples
        if (!/\.(mjs|cjs|js|ts|tsx|jsx|md)$/i.test(entry.name)) continue;
        result.push(path.join(dirName, entry.name));
        if (result.length >= maxFiles) return result;
      }
    } catch {
      // ignore
    }
  }
  return result;
}

function exampleNeedle(optionsFilter, examplesFor) {
  const raw = examplesFor || optionsFilter || null;
  return raw ? String(raw).trim() : null;
}

function scoreExampleForNeedle(example, needle) {
  if (!needle) return 0;
  const lowerNeedle = needle.toLowerCase();
  const haystack = [example.path, example.symbol, example.lang, example.code]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  let score = 0;
  if ((example.symbol || '').toLowerCase() === lowerNeedle) score += 100;
  if ((example.path || '').toLowerCase().includes(lowerNeedle)) score += 25;
  const escapedNeedle = lowerNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${escapedNeedle}\\b`, 'i').test(haystack)) score += 60;
  const directMatches = haystack.split(lowerNeedle).length - 1;
  score += directMatches * 12;

  const tokens = tokenizeSymbolName(needle);
  for (const token of tokens) {
    if (token.length < 2) continue;
    const tokenMatches = haystack.split(token).length - 1;
    score += tokenMatches * 3;
  }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add)\b/i.test(example.code || '')) score -= 5;
  return score;
}

function rankExamplesForNeedle(examples, needle, maxExamples) {
  const ranked = examples.map((example, index) => ({
    ...example,
    score: scoreExampleForNeedle(example, needle),
    rankSource: needle ? 'symbol' : 'default',
    _index: index,
  }));
  ranked.sort((a, b) => b.score - a.score || a._index - b._index);
  return ranked.slice(0, maxExamples).map(({ _index, ...example }) => example);
}

function truncateSummary(text, mode, maxLen, truncateMode) {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (truncateMode === 'none') return normalized;
  const limit = typeof maxLen === 'number' ? maxLen : mode === 'compact' ? 240 : 1200;
  if (normalized.length <= limit) return normalized;
  if (truncateMode === 'sentence') {
    const slice = normalized.slice(0, limit);
    const lastPeriod = Math.max(
      slice.lastIndexOf('.'),
      slice.lastIndexOf('!'),
      slice.lastIndexOf('?')
    );
    if (lastPeriod > 40) {
      return `${slice.slice(0, lastPeriod + 1)}`;
    }
  }
  if (truncateMode === 'word') {
    const slice = normalized.slice(0, limit);
    const lastSpace = slice.lastIndexOf(' ');
    if (lastSpace > 40) {
      return `${slice.slice(0, lastSpace)}...`;
    }
  }
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function formatJsdocEntry(name, doc, options) {
  const mode = options.mode || 'compact';
  const truncateMode = options.truncate || 'word';
  const maxLen = options.maxLen;
  const sections =
    options.sections && options.sections.length > 0
      ? options.sections
      : mode === 'full'
        ? ['summary', 'params', 'returns', 'tags']
        : ['summary', 'tags'];
  const includeTags = options.tags?.include || null;
  const excludeTags = options.tags?.exclude || null;

  const summary = truncateSummary(doc.summary || '', mode, maxLen, truncateMode);
  const tags = doc.tags || {};
  const tagLines = [];

  const addTag = (tagName, values) => {
    if (!values || values.length === 0) {
      tagLines.push(`@${tagName}`);
      return;
    }
    for (const value of values) {
      tagLines.push(value ? `@${tagName} ${value}` : `@${tagName}`);
    }
  };

  const wantParams = sections.includes('params');
  const wantReturns = sections.includes('returns');
  const wantTags = sections.includes('tags');

  if (wantParams) {
    if (tags.param) addTag('param', tags.param);
  }
  if (wantReturns) {
    if (tags.returns) addTag('returns', tags.returns);
    if (tags.return) addTag('return', tags.return);
  }
  if (wantTags) {
    for (const [tagName, values] of Object.entries(tags)) {
      if (tagName === 'param' || tagName === 'returns' || tagName === 'return') continue;
      if (includeTags && !includeTags.includes(tagName)) continue;
      if (excludeTags && excludeTags.includes(tagName)) continue;
      if (mode === 'compact' && !includeTags && !excludeTags) {
        if (!['deprecated', 'since', 'experimental'].includes(tagName)) continue;
      }
      addTag(tagName, values);
    }
  }

  const parts = [];
  if (sections.includes('summary') && summary) {
    parts.push(summary);
  }
  if (tagLines.length > 0) {
    parts.push(tagLines.join('; '));
  }

  return `${name}: ${parts.join(' | ')}`.trim();
}

function selectJsdocTags(tags, options) {
  const mode = options.mode || 'compact';
  const sections =
    options.sections && options.sections.length > 0
      ? options.sections
      : mode === 'full'
        ? ['summary', 'params', 'returns', 'tags']
        : ['summary', 'tags'];
  const include = options.tags?.include || null;
  const exclude = options.tags?.exclude || null;

  return Object.fromEntries(
    Object.entries(tags || {}).filter(([tagName]) => {
      if (include && !include.includes(tagName)) return false;
      if (exclude?.includes(tagName)) return false;
      if (tagName === 'param') return sections.includes('params');
      if (tagName === 'returns' || tagName === 'return') return sections.includes('returns');
      if (!sections.includes('tags')) return false;
      if (mode === 'compact' && !include && !exclude) {
        return ['deprecated', 'since', 'experimental'].includes(tagName);
      }
      return true;
    })
  );
}

function buildJsdocPayload(typeInfo, options) {
  const matcher = buildSymbolMatcher(options.symbols, null);
  const mode = options.mode || 'compact';
  const sections =
    options.sections && options.sections.length > 0
      ? options.sections
      : mode === 'full'
        ? ['summary', 'params', 'returns', 'tags']
        : ['summary', 'tags'];
  const entries = Object.entries(typeInfo?.jsdoc || {})
    .filter(([name]) => !matcher || matcher(name))
    .map(([name, doc]) => ({
      name,
      summary: sections.includes('summary')
        ? truncateSummary(doc.summary || '', mode, options.maxLen, options.truncate || 'word')
        : '',
      tags: selectJsdocTags(doc.tags, { ...options, mode, sections }),
      text: formatJsdocEntry(name, doc, { ...options, mode, sections }),
    }));
  return { mode, output: options.output || 'section', entries };
}

// Helper function to inspect object properties recursively
function inspectObject(obj, currentDepth = 0, maxDepth = 1, maxPropsLimit = 10, indent = '  ') {
  if (currentDepth >= maxDepth || obj === null || obj === undefined) {
    return [];
  }

  const lines = [];
  try {
    const descriptors = Object.getOwnPropertyDescriptors(obj);
    const keys = Object.keys(descriptors).slice(0, maxPropsLimit);
    for (const key of keys) {
      try {
        const descriptor = descriptors[key];
        if (descriptor.get || descriptor.set) {
          lines.push(`${indent.repeat(currentDepth + 1)}${key}: <getter>`);
          continue;
        }
        const value = descriptor.value;
        const type = typeof value;
        const prefix = indent.repeat(currentDepth + 1);

        if (type === 'function') {
          const paramCount = value.length;
          lines.push(`${prefix}${key}(${paramCount} param${paramCount !== 1 ? 's' : ''})`);
        } else if (type === 'object' && value !== null) {
          lines.push(`${prefix}${key}: {object}`);
          if (currentDepth + 1 < maxDepth) {
            lines.push(...inspectObject(value, currentDepth + 1, maxDepth, maxPropsLimit, indent));
          }
        } else {
          const valStr =
            type === 'string'
              ? `"${String(value).substring(0, 30)}"`
              : String(value).substring(0, 30);
          lines.push(`${prefix}${key}: ${valStr}`);
        }
      } catch (e) {
        // Skip properties that throw on access
      }
    }
    const totalKeys = Object.keys(descriptors).length;
    if (totalKeys > maxPropsLimit) {
      lines.push(`${indent.repeat(currentDepth + 1)}... and ${totalKeys - maxPropsLimit} more`);
    }
  } catch (e) {
    // Skip if object is not enumerable
  }
  return lines;
}

export async function runInspectCore(options) {
  throwIfAborted(options?.signal, 'inspect');
  let sourceAnalysis;
  let detectedLang;
  let languageAnalysis;
  const collect = !options?.write && !options?.writeError;
  const output = collect ? [] : null;
  const write = options?.write;
  const writeError = options?.writeError ?? options?.write;

  const log = (line = '') => {
    if (format === 'json' || format === 'object') return;
    if (collect) output.push(String(line));
    else if (write) write(String(line));
  };
  const logErr = (line = '') => {
    if (format === 'json' || format === 'object') return;
    if (collect) output.push(String(line));
    else if (writeError) writeError(String(line));
  };

  const target = options?.target;
  const filterRaw = options?.filter || null;
  const filter = filterRaw ? filterRaw.toLowerCase() : null;
  const showTypes = Boolean(options?.showTypes);
  const includeDocs = Boolean(options?.includeDocs);
  const docsFor = options?.docsFor ? String(options.docsFor) : null;
  const includeExamples = Boolean(options?.includeExamples);
  const examplesFor = options?.examplesFor ? String(options.examplesFor) : null;
  const remote = Boolean(options?.remote);
  const remoteVersion = options?.remoteVersion ? String(options.remoteVersion) : null;
  const runtimeEnabled = options?.runtime !== false && options?.noRuntime !== true;

  // New options
  const format =
    options?.format === 'object' ? 'object' : options?.format === 'json' ? 'json' : 'text';

  const jsdocModeRaw = options?.jsdoc ? String(options.jsdoc).toLowerCase() : null;
  const jsdocQuery = options?.jsdocQuery || null;
  const jsdocOutputRaw = options?.jsdocOutput ? String(options.jsdocOutput).toLowerCase() : null;
  const jsdocOutput = jsdocOutputRaw || (jsdocQuery ? 'section' : 'off');
  const wantJsdoc = jsdocOutput !== 'off';
  const jsdocMode = showTypes || wantJsdoc ? jsdocQuery?.mode || jsdocModeRaw || 'compact' : 'off';
  const forcedLanguage = options?.language ? String(options.language).toLowerCase() : null;
  const kindFilter = Array.isArray(options?.kind)
    ? options.kind.map((k) => String(k).trim().toLowerCase())
    : null;
  let depth = typeof options?.depth === 'number' ? options.depth : 1;
  if (isNaN(depth) || depth < 0 || depth > 5) depth = 1;

  // more new options below...
  const listSections = Boolean(options?.listSections);
  const docsSections = Array.isArray(options?.docsSections)
    ? options.docsSections
    : options?.docsSections
      ? [options.docsSections]
      : null;
  const search = options?.search ? String(options.search) : null;
  const maxExports = typeof options?.maxExports === 'number' ? options.maxExports : 100;
  const maxProps = typeof options?.maxProps === 'number' ? options.maxProps : 10;
  const maxExamples = typeof options?.maxExamples === 'number' ? options.maxExamples : 10;
  const captureResult = typeof options?.captureResult === 'function' ? options.captureResult : null;

  // JSON output collector (also used for format="object")
  const jsonOutput =
    format === 'json' || format === 'object' || captureResult
      ? createInspectSnapshot({
          target: target || null,
          includeDocs,
          docsFor,
          includeExamples,
          examplesFor,
          showTypes,
          remote,
          remoteVersion,
          runtime: runtimeEnabled,
          offline: Boolean(options?.offline),
          listSections,
          docsSections: docsSections || null,
          search,
          format,
          maxExports,
          maxProps,
          maxExamples,
        })
      : null;

  let resultCaptured = false;
  const finalizeOutput = () => {
    if (captureResult && jsonOutput && !resultCaptured) {
      resultCaptured = true;
      captureResult(jsonOutput);
    }
    if (format === 'object') return jsonOutput;
    if (format === 'json') return JSON.stringify(jsonOutput, null, 2);
    return collect ? output.join('\n') : '';
  };

  const warn = (message) => {
    if (jsonOutput) {
      jsonOutput.warnings.push(message);
    }
    if (format === 'text') logErr(`⚠️  ${message}`);
  };

  if (!target) {
    logErr(
      'Uso: node inspect.mjs <pacote> [filtro] [--filter VALUE] [--types] [--jsdoc off|compact|full] [--jsdoc-output off|section|inline|only] [--jsdoc-symbol NAME|glob|/re/] [--jsdoc-sections summary,params,returns,tags] [--jsdoc-tags t1,t2] [--jsdoc-tags-exclude t1,t2] [--jsdoc-truncate none|sentence|word] [--jsdoc-max-len N] [--kind function,class,...] [--depth N] [--resolve-from DIR]'
    );
    return finalizeOutput();
  }

  const baseCwd = options?.cwd;
  const explicitResolveFromRaw = options?.resolveFrom
    ? path.resolve(baseCwd || process.cwd(), options.resolveFrom)
    : null;
  let resolveFrom = explicitResolveFromRaw || baseCwd;
  let explicitResolveFrom = explicitResolveFromRaw;
  let remoteCache = null;
  const inferredProjectLanguage = detectLanguage(resolveFrom || baseCwd || process.cwd());
  const shouldTryPythonResolution =
    forcedLanguage === 'python' || (!forcedLanguage && inferredProjectLanguage === 'python');

  if (remote) {
    const basePkgName = getPackageName(target);
    if (basePkgName) {
      const spec = remoteVersion || 'latest';
      if (options?.offline && !remoteVersion) {
        const message = '--offline with --remote requires an explicit --remote-version';
        warn(message);
        logErr(`\n❌ Remote download failed: ${message}`);
      } else {
        log(`\n🌐 Remote: resolving ${basePkgName}@${spec}...`);
        try {
          const exactVersion = options?.offline
            ? spec
            : await resolveVersionAsync(basePkgName, spec, baseCwd || process.cwd(), {
                signal: options?.signal,
                timeoutMs: options?.timeoutMs,
              });
          log(`   ResolvedVersion: ${exactVersion}`);
          const downloaded = await downloadVersion(basePkgName, exactVersion, {
            timeout: Number(options?.timeoutMs) || 120000,
            cacheDir: options?.cacheDir,
            signal: options?.signal,
            preferCdn: Boolean(options?.preferCdn),
            offline: Boolean(options?.offline),
          });
          resolveFrom = downloaded.path;
          explicitResolveFrom = downloaded.path;
          remoteCache = {
            path: downloaded.path,
            cached: Boolean(downloaded.cached),
            fetched: Boolean(downloaded.fetched),
            metadata: downloaded.metadata || null,
          };
          log(`   CachePath: ${downloaded.path}`);
          log(`   Cached: ${downloaded.cached ? 'yes' : 'no'}`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (jsonOutput) {
            const structuredError = errorPayload(e, {
              code: 'REMOTE_DOWNLOAD_FAILED',
              phase: 'download',
              retryable: true,
              details: { package: basePkgName, version: spec },
            });
            jsonOutput.error = `Remote download failed: ${structuredError.error}`;
            jsonOutput.errorInfo = structuredError.errorInfo;
            jsonOutput.warnings.push(jsonOutput.error);
            jsonOutput.resolution = {
              target,
              resolveFrom: resolveFrom || null,
              resolveCwd: baseCwd || null,
              resolved: null,
              entrypointPath: null,
              entrypointExists: false,
              cache: null,
            };
          }
          logErr(`\n❌ Remote download failed: ${message}`);
          return finalizeOutput();
        }
      }
    }
  }
  const resolution = await resolveTargetModule(target, baseCwd, resolveFrom, explicitResolveFrom);
  const resolveCwd = resolution.resolveCwd || resolveFrom || baseCwd;
  const require = createRequire(resolveCwd ? path.join(resolveCwd, 'noop.js') : import.meta.url);
  const resolvedPath = resolution.resolved;
  const entrypointPath = resolution.metadataOnly
    ? null
    : existingEntrypointPath(
        typeof resolvedPath === 'string' && resolvedPath.startsWith('file://')
          ? fileURLToPath(resolvedPath)
          : resolvedPath
      );
  const entrypointExists = entrypointPath ? fs.existsSync(entrypointPath) : false;

  if (jsonOutput) {
    jsonOutput.resolution = {
      target,
      resolveFrom: resolveFrom || null,
      resolveCwd: resolveCwd || null,
      resolved: resolution.resolved || null,
      entrypointPath: entrypointPath || null,
      entrypointExists,
      metadataOnly: Boolean(resolution.metadataOnly),
      cache: remoteCache,
    };
  }

  const flags = [];
  if (filterRaw) flags.push(`Filtro: "${filterRaw}"`);
  if (kindFilter) flags.push(`Kind: ${kindFilter.join(',')}`);
  if (showTypes || wantJsdoc) flags.push('Type Analysis');
  if (includeDocs) flags.push('Docs');
  if (includeExamples) flags.push('Examples');
  if (remote) flags.push(`Remote${remoteVersion ? `@${remoteVersion}` : ''}`);
  if (jsdocOutput !== 'off') flags.push(`JSDoc: ${jsdocMode}`);
  if (depth > 1) flags.push(`Depth: ${depth}`);

  const flagsStr = flags.length > 0 ? ` (${flags.join(' | ')})` : '';
  log(`🔍 Target: ${target}${flagsStr}`);

  try {
    if (!resolution.resolved) {
      if (shouldTryPythonResolution) {
        const pythonResolution = resolvePythonPackage(target, {
          resolveFrom: resolveFrom || baseCwd || process.cwd(),
        });

        if (pythonResolution?.resolved && pythonResolution?.pkgDir) {
          detectedLang = 'python';

          if (jsonOutput) {
            jsonOutput.package = pythonResolution.package || target;
            jsonOutput.version = pythonResolution.version || null;
            jsonOutput.description = pythonResolution.description || null;
            jsonOutput.pkgDir = pythonResolution.pkgDir;
            jsonOutput.resolution = {
              target,
              resolveFrom: resolveFrom || null,
              resolveCwd: resolveCwd || resolveFrom || baseCwd || null,
              resolved: pythonResolution.resolved || null,
              entrypointPath: pythonResolution.resolved || null,
              entrypointExists: pythonResolution.resolved
                ? fs.existsSync(pythonResolution.resolved)
                : false,
            };
          }

          log('\n🧭 Resolution:');
          log(`   ResolveFrom: ${resolveFrom || baseCwd || 'unknown'}`);
          log(`   Entrypoint: ${pythonResolution.resolved}`);
          log(`   PackageRoot: ${pythonResolution.pkgDir}`);
          log(`   Runtime: ${pythonResolution.pythonExecutable || 'python'}`);

          log('\n📄 Package Info:');
          log(`   Name: ${pythonResolution.package || target}`);
          log(`   Version: ${pythonResolution.version || 'Unknown'}`);
          if (pythonResolution.description) {
            log(`   Description: ${pythonResolution.description}`);
          }

          if (options?.analyzeSource) {
            languageAnalysis = analyzePythonPackage(pythonResolution.pkgDir, {
              filter: filterRaw,
              maxFiles: options?.sourceMaxFiles || 100,
              includeBody: options?.sourceIncludeBody || false,
              maxBodyLines: 10,
            });

            if (languageAnalysis?.error) {
              warn(languageAnalysis.error);
            } else {
              log('\n📝 Source/Language Analysis (python):');
              log(
                `   Python: ${languageAnalysis.summary.totalFiles} files, ${languageAnalysis.summary.totalFunctions} functions, ${languageAnalysis.summary.totalClasses} classes`
              );
            }
          }

          if (jsonOutput && languageAnalysis && !languageAnalysis.error) {
            jsonOutput.languageAnalysis = {
              language: 'python',
              files: languageAnalysis.summary.totalFiles,
              summary: languageAnalysis.summary,
            };
          }

          return finalizeOutput();
        }
      }

      const errorMsg = `Não foi possível resolver '${target}'`;
      warn(errorMsg);
      logErr(`\n❌ Erro: ${errorMsg}`);
      logErr(`ResolveFrom: ${resolveFrom || baseCwd || 'unknown'}`);
      logErr(`Certifique-se que '${target}' está instalado e é um caminho válido.`);
      return finalizeOutput();
    }

    const basePkg = getPackageName(target);
    const subpath = getPackageSubpath(target);
    const pkgInfo = basePkg
      ? resolvePackageInfo(
          basePkg,
          require,
          resolveFrom || baseCwd || process.cwd(),
          entrypointPath || resolution.resolved
        )
      : null;
    const pkg = pkgInfo?.pkg;
    const pkgDir = pkgInfo?.pkgDir;

    log('\n🧭 Resolution:');
    log(`   ResolveFrom: ${resolveFrom || baseCwd || 'unknown'}`);
    log(`   Entrypoint: ${entrypointPath || '(metadata only)'}`);
    if (resolution.resolver) {
      log(`   Resolver: ${resolution.resolver}`);
    }
    if (pkgDir) {
      log(`   PackageRoot: ${pkgDir}`);
    }

    let dtsPath;
    let typesFile;
    let typesSource;

    if (pkg) {
      if (resolution.metadataOnly) {
        warn(
          'Package has no importable runtime entrypoint; package metadata and bin files remain inspectable.'
        );
      }
      log('\n📄 Package Info:');
      log(`   Name: ${pkg.name || basePkg}`);
      log(`   Version: ${pkg.version || 'Unknown'}`);
      if (pkg.description) {
        log(`   Description: ${pkg.description}`);
      }
      if (pkg.license) {
        log(`   License: ${pkg.license}`);
      }

      // Populate JSON output
      if (jsonOutput) {
        jsonOutput.package = pkg.name || basePkg;
        jsonOutput.version = pkg.version || null;
        jsonOutput.description = pkg.description || null;
        jsonOutput.pkgDir = pkgDir;
      }

      if (includeDocs || listSections || docsSections || docsFor) {
        const readme = readPackageTextFile(pkgDir, ['README.md', 'readme.md', 'README.MD']);

        if (listSections) {
          // List available sections
          const sections = listReadmeSections(readme);
          if (jsonOutput) {
            jsonOutput.sections = sections;
          } else {
            log(`\n📑 Available README Sections (${sections.length}):`);
            for (const s of sections) {
              const codeTag = s.hasCode ? ' 📝' : '';
              log(`   ${'#'.repeat(s.level)} ${s.title}${codeTag} (${s.charCount} chars)`);
            }
          }
        }

        if (docsFor) {
          const rankedSections = rankReadmeSections(readme, docsFor, 5, 4000);
          if (jsonOutput) {
            jsonOutput.docs = { target: docsFor, rankedSections };
          } else {
            log(`\n📚 Docs ranked for ${docsFor} (${rankedSections.length} sections):`);
            for (const section of rankedSections) {
              log(`\n--- ${section.title} (score ${section.score}) ---`);
              log(section.content);
              if (section.truncated) {
                log('\n… (truncated)');
              }
            }
          }
        } else if (docsSections && docsSections.length > 0) {
          // Extract specific sections
          const extracted = extractSectionsByName(readme, docsSections, 4000);
          if (jsonOutput) {
            jsonOutput.docs = { sections: extracted };
          } else {
            log(`\n📚 Docs (${extracted.length} sections):`);
            for (const section of extracted) {
              log(`\n--- ${section.title} ---`);
              log(section.content);
              if (section.truncated) {
                log('\n… (truncated)');
              }
            }
          }
        } else if (includeDocs && !listSections) {
          // Original behavior: full README preview
          if (readme) {
            const preview = readme.trim().slice(0, 4000);
            if (jsonOutput) {
              jsonOutput.docs = {
                readme: preview,
                truncated: readme.trim().length > 4000,
              };
            } else {
              log('\n📚 Docs (README preview):');
              log(preview);
              if (readme.trim().length > preview.length) {
                log(`\n… (truncated, ${readme.trim().length - preview.length} chars more)`);
              }
            }
          } else {
            if (format !== 'json') {
              log('\n📚 Docs: README not found');
            }
          }
        }
      }

      if (includeExamples) {
        const readme = readPackageTextFile(pkgDir, ['README.md', 'readme.md', 'README.MD']);
        const targetNeedle = exampleNeedle(filterRaw, examplesFor);
        const readmeBlocks = extractMarkdownCodeFences(readme, maxExamples, 50).map((block) => ({
          ...block,
          source: 'readme',
        }));

        const examplesFiles = listExamplesFromDirs(pkgDir, maxExamples);
        const examplesContent = [];
        for (const relPath of examplesFiles) {
          const full = path.join(pkgDir, relPath);
          try {
            const body = fs.readFileSync(full, 'utf-8');
            const snippet = body.split('\n').slice(0, 80).join('\n').trim();
            if (!snippet) continue;
            examplesContent.push({ source: 'file', path: relPath, code: snippet });
          } catch {
            // ignore
          }
        }

        const jsdocExamples = [];
        if (dtsPath && fs.existsSync(dtsPath)) {
          const parsedForExamples = typeInfoRaw || parseDtsFile(dtsPath, null);
          const jsdocTable = parsedForExamples?.jsdoc;
          if (jsdocTable) {
            for (const [name, doc] of Object.entries(jsdocTable)) {
              const tags = doc?.tags || {};
              const ex = tags.example || [];
              for (const snippet of ex) {
                if (!snippet || !looksLikeCodeBlock(snippet)) continue;
                jsdocExamples.push({
                  source: 'jsdoc',
                  symbol: name,
                  code: String(snippet).trim(),
                });
                if (jsdocExamples.length >= maxExamples) break;
              }
              if (jsdocExamples.length >= maxExamples) break;
            }
          }
        }

        const hasAnything =
          readmeBlocks.length > 0 || examplesContent.length > 0 || jsdocExamples.length > 0;
        const rankedExamples = rankExamplesForNeedle(
          [...readmeBlocks, ...examplesContent, ...jsdocExamples],
          targetNeedle,
          maxExamples
        );

        // Populate JSON examples
        if (jsonOutput) {
          jsonOutput.examples = {
            target: targetNeedle,
            ranked: rankedExamples,
            readme: readmeBlocks,
            files: examplesContent,
            jsdoc: jsdocExamples,
          };
        }

        if (!hasAnything) {
          log('\n🧩 Examples: none found');
        } else {
          log('\n🧩 Examples:');
          if (targetNeedle) {
            log(`\n  Ranked for: ${targetNeedle}`);
            for (const ex of rankedExamples) {
              const label = ex.symbol || ex.path || ex.lang || ex.source || 'example';
              log(`\n  --- ${label} (score ${ex.score}) ---`);
              log(ex.code);
            }
          }

          if (!targetNeedle && readmeBlocks.length > 0) {
            log(`\n  📄 README code fences (${readmeBlocks.length}):`);
            readmeBlocks.forEach((b, i) => {
              log(`\n  --- README example #${i + 1}${b.lang ? ` (${b.lang})` : ''} ---`);
              log(b.code);
            });
          }

          if (!targetNeedle && examplesContent.length > 0) {
            log(`\n  📁 examples/ files (${examplesContent.length}):`);
            for (const ex of examplesContent) {
              log(`\n  --- ${ex.path} ---`);
              log(ex.code);
            }
          }

          if (!targetNeedle && jsdocExamples.length > 0) {
            log(`\n  🏷️  JSDoc @example (${jsdocExamples.length}):`);
            for (const ex of jsdocExamples) {
              log(`\n  --- ${ex.symbol} ---`);
              log(ex.code);
            }
          }
        }
      }

      const typesResolution = resolveTypesFile(
        pkg,
        pkgDir,
        subpath,
        basePkg,
        require,
        entrypointPath
      );
      typesFile = typesResolution.typesFile;

      dtsPath = typesResolution.dtsPath;
      typesSource = typesResolution.source;

      // Auto-geração de types se não encontrado no disco e flag habilitada
      if (options?.autoGenerateTypes !== false && pkgDir) {
        const typesExist = dtsPath && fs.existsSync(dtsPath);
        if (!typesExist) {
          log('   🔧 Types not found on disk, generating via dts-gen...');
          const generatedPath = await generateDts(pkgDir);
          if (generatedPath && fs.existsSync(generatedPath)) {
            typesFile = generatedPath;
            dtsPath = generatedPath;
            log(`   ✅ Types generated: ${path.basename(generatedPath)}`);
          } else {
          }
        } else {
        }
      }

      // Update pkgDir if we're using @types package
      if (typesResolution.pkgDir && typesSource === '@types') {
        // Keep original pkgDir for runtime, but use types pkgDir for dtsPath
        // dtsPath is already set correctly from typesResolution
      }

      if (typesFile) {
        const sourceLabel = typesSource ? ` (${typesSource})` : '';
        const existsLabel = dtsPath && fs.existsSync(dtsPath) ? '' : ' (missing)';
        log(`   Types: ${typesFile}${sourceLabel}${existsLabel}`);
      } else {
        log('   Types: Not found');
      }

      // === Mostrar subpath exports ===
      if (pkg.exports && typeof pkg.exports === 'object') {
        const exportEntries = Object.entries(pkg.exports);
        if (exportEntries.length > 0) {
          log(`\n🚪 Subpath Exports (${exportEntries.length} available):`);
          for (const [pathKey, value] of exportEntries.slice(0, 10)) {
            if (typeof value === 'string') {
              log(`   ${pathKey} → ${value}`);
            } else if (value && typeof value === 'object') {
              const targets = Object.keys(value).join(', ');
              log(`   ${pathKey} → { ${targets} }`);
            }
          }
          if (exportEntries.length > 10) {
            log(`   ... and ${exportEntries.length - 10} more`);
          }
        }
      }
    }

    let typeInfoRaw = null;
    // Sempre parsear types para JSON output (mesmo sem --types)
    if (jsonOutput && dtsPath && fs.existsSync(dtsPath)) {
      typeInfoRaw = await getCachedDtsParse(dtsPath);
    }

    let moduleNamespace = {};
    let moduleDescriptors = {};
    let allExports = [];
    let runtimeLoadError = null;
    let runtimeAvailable = false;
    if (!runtimeEnabled) {
      if (jsonOutput) {
        jsonOutput.meta.runtimeSkipped = true;
        jsonOutput.meta.runtimeSkipReason = 'disabled';
      }
      log('ℹ️  Runtime export loading skipped by runtime=false/--no-runtime.');
    } else if (!entrypointExists) {
      log('\n⚠️  Entrypoint not found on disk; runtime exports skipped.');
    } else {
      try {
        const { module: loadedNamespace } = await loadModuleExports(entrypointPath, require, pkg);
        moduleNamespace = loadedNamespace;
        moduleDescriptors = Object.getOwnPropertyDescriptors(moduleNamespace);
        allExports = Object.keys(moduleDescriptors);
        runtimeAvailable = true;
      } catch (e) {
        runtimeLoadError = e instanceof Error ? e.message : String(e);
        // Continue with empty runtime exports
      }
    }

    // Lógica de Filtro (case-insensitive, supports regex)
    let finalList = allExports;
    let matchedSearchNames = null;
    if (filterRaw) {
      // Check if it's a regex pattern
      const isRegex = filterRaw.startsWith('/') && filterRaw.endsWith('/') && filterRaw.length > 2;
      if (isRegex) {
        try {
          const regexPattern = filterRaw.slice(1, -1);
          const regex = new RegExp(regexPattern, 'i'); // case-insensitive
          finalList = allExports.filter((key) => regex.test(key));
        } catch (e) {
          // Fallback to substring match if regex is invalid
          finalList = allExports.filter((key) => key.toLowerCase().includes(filter));
        }
      } else {
        // Simple substring match (case-insensitive)
        finalList = allExports.filter((key) => key.toLowerCase().includes(filter));
      }
    }

    // Se a lista for muito grande e não tiver filtro, avisa e corta
    if (!filterRaw && !search && finalList.length > maxExports) {
      log(`\n⚠️ Módulo exporta ${finalList.length} itens. Mostrando os primeiros ${maxExports}...`);
      log("DICA: Use o parâmetro 'filter' ou 'search' para encontrar o que procura.");
      finalList = finalList.slice(0, maxExports);
    }

    // Semantic search (token matching + JSDoc)
    if (search) {
      const queryTokens = expandSynonyms(tokenizeSymbolName(search));

      // Search one shared runtime + type universe so exports and symbols stay aligned.
      const filteredTypes = filterTypeInfo(typeInfoRaw, filter, kindFilter);
      const candidates = [...new Set([...finalList, ...typeSymbolNames(filteredTypes)])].map(
        (name) => ({ name })
      );

      // If types are available, use JSDoc-aware scoring
      let results = null;
      if (typeInfoRaw) {
        results = searchExports(candidates, typeInfoRaw, search, 0.25);
      }

      // If no results (or no types), fallback to token matching on names
      if (!results || results.length === 0) {
        results = candidates
          .map((c) => {
            const score = tokenMatchScore(queryTokens, c.name, '');
            return { ...c, _searchScore: score };
          })
          .filter((r) => r._searchScore >= 0.25)
          .sort((a, b) => b._searchScore - a._searchScore);
      }

      matchedSearchNames = results.map((r) => r.name);
      const runtimeNames = new Set(allExports);
      finalList = matchedSearchNames.filter((name) => runtimeNames.has(name));
      if (matchedSearchNames.length === 0) {
        warn(`Search "${search}" found no matches. Try different keywords.`);
      } else {
        log(`\n🔍 Search "${search}" found ${matchedSearchNames.length} matches`);
      }
    }

    // === MELHORIA 2: Categorizar exports por tipo ===
    const categorized = {
      functions: [],
      classes: [],
      objects: [],
      primitives: [],
      constants: [],
    };

    if (runtimeAvailable) {
      for (const key of finalList) {
        const descriptor = moduleDescriptors[key];
        if (!descriptor) continue;
        if (descriptor.get || descriptor.set) {
          categorized.objects.push(key);
          continue;
        }
        const value = descriptor.value;
        const type = typeof value;

        if (type === 'function') {
          // Distinguir class vs function
          if (isProbablyClass(value)) {
            categorized.classes.push(key);
          } else {
            categorized.functions.push(key);
          }
        } else if (type === 'object' && value !== null) {
          categorized.objects.push(key);
        } else if (type === 'string' || type === 'number' || type === 'boolean') {
          categorized.constants.push(key);
        } else {
          categorized.primitives.push(key);
        }
      }

      // Prefer class from type info when available
      if (typeInfoRaw && Object.keys(typeInfoRaw.classes || {}).length > 0) {
        const classNames = new Set(Object.keys(typeInfoRaw.classes));
        categorized.functions = categorized.functions.filter((name) => {
          if (classNames.has(name)) {
            categorized.classes.push(name);
            return false;
          }
          return true;
        });
      }

      // Apply kind filter if specified
      if (kindFilter && kindFilter.length > 0) {
        const kindMap = {
          function: 'functions',
          class: 'classes',
          object: 'objects',
          constant: 'constants',
        };

        // Keep only the requested kinds
        for (const key of Object.keys(categorized)) {
          const shouldKeep = Object.entries(kindMap).some(
            ([kind, catKey]) => kindFilter.includes(kind) && catKey === key
          );
          if (!shouldKeep) {
            categorized[key] = [];
          }
        }

        // Update finalList to only include filtered kinds
        finalList = [
          ...categorized.functions,
          ...categorized.classes,
          ...categorized.objects,
          ...categorized.constants,
        ];
      }
    }

    // Mostrar exports categorizados
    if (jsdocOutput !== 'only') {
      if (!runtimeAvailable) {
        log('\nℹ️  Runtime exports unavailable. Use --types to inspect type exports.');
      }
      log(`\n🔑 Exports Encontrados (${finalList.length} total):`);

      // Populate JSON exports
      if (jsonOutput) {
        jsonOutput.exports = {
          total: finalList.length,
          functions: categorized.functions,
          classes: categorized.classes,
          objects: categorized.objects,
          constants: categorized.constants,
        };
      }

      if (categorized.functions.length > 0) {
        log(`\n  📘 Functions (${categorized.functions.length}):`);
        log(`     ${categorized.functions.join(', ')}`);
      }

      if (categorized.classes.length > 0) {
        log(`\n  🏛️  Classes (${categorized.classes.length}):`);
        log(`     ${categorized.classes.join(', ')}`);
      }

      if (categorized.objects.length > 0) {
        log(`\n  📦 Objects/Namespaces (${categorized.objects.length}):`);
        log(`     ${categorized.objects.join(', ')}`);

        // If depth > 0, show object contents
        if (depth > 0 && categorized.objects.length <= 10) {
          log(`\n  📦 Object Contents (depth: ${depth}):`);
          for (const objName of categorized.objects) {
            log(`\n     ${objName}:`);
            const descriptor = moduleDescriptors[objName];
            if (!descriptor || descriptor.get || descriptor.set) {
              log(`     ${objName}: <getter>`);
              continue;
            }
            const objValue = descriptor.value;
            const lines = inspectObject(objValue, 0, depth, '  ');
            lines.forEach((line) => log(`     ${line}`));
          }
        } else if (depth > 0 && categorized.objects.length > 10) {
          log("\n  ℹ️  Too many objects to show contents. Use 'filter' to narrow down.");
        }
      }

      if (categorized.constants.length > 0) {
        log(`\n  🔢 Constants (${categorized.constants.length}):`);
        log(`     ${categorized.constants.join(', ')}`);
      }

      if (finalList.length === 0) {
        log('Nenhum export corresponde ao filtro.');
      }
    }

    // === MELHORIA 5: Mostrar assinaturas de funções ===
    if (jsdocOutput !== 'only') {
      if (!runtimeAvailable) {
        // Skip runtime-only signature/default export hints when entrypoint is missing
      } else if (
        !showTypes &&
        categorized.functions.length > 0 &&
        categorized.functions.length <= 15
      ) {
        log('\n✍️  Function Signatures:');
        for (const fname of categorized.functions) {
          const descriptor = moduleDescriptors[fname];
          const fn = descriptor?.value;
          if (typeof fn === 'function') {
            const paramCount = fn.length;
            const params =
              paramCount === 0 ? '' : paramCount === 1 ? '1 param' : `${paramCount} params`;
            log(`     ${fname}(${params})`);
          }
        }
      }

      // Default export handling
      if (runtimeAvailable) {
        const defaultDescriptor = moduleDescriptors.default;
        if (defaultDescriptor && (!filterRaw || 'default'.toLowerCase().includes(filter))) {
          const defaultValue =
            defaultDescriptor.get || defaultDescriptor.set ? undefined : defaultDescriptor.value;
          const defaultType = typeof defaultValue;
          log(`\n📦 Default Export: ${defaultType}`);
          if (defaultType === 'function' && defaultValue && defaultValue.length !== undefined) {
            log(`   Parameters: ${defaultValue.length}`);
          }
        }
      }
    }

    // === NEW: Parse .d.ts file if --types flag is present ===
    // Load type info if dtsPath exists (for both logs and JSON)
    if (dtsPath && fs.existsSync(dtsPath) && typeInfoRaw === null) {
      typeInfoRaw = await getCachedDtsParse(dtsPath);
    }

    if (runtimeEnabled && hasTypeSymbols(typeInfoRaw) && (!runtimeAvailable || runtimeLoadError)) {
      const reason = runtimeLoadError
        ? `runtime export introspection failed: ${runtimeLoadError}`
        : 'runtime entrypoint is not available on disk';
      warn(`Runtime export introspection unavailable (${reason}); type definitions were found.`);
    }

    if (showTypes || wantJsdoc) {
      if (dtsPath && fs.existsSync(dtsPath)) {
        if (jsdocOutput !== 'only') {
          log('\n🔬 Type Definitions Analysis:');
          log(`   Source: ${path.basename(dtsPath)}`);
        }

        const typeInfo = filterTypeInfoForOutput(
          typeInfoRaw,
          filter,
          kindFilter,
          matchedSearchNames
        );

        if (wantJsdoc) {
          const jsdocPayload = buildJsdocPayload(typeInfo, {
            ...(jsdocQuery || {}),
            mode: jsdocMode,
            output: jsdocOutput,
          });
          if (jsonOutput) jsonOutput.jsdoc = jsdocPayload;
          log(`\nJSDoc: (${jsdocPayload.entries.length})`);
          for (const entry of jsdocPayload.entries) log(`   ${entry.text}`);
          if (jsdocPayload.entries.length === 0) log('   No matching JSDoc found.');
        }

        // Log functions
        const functionCount = Object.keys(typeInfo.functions).length;
        if (functionCount > 0 && jsdocOutput !== 'only') {
          log(`\n   Functions (${functionCount}):`);
          for (const [name, info] of Object.entries(typeInfo.functions)) {
            const params = info.params; // already formatted string from parseDtsFile
            log(`     ${name}(${params}): ${info.returnType}`);
          }
        }

        // Log interfaces
        const interfaceCount = Object.keys(typeInfo.interfaces).length;
        if (interfaceCount > 0 && jsdocOutput !== 'only') {
          log(`\n   Interfaces (${interfaceCount}):`);
          for (const name of Object.keys(typeInfo.interfaces)) {
            log(`     ${name}`);
          }
        }

        // Log types
        const typeAliasCount = Object.keys(typeInfo.types).length;
        if (typeAliasCount > 0 && jsdocOutput !== 'only') {
          log(`\n   Types (${typeAliasCount}):`);
          for (const name of Object.keys(typeInfo.types)) {
            log(`     ${name}`);
          }
        }

        // Log classes
        const classCount = Object.keys(typeInfo.classes).length;
        if (classCount > 0 && jsdocOutput !== 'only') {
          log(`\n   Classes (${classCount}):`);
          for (const [name, classInfo] of Object.entries(typeInfo.classes)) {
            const extendsClause =
              classInfo && typeof classInfo === 'object' ? classInfo.extends || null : classInfo;
            log(`     class ${name}${extendsClause ? ' extends ' + extendsClause : ''}`);
          }
        }

        // Log enums
        const enumCount = Object.keys(typeInfo.enums || {}).length;
        if (enumCount > 0 && jsdocOutput !== 'only') {
          log(`\n   Enums (${enumCount}):`);
          for (const name of Object.keys(typeInfo.enums)) {
            log(`     enum ${name}`);
          }
        }
      } else {
        if (jsdocOutput !== 'only') {
          log('\n⚠️  Type definitions not available for this package');
        }
      }
    }

    // Always include types in JSON output if available

    let symbolTypeInfo = null;
    if (
      jsonOutput &&
      (showTypes || wantJsdoc) &&
      dtsPath &&
      fs.existsSync(dtsPath) &&
      !jsonOutput.types
    ) {
      const typeInfoRaw2 = await getCachedDtsParse(dtsPath);
      const typeInfo = filterTypeInfoForOutput(
        typeInfoRaw2,
        filter,
        kindFilter,
        matchedSearchNames
      );
      symbolTypeInfo = typeInfo;
      if (typeInfo) {
        jsonOutput.types = {
          source: path.basename(dtsPath),
          functions: Object.fromEntries(
            Object.entries(typeInfo.functions).map(([name, info]) => [
              name,
              { params: info.params, returnType: info.returnType },
            ])
          ),
          interfaces: typeInfo.interfaces,
          types: typeInfo.types,
          classes: typeInfo.classes,
          enums: typeInfo.enums || {},
          enumDetails: typeInfo.enumDetails || {},
          variables: typeInfo.variables || {},
        };
      }
    }

    if (jsonOutput) {
      if (!symbolTypeInfo && typeInfoRaw) {
        symbolTypeInfo = filterTypeInfoForOutput(
          typeInfoRaw,
          filter,
          kindFilter,
          matchedSearchNames
        );
      }
      const relativeRuntimePath = packageRelativeModulePath(entrypointPath, pkgDir);
      const relativeTypesPath = packageRelativeModulePath(dtsPath, pkgDir);
      if (jsonOutput.resolution) {
        jsonOutput.resolution.runtimePath = relativeRuntimePath;
        jsonOutput.resolution.typesPath = relativeTypesPath;
        jsonOutput.resolution.typesSource = typesSource || null;
        jsonOutput.resolution.runtimeTypesDiverge = Boolean(
          relativeRuntimePath &&
          relativeTypesPath &&
          comparableModuleStem(relativeRuntimePath) !== comparableModuleStem(relativeTypesPath)
        );
        jsonOutput.resolution.trace = buildResolutionTrace({
          pkg,
          subpath,
          resolver: resolution.resolver,
          runtimePath: relativeRuntimePath,
          runtimeAvailable,
          typesPath: relativeTypesPath,
          typesSource,
          explicitConditions: options?.conditions || null,
        });
      }
      const runtimeCondition =
        jsonOutput.resolution?.trace?.runtime?.conditionsMatched?.slice(-1)[0] || null;
      const typesCondition =
        jsonOutput.resolution?.trace?.types?.conditionsMatched?.slice(-1)[0] ||
        (typesSource === 'exports' ? 'types' : null);
      jsonOutput.symbols = buildSymbols({
        packageName: pkg?.name || basePkg || target,
        subpath,
        runtimeNames: finalList,
        categorized,
        runtimePath: relativeRuntimePath,
        runtimeAvailable,
        runtimeCondition,
        typeInfo: symbolTypeInfo,
        typesPath: relativeTypesPath,
        typesSource,
        typesCondition,
      });
      if (matchedSearchNames) {
        const searchOrder = new Map(matchedSearchNames.map((name, index) => [name, index]));
        jsonOutput.symbols.sort(
          (left, right) =>
            (searchOrder.get(left.exportName) ?? Number.MAX_SAFE_INTEGER) -
              (searchOrder.get(right.exportName) ?? Number.MAX_SAFE_INTEGER) ||
            left.exportName.localeCompare(right.exportName)
        );
      }
      if (!showTypes && !wantJsdoc) {
        jsonOutput.symbols = jsonOutput.symbols.map((symbol) => {
          if (!symbol.types) return symbol;
          return {
            ...symbol,
            types: {
              kind: symbol.types.kind,
              path: symbol.types.path,
              source: symbol.types.source,
              condition: symbol.types.condition,
            },
          };
        });
      }
      const staticNames = jsonOutput.symbols
        .filter((symbol) => symbol.facets.includes('types'))
        .map((symbol) => symbol.exportName);
      jsonOutput.staticExports = {
        total: staticNames.length,
        names: staticNames,
      };
      if (remoteCache?.metadata?.source === 'cdn') {
        warn(
          'CDN mode fetches selected entry files only and may omit declaration re-exports; use --prefer-npm for a complete package tree.'
        );
      }
      if (
        options?.preferCdn &&
        showTypes &&
        jsonOutput.symbols.length === 0 &&
        remoteCache?.metadata?.source === 'cdn'
      ) {
        warn(
          'CDN cache did not provide enough package files for type analysis; retry with --prefer-npm for full package contents.'
        );
      }
    }

    // Source code analysis
  } catch (e) {
    if (jsonOutput) {
      jsonOutput.error = e.message;
      jsonOutput.warnings.push(`Error: ${e.message}`);
    } else {
      logErr(`\n❌ Erro: ${e.message}`);
      logErr(`Certifique-se que '${target}' está instalado e é um caminho válido.`);
    }
  }

  // Adicionar sourceAnalysis ao JSON se disponível
  if (jsonOutput && sourceAnalysis && !sourceAnalysis.error) {
    jsonOutput.sourceAnalysis = {
      files: sourceAnalysis.files.length,
      summary: sourceAnalysis.summary,
    };
  }

  if (jsonOutput && languageAnalysis && !languageAnalysis.error) {
    jsonOutput.languageAnalysis = {
      language: detectedLang || 'unknown',
      files: languageAnalysis.summary.totalFiles,
      summary: languageAnalysis.summary,
    };
  }

  return finalizeOutput();
}

export { runDiff } from './diff.mjs';
