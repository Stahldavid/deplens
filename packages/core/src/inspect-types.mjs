// Unified type inspection + auto-generation orchestrator
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { parseDtsFileWithMetadata } from './parse-dts.mjs';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
const PARSE_CACHE_VERSION = 4;

export async function generateDts(pkgDir) {
  try {
    const needle = path.join(pkgDir, 'node_modules', '.bin', 'dts-gen');
    if (!fs.existsSync(needle)) return null;
    await execFileAsync(needle, ['--name', 'temp', '--project', pkgDir, '--yes'], {
      cwd: pkgDir,
      timeout: 30000,
    });
    const gen = path.join(pkgDir, 'index.d.ts');
    return fs.existsSync(gen) ? gen : null;
  } catch {
    return null;
  }
}

export function getCacheKey(dtsPath) {
  const cacheRoot = path.join(os.homedir(), '.deplens-cache');
  if (dtsPath.startsWith(cacheRoot)) return `${PARSE_CACHE_VERSION}:${dtsPath}`;
  try {
    const real = fs.realpathSync(dtsPath);
    if (real.startsWith(cacheRoot)) return `${PARSE_CACHE_VERSION}:${real}`;
  } catch {}
  return `${PARSE_CACHE_VERSION}:${dtsPath}`;
}

function getFileCacheMetadata(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return {
      path: fs.realpathSync(filePath),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  } catch {
    return null;
  }
}

function isFreshCachePayload(payload) {
  if (!payload?.result || !Array.isArray(payload.cache?.files)) return false;
  return payload.cache.files.every((cached) => {
    const current = getFileCacheMetadata(cached.path);
    return (
      current &&
      current.path === cached.path &&
      current.size === cached.size &&
      current.mtimeMs === cached.mtimeMs
    );
  });
}

const memoryCache = new Map();
const MEMORY_CACHE_MAX = 20;
function getMemory(key) {
  return memoryCache.get(key) ?? null;
}
function setMemory(key, value) {
  if (memoryCache.size >= MEMORY_CACHE_MAX) memoryCache.delete(memoryCache.keys().next().value);
  memoryCache.set(key, value);
}

export async function getCachedDtsParse(dtsPath) {
  const cacheKey = getCacheKey(dtsPath);
  const fromMem = getMemory(cacheKey);
  if (isFreshCachePayload(fromMem)) return fromMem.result;
  const cacheDir = path.join(os.homedir(), '.deplens-cache', 'parse');
  fs.mkdirSync(cacheDir, { recursive: true });
  const safeName = crypto.createHash('sha256').update(cacheKey).digest('hex');
  const cacheFile = path.join(cacheDir, `${safeName}.json`);
  if (fs.existsSync(cacheFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (isFreshCachePayload(parsed)) {
        setMemory(cacheKey, parsed);
        return parsed.result;
      }
    } catch {}
  }

  const parsed = parseDtsFileWithMetadata(dtsPath, null);
  const result = parsed?.result || null;
  const files = [...new Set(parsed?.dependencies || [dtsPath])]
    .map(getFileCacheMetadata)
    .filter(Boolean);
  const payload = { cache: { version: PARSE_CACHE_VERSION, files }, result };

  const temporaryFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(payload));
  try {
    fs.renameSync(temporaryFile, cacheFile);
  } catch (error) {
    if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
    fs.rmSync(cacheFile, { force: true });
    fs.renameSync(temporaryFile, cacheFile);
  }
  setMemory(cacheKey, payload);
  return result;
}

export function filterTypeInfo(typeInfoRaw, filterRaw, kindFilter = []) {
  if (!typeInfoRaw)
    return {
      functions: {},
      interfaces: {},
      types: {},
      classes: {},
      enums: {},
      namespaces: {},
      jsdoc: {},
    };
  let functions = typeInfoRaw.functions || {};
  let interfaces = typeInfoRaw.interfaces || {};
  let types = typeInfoRaw.types || {};
  let classes = typeInfoRaw.classes || {};
  let enums = typeInfoRaw.enums || {};
  let enumDetails = typeInfoRaw.enumDetails || {};
  let namespaces = typeInfoRaw.namespaces || {};
  let variables = typeInfoRaw.variables || {};
  let interfaceDetails = typeInfoRaw.interfaceDetails || {};
  let jsdoc = typeInfoRaw.jsdoc || {};
  if (filterRaw) {
    const isRegex = filterRaw.startsWith('/') && filterRaw.endsWith('/') && filterRaw.length > 2;
    let regex = null;
    if (isRegex) {
      try {
        regex = new RegExp(filterRaw.slice(1, -1), 'i');
      } catch {}
    }
    const lower = filterRaw.toLowerCase();
    const matchesName = (name, value) => {
      const candidates = [name, value?.localName].filter(Boolean).map(String);
      return candidates.some((candidate) =>
        regex ? regex.test(candidate) : candidate.toLowerCase().includes(lower)
      );
    };
    functions = Object.fromEntries(
      Object.entries(functions).filter(([name, value]) => matchesName(name, value))
    );
    interfaces = Object.fromEntries(
      Object.entries(interfaces).filter(([name]) =>
        regex ? regex.test(name) : name.toLowerCase().includes(lower)
      )
    );
    types = Object.fromEntries(
      Object.entries(types).filter(([name]) =>
        regex ? regex.test(name) : name.toLowerCase().includes(lower)
      )
    );
    classes = Object.fromEntries(
      Object.entries(classes).filter(([name, value]) => matchesName(name, value))
    );
    enums = Object.fromEntries(
      Object.entries(enums).filter(([name]) =>
        regex ? regex.test(name) : name.toLowerCase().includes(lower)
      )
    );
    enumDetails = Object.fromEntries(
      Object.entries(enumDetails).filter(([name]) =>
        regex ? regex.test(name) : name.toLowerCase().includes(lower)
      )
    );
    namespaces = Object.fromEntries(
      Object.entries(namespaces).filter(([name]) =>
        regex ? regex.test(name) : name.toLowerCase().includes(lower)
      )
    );
    variables = Object.fromEntries(
      Object.entries(variables).filter(([name]) =>
        regex ? regex.test(name) : name.toLowerCase().includes(lower)
      )
    );
    interfaceDetails = Object.fromEntries(
      Object.entries(interfaceDetails).filter(([name]) =>
        regex ? regex.test(name) : name.toLowerCase().includes(lower)
      )
    );
    jsdoc = Object.fromEntries(
      Object.entries(jsdoc).filter(([name]) =>
        regex ? regex.test(name) : name.toLowerCase().includes(lower)
      )
    );
  }
  if (kindFilter && kindFilter.length > 0) {
    if (!kindFilter.includes('function')) functions = {};
    if (!kindFilter.includes('interface')) interfaces = {};
    if (!kindFilter.includes('type')) types = {};
    if (!kindFilter.includes('class')) classes = {};
    if (!kindFilter.includes('enum')) enums = {};
    if (!kindFilter.includes('enum')) enumDetails = {};
    if (!kindFilter.includes('namespace')) namespaces = {};
    if (!kindFilter.includes('constant') && !kindFilter.includes('variable')) variables = {};
  }
  const symbolNames = new Set([
    ...Object.keys(functions),
    ...Object.keys(interfaces),
    ...Object.keys(types),
    ...Object.keys(classes),
    ...Object.keys(enums),
    ...Object.keys(namespaces),
    ...Object.keys(variables),
  ]);
  if (symbolNames.size > 0) {
    jsdoc = Object.fromEntries(Object.entries(jsdoc).filter(([name]) => symbolNames.has(name)));
  }
  return {
    functions,
    interfaces,
    interfaceDetails,
    types,
    classes,
    enums,
    enumDetails,
    namespaces,
    variables,
    jsdoc,
  };
}
