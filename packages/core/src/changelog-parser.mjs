/**
 * changelog-parser.mjs - Parse CHANGELOG.md files to extract version notes
 */

import fs from 'fs';
import path from 'path';
import semver from 'semver';

const MAX_CHANGELOG_BYTES = 2 * 1024 * 1024;

/**
 * Common changelog file names
 */
const CHANGELOG_NAMES = [
  'CHANGELOG.md',
  'CHANGELOG',
  'changelog.md',
  'Changelog.md',
  'HISTORY.md',
  'HISTORY',
  'history.md',
  'CHANGES.md',
  'CHANGES',
  'changes.md',
  'NEWS.md',
  'RELEASES.md',
];

/**
 * Find changelog file in package directory
 */
export function findChangelog(packageDir) {
  for (const name of CHANGELOG_NAMES) {
    const fullPath = path.join(packageDir, name);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

/**
 * Try to fetch changelog from CDN (unpkg/jsdelivr) if not found locally.
 * Returns the changelog text or null.
 */
export async function findChangelogRemote(packageName, version, timeoutMs = 10000) {
  if (typeof fetch !== 'function') return null;
  const baseUrls = [
    `https://unpkg.com/${packageName}@${version}`,
    `https://cdn.jsdelivr.net/npm/${packageName}@${version}`,
  ];
  const fetchCandidate = async (base, name) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/${name}`, { signal: controller.signal });
      if (!res.ok) return null;
      const declaredLength = Number(res.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_CHANGELOG_BYTES) return null;
      const text = await res.text();
      return Buffer.byteLength(text) <= MAX_CHANGELOG_BYTES ? text : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };
  for (const base of baseUrls) {
    const results = await Promise.all(CHANGELOG_NAMES.map((name) => fetchCandidate(base, name)));
    const found = results.find(Boolean);
    if (found) return found;
  }
  return null;
}

/**
 * Parse version header patterns
 */
const VERSION_PATTERNS = [
  // ## [1.2.3] - 2024-01-01
  /^##\s*\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:\s*[-–—]\s*(.+))?$/i,
  // ## 1.2.3
  /^##\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s+(.+))?$/i,
  // # Version 1.2.3
  /^#\s*(?:Version\s+)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s+(.+))?$/i,
  // ### 1.2.3
  /^###\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s+(.+))?$/i,
];

/**
 * Categorize changelog entry
 */
function categorizeEntry(line) {
  const lowerLine = line.toLowerCase();

  if (/security|vulnerability|cve/i.test(lowerLine)) {
    return 'security';
  }
  if (/breaking|removed|deprecated/i.test(lowerLine)) {
    return 'breaking';
  }
  if (/fix|bug|patch|resolved|corrected/i.test(lowerLine)) {
    return 'fixed';
  }
  if (/add|new|feature|implement/i.test(lowerLine)) {
    return 'added';
  }
  if (/change|update|improve|enhance|refactor/i.test(lowerLine)) {
    return 'changed';
  }
  return 'other';
}

/**
 * Parse a single changelog entry line
 */
function parseEntryLine(line) {
  // Remove bullet points and clean up
  const cleaned = line
    .replace(/^[\s*\-•·]+/, '')
    .replace(/\[#\d+\].*$/, '') // Remove issue links
    .replace(/\(#\d+\)/, '')
    .replace(/by @[\w-]+/i, '')
    .trim();

  if (!cleaned || cleaned.length < 3) return null;

  return {
    text: cleaned,
    category: categorizeEntry(cleaned),
    raw: line,
  };
}

/**
 * Parse changelog content
 */
export function parseChangelog(content) {
  const lines = content.split('\n');
  const versions = {};
  let currentVersion = null;
  let currentSection = null;

  for (const line of lines) {
    // Check for version header
    let versionMatch = null;
    for (const pattern of VERSION_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        versionMatch = match;
        break;
      }
    }

    if (versionMatch) {
      currentVersion = versionMatch[1];
      const date = versionMatch[2] || null;

      versions[currentVersion] = {
        version: currentVersion,
        date,
        sections: {
          breaking: [],
          added: [],
          changed: [],
          fixed: [],
          security: [],
          other: [],
        },
        raw: [],
      };
      currentSection = null;
      continue;
    }

    if (!currentVersion) continue;

    // Check for section headers (### Added, ### Fixed, etc.)
    const sectionMatch = line.match(
      /^###\s*(Added|Changed|Deprecated|Removed|Fixed|Security|Breaking)/i
    );
    if (sectionMatch) {
      const section = sectionMatch[1].toLowerCase();
      if (section === 'removed' || section === 'deprecated') {
        currentSection = 'breaking';
      } else {
        currentSection = section;
      }
      continue;
    }

    // Parse entry lines
    if (line.match(/^[\s*\-•·]+/)) {
      const entry = parseEntryLine(line);
      if (entry) {
        const section = currentSection || entry.category;
        if (versions[currentVersion].sections[section]) {
          versions[currentVersion].sections[section].push(entry);
        } else {
          versions[currentVersion].sections.other.push(entry);
        }
        versions[currentVersion].raw.push(line);
      }
    }
  }

  return versions;
}

/**
 * Parse changelog file
 */
/**
 * Parse changelog from raw text string
 */
export function parseChangelogString(text) {
  if (text && typeof text === 'object' && text.versions) {
    return text;
  }
  if (typeof text !== 'string') {
    return { versions: {} };
  }
  return {
    versions: parseChangelog(text),
  };
}

/**
 * Parse changelog from file
 */
export function parseChangelogFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { error: 'Changelog not found', versions: {} };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return {
    file: filePath,
    versions: parseChangelog(content),
  };
}

/**
 * Get changelog entries between two versions
 */
export function getChangesBetweenVersions(changelog, fromVersion, toVersion) {
  const versions = changelog.versions || {};
  const versionList = Object.keys(versions);

  // Sort versions (semver-like)
  versionList.sort((a, b) => semver.compare(a, b));

  // Find versions in range
  const fromIndex = versionList.indexOf(fromVersion);
  const toIndex = versionList.indexOf(toVersion);

  if (fromIndex === -1 || toIndex === -1) {
    // Try to find closest versions
    return {
      exact: false,
      versions: [],
      note: `Could not find exact versions. Available: ${versionList.slice(-5).join(', ')}`,
    };
  }

  const ascending = fromIndex < toIndex;
  const inRange = ascending
    ? versionList.slice(fromIndex + 1, toIndex + 1)
    : versionList.slice(toIndex, fromIndex).reverse();

  const combined = {
    breaking: [],
    added: [],
    changed: [],
    fixed: [],
    security: [],
  };

  for (const v of inRange) {
    const vData = versions[v];
    if (!vData) continue;

    for (const [section, entries] of Object.entries(vData.sections)) {
      if (combined[section]) {
        combined[section].push(
          ...entries.map((e) => ({
            ...e,
            version: v,
          }))
        );
      }
    }
  }

  return {
    exact: true,
    direction: ascending ? 'upgrade' : 'downgrade',
    from: fromVersion,
    to: toVersion,
    versionsIncluded: inRange,
    changes: combined,
    summary: {
      breaking: combined.breaking.length,
      added: combined.added.length,
      changed: combined.changed.length,
      fixed: combined.fixed.length,
      security: combined.security.length,
    },
  };
}

/**
 * Format changelog diff as text
 */
export function formatChangelogDiff(changelogDiff, options = {}) {
  const { maxPerSection = 5 } = options;
  const lines = [];

  if (!changelogDiff.exact) {
    lines.push(`⚠️  ${changelogDiff.note}`);
    return lines.join('\n');
  }

  lines.push(`📜 Changelog: ${changelogDiff.from} → ${changelogDiff.to}`);
  lines.push(`   Versions included: ${changelogDiff.versionsIncluded.join(', ')}`);
  lines.push('');

  const sections = [
    { key: 'breaking', icon: '🔴', title: 'Breaking Changes' },
    { key: 'added', icon: '🟢', title: 'Added' },
    { key: 'changed', icon: '🟡', title: 'Changed' },
    { key: 'fixed', icon: '🔧', title: 'Fixed' },
    { key: 'security', icon: '🔒', title: 'Security' },
  ];

  for (const { key, icon, title } of sections) {
    const entries = changelogDiff.changes[key] || [];
    if (entries.length === 0) continue;

    lines.push(`${icon} ${title} (${entries.length}):`);
    const shown = entries.slice(0, maxPerSection);
    for (const entry of shown) {
      lines.push(`   • ${entry.text} (${entry.version})`);
    }
    if (entries.length > maxPerSection) {
      lines.push(`   ... and ${entries.length - maxPerSection} more`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export default {
  findChangelog,
  parseChangelog,
  parseChangelogFile,
  getChangesBetweenVersions,
  formatChangelogDiff,
};
