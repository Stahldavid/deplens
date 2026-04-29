// Unified type inspection + auto-generation orchestrator
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseDtsFile, findReExports } from './parse-dts.mjs';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

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
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const cacheRoot = path.join(home, '.deplens-cache');
  if (dtsPath.startsWith(cacheRoot)) return dtsPath;
  try { const real = fs.realpathSync(dtsPath); if (real.startsWith(cacheRoot)) return real; } catch {}
  return dtsPath;
}

const memoryCache = new Map(); const MEMORY_CACHE_MAX = 20;
function getMemory(key) { return memoryCache.get(key) ?? null; }
function setMemory(key, value) {
  if (memoryCache.size >= MEMORY_CACHE_MAX) memoryCache.delete(memoryCache.keys().next().value);
  memoryCache.set(key, value);
}

export async function getCachedDtsParse(dtsPath) {
  const cacheKey = getCacheKey(dtsPath);
  const fromMem = getMemory(cacheKey);
  if (fromMem) return fromMem;
  const cacheDir = path.join(process.env.HOME || '~', '.deplens-cache', 'parse');
  fs.mkdirSync(cacheDir, { recursive: true });
  const safeName = cacheKey.replace(/[/:\\]/g, '_');
  const cacheFile = path.join(cacheDir, safeName + '.json');
  if (fs.existsSync(cacheFile)) {
    try { const parsed = JSON.parse(fs.readFileSync(cacheFile,'utf8')); setMemory(cacheKey, parsed); return parsed; } catch {}
  }

  const result = await parseDtsFileRecursive(dtsPath, []);


  fs.writeFileSync(cacheFile, JSON.stringify(result, null, 0));
  setMemory(cacheKey, result);
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
  for (const [sym, targetPath] of named) {
    try { if (fs.existsSync(targetPath)) { const sub = await parseDtsFileRecursive(targetPath, nextVisited); if (sub) extraResults.push(sub); } } catch {}
  }
  for (const basePath of wildcards) {
    try { const resolved = resolveWildcardTarget(basePath); if (resolved && fs.existsSync(resolved)) { const sub = await parseDtsFileRecursive(resolved, nextVisited); if (sub) extraResults.push(sub); } } catch {}
  }
  const merged = { functions: { ...base.functions }, interfaces: { ...base.interfaces }, types: { ...base.types }, classes: { ...base.classes }, enums: { ...base.enums }, namespaces: { ...base.namespaces }, defaults: { ...base.defaults }, jsdoc: { ...base.jsdoc } };
  for (const r of extraResults) {
    Object.assign(merged.functions, r.functions);
    Object.assign(merged.interfaces, r.interfaces);
    Object.assign(merged.types, r.types);
    Object.assign(merged.classes, r.classes);
    Object.assign(merged.enums, r.enums);
    Object.assign(merged.namespaces, r.namespaces);
  }
  return merged;
}

function resolveWildcardTarget(basePath) {
  if (fs.existsSync(basePath)) return basePath;
  const withIndex = path.join(basePath, 'index.d.ts');
  if (fs.existsSync(withIndex)) return withIndex;
  const withCts = path.join(basePath, 'index.d.cts');
  if (fs.existsSync(withCts)) return withCts;
  return basePath;
}

export function filterTypeInfo(typeInfoRaw, filterRaw, kindFilter = []) {
  if (!typeInfoRaw) return { functions: {}, interfaces: {}, types: {}, classes: {}, enums: {}, namespaces: {} };
  let functions = typeInfoRaw.functions || {};
  let interfaces = typeInfoRaw.interfaces || {};
  let types = typeInfoRaw.types || {};
  let classes = typeInfoRaw.classes || {};
  let enums = typeInfoRaw.enums || {};
  let namespaces = typeInfoRaw.namespaces || {};
  if (filterRaw) {
    const isRegex = filterRaw.startsWith('/') && filterRaw.endsWith('/') && filterRaw.length > 2;
    const regex = isRegex ? new RegExp(filterRaw.slice(1,-1), 'i') : null;
    const lower = filterRaw.toLowerCase();
    functions = Object.fromEntries(Object.entries(functions).filter(([name]) => regex ? regex.test(name) : name.toLowerCase().includes(lower)));
    interfaces = Object.fromEntries(Object.entries(interfaces).filter(([name]) => regex ? regex.test(name) : name.toLowerCase().includes(lower)));
    types = Object.fromEntries(Object.entries(types).filter(([name]) => regex ? regex.test(name) : name.toLowerCase().includes(lower)));
    classes = Object.fromEntries(Object.entries(classes).filter(([name]) => regex ? regex.test(name) : name.toLowerCase().includes(lower)));
    enums = Object.fromEntries(Object.entries(enums).filter(([name]) => regex ? regex.test(name) : name.toLowerCase().includes(lower)));
    namespaces = Object.fromEntries(Object.entries(namespaces).filter(([name]) => regex ? regex.test(name) : name.toLowerCase().includes(lower)));
  }
  if (kindFilter && kindFilter.length > 0) {
    if (!kindFilter.includes('function')) functions = {};
    if (!kindFilter.includes('interface')) interfaces = {};
    if (!kindFilter.includes('type')) types = {};
    if (!kindFilter.includes('class')) classes = {};
    if (!kindFilter.includes('enum')) enums = {};
    if (!kindFilter.includes('namespace')) namespaces = {};
  }
  return { functions, interfaces, types, classes, enums, namespaces };
}
