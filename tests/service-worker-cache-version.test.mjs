import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serviceWorker = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

test('service worker invalidates the previous shell cache after static UI asset changes', () => {
  assert.match(serviceWorker, /const CACHE_VERSION = "v27";/);
  assert.doesNotMatch(serviceWorker, /const CACHE_VERSION = "v26";/);
});

test('the updated visual override stylesheet remains part of the precached application shell', () => {
  assert.match(serviceWorker, /new URL\("\.\/app-overrides\.css", base\)\.href/);
});
