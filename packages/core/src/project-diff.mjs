import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import semver from 'semver';
import { parse as parseYaml } from 'yaml';
import { runDiff, serializeDiffForJson } from './diff.mjs';
import { createOperationSignal, errorPayload, throwIfAborted } from './errors.mjs';
import { createSafeRecord, setSafeRecord } from './safe-record.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_PROJECT_CHANGES_PER_PACKAGE = 10;
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
  const reference = raw.split('(')[0];
  if (!reference.startsWith('npm:')) return reference || null;

  const aliasTarget = reference.slice(4);
  const delimiter = aliasTarget.startsWith('@')
    ? aliasTarget.indexOf('@', aliasTarget.indexOf('/') + 1)
    : aliasTarget.indexOf('@');
  return delimiter > 0 ? aliasTarget.slice(delimiter + 1) || null : null;
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

function summarizeProjectChanges(changes) {
  const count = (type) => changes.filter((change) => change.changeType === type).length;
  return {
    total: changes.length,
    added: count('added'),
    removed: count('removed'),
    upgraded: count('upgraded'),
    downgraded: count('downgraded'),
  };
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
  return {
    schemaVersion: 1,
    kind: 'deplens-project-diff',
    detailLevel: 'compact',
    from: from?.project || null,
    to: to?.project || null,
    summary: summarizeProjectChanges(changes),
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

function compactProjectApi(api, options = {}) {
  let payload = api;
  if (!payload?.summary && typeof payload?.output === 'string') {
    try {
      payload = JSON.parse(payload.output);
    } catch {
      payload = api;
    }
  }
  if (payload?.error) {
    return {
      package: payload.package || null,
      error: payload.error,
      ...(payload.errorInfo ? { errorInfo: payload.errorInfo } : {}),
      ...(payload.warnings?.length ? { warnings: payload.warnings } : {}),
    };
  }
  const allChanges = Array.isArray(payload?.changes) ? payload.changes : [];
  const parsedCursor = Number.parseInt(String(options.cursor || '0'), 10);
  const offset = Number.isFinite(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;
  const maxChanges = Math.max(1, Number(options.maxChanges) || DEFAULT_PROJECT_CHANGES_PER_PACKAGE);
  const upstreamPagination = options.repaginate ? null : payload?.pagination;
  const changes = upstreamPagination ? allChanges : allChanges.slice(offset, offset + maxChanges);
  const total = Number.isFinite(Number(upstreamPagination?.total))
    ? Number(upstreamPagination.total)
    : Number.isFinite(Number(payload?.changeCount))
      ? Number(payload.changeCount)
      : allChanges.length;
  const pageOffset = Number.isFinite(Number(upstreamPagination?.offset))
    ? Number(upstreamPagination.offset)
    : offset;
  const returned = changes.length;
  const nextCursor =
    upstreamPagination?.nextCursor ??
    (pageOffset + returned < total ? String(pageOffset + returned) : null);
  return {
    package: payload?.package || null,
    summary: payload?.summary || null,
    changes,
    semanticCompatibility: payload?.semanticCompatibility || null,
    pagination: {
      total,
      offset: pageOffset,
      returned,
      nextCursor,
      truncated: returned < total,
    },
    ...(payload?.sourceComparison ? { sourceComparison: payload.sourceComparison } : {}),
  };
}

function projectApiSnapshot(api) {
  let payload = api;
  if (api?.diff) {
    payload = serializeDiffForJson(api.diff, {
      packageName: api.package,
      maxChanges: Number.MAX_SAFE_INTEGER,
    });
  } else if (!payload?.summary && typeof payload?.output === 'string') {
    try {
      payload = JSON.parse(payload.output);
    } catch {
      return null;
    }
  }
  if (payload?.error || !Array.isArray(payload?.changes)) return null;
  const total = Number(
    payload?.pagination?.total ?? payload?.changeCount ?? payload.changes.length
  );
  if (!Number.isFinite(total) || payload.changes.length < total) return null;
  return {
    package: payload.package || null,
    summary: payload.summary || null,
    changes: payload.changes,
    semanticCompatibility: payload.semanticCompatibility || null,
    ...(payload.sourceComparison ? { sourceComparison: payload.sourceComparison } : {}),
  };
}

function projectSnapshotFingerprint(from, to, options) {
  const packageVersions = (snapshot) =>
    Object.entries(snapshot?.packages || {})
      .map(([name, value]) => [name, value?.version || null])
      .sort(([left], [right]) => left.localeCompare(right));
  const value = JSON.stringify({
    from: packageVersions(from),
    to: packageVersions(to),
    includeSource: Boolean(options.includeSource),
    runtime: Boolean(options.runtime),
    semantic: options.semantic !== false,
    conditions: [...(options.conditions || [])].sort(),
  });
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readProjectAnalysisSnapshot(filePath, fingerprint) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const snapshot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (
      snapshot?.schemaVersion !== 1 ||
      snapshot?.kind !== 'deplens-project-analysis-snapshot' ||
      snapshot?.fingerprint !== fingerprint ||
      !snapshot?.packages
    ) {
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function writeProjectAnalysisSnapshot(filePath, snapshot) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(temporary, JSON.stringify(snapshot, null, 2));
  fs.rmSync(resolved, { force: true });
  fs.renameSync(temporary, resolved);
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
  report.detailLevel = options.detail === 'full' ? 'full' : 'compact';
  if (!options.includeTransitive) {
    report.changes = report.changes.filter((change) => change.direct);
    report.summary = summarizeProjectChanges(report.changes);
  }
  const packageOnly = new Set(
    (Array.isArray(options.packageOnly)
      ? options.packageOnly
      : options.packageOnly
        ? [options.packageOnly]
        : []
    )
      .flatMap((value) => String(value).split(','))
      .map((value) => value.trim())
      .filter(Boolean)
  );
  if (packageOnly.size > 0) {
    const available = new Set(report.changes.map((change) => change.package));
    report.changes = report.changes.filter((change) => packageOnly.has(change.package));
    report.summary = summarizeProjectChanges(report.changes);
    const missing = [...packageOnly].filter((packageName) => !available.has(packageName));
    if (missing.length > 0)
      report.warnings.push(`Requested packages not changed: ${missing.join(', ')}`);
  }
  const diffRunner = options.diffRunner || defaultDiffRunner;
  const maxChangesPerPackage = Math.max(
    1,
    Number(options.maxChangesPerPackage ?? options.maxChanges) ||
      DEFAULT_PROJECT_CHANGES_PER_PACKAGE
  );
  const candidates = (options.analyze === false ? [] : report.changes).filter(
    (change) =>
      change.fromVersion && change.toVersion && (options.includeTransitive || change.direct)
  );
  const snapshotPath =
    options.detail === 'full' || !options.projectSnapshot
      ? null
      : path.resolve(options.projectDir || process.cwd(), options.projectSnapshot);
  if (options.detail === 'full' && options.projectSnapshot) {
    report.warnings.push('Project snapshots are available only with compact detail');
  }
  const fingerprint = snapshotPath ? projectSnapshotFingerprint(from, to, options) : null;
  const storedSnapshot = readProjectAnalysisSnapshot(snapshotPath, fingerprint);
  const snapshotPackages = createSafeRecord();
  for (const [packageName, value] of Object.entries(storedSnapshot?.packages || {})) {
    setSafeRecord(snapshotPackages, packageName, value);
  }
  let reusedPackages = 0;
  let writtenPackages = 0;
  const operation = createOperationSignal(options.signal, options.timeoutMs, 'project-diff');
  let completed = 0;
  try {
    await mapConcurrent(
      candidates,
      Math.max(1, Number(options.concurrency) || 4),
      async (change) => {
        throwIfAborted(operation.signal, 'project-diff');
        try {
          const cursor = Object.hasOwn(options.packageCursors || {}, change.package)
            ? String(options.packageCursors[change.package])
            : '0';
          const cachedApi = Object.hasOwn(snapshotPackages, change.package)
            ? snapshotPackages[change.package]
            : null;
          if (
            cachedApi?.fromVersion === change.fromVersion &&
            cachedApi?.toVersion === change.toVersion
          ) {
            change.api = compactProjectApi(cachedApi.api, {
              maxChanges: maxChangesPerPackage,
              cursor,
              repaginate: true,
            });
            reusedPackages += 1;
            return;
          }
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
            cacheDir: options.cacheDir,
            ...(options.detail === 'full' ? {} : { maxChanges: maxChangesPerPackage, cursor }),
          });
          change.api =
            options.detail === 'full'
              ? api
              : compactProjectApi(api, { maxChanges: maxChangesPerPackage, cursor });
          if (snapshotPath) {
            const snapshotApi = projectApiSnapshot(api);
            if (snapshotApi) {
              setSafeRecord(snapshotPackages, change.package, {
                fromVersion: change.fromVersion,
                toVersion: change.toVersion,
                api: snapshotApi,
              });
              writtenPackages += 1;
            }
          }
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
  if (snapshotPath) {
    if (writtenPackages > 0) {
      writeProjectAnalysisSnapshot(snapshotPath, {
        schemaVersion: 1,
        kind: 'deplens-project-analysis-snapshot',
        fingerprint,
        createdAt: new Date().toISOString(),
        packages: snapshotPackages,
      });
    }
    report.snapshot = {
      path: snapshotPath,
      fingerprint,
      reusedPackages,
      writtenPackages,
    };
  }
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
