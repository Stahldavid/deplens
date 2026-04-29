// history-manager.mjs
import fs from 'fs';
import path from 'path';
import os from 'os';

const DEFAULT_HISTORY_DIR = path.join(os.homedir(), '.deplens', 'history');

/**
 * Garante que o diretório de histórico existe
 */
export function ensureHistoryDir(dir) {
  if (dir == null) dir = DEFAULT_HISTORY_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Retorna caminho do diretório de histórico de um pacote
 */
export function getPackageHistoryDir(packageName, baseDir = DEFAULT_HISTORY_DIR) {
  // Sanitizar nome do pacote para diretório (scoped packages: @org/name -> org_name)
  const safeName = packageName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(ensureHistoryDir(baseDir), safeName);
}

/**
 * Retorna caminho do arquivo de histórico para uma versão
 */
export function getHistoryFilePath(packageName, version, baseDir = DEFAULT_HISTORY_DIR) {
  const pkgDir = getPackageHistoryDir(packageName, baseDir);
  // Sanitizar versão para filename (remover /, :, etc)
  const safeVersion = version.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(pkgDir, `${safeVersion}.json`);
}

/**
 * Salva uma entrada no histórico
 * @param {Object} entry - { package, version, timestamp, command, result }
 * @param {string} [baseDir] - diretório base (default: ~/.deplens/history)
 * @returns {string} caminho do arquivo salvo
 */
export function saveHistoryEntry(entry, baseDir) {
  const { package: pkg, version } = entry;
  if (!pkg || !version) {
    throw new Error('Entry must contain package and version');
  }

  const filePath = getHistoryFilePath(pkg, version, baseDir);

  // Garantir diretório
  ensureHistoryDir(path.dirname(filePath));

  // Adicionar timestamp se não fornecido
  const record = {
    ...entry,
    timestamp: entry.timestamp || Date.now(),
    savedAt: Date.now(),
  };

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
  return filePath;
}

/**
 * Lista todas as entradas do histórico
 * @param {string} [filterPackage] - opcional: filtrar por nome de pacote
 * @param {string} [baseDir] - diretório base
 * @returns {Array<{package: string, version: string, timestamp: number, file: string}>}
 */
export function listHistory(filterPackage = null, baseDir = DEFAULT_HISTORY_DIR) {
  const historyRoot = ensureHistoryDir(baseDir);
  const entries = [];

  // Listar subdiretórios (pacotes)
  const pkgDirs = fs
    .readdirSync(historyRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const pkgDir of pkgDirs) {
    // Reverter sanitização parcial? Melhor armazenar nome original em index...
    // Por enquanto, assumimos que pkgDir é nome sanitizado; usamos filterPackage diretamente
    if (filterPackage && !pkgDir.includes(filterPackage.replace(/[^a-zA-Z0-9]/g, '_'))) {
      continue;
    }

    const pkgPath = path.join(historyRoot, pkgDir);
    const files = fs.readdirSync(pkgPath).filter((f) => f.endsWith('.json') && f !== 'index.json');

    for (const file of files) {
      const filePath = path.join(pkgPath, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        entries.push({
          package: data.package,
          version: data.version,
          timestamp: data.timestamp,
          file: filePath,
        });
      } catch (e) {
        // ignorar JSON malformado
      }
    }
  }

  // Ordenar por timestamp desc
  entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return entries;
}

/**
 * Obtém uma entrada específica do histórico
 * @param {string} packageName
 * @param {string} version
 * @param {string} [baseDir]
 * @returns {Object|null}
 */
export function getHistoryEntry(packageName, version, baseDir = DEFAULT_HISTORY_DIR) {
  const filePath = getHistoryFilePath(packageName, version, baseDir);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

/**
 * Remove entradas do histórico
 * @param {string} [packageName] - se fornecido, remove apenas do pacote; senão, limpa tudo
 * @param {string} [baseDir]
 * @returns {{removed: number, files: string[]}}
 */
export function clearHistory(packageName = null, baseDir = DEFAULT_HISTORY_DIR) {
  const historyRoot = ensureHistoryDir(baseDir);
  const allRemoved = [];

  if (packageName) {
    const pkgDir = getPackageHistoryDir(packageName, baseDir);
    if (fs.existsSync(pkgDir)) {
      const files = fs.readdirSync(pkgDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        const fp = path.join(pkgDir, file);
        fs.unlinkSync(fp);
        allRemoved.push(fp);
      }
      // Remover diretório se vazio
      try {
        fs.rmdirSync(pkgDir);
      } catch {
        /* não vazio ou já foi removido */
      }
    }
  } else {
    // Limpar tudo
    const pkgDirs = fs
      .readdirSync(historyRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const pkg of pkgDirs) {
      const result = clearHistory(pkg, baseDir);
      allRemoved.push(...result.files);
    }
  }

  return { removed: allRemoved.length, files: allRemoved };
}

/**
 * Compara duas entradas de histórico e retorna diff resumido
 * @param {Object} entryA - resultado do inspect (json)
 * @param {Object} entryB - resultado do inspect (json)
 * @returns {Object} diff informativo
 */
export function compareHistoryEntries(entryA, entryB) {
  if (!entryA || !entryB) {
    return { error: 'Both entries are required' };
  }

  const diff = {
    package: entryA.package,
    versions: { v1: entryA.version, v2: entryB.version },
    exports: { added: 0, removed: 0, changed: 0 },
    types: { added: 0, removed: 0, changed: 0 },
    summary: '',
  };

  // Comparar exports (simplificado)
  const exportsA = entryA.exports || [];
  const exportsB = entryB.exports || [];

  const keysA = new Set(exportsA.map((e) => e.name || e));
  const keysB = new Set(exportsB.map((e) => e.name || e));

  diff.exports.added = [...keysB].filter((k) => !keysA.has(k)).length;
  diff.exports.removed = [...keysA].filter((k) => !keysB.has(k)).length;
  // Changed: mesmos nomes mas tipo diferente? (precisa mergirar detalhes)
  const common = [...keysA].filter((k) => keysB.has(k));
  for (const name of common) {
    const expA = exportsA.find((e) => (e.name || e) === name);
    const expB = exportsB.find((e) => (e.name || e) === name);
    // Se forem objetos (com tipo), comparar kind
    if (expA && expB && typeof expA === 'object' && typeof expB === 'object') {
      if (expA.kind !== expB.kind) diff.exports.changed++;
    }
  }

  // Comparar types info (se houver)
  const typesA = entryA.types || null;
  const typesB = entryB.types || null;

  if (typesA && typesB) {
    // Estimativa: contagem de símbolos
    const countA = typeof typesA === 'object' ? Object.keys(typesA).length || 0 : 0;
    const countB = typeof typesB === 'object' ? Object.keys(typesB).length || 0 : 0;
    diff.types.added = Math.max(0, countB - countA);
    diff.types.removed = Math.max(0, countA - countB);
  } else if (typesB && !typesA) {
    diff.types.added = 1;
  } else if (typesA && !typesB) {
    diff.types.removed = 1;
  }

  diff.summary =
    `+${diff.exports.added} exports, -${diff.exports.removed} removals` +
    (diff.exports.changed ? `, ~${diff.exports.changed} changed` : '');

  return diff;
}

export default {
  ensureHistoryDir,
  getPackageHistoryDir,
  getHistoryFilePath,
  saveHistoryEntry,
  listHistory,
  getHistoryEntry,
  clearHistory,
  compareHistoryEntries,
};
