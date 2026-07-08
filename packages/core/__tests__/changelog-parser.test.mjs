import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  getChangesBetweenVersions,
  parseChangelogFile,
  parseChangelogString,
} from '../src/changelog-parser.mjs';

describe('changelog parser', () => {
  it('accepts parsed changelog file results without reparsing them as text', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-changelog-'));
    try {
      const changelogPath = path.join(root, 'CHANGELOG.md');
      writeFileSync(
        changelogPath,
        [
          '## 1.1.0',
          '',
          '### Added',
          '- New public API',
          '',
          '## 1.0.0',
          '',
          '- Initial release',
        ].join('\n')
      );

      const parsed = parseChangelogString(parseChangelogFile(changelogPath));
      const diff = getChangesBetweenVersions(parsed, '1.0.0', '1.1.0');

      expect(diff.exact).toBe(true);
      expect(diff.summary.added).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
