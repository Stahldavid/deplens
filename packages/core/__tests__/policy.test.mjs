import { describe, expect, it } from 'vitest';
import {
  createProjectBaseline,
  evaluateProjectPolicy,
  formatPolicyAsSarif,
  runProjectCheck,
} from '../src/policy.mjs';

const report = {
  schemaVersion: 1,
  kind: 'deplens-project-diff',
  changes: [
    {
      package: 'zod',
      fromVersion: '3.22.4',
      toVersion: '4.3.6',
      direct: true,
      api: { summary: { breaking: 2, warnings: 1, additions: 3, removals: 1 } },
    },
    {
      package: 'safe-package',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      direct: true,
      api: { summary: { breaking: 0, warnings: 0, additions: 1, removals: 0 } },
    },
  ],
};

describe('project policy', () => {
  it('creates a versioned baseline from a project snapshot', () => {
    const baseline = createProjectBaseline({
      schemaVersion: 1,
      kind: 'deplens-project-snapshot',
      project: { name: 'demo' },
      packages: {},
    });

    expect(baseline).toMatchObject({
      schemaVersion: 1,
      kind: 'deplens-baseline',
      snapshot: { kind: 'deplens-project-snapshot' },
    });
  });

  it('fails on configured severity while supporting package exceptions', () => {
    const failed = evaluateProjectPolicy(report, { failOn: 'breaking' });
    const allowed = evaluateProjectPolicy(report, {
      failOn: 'breaking',
      packages: { zod: { allow: ['breaking'] } },
    });

    expect(failed.passed).toBe(false);
    expect(failed.violations[0]).toMatchObject({ package: 'zod', severity: 'breaking' });
    expect(allowed.passed).toBe(true);
  });

  it('emits GitHub-compatible SARIF', () => {
    const evaluation = evaluateProjectPolicy(report, { failOn: 'breaking' });
    const sarif = formatPolicyAsSarif(evaluation);

    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].tool.driver.name).toBe('DepLens');
    expect(sarif.runs[0].results[0]).toMatchObject({ level: 'error', ruleId: 'deplens/breaking' });
  });

  it('runs a baseline-to-current policy check through an injected diff runner', async () => {
    const baseline = createProjectBaseline({
      schemaVersion: 1,
      kind: 'deplens-project-snapshot',
      project: { name: 'demo' },
      packages: {
        zod: { name: 'zod', version: '3.22.4', direct: true, workspaces: [] },
      },
      instances: [],
    });
    const current = {
      schemaVersion: 1,
      kind: 'deplens-project-snapshot',
      project: { name: 'demo' },
      packages: {
        zod: { name: 'zod', version: '4.3.6', direct: true, workspaces: [] },
      },
      instances: [],
    };

    const result = await runProjectCheck({
      baseline,
      current,
      policy: { failOn: 'breaking' },
      diffRunner: async () => ({ summary: { breaking: 1, warnings: 0 } }),
    });

    expect(result.passed).toBe(false);
    expect(result.report.summary.breakingPackages).toBe(1);
  });
});
