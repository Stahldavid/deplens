import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import semver from 'semver';
import { parse as parseYaml } from 'yaml';
import { runDiff } from './diff.mjs';
import { createOperationSignal, errorPayload, throwIfAborted } from './errors.mjs';
import { createSafeRecord, setSafeRecord } from './safe-record.mjs';

const execFileAsync = promisify(execFile);
const DEPENDENCY_GROUPS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

function parseLockfileContent(content, fileName = '') {
  const trimmed = String(content).trimStart();
  if (/\.ya?ml$/i.test(fileName) || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return parseYaml(content);
  }
  return JSON.parse(content);
}

function parseLockfile(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') throw new TypeError('A lockfile object or path is required');
  const filePath = path.resolve(value);
  return parseLockfileContent(fs.readFileSync(filePath, 'utf8'), filePath);
}

function packageNameFromLockPath(lockPath, entry) {
  if (entry?.name) return entry.name;
  const marker = 'node_modules/';
  const index = lockPath.lastIndexOf(marker);
  return index === -1 ? null : lockPath.slice(index + marker.length);
}

function dependencyNames(entry) {
  return new Set(DEPENDENCY_GROUPS.flatMap((group) => Object.keys(entry?.[group] || {})));
}

function dependencyType(root, packageName) {
  return DEPENDENCY_GROUPS.find((group) => Object.hasOwn(root?.[group] || {}, packageName)) || null;
}

function pnpmDependencyVersion(value) {
  const raw = value && typeof value === 'object' ? value.version : value;
  if (typeof raw !== 'string') return null;
  if (/^(?:link|workspace|file):/.test(raw)) return null;
  const npmAlias = raw.startsWith('npm:') ? raw.slice(4) : raw;
  const versionPart = npmAlias.startsWith('@')
    ? npmAlias.slice(npmAlias.indexOf('@', npmAlias.indexOf('/') + 1) + 1)
    : npmAlias.includes('@')
      ? npmAlias.slice(npmAlias.lastIndexOf('@') + 1)
      : npmAlias;
  return versionPart.split('(')[0] || null;
}

function pnpmPackageIdentity(key, entry = {}) {
  const normalized = String(key).replace(/^\//, '');
  if (/^(?:link|workspace|file):/.test(normalized)) return null;
  const delimiter = normalized.startsWith('@')
    ? normalized.indexOf('@', normalized.indexOf('/') + 1)
    : normalized.indexOf('@');
  if (delimiter <= 0) return null;
  const name = entry.name || normalized.slice(0, delimiter);
  const version = String(entry.version || normalized.slice(delimiter + 1)).split('(')[0];
  return name && version ? { name, version } : null;
}

function createPnpmProjectSnapshot(lockfile, options) {
  const importers = lockfile.importers || {};
  const directByName = new Map();
  for (const [importerPath, importer] of Object.entries(importers)) {
    for (const group of DEPENDENCY_GROUPS) {
      for (const [name, reference] of Object.entries(importer?.[group] || {})) {
        const version = pnpmDependencyVersion(reference);
        if (!version) continue;
        const records = directByName.get(name) || [];
        records.push({
          version,
          dependencyType: group,
          workspace: importerPath === '.' ? null : importerPath,
        });
        directByName.set(name, records);
      }
    }
  }

  const instances = [];
  const packageEntries = Object.entries(lockfile.packages || lockfile.snapshots || {});
  for (const [packageKey, entry] of packageEntries) {
    const identity = pnpmPackageIdentity(packageKey, entry);
    if (!identity) continue;
    const directRecords = (directByName.get(identity.name) || []).filter(
      (record) => record.version === identity.version
    );
    instances.push({
      id: packageKey,
      name: identity.name,
      version: identity.version,
      resolved: entry?.resolution?.tarball || entry?.resolved || null,
      integrity: entry?.resolution?.integrity || entry?.integrity || null,
      direct: directRecords.length > 0,
      dependencyType: directRecords[0]?.dependencyType || null,
      workspaces: [
        ...new Set(directRecords.map((record) => record.workspace).filter(Boolean)),
      ].sort(),
    });
  }

  for (const [name, records] of directByName) {
    for (const record of records) {
      if (instances.some((item) => item.name === name && item.version === record.version)) continue;
      instances.push({
        id: `${name}@${record.version}`,
        name,
        version: record.version,
        resolved: null,
        integrity: null,
        direct: true,
        dependencyType: record.dependencyType,
        workspaces: record.workspace ? [record.workspace] : [],
      });
    }
  }

  instances.sort((left, right) => left.id.localeCompare(right.id));
  const packages = createSafeRecord();
  for (const instance of [...instances].sort((left, right) => {
    if (left.direct !== right.direct) return left.direct ? -1 : 1;
    return left.id.localeCompare(right.id);
  })) {
    if (!Object.hasOwn(packages, instance.name)) setSafeRecord(packages, instance.name, instance);
  }
  return {
    schemaVersion: 1,
    kind: 'deplens-project-snapshot',
    project: {
      name: options.name || null,
      version: null,
      lockfileVersion: lockfile.lockfileVersion || null,
      source: options.source || null,
      packageManager: 'pnpm',
    },
    packages,
    instances,
  };
}

export function createProjectSnapshot(lockfileInput, options = {}) {
  const lockfile = parseLockfile(lockfileInput);
  if (lockfile.importers && (lockfile.packages || lockfile.snapshots)) {
    return createPnpmProjectSnapshot(lockfile, options);
  }
  if (!lockfile.packages || typeof lockfile.packages !== 'object') {
    throw new Error('Supported lockfiles are npm package-lock v2/v3 and pnpm-lock YAML');
  }
  const root = lockfile.packages[''] || {};
  const rootDependencies = dependencyNames(root);
  const workspaces = Object.entries(lockfile.packages)
    .filter(([lockPath, entry]) => lockPath && !lockPath.includes('node_modules/') && entry?.name)
    .map(([lockPath, entry]) => ({
      lockPath,
      name: entry.name,
      dependencies: dependencyNames(entry),
    }));
  const instances = [];
  for (const [lockPath, entry] of Object.entries(lockfile.packages)) {
    if (!lockPath.includes('node_modules/') || !entry?.version) continue;
    const name = packageNameFromLockPath(lockPath, entry);
    if (!name) continue;
    instances.push({
      id: lockPath,
      name,
      version: String(entry.version),
      resolved: entry.resolved || null,
      integrity: entry.integrity || null,
      direct: rootDependencies.has(name),
      dependencyType: dependencyType(root, name),
      workspaces: workspaces
        .filter((workspace) => workspace.dependencies.has(name))
        .map((workspace) => workspace.name)
        .sort(),
    });
  }
  instances.sort((left, right) => left.id.localeCompare(right.id));
  const packages = createSafeRecord();
  for (const instance of [...instances].sort((left, right) => {
    if (left.direct !== right.direct) return left.direct ? -1 : 1;
    return left.id.length - right.id.length || left.id.localeCompare(right.id);
  })) {
    if (!Object.hasOwn(packages, instance.name)) setSafeRecord(packages, instance.name, instance);
  }
  return {
    schemaVersion: 1,
    kind: 'deplens-project-snapshot',
    project: {
      name: options.name || root.name || lockfile.name || null,
      version: root.version || lockfile.version || null,
      lockfileVersion: lockfile.lockfileVersion || null,
      source: options.source || null,
      packageManager: 'npm',
    },
    packages,
    instances,
  };
}

function classifyVersionChange(fromVersion, toVersion) {
  if (!fromVersion) return 'added';
  if (!toVersion) return 'removed';
  if (semver.valid(fromVersion) && semver.valid(toVersion)) {
    if (semver.gt(toVersion, fromVersion)) return 'upgraded';
    if (semver.lt(toVersion, fromVersion)) return 'downgraded';
  }
  return 'changed';
}

export function compareProjectSnapshots(from, to) {
  const names = [
    ...new Set([...Object.keys(from?.packages || {}), ...Object.keys(to?.packages || {})]),
  ].sort();
  const changes = [];
  for (const packageName of names) {
    const before = from?.packages?.[packageName] || null;
    const after = to?.packages?.[packageName] || null;
    if (before?.version === after?.version) continue;
    changes.push({
      package: packageName,
      fromVersion: before?.version || null,
      toVersion: after?.version || null,
      changeType: classifyVersionChange(before?.version, after?.version),
      direct: Boolean(before?.direct || after?.direct),
      dependencyType: after?.dependencyType || before?.dependencyType || null,
      workspaces: [
        ...new Set([...(before?.workspaces || []), ...(after?.workspaces || [])]),
      ].sort(),
    });
  }
  const count = (type) => changes.filter((change) => change.changeType === type).length;
  return {
    schemaVersion: 1,
    kind: 'deplens-project-diff',
    from: from?.project || null,
    to: to?.project || null,
    summary: {
      total: changes.length,
      added: count('added'),
      removed: count('removed'),
      upgraded: count('upgraded'),
      downgraded: count('downgraded'),
    },
    changes,
    warnings: [],
  };
}

async function defaultDiffRunner(options) {
  const result = await runDiff({ ...options, format: 'json' });
  if (result?.schemaVersion) return result;
  if (typeof result?.output === 'string') return JSON.parse(result.output);
  return result;
}

async function mapConcurrent(items, concurrency, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}

export async function runProjectDiff(options = {}) {
  const startedAt = performance.now();
  const from =
    options.from?.kind === 'deplens-project-snapshot'
      ? options.from
      : createProjectSnapshot(options.from, { source: options.fromSource });
  const to =
    options.to?.kind === 'deplens-project-snapshot'
      ? options.to
      : createProjectSnapshot(options.to, { source: options.toSource });
  const report = compareProjectSnapshots(from, to);
  const diffRunner = options.diffRunner || defaultDiffRunner;
  const candidates = (options.analyze === false ? [] : report.changes).filter(
    (change) =>
      change.fromVersion && change.toVersion && (options.includeTransitive || change.direct)
  );
  const operation = createOperationSignal(options.signal, options.timeoutMs, 'project-diff');
  let completed = 0;
  try {
    await mapConcurrent(
      candidates,
      Math.max(1, Number(options.concurrency) || 4),
      async (change) => {
        throwIfAborted(operation.signal, 'project-diff');
        try {
          const api = await diffRunner({
            package: change.package,
            from: change.fromVersion,
            to: change.toVersion,
            projectDir: options.projectDir || process.cwd(),
            includeChangelog: false,
            includeSource: Boolean(options.includeSource),
            preferCdn: Boolean(options.preferCdn),
            offline: Boolean(options.offline),
            runtime: Boolean(options.runtime),
            conditions: options.conditions,
            semantic: options.semantic !== false,
            signal: operation.signal,
            timeoutMs: options.timeoutMs,
          });
          change.api = api;
        } catch (error) {
          Object.assign(
            change,
            errorPayload(error, { phase: 'project-diff', code: 'PACKAGE_DIFF_FAILED' })
          );
        } finally {
          completed += 1;
          options.onProgress?.({ completed, total: candidates.length, package: change.package });
        }
      }
    );
  } finally {
    operation.dispose();
  }
  report.summary.analyzed = candidates.length;
  report.summary.breakingPackages = report.changes.filter(
    (change) => Number(change.api?.summary?.breaking || 0) > 0
  ).length;
  report.summary.warningPackages = report.changes.filter(
    (change) => Number(change.api?.summary?.warnings || 0) > 0
  ).length;
  report.summary.failedPackages = report.changes.filter((change) => change.error).length;
  if (options.profile) {
    report.meta = { timings: { totalMs: Number((performance.now() - startedAt).toFixed(2)) } };
  }
  return report;
}

export async function loadLockfileFromGit(ref, options = {}) {
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const lockfile = options.lockfile || 'package-lock.json';
  const { stdout } = await execFileAsync('git', ['show', `${ref}:${lockfile}`], {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: Number(options.timeoutMs) || 30000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return parseLockfileContent(stdout, lockfile);
}

export async function loadProjectSnapshot(source = 'working', options = {}) {
  if (source?.kind === 'deplens-project-snapshot') return source;
  if (source && typeof source === 'object') return createProjectSnapshot(source, options);
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const lockfile = options.lockfile || 'package-lock.json';
  const sourceText = String(source || 'working');
  const candidate = path.resolve(projectDir, sourceText === 'working' ? lockfile : sourceText);
  if (sourceText === 'working' || sourceText === 'current' || fs.existsSync(candidate)) {
    return createProjectSnapshot(candidate, { source: sourceText });
  }
  const lock = await loadLockfileFromGit(sourceText, { ...options, projectDir, lockfile });
  return createProjectSnapshot(lock, { source: sourceText });
}

export function formatProjectDiffText(report) {
  const lines = [
    `DepLens project diff: ${report.from?.source || report.from?.name || 'before'} -> ${report.to?.source || report.to?.name || 'after'}`,
    `Changed packages: ${report.summary.total}`,
    `Breaking packages: ${report.summary.breakingPackages || 0}`,
  ];
  for (const change of report.changes || []) {
    const breaking = Number(change.api?.summary?.breaking || 0);
    const marker =
      breaking > 0 ? 'BREAKING' : change.error ? 'ERROR' : change.changeType.toUpperCase();
    lines.push(
      `  ${marker} ${change.package}: ${change.fromVersion || 'absent'} -> ${change.toVersion || 'absent'}${breaking ? ` (${breaking} breaking)` : ''}`
    );
  }
  return lines.join('\n');
}
