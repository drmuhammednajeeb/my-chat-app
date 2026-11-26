import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('app-overrides.css has no repeated identical rule blocks', async () => {
  const css = await readFile(new URL('../app-overrides.css', import.meta.url), 'utf8');
  const blocks = new Map();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    if (selector.startsWith('@')) continue;
    const declarations = match[2].trim().replace(/\s+/g, ' ');
    const key = selector + '{' + declarations + '}';
    blocks.set(key, (blocks.get(key) || 0) + 1);
  }
  const duplicates = [...blocks].filter(([, count]) => count > 1).map(([key]) => key);
  assert.deepEqual(duplicates, [], 'identical CSS rules should not be repeated');
});
