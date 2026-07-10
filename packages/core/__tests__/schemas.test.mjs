import { describe, expect, it } from 'vitest';
import { OUTPUT_SCHEMAS, getOutputSchema } from '../src/schemas.mjs';

describe('public output schemas', () => {
  it('publishes versioned schemas for every machine-readable workflow', () => {
    expect(Object.keys(OUTPUT_SCHEMAS).sort()).toEqual([
      'baseline-v1',
      'cache-clear-v1',
      'cache-migrate-v1',
      'cache-pin-v1',
      'cache-prune-v1',
      'cache-stats-v1',
      'diff-v2',
      'doctor-v1',
      'inspect-v2',
      'policy-v1',
      'project-diff-v1',
      'project-snapshot-v1',
    ]);
    expect(getOutputSchema('diff', 2).$id).toContain('diff/v2');
    expect(getOutputSchema('doctor', 1).$id).toContain('doctor/v1');
    expect(getOutputSchema('cache-stats', 1).$id).toContain('cache/stats/v1');
  });
});
