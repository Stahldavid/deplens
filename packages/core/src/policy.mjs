import fs from 'fs';
import path from 'path';
import { createProjectSnapshot, runProjectDiff } from './project-diff.mjs';

const SEVERITY_RANK = { none: 99, breaking: 3, warning: 2, change: 1 };

function readJsonInput(input) {
  if (input && typeof input === 'object') return input;
  if (typeof input !== 'string') throw new TypeError('Expected a JSON object or file path');
  return JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
}

function asSnapshot(input) {
  const value = readJsonInput(input);
  if (value.kind === 'deplens-baseline') return value.snapshot;
  if (value.kind === 'deplens-project-snapshot') return value;
  return createProjectSnapshot(value);
}

export function createProjectBaseline(snapshot, options = {}) {
  return {
    schemaVersion: 1,
    kind: 'deplens-baseline',
    createdAt: options.createdAt || new Date().toISOString(),
    snapshot,
  };
}

function packageSeverity(change) {
  if (Number(change.api?.summary?.breaking || 0) > 0) return 'breaking';
  if (Number(change.api?.summary?.warnings || 0) > 0 || change.error) return 'warning';
  return 'change';
}

function isAllowed(packageName, severity, policy) {
  const rule = policy?.packages?.[packageName];
  return Boolean(rule?.ignore || rule?.allow?.includes(severity));
}

export function evaluateProjectPolicy(report, policy = {}) {
  const failOn = policy.failOn || 'breaking';
  const threshold = SEVERITY_RANK[failOn] ?? SEVERITY_RANK.breaking;
  const violations = [];
  for (const change of report?.changes || []) {
    const severity = packageSeverity(change);
    if (isAllowed(change.package, severity, policy)) continue;
    if ((SEVERITY_RANK[severity] ?? 0) < threshold) continue;
    violations.push({
      package: change.package,
      severity,
      fromVersion: change.fromVersion || null,
      toVersion: change.toVersion || null,
      message:
        severity === 'breaking'
          ? `${change.package} introduces ${change.api.summary.breaking} breaking API change(s)`
          : severity === 'warning'
            ? `${change.package} requires review${change.error ? `: ${change.error}` : ''}`
            : `${change.package} changed from ${change.fromVersion || 'absent'} to ${change.toVersion || 'absent'}`,
    });
  }
  return {
    schemaVersion: 1,
    kind: 'deplens-policy-result',
    passed: violations.length === 0,
    failOn,
    summary: { checked: report?.changes?.length || 0, violations: violations.length },
    violations,
  };
}

export function formatPolicyAsSarif(evaluation) {
  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: 'DepLens',
            informationUri: 'https://github.com/Stahldavid/deplens',
            rules: [
              {
                id: 'deplens/breaking',
                shortDescription: { text: 'Breaking dependency API change' },
              },
              { id: 'deplens/warning', shortDescription: { text: 'Dependency API warning' } },
              { id: 'deplens/change', shortDescription: { text: 'Dependency version change' } },
            ],
          },
        },
        results: (evaluation?.violations || []).map((violation) => ({
          ruleId: `deplens/${violation.severity}`,
          level: violation.severity === 'breaking' ? 'error' : 'warning',
          message: { text: violation.message },
          properties: {
            package: violation.package,
            fromVersion: violation.fromVersion,
            toVersion: violation.toVersion,
          },
        })),
      },
    ],
  };
}

export function loadProjectPolicy(configPath, options = {}) {
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const candidates = configPath
    ? [path.resolve(projectDir, configPath)]
    : [path.join(projectDir, '.deplensrc.json'), path.join(projectDir, 'deplens.config.json')];
  const selected = candidates.find((candidate) => fs.existsSync(candidate));
  if (!selected) return {};
  return JSON.parse(fs.readFileSync(selected, 'utf8'));
}

export async function runProjectCheck(options = {}) {
  const baselineValue = readJsonInput(options.baseline);
  const baseline =
    baselineValue.kind === 'deplens-baseline'
      ? baselineValue
      : createProjectBaseline(asSnapshot(baselineValue));
  const current = asSnapshot(options.current);
  const report = await runProjectDiff({
    ...options,
    from: baseline.snapshot,
    to: current,
  });
  const policy = options.policy || loadProjectPolicy(options.config, options);
  const evaluation = evaluateProjectPolicy(report, policy);
  return { ...evaluation, report, policy };
}

export function formatPolicyText(result) {
  const lines = [
    `DepLens policy: ${result.passed ? 'PASS' : 'FAIL'}`,
    `Checked: ${result.summary.checked}`,
    `Violations: ${result.summary.violations}`,
  ];
  for (const violation of result.violations || []) {
    lines.push(`  ${violation.severity.toUpperCase()} ${violation.message}`);
  }
  return lines.join('\n');
}
