// Unified type inspection + auto-generation orchestrator
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseDtsFile, findReExports } from './parse-dts.mjs';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
const PARSE_CACHE_VERSION = 3;

export async function generateDts(pkgDir) {
  try {
    const needle = path.join(pkgDir, 'node_modules', '.bin', 'dts-gen');
    if (!fs.existsSync(needle)) return null;
    await execFileAsync(needle, ['--name','temp','--project',pkgDir,'--yes'], { cwd: pkgDir, timeout: 30000 });
    const gen = path.join(pkgDir, 'index.d.ts');
    return fs.existsSync(gen) ? gen : null;
  } catch { return null; }
}

export function getCacheKey(dtsPath) {
  const cacheRoot = path.join(os.homedir(), '.deplens-cache');
  if (dtsPath.startsWith(cacheRoot)) return `${PARSE_CACHE_VERSION}:${dtsPath}`;
  try { const real = fs.realpathSync(dtsPath); if (real.startsWith(cacheRoot)) return `${PARSE_CACHE_VERSION}:${real}`; } catch {}
  return `${PARSE_CACHE_VERSION}:${dtsPath}`;
}

function getFileCacheMetadata(dtsPath) {
  const stats = fs.statSync(dtsPath);
  return {
    path: fs.realpathSync(dtsPath),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

function isFreshCachePayload(payload, metadata) {
  return (
    payload &&
    payload.cache &&
    payload.cache.path === metadata.path &&
    payload.cache.size === metadata.size &&
    payload.cache.mtimeMs === metadata.mtimeMs &&
    payload.result
  );
}

const memoryCache = new Map(); const MEMORY_CACHE_MAX = 20;
function getMemory(key) { return memoryCache.get(key) ?? null; }
function setMemory(key, value) {
  if (memoryCache.size >= MEMORY_CACHE_MAX) memoryCache.delete(memoryCache.keys().next().value);
  memoryCache.set(key, value);
}

export async function getCachedDtsParse(dtsPath) {
  const cacheKey = getCacheKey(dtsPath);
  const metadata = getFileCacheMetadata(dtsPath);
  const fromMem = getMemory(cacheKey);
  if (isFreshCachePayload(fromMem, metadata)) return fromMem.result;
  const cacheDir = path.join(os.homedir(), '.deplens-cache', 'parse');
  fs.mkdirSync(cacheDir, { recursive: true });
  const safeName = cacheKey.replace(/[/:\\]/g, '_');
  const cacheFile = path.join(cacheDir, safeName + '.json');
  if (fs.existsSync(cacheFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cacheFile,'utf8'));
      if (isFreshCachePayload(parsed, metadata)) {
        setMemory(cacheKey, parsed);
        return parsed.result;
      }
    } catch {}
  }

  const result = await parseDtsFileRecursive(dtsPath, []);
  const payload = { cache: metadata, result };

  fs.writeFileSync(cacheFile, JSON.stringify(payload, null, 0));
  setMemory(cacheKey, payload);
  return result;
}

async function parseDtsFileRecursive(dtsPath, visited) {
  const real = fs.realpathSync(dtsPath);
  if (visited.includes(real)) return null;
  const nextVisited = [...visited, real];
  const base = await parseDtsFile(dtsPath, null);
  const reExportResult = findReExports(dtsPath, null);
  const named = new Map(reExportResult.named);
  const wildcards = reExportResult.wildcards;
  const extraResults = [];
  const aliasMappings = [];
  for (const [exportedName, target] of named) {
    const targetPath = typeof target === 'string' ? target : target.sourcePath;
    const localName = typeof target === 'string' ? exportedName : target.localName;
    try {
      if (fs.existsSync(targetPath)) {
        const sub = await parseDtsFileRecursive(targetPath, nextVisited);
        if (sub) {
          extraResults.push(sub);
          if (localName !== exportedName) aliasMappings.push({ localName, exportedName });
        }
      }
    } catch {}
  }
  for (const basePath of wildcards) {
    try { const resolved = resolveWildcardTarget(basePath); if (resolved && fs.existsSync(resolved)) { const sub = await parseDtsFileRecursive(resolved, nextVisited); if (sub) extraResults.push(sub); } } catch {}
  }
  const merged = { functions: { ...base.functions }, interfaces: { ...base.interfaces }, types: { ...base.types }, classes: { ...base.classes }, enums: { ...base.enums }, namespaces: { ...base.namespaces }, defaults: [...(base.defaults || [])], jsdoc: { ...base.jsdoc } };
  for (const r of extraResults) {
    Object.assign(merged.functions, r.functions);
    Object.assign(merged.interfaces, r.interfaces);
    Object.assign(merged.types, r.types);
    Object.assign(merged.classes, r.classes);
    Object.assign(merged.enums, r.enums);
    Object.assign(merged.namespaces, r.namespaces);
    Object.assign(merged.jsdoc, r.jsdoc);
    merged.defaults.push(...(r.defaults || []));
  }
  for (const { localName, exportedName } of aliasMappings) {
    for (const bucket of ['functions', 'interfaces', 'types', 'classes', 'enums', 'namespaces', 'jsdoc']) {
      if (merged[bucket]?.[localName]) {
        merged[bucket][exportedName] = merged[bucket][localName];
        delete merged[bucket][localName];
      }
    }
  }
  return merged;
}

function resolveWildcardTarget(basePath) {
  if (fs.existsSync(basePath)) return basePath;
  const withIndex = path.join(basePath, 'index.d.ts');
  if (fs.existsSync(withIndex)) return withIndex;
  const withCts = path.join(basePath, 'index.d.cts');
  if (fs.existsSync(withCts)) return withCts;
  const withMts = path.join(basePath, 'index.d.mts');
  if (fs.existsSync(withMts)) return withMts;
  return basePath;
}

export function filterTypeInfo(typeInfoRaw, filterRaw, kindFilter = []) {
  if (!typeInfoRaw) return { functions: {}, interfaces: {}, types: {}, classes: {}, enums: {}, namespaces: {}, jsdoc: {} };
  let functions = typeInfoRaw.functions || {};
  let interfaces = typeInfoRaw.interfaces || {};
  let types = typeInfoRaw.types || {};
  let classes = typeInfoRaw.classes || {};
  let enums = typeInfoRaw.enums || {};
  let namespaces = typeInfoRaw.namespaces || {};
  let jsdoc = typeInfoRaw.jsdoc || {};
  if (filterRaw) {
    const isRegex = filterRaw.startsWith('/') && filterRaw.endsWith('/') && filterRaw.length > 2;
    const regex = isRegex ? new RegExp(filterRaw.slice(1,-1), 'i') : null;
    const lower = filterRaw.toLowerCase();
    const matchesName = (name, value) => {
      const candidates = [name, value?.localName].filter(Boolean).map(String);
      return candidates.some((candidate) => regex ? regex.test(candidate) : candidate.toLowerCase().includes(lower));
    };
    functions = Object.fromEntries(Object.entries(functions).filter(([name, value]) => matchesName(name, value)));
    interfaces = Object.fromEntries(Object.entries(interfaces).filter(([name]) => regex ? regex.test(name) : name.toLowerCase().includes(lower)));
    types = Object.fromEntries(Object.entries(types).filter(([name]) => regex ? regex.test(name) : name.toLowerCase().includes(lower)));
    classes = Object.fromEntries(Object.entries(classes).filter(([name, value]) => matchesName(name, value)));
    enums = Object.fromEntries(Object.entries(enums).filter(([name]) => regex ? regex.test(name) : name.toLowerCase().includes(lower)));
    namespaces = Object.fromEntries(Object.entries(namespaces).filter(([name]) => regex ? regex.test(name) : name.toLowerCase().includes(lower)));
    jsdoc = Object.fromEntries(Object.entries(jsdoc).filter(([name]) => regex ? regex.test(name) : name.toLowerCase().includes(lower)));
  }
  if (kindFilter && kindFilter.length > 0) {
    if (!kindFilter.includes('function')) functions = {};
    if (!kindFilter.includes('interface')) interfaces = {};
    if (!kindFilter.includes('type')) types = {};
    if (!kindFilter.includes('class')) classes = {};
    if (!kindFilter.includes('enum')) enums = {};
    if (!kindFilter.includes('namespace')) namespaces = {};
  }
  const symbolNames = new Set([
    ...Object.keys(functions),
    ...Object.keys(interfaces),
    ...Object.keys(types),
    ...Object.keys(classes),
    ...Object.keys(enums),
    ...Object.keys(namespaces),
  ]);
  if (symbolNames.size > 0) {
    jsdoc = Object.fromEntries(Object.entries(jsdoc).filter(([name]) => symbolNames.has(name)));
  }
  return { functions, interfaces, types, classes, enums, namespaces, jsdoc };
}
