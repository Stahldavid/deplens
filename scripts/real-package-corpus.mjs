import { runDiff } from '../packages/core/src/index.mjs';

const cases = [
  ['@posthog/convex', '1.0.6', '2.0.32'],
  ['zod', '3.22.4', '4.3.6'],
  ['@types/react', '18.2.0', '19.1.0'],
  ['@types/express', '4.17.21', '5.0.1'],
  ['typescript', '5.4.5', '5.8.2'],
];

let failed = false;
for (const [packageName, from, to] of cases) {
  const startedAt = performance.now();
  const result = await runDiff({
    package: packageName,
    from,
    to,
    format: 'json',
    runtime: false,
    includeChangelog: false,
    semantic: true,
    maxChanges: 25,
    timeoutMs: 180000,
  });
  const payload = typeof result.output === 'string' ? JSON.parse(result.output) : result;
  const elapsed = Math.round(performance.now() - startedAt);
  const hasSymbols =
    Number(payload.symbols?.fromCount || 0) > 0 || Number(payload.symbols?.toCount || 0) > 0;
  if (payload.error || !hasSymbols) {
    failed = true;
    console.error(
      `FAIL ${packageName} ${from} -> ${to}: ${payload.error || 'analysis returned no symbols'}`
    );
  } else {
    console.log(
      `PASS ${packageName} ${from} -> ${to}: ${payload.changeCount} changes, ${payload.summary?.breaking || 0} breaking (${elapsed}ms)`
    );
  }
}

if (failed) process.exitCode = 1;
