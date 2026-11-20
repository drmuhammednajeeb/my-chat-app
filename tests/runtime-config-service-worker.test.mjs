import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

function createHarness(networkFetch) {
  const listeners = {};
  const stores = new Map();
  const caches = {
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        match: async request => {
          const value = store.get(typeof request === 'string' ? request : request.url);
          return value ? value.clone() : undefined;
        },
        put: async (request, response) => {
          store.set(typeof request === 'string' ? request : request.url, response.clone());
        },
        addAll: async () => {}
      };
    },
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name)
  };
  const self = {
    location: { origin: 'https://app.example' },
    registration: { scope: 'https://app.example/' },
    clients: { claim: async () => {} },
    addEventListener: (name, callback) => { listeners[name] = callback; },
    skipWaiting: async () => {}
  };
  runInNewContext(source, { self, caches, fetch: (...args) => networkFetch(...args), URL, Response, atob, Promise, Set, console });
  return {
    stores,
    async requestRuntimeConfig() {
      let pending;
      listeners.fetch({
        request: { method: 'GET', url: 'https://app.example/api/runtime-config', mode: 'cors' },
        respondWith: promise => { pending = promise; }
      });
      assert.ok(pending, 'runtime config request must be handled by the service worker');
      return pending;
    }
  };
}

const publicConfig = {
  environment: 'preview',
  supabaseUrl: 'https://staging-project.supabase.co',
  supabaseAnonKey: 'header.' + Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url') + '.signature'
};
const publicConfigScript = 'window.BIZMIND_RUNTIME_CONFIG = ' + JSON.stringify(publicConfig) + ';';

test('runtime config uses network-first and falls back to the origin-scoped cached public config offline', async () => {
  let online = true;
  const harness = createHarness(async () => {
    if (!online) throw new TypeError('Network unavailable');
    return new Response(publicConfigScript, { status: 200, headers: { 'Content-Type': 'application/javascript' } });
  });

  const first = await harness.requestRuntimeConfig();
  assert.equal(first.status, 200);
  assert.equal(await first.text(), publicConfigScript);
  online = false;

  const offline = await harness.requestRuntimeConfig();
  assert.equal(offline.status, 200);
  assert.equal(await offline.text(), publicConfigScript);
  assert.ok([...harness.stores.keys()].some(key => key.includes('runtime-config-v38')));
});

test('runtime config HTTP errors are not replaced with stale cached configuration', async () => {
  let response = new Response(publicConfigScript, { status: 200 });
  const harness = createHarness(async () => response);
  await harness.requestRuntimeConfig();
  response = new Response('window.BIZMIND_RUNTIME_CONFIG = {"error":"misconfigured"};', { status: 503 });

  const failed = await harness.requestRuntimeConfig();
  assert.equal(failed.status, 503);
  assert.match(await failed.text(), /misconfigured/);
});

test('error and secret runtime configuration responses are never cached for offline use', async () => {
  let online = true;
  let body = 'window.BIZMIND_RUNTIME_CONFIG = {"error":"invalid"};';
  const harness = createHarness(async () => {
    if (!online) throw new TypeError('Network unavailable');
    return new Response(body, { status: 200 });
  });

  await harness.requestRuntimeConfig();
  online = false;
  const offlineAfterError = await harness.requestRuntimeConfig();
  assert.equal(offlineAfterError.status, 503);
  assert.doesNotMatch(await offlineAfterError.text(), /invalid/);

  online = true;
  body = 'window.BIZMIND_RUNTIME_CONFIG = ' + JSON.stringify({
    ...publicConfig,
    supabaseAnonKey: 'sb_secret_do_not_cache'
  }) + ';';
  await harness.requestRuntimeConfig();
  online = false;
  const offlineAfterSecret = await harness.requestRuntimeConfig();
  assert.equal(offlineAfterSecret.status, 503);
  assert.doesNotMatch(await offlineAfterSecret.text(), /sb_secret_/);
});
