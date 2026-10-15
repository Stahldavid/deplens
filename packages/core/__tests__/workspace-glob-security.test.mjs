import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInspect } from '../src/inspect.mjs';

const roots = [];
afterEach(() =>
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }))
);

it.each([
  [['packages/{app,other}'], false],
  [{ packages: ['packages/*'] }, true],
])(
  'resolves a dependency installed only in a selected workspace: %j',
  async (workspaces, symlink) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deplens-workspace-security-'));
    roots.push(root);
    const write = (relative, data) => {
      const dest = path.join(root, relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, typeof data === 'string' ? data : JSON.stringify(data));
    };
    write('package.json', { name: 'workspace-fixture', workspaces });
    write('packages/app/package.json', { name: 'app', dependencies: { 'glob-fixture': '1.0.0' } });
    write('packages/app/node_modules/glob-fixture/package.json', {
      name: 'glob-fixture',
      version: '1.0.0',
      main: 'index.cjs',
      types: 'index.d.ts',
    });
    write('packages/app/node_modules/glob-fixture/index.cjs', 'exports.fixture = () => 1;');
    write(
      'packages/app/node_modules/glob-fixture/index.d.ts',
      'export declare function fixture(): number;'
    );
    if (symlink)
      fs.symlinkSync(path.join(root, 'packages/app'), path.join(root, 'packages/link'), 'dir');
    const result = await runInspect({
      target: 'glob-fixture',
      cwd: root,
      format: 'object',
      runtime: false,
      types: true,
    });
    expect(result.package).toBe('glob-fixture');
    expect(path.resolve(result.pkgDir)).toBe(
      path.join(root, 'packages/app/node_modules/glob-fixture')
    );
  }
);
