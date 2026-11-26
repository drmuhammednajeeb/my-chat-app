import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('app-overrides.css does not contain repeated reduced-motion transition reset', async () => {
  const css = await readFile(new URL('../app-overrides.css', import.meta.url), 'utf8');
  const block = /@media\(prefers-reduced-motion:reduce\)\{\s*html,body,#app,#auth,.sidebar,.chat,.chat-head,.messages,.composer-wrap,.composer,\s*\.profile,.auth-card,.group-dialog,.notification-panel,.team-panel,.chat-search-panel,\s*\.conversation,.notification-item,.chat-search-result\{transition:none!important\}\s*\}/g;
  assert.equal([...css.matchAll(block)].length, 1, 'the identical reduced-motion reset should appear only once');
});
