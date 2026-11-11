import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const [html, harness, workflow] = await Promise.all([
  readFile(new URL('../../../index.html', import.meta.url), 'utf8'),
  readFile(new URL('./local-chat-e2e.browser.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../../../.github/workflows/disposable-local-supabase-runtime.yml', import.meta.url), 'utf8')
]);

test('browser E2E targets the current inline bootstrap, not the removed legacy bootstrap file', () => {
  assert.match(html, /const SUPABASE_URL=/);
  assert.match(html, /const SUPABASE_ANON_KEY=/);
  assert.doesNotMatch(harness, /js\/00-bootstrap\.js/);
  assert.doesNotMatch(harness, /bootstrapPath/);
});

test('browser E2E pins the same real UMD bundle loaded by the application', () => {
  const script = html.match(/<script src="([^"]*supabase[^"]*)"\s*><\/script>/);
  const harnessSdk = harness.match(/const SDK_URL = '([^']+)'/);
  assert.ok(script, 'application must declare a Supabase UMD script');
  assert.ok(harnessSdk, 'harness must pin its intercepted Supabase UMD URL');
  assert.equal(script[1], harnessSdk[1]);
  assert.match(script[1], /@2\.49\.1\/dist\/umd\/supabase\.js$/);
  assert.doesNotMatch(script[1], /supabase\.min\.js$/);
});

test('browser E2E patches only an in-memory HTML copy and confines API/admin access to loopback', () => {
  assert.match(harness, /const testHtml = originalHtml/);
  assert.match(harness, /assertLoopbackUrl\(apiUrl, 54321, 'http:'\)/);
  assert.match(harness, /127\.0\.0\.1/);
  assert.match(harness, /serviceKey/);
  assert.doesNotMatch(harness, /writeFileSync|writeFile\(/);
  assert.match(harness, /Authorization: 'Bearer ' \+ serviceKey/);
  assert.match(harness, /LOCAL_CHAT_BROWSER_E2E_STEP=verify disposable loopback configuration/);
});

test('browser E2E covers two isolated sessions, messaging, reconnect, and membership revocation', () => {
  for (const marker of [
    'browser.newContext()',
    'authenticate two independent browser contexts',
    'send and receive message through application UI and Realtime',
    'offline reconciliation and reconnect',
    'revoke membership and verify server-side isolation',
    'revoked browser context must not receive later Realtime messages',
    'LOCAL_CHAT_BROWSER_E2E=PASSED'
  ]) assert.ok(harness.includes(marker), 'missing E2E contract: ' + marker);
});

test('disposable runtime workflow installs pinned browser dependencies and invokes the real E2E runner', () => {
  assert.match(workflow, /playwright@1\.56\.1/);
  assert.match(workflow, /@supabase\/supabase-js@2\.49\.1/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /LOCAL_SYNTHETIC_AUTH_PASSWORD=/);
  assert.match(workflow, /LOCAL_SYNTHETIC_AUTH_USERS_FILE=/);
  assert.match(workflow, /LOCAL_SYNTHETIC_AUTH_USERS_JSON=.*cat/);
  assert.match(workflow, /node tests\/staging\/local-supabase\/local-chat-e2e\.browser\.mjs/);
  assert.match(workflow, /rebuild\/clean-core-20261111/);
  assert.match(workflow, /group: disposable-local-supabase-runtime-repository-wide/);
  assert.match(workflow, /RUNTIME_PROJECT_ID: my-chat-app-supabase-runtime-\\$\\{\\{ github\\.run_id \\}\\}/);
  assert.match(workflow, /project_id =/);
});
