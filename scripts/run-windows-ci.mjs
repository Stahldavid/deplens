import { readdirSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitestBin = path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');
const coreDir = path.join(repoRoot, 'packages', 'core');

function run(label, cwd, args) {
  const grouped = process.env.GITHUB_ACTIONS === 'true';
  if (grouped) console.log(`::group::${label}`);
  else console.log(`\n## ${label}`);

  const result = spawnSync(process.execPath, [vitestBin, ...args], {
    cwd,
    stdio: 'inherit',
    timeout: 120_000,
  });

  if (grouped) console.log('::endgroup::');
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

const coreTests = readdirSync(path.join(coreDir, '__tests__'))
  .filter((name) => /\.(?:test|spec)\.(?:js|mjs|cjs|ts)$/.test(name))
  .sort();

for (const testFile of coreTests) {
  run(`core: ${testFile}`, coreDir, ['run', path.join('__tests__', testFile)]);
}

run('cli tests', path.join(repoRoot, 'packages', 'cli'), ['run']);

const smoke = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, 'packages', 'cli', 'bin', 'deplens.js'),
    'zod',
    '--types',
    '--filter',
    'ZodString',
  ],
  { cwd: repoRoot, stdio: 'inherit', timeout: 30_000 }
);
if (smoke.error) throw smoke.error;
if (smoke.status !== 0) process.exit(smoke.status || 1);

run('mcp tests', path.join(repoRoot, 'packages', 'mcp'), ['run']);
