import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const serverPath = path.resolve(here, '..', 'bin', 'deplens-mcp.js');

describe('DepLens MCP server', () => {
  let client;

  beforeEach(async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      cwd: repoRoot,
      stderr: 'pipe',
    });
    client = new Client({ name: 'deplens-test-client', version: '1.0.0' });
    await client.connect(transport);
  });

  afterEach(async () => {
    await client?.close();
  });

  it('returns a valid structured inspect payload without runtime execution', async () => {
    const result = await client.callTool({
      name: 'deplens_inspect',
      arguments: { target: 'zod', filter: 'ZodString', runtime: false, format: 'object' },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.package).toBe('zod');
    expect(result.structuredContent.sourceAnalysis).toBeNull();
    expect(result.structuredContent.languageAnalysis).toBeNull();
  });

  it('advertises project, policy, doctor, and version workflows', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'deplens_inspect',
        'deplens_diff',
        'deplens_doctor',
        'deplens_project_diff',
        'deplens_check',
        'deplens_versions',
      ])
    );
  });

  it('runs doctor and project lockfile diff as structured tools', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-mcp-project-'));
    try {
      const before = path.join(root, 'before.json');
      const after = path.join(root, 'after.json');
      const lock = (version) => ({
        name: 'mcp-project',
        lockfileVersion: 3,
        packages: {
          '': { name: 'mcp-project', dependencies: { zod: '*' } },
          'node_modules/zod': { version },
        },
      });
      writeFileSync(before, JSON.stringify(lock('3.22.4')));
      writeFileSync(after, JSON.stringify(lock('4.3.6')));

      const doctor = await client.callTool({
        name: 'deplens_doctor',
        arguments: { target: 'zod', rootDir: repoRoot, runtime: false, format: 'object' },
      });
      const project = await client.callTool({
        name: 'deplens_project_diff',
        arguments: { from: before, to: after, rootDir: root, analyze: false, format: 'object' },
      });

      expect(doctor.isError).not.toBe(true);
      expect(doctor.structuredContent.package).toBe('zod');
      expect(project.isError).not.toBe(true);
      expect(project.structuredContent.changes[0]).toMatchObject({
        package: 'zod',
        changeType: 'upgraded',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns identical version diffs as successful no-op results', async () => {
    const result = await client.callTool({
      name: 'deplens_diff',
      arguments: { package: 'zod', from: '3.22.0', to: '3.22.0', format: 'object' },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.identicalVersions).toBe(true);
    expect(result.structuredContent.changeCount).toBe(0);
  });

  it('keeps runtime imports opt-in and advertises the side-effect boundary', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'deplens-mcp-static-'));
    try {
      const packageDir = path.join(root, 'node_modules', 'side-effect-pkg');
      const marker = path.join(root, 'executed.txt');
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(packageDir, 'package.json'),
        JSON.stringify({
          name: 'side-effect-pkg',
          version: '1.0.0',
          type: 'module',
          main: 'index.js',
          types: 'index.d.ts',
        })
      );
      writeFileSync(
        path.join(packageDir, 'index.js'),
        `import { writeFileSync } from 'fs'; writeFileSync(${JSON.stringify(marker)}, 'ran'); export const value = 1;`
      );
      writeFileSync(path.join(packageDir, 'index.d.ts'), 'export const value: number;\n');

      const tools = await client.listTools();
      const inspectTool = tools.tools.find((tool) => tool.name === 'deplens_inspect');
      const result = await client.callTool({
        name: 'deplens_inspect',
        arguments: { target: 'side-effect-pkg', rootDir: root, format: 'object' },
      });

      expect(inspectTool.annotations.readOnlyHint).toBe(false);
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.staticExports.names).toContain('value');
      expect(() => readFileSync(marker, 'utf8')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
