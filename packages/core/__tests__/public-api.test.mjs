import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import * as publicApi from '../src/index.mjs';
import { parseDtsFile } from '../src/parse-dts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('public API declarations', () => {
  it('declares every JavaScript export in index.d.ts', () => {
    const declarations = parseDtsFile(path.resolve(here, '..', 'src', 'index.d.ts'));
    const declaredNames = new Set(
      ['functions', 'interfaces', 'types', 'classes', 'enums', 'namespaces', 'variables'].flatMap(
        (category) => Object.keys(declarations?.[category] || {})
      )
    );
    const missing = Object.keys(publicApi).filter((name) => !declaredNames.has(name));

    expect(missing).toEqual([]);
  });
});
