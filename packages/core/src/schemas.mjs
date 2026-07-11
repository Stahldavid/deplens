const schema = (id, required, properties) =>
  Object.freeze({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://deplens.dev/schemas/${id}`,
    type: 'object',
    required,
    properties,
    additionalProperties: true,
  });

const version = (value) => ({ const: value });
const kind = (value) => ({ const: value });

export const OUTPUT_SCHEMAS = Object.freeze({
  'inspect-v2': schema('inspect/v2', ['schemaVersion', 'kind', 'detailLevel'], {
    schemaVersion: version(2),
    kind: kind('deplens-inspect'),
    detailLevel: { enum: ['compact', 'full'] },
    package: { type: ['string', 'null'] },
    symbols: { type: 'array' },
    pagination: { type: 'object' },
  }),
  'diff-v2': schema('diff/v2', ['schemaVersion', 'package'], {
    schemaVersion: version(2),
    package: { type: ['string', 'null'] },
    summary: { type: ['object', 'null'] },
    changes: { type: 'array' },
  }),
  'doctor-v1': schema('doctor/v1', ['schemaVersion', 'kind', 'status', 'checks'], {
    schemaVersion: version(1),
    kind: kind('deplens-doctor'),
    status: { enum: ['ok', 'issues'] },
    checks: { type: 'array' },
  }),
  'cache-stats-v1': schema('cache/stats/v1', ['schemaVersion', 'kind', 'entries'], {
    schemaVersion: version(1),
    kind: kind('deplens-cache-stats'),
    entries: { type: 'number' },
    pagination: { type: 'object' },
  }),
  'cache-clear-v1': schema('cache/clear/v1', ['schemaVersion', 'kind', 'removed'], {
    schemaVersion: version(1),
    kind: kind('deplens-cache-clear'),
    removed: { type: 'number' },
  }),
  'cache-pin-v1': schema('cache/pin/v1', ['schemaVersion', 'kind', 'package', 'version'], {
    schemaVersion: version(1),
    kind: kind('deplens-cache-pin'),
    package: { type: 'string' },
    version: { type: 'string' },
  }),
  'cache-migrate-v1': schema('cache/migrate/v1', ['schemaVersion', 'kind', 'migrated'], {
    schemaVersion: version(1),
    kind: kind('deplens-cache-migrate'),
    migrated: { type: 'number' },
  }),
  'cache-prune-v1': schema('cache/prune/v1', ['schemaVersion', 'kind', 'removed'], {
    schemaVersion: version(1),
    kind: kind('deplens-cache-prune'),
    removed: { type: 'number' },
    wouldRemove: { type: 'number' },
    candidatesPreview: { type: 'array' },
  }),
  'project-snapshot-v1': schema(
    'project-snapshot/v1',
    ['schemaVersion', 'kind', 'project', 'packages'],
    {
      schemaVersion: version(1),
      kind: kind('deplens-project-snapshot'),
      project: { type: 'object' },
      packages: { type: 'object' },
      instances: { type: 'array' },
    }
  ),
  'project-diff-v1': schema(
    'project-diff/v1',
    ['schemaVersion', 'kind', 'detailLevel', 'summary', 'changes'],
    {
      schemaVersion: version(1),
      kind: kind('deplens-project-diff'),
      detailLevel: { enum: ['compact', 'full'] },
      summary: { type: 'object' },
      changes: { type: 'array' },
    }
  ),
  'baseline-v1': schema('baseline/v1', ['schemaVersion', 'kind', 'snapshot'], {
    schemaVersion: version(1),
    kind: kind('deplens-baseline'),
    snapshot: { type: 'object' },
  }),
  'policy-v1': schema('policy/v1', ['schemaVersion', 'kind', 'passed', 'violations'], {
    schemaVersion: version(1),
    kind: kind('deplens-policy-result'),
    passed: { type: 'boolean' },
    violations: { type: 'array' },
  }),
});

export function getOutputSchema(kindName, schemaVersion) {
  return OUTPUT_SCHEMAS[`${kindName}-v${schemaVersion}`] || null;
}
