import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import updater from '../modules/app-updater.js';

test('compares numeric release components rather than lexical strings', () => {
  assert.equal(updater.compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(updater.compareVersions('2026.11.12.2', '2026.11.12.1'), 1);
  assert.equal(updater.compareVersions('2.0', '2.0.0'), 0);
  assert.equal(updater.compareVersions('1.2.0', '1.2.1'), -1);
});

test('page version and public release metadata stay in sync', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const metadata = JSON.parse(await readFile(new URL('../version.json', import.meta.url), 'utf8'));
  const pageVersion = html.match(/<meta name="app-version" content="([^"]+)">/);
  assert.ok(pageVersion);
  assert.equal(pageVersion[1], metadata.version);
});

test('service worker activation requires explicit user approval', async () => {
  const source = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.ok(source.includes('event.data.type === "SKIP_WAITING"'));
  assert.ok(!source.includes('await self.skipWaiting();'));
  assert.ok(source.includes('const CACHE_VERSION = "v47";'));
});

test('updater start is idempotent and dispose releases listeners and polling', async () => {
  const listeners = new Map();
  const removed = [];
  const cleared = [];
  let fetchCount = 0;
  let intervalCount = 0;
  const win = {
    location: { protocol: 'http:', reload() {} },
    addEventListener(name, handler) { listeners.set('window:' + name, handler); },
    removeEventListener(name, handler) { removed.push('window:' + name); if (listeners.get('window:' + name) === handler) listeners.delete('window:' + name); },
    setInterval() { intervalCount += 1; return 41; },
    clearInterval(id) { cleared.push(id); },
    setTimeout,
    clearTimeout,
  };
  const doc = {
    baseURI: 'https://example.test/app/',
    visibilityState: 'hidden',
    querySelector() { return { content: '1.0.0' }; },
    addEventListener(name, handler) { listeners.set('document:' + name, handler); },
    removeEventListener(name, handler) { removed.push('document:' + name); if (listeners.get('document:' + name) === handler) listeners.delete('document:' + name); },
  };
  const instance = updater.create({ window: win, document: doc, fetch: async () => {
    fetchCount += 1;
    return { ok: true, json: async () => ({ version: '1.0.0' }) };
  } });
  await Promise.all([instance.start(), instance.start()]);
  assert.equal(fetchCount, 1);
  assert.equal(intervalCount, 1);
  assert.equal(instance.dispose(), true);
  assert.equal(instance.dispose(), false);
  assert.deepEqual(cleared, [41]);
  assert.deepEqual(removed.sort(), ['document:visibilitychange', 'window:focus']);
  assert.equal(listeners.size, 0);
});
