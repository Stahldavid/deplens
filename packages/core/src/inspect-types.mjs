// inspect-types.mjs — Type definition extraction + auto-generation
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { parseDtsFile } from './parse-dts.mjs';

const DTS_CACHE_DIR = path.join(os.homedir(), '.deplens-cache', 'types');
const DEFAULT_DTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function ensureDtsCacheDir() {
  if (!fs.existsSync(DTS_CACHE_DIR)) {
    fs.mkdirSync(DTS_CACHE_DIR, { recursive: true });
  }
  return DTS_CACHE_DIR;
}

function safeCacheKeyFromPath(dtsPath) {
  return dtsPath.replace(/[:\\/]/g, '_');
}

function getDtsCacheEntryPath(dtsPath) {
  const base = safeCacheKeyFromPath(dtsPath);
  return path.join(ensureDtsCacheDir(), `${base}.json`);
}

export async function getCachedDtsParse(dtsPath, ttlMs = DEFAULT_DTS_TTL_MS) {
  try {
    const cachePath = getDtsCacheEntryPath(dtsPath);
    const stat = fs.statSync(dtsPath);
    const sourceMtimeMs = stat.mtimeMs;

    if (fs.existsSync(cachePath)) {
      const cacheStat = fs.statSync(cachePath);
      const tooOld = Date.now() - cacheStat.mtimeMs > ttlMs;
      if (!tooOld) {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        if (cached?.sourceMtimeMs === sourceMtimeMs && cached?.data) {
          return cached.data;
        }
      }
    }

    const parsed = parseDtsFile(dtsPath, null);
    fs.writeFileSync(cachePath, JSON.stringify({ sourceMtimeMs, data: parsed }), 'utf-8');
    return parsed;
  } catch {
    return parseDtsFile(dtsPath, null);
  }
}

export async function generateDts(pkgDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
    const moduleName = pkg.name || path.basename(pkgDir);
    execSync('npx dts-gen -m ' + moduleName + ' --overwrite', {
      cwd: pkgDir,
      stdio: 'pipe',
      timeout: 30000,
    });
    const dtsPath = path.join(pkgDir, moduleName + '.d.ts');
    if (fs.existsSync(dtsPath)) {
      return dtsPath;
    }
  } catch {
    // silencioso
  }
  return null;
}

export { ensureDtsCacheDir, safeCacheKeyFromPath, getDtsCacheEntryPath };
