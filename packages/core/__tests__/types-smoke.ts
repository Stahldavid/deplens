import {
  findChangelog,
  findChangelogRemote,
  createProjectBaseline,
  createProjectSnapshot,
  evaluateProjectPolicy,
  getOutputSchema,
  migrateCache,
  parseChangelogFile,
  parseChangelogString,
  parseDtsFile,
  pruneCache,
  runDiff,
  runInspect,
  runProjectCheck,
  runProjectDiff,
  type InspectResult,
  type ParsedChangelog,
  type ProjectDiffReport,
  type ProjectSnapshot,
} from '@deplens/core';

async function verifyPublicTypes() {
  const inspection: InspectResult = await runInspect({
    target: 'zod',
    format: 'object',
    runtime: false,
  });
  const text: string = await runInspect({ target: 'zod', format: 'json' });
  const diff: Record<string, unknown> = await runDiff({
    package: 'zod',
    from: '3.22.0',
    to: '3.23.0',
  });
  const declarations = parseDtsFile('index.d.ts');
  const changelogPath: string | null = findChangelog('.');
  const remoteChangelog: string | null = await findChangelogRemote('zod', '4.3.6');
  const parsed: ParsedChangelog = parseChangelogString('## 1.0.0');
  const parsedFile: ParsedChangelog = parseChangelogFile('CHANGELOG.md');
  const migration = migrateCache({ dryRun: true });
  const prune = pruneCache({
    dryRun: true,
    maxAgeDays: 30,
    maxEntries: 100,
    maxSizeBytes: 2 * 1024 ** 3,
  });
  const snapshot: ProjectSnapshot = createProjectSnapshot({
    lockfileVersion: 3,
    packages: { '': { name: 'demo' } },
  });
  const baseline = createProjectBaseline(snapshot);
  const projectDiff: ProjectDiffReport = await runProjectDiff({
    from: snapshot,
    to: snapshot,
    analyze: false,
    detail: 'compact',
  });
  const policy = evaluateProjectPolicy(projectDiff, { failOn: 'breaking' });
  const check = await runProjectCheck({
    baseline,
    current: snapshot,
    analyze: false,
  });
  const schema = getOutputSchema('project-diff', 1);
  return {
    inspection,
    text,
    diff,
    declarations,
    changelogPath,
    remoteChangelog,
    parsed,
    parsedFile,
    migration,
    prune,
    snapshot,
    baseline,
    projectDiff,
    policy,
    check,
    schema,
  };
}

void verifyPublicTypes;
