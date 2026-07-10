import {
  findChangelog,
  findChangelogRemote,
  migrateCache,
  parseChangelogFile,
  parseChangelogString,
  parseDtsFile,
  pruneCache,
  runDiff,
  runInspect,
  type InspectResult,
  type ParsedChangelog,
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
  const prune = pruneCache({ dryRun: true, maxAgeDays: 30 });
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
  };
}

void verifyPublicTypes;
