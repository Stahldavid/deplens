import { parseDtsFile, runDiff, runInspect, type InspectResult } from '@deplens/core';

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
  return { inspection, text, diff, declarations };
}

void verifyPublicTypes;
