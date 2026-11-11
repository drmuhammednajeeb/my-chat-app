#!/usr/bin/env node
// Real browser E2E against a disposable loopback-only Supabase stack.
// The production HTML is read and patched in memory; repository source is never rewritten.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HTML_PATH = path.join(ROOT, 'index.html');
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/dist/umd/supabase.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) {
  console.error('LOCAL_CHAT_BROWSER_E2E_FAILED=' + message);
  process.exitCode = 1;
  throw new Error(message);
}
function required(name) {
  const value = process.env[name];
  if (!value) fail(name + ' is required');
  return value;
}
function assertLoopbackUrl(raw, expectedPort, protocol) {
  let url;
  try { url = new URL(raw); } catch { fail('invalid URL for ' + protocol + ':' + expectedPort); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== protocol
    || !['127.0.0.1', 'localhost', '::1'].includes(host)
    || url.port !== String(expectedPort)
    || url.pathname !== '/'
    || url.username || url.password || url.search || url.hash) {
    fail('refusing non-disposable target; expected ' + protocol + '//loopback:' + expectedPort + '/');
  }
  return url;
}
const apiUrl = required('LOCAL_SUPABASE_URL');
assertLoopbackUrl(apiUrl, 54321, 'http:');
const anonKey = required('LOCAL_SUPABASE_ANON_KEY');
const serviceKey = required('LOCAL_SUPABASE_SERVICE_ROLE_KEY');
const password = required('LOCAL_SYNTHETIC_AUTH_PASSWORD');
if (password.length < 32) fail('synthetic Auth password is too short');
let synthetic;
try { synthetic = JSON.parse(required('LOCAL_SYNTHETIC_AUTH_USERS_JSON')); }
catch { fail('LOCAL_SYNTHETIC_AUTH_USERS_JSON is invalid'); }
for (const key of ['direct_a', 'direct_b']) {
  if (!UUID.test(synthetic?.[key] || '')) fail('missing Auth-generated synthetic user id: ' + key);
}
if (!fs.existsSync(HTML_PATH)) fail('current application entry point index.html is missing');
const originalHtml = fs.readFileSync(HTML_PATH, 'utf8');
if (!originalHtml.includes(SDK_URL)) fail('pinned Supabase UMD script reference changed; review SDK loading before updating this harness');
if ((originalHtml.match(/const SUPABASE_URL=/g) || []).length !== 1
  || (originalHtml.match(/const SUPABASE_ANON_KEY=/g) || []).length !== 1) {
  fail('expected exactly one inline Supabase URL and publishable-key declaration');
}
const testHtml = originalHtml
  .replace(/const SUPABASE_URL='[^']*';/, 'const SUPABASE_URL=' + JSON.stringify(apiUrl) + ';')
  .replace(/const SUPABASE_ANON_KEY='[^']*';/, 'const SUPABASE_ANON_KEY=' + JSON.stringify(anonKey) + ';');
if (testHtml === originalHtml || testHtml.includes('lvkeohpuucuklagvwpnq.supabase.co')) {
  fail('in-memory staging configuration replacement did not complete');
}

const sdkCandidates = [
  path.join(ROOT, 'node_modules/@supabase/supabase-js/dist/umd/supabase.min.js'),
  path.join(ROOT, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js')
];
const sdkPath = sdkCandidates.find(candidate => fs.existsSync(candidate));
if (!sdkPath) fail('pinned @supabase/supabase-js UMD bundle was not installed at a supported package path');

let server;
let browser;
const contexts = [];
const pages = [];
const pageErrors = [];
const browserDiagnostics = [];
let conversationId = null;
let adminApiBase = apiUrl.replace(/\/$/, '');

async function adminRequest(resource, method = 'GET', body) {
  const response = await fetch(adminApiBase + '/rest/v1/' + resource, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method === 'DELETE' ? { Prefer: 'return=representation' } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error('local service-role cleanup/admin request failed (' + response.status + '): ' + text.slice(0, 300));
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((request, response) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
      catch { response.writeHead(400).end('Bad request'); return; }
      if (pathname === '/') pathname = '/index.html';
      const absolute = path.resolve(ROOT, '.' + pathname);
      if (!absolute.startsWith(ROOT + path.sep) && absolute !== HTML_PATH) {
        response.writeHead(403).end('Forbidden'); return;
      }
      if (pathname === '/index.html') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(testHtml); return;
      }
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        response.writeHead(404).end('Not found'); return;
      }
      const ext = path.extname(absolute).toLowerCase();
      const types = { '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
      response.writeHead(200, { 'Content-Type': (types[ext] || 'application/octet-stream') + (ext === '.css' || ext === '.js' || ext === '.json' ? '; charset=utf-8' : '') });
      fs.createReadStream(absolute).pipe(response);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function signIn(page, email) {
  await page.goto('http://127.0.0.1:' + server.address().port + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#authSubmit').click();
  await page.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => typeof state !== 'undefined' && !!state.user?.id, null, { timeout: 15000 });
  const actual = await page.evaluate(() => state.user.id);
  const expected = email.startsWith('direct-a@') ? synthetic.direct_a : synthetic.direct_b;
  assert.equal(actual, expected, 'the application session must belong to the expected synthetic Auth identity');
  // The app deliberately finishes authentication by resetting to Home. Do not race
  // openDirectConversation against the tail of that startup sequence.
  await page.waitForFunction(() => {
    const welcome = document.querySelector('#messages .welcome')?.innerText || '';
    return !!state.user?.id
      && !!state.profile?.id
      && state.conversationsLoading === false
      && state.active === null
      && welcome.includes('مرحباً بك في BizmindMakers Chat Pro');
  }, null, { timeout: 20000 });
}

async function openDirect(page, otherId) {
  const result = await page.evaluate(async peerId => {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('id,username,display_name,avatar_url,membership_number,membership_number_verified')
      .eq('id', peerId)
      .single();
    if (error) throw error;
    await openDirectConversation(data);
    return {
      activeId: state.active?.id || null,
      conversationCount: state.conversations?.length || 0,
      matchingConversation: state.conversations?.find(c => c.type === 'direct' && c.members?.some(m => m.user_id === peerId))?.id || null,
      userId: state.user?.id || null,
      profileId: data.id
    };
  }, otherId);
  if (!result.activeId) {
    throw new Error('Application did not activate the direct conversation: ' + JSON.stringify(result)
      + (browserDiagnostics.length ? '\\nBrowser diagnostics:\\n' + browserDiagnostics.join('\\n') : ''));
  }
  await page.waitForFunction(expected => state.active?.id === expected, result.activeId, { timeout: 25000 });
  await page.locator('#messageInput').waitFor({ state: 'visible' });
  return result.activeId;
}

async function send(page, content) {
  await page.locator('#messageInput').fill(content);
  await page.locator('#sendBtn').click();
  await page.waitForFunction(value => {
    const input = document.getElementById('messageInput');
    return input && input.value !== value && !state.uploading;
  }, content, { timeout: 20000 });
}

async function messageVisible(page, content) {
  await page.waitForFunction(value => {
    const root = document.getElementById('messages');
    return !!root && root.innerText.includes(value);
  }, content, { timeout: 20000 });
}

try {
  console.log('LOCAL_CHAT_BROWSER_E2E_STEP=verify disposable loopback configuration');
  const port = await startStaticServer();
  browser = await chromium.launch({ headless: true });
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  contexts.push(contextA, contextB);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  pages.push(pageA, pageB);
  for (const page of pages) {
    page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) browserDiagnostics.push('[' + message.type() + '] ' + message.text()); });
    page.on('requestfailed', request => browserDiagnostics.push('[requestfailed] ' + request.method() + ' ' + request.url() + ' :: ' + (request.failure()?.errorText || 'unknown')));
    await page.route(SDK_URL, route => route.fulfill({
      path: sdkPath,
      contentType: 'application/javascript; charset=utf-8',
      headers: { 'Cache-Control': 'no-store' }
    }));
  }

  console.log('LOCAL_CHAT_BROWSER_E2E_STEP=authenticate two independent browser contexts');
  await Promise.all([
    signIn(pageA, 'direct-a@bizmindmakers.test'),
    signIn(pageB, 'direct-b@bizmindmakers.test')
  ]);

  console.log('LOCAL_CHAT_BROWSER_E2E_STEP=create and open direct conversation through application code');
  const [conversationA, conversationB] = await Promise.all([
    openDirect(pageA, synthetic.direct_b),
    openDirect(pageB, synthetic.direct_a)
  ]);
  assert.ok(conversationA && conversationB);
  assert.equal(conversationA, conversationB, 'both authenticated clients must resolve the same direct conversation');
  conversationId = conversationA;

  console.log('LOCAL_CHAT_BROWSER_E2E_STEP=verify empty conversation history rendering and read receipt');
  const emptyHistory = await pageA.evaluate(async () => {
    if (typeof loadMessages !== 'function') throw new Error('application loadMessages entry point is unavailable');
    const loaded = await loadMessages();
    return {
      loaded,
      activeConversationId: state.active?.id || null,
      messageCount: state.messages.filter(message => message.conversation_id === state.active?.id).length,
      renderedMessageCount: document.querySelectorAll('#messages .message').length,
      emptyStateVisible: document.querySelector('#messages .welcome')?.innerText.includes('بداية محادثة جديدة') || false,
      loading: state.isLoadingMessages
    };
  });
  assert.equal(emptyHistory.loaded, true, 'empty history must complete loadMessages successfully');
  assert.equal(emptyHistory.activeConversationId, conversationId);
  assert.equal(emptyHistory.messageCount, 0, 'empty conversation must have no persisted messages');
  assert.equal(emptyHistory.renderedMessageCount, 0, 'empty conversation must not render message rows');
  assert.equal(emptyHistory.emptyStateVisible, true, 'empty conversation welcome state must be rendered');
  assert.equal(emptyHistory.loading, false, 'empty history must clear the loading state');

  console.log('LOCAL_CHAT_BROWSER_E2E_STEP=send multiple messages and verify full history reload');
  const firstMessage = 'E2E-' + crypto.randomUUID() + '-realtime';
  const secondMessage = 'E2E-' + crypto.randomUUID() + '-history';
  const thirdMessage = 'E2E-' + crypto.randomUUID() + '-history';
  await send(pageA, firstMessage);
  await send(pageA, secondMessage);
  await send(pageA, thirdMessage);
  await messageVisible(pageA, firstMessage);
  await messageVisible(pageA, secondMessage);
  await messageVisible(pageA, thirdMessage);
  await messageVisible(pageB, firstMessage);

  const multiMessageHistory = await pageA.evaluate(async expected => {
    const loaded = await loadMessages();
    const messages = state.messages.filter(message => message.conversation_id === state.active?.id);
    const renderedText = document.querySelector('#messages')?.innerText || '';
    return {
      loaded,
      count: messages.length,
      expectedPresent: expected.map(value => messages.some(message => message.content === value)),
      renderedPresent: expected.map(value => renderedText.includes(value)),
      renderedRows: document.querySelectorAll('#messages .message').length,
      loading: state.isLoadingMessages
    };
  }, [firstMessage, secondMessage, thirdMessage]);
  assert.equal(multiMessageHistory.loaded, true, 'multi-message history reload must complete successfully');
  assert.ok(multiMessageHistory.count >= 3, 'reloaded state must contain all three persisted messages');
  assert.deepEqual(multiMessageHistory.expectedPresent, [true, true, true], 'all expected messages must be present in application state');
  assert.deepEqual(multiMessageHistory.renderedPresent, [true, true, true], 'all expected messages must be visible after re-render');
  assert.ok(multiMessageHistory.renderedRows >= 3, 'multiple message DOM rows must be rendered');
  assert.equal(multiMessageHistory.loading, false, 'multi-message reload must clear the loading state');

  console.log('LOCAL_CHAT_BROWSER_E2E_STEP=offline reconciliation and reconnect');
  await contextB.setOffline(true);
  await pageB.waitForTimeout(400);
  const reconnectMessage = 'E2E-' + crypto.randomUUID() + '-reconcile';
  await send(pageA, reconnectMessage);
  await contextB.setOffline(false);
  await pageB.evaluate(async () => {
    if (typeof loadMessages !== 'function') throw new Error('application message reconciliation entry point is unavailable');
    await loadMessages();
  });
  await messageVisible(pageB, reconnectMessage);

  console.log('LOCAL_CHAT_BROWSER_E2E_STEP=revoke membership and verify server-side isolation');
  const revoked = await adminRequest(
    'conversation_members?conversation_id=eq.' + encodeURIComponent(conversationId)
      + '&user_id=eq.' + encodeURIComponent(synthetic.direct_b),
    'DELETE'
  );
  assert.ok(Array.isArray(revoked) && revoked.some(row => row.user_id === synthetic.direct_b),
    'the disposable service-role fixture must revoke exactly the peer membership');

  const afterRevoke = await pageB.evaluate(async conversation => {
    const { data, error } = await supabaseClient.from('chat_messages')
      .select('id').eq('conversation_id', conversation).limit(5);
    return { count: data?.length ?? null, error: error?.message || null, code: error?.code || null };
  }, conversationId);
  assert.ok(afterRevoke.error || afterRevoke.count === 0,
    'revoked member must not be able to read conversation messages');

  const forbiddenMessage = 'E2E-' + crypto.randomUUID() + '-must-not-leak';
  await send(pageA, forbiddenMessage);
  await messageVisible(pageA, forbiddenMessage);
  await pageB.waitForTimeout(1800);
  const leaked = await pageB.locator('#messages').innerText();
  assert.ok(!leaked.includes(forbiddenMessage), 'revoked browser context must not receive later Realtime messages');

  if (pageErrors.length) fail('browser page errors detected: ' + pageErrors.join('\n---\n'));
  console.log('LOCAL_CHAT_BROWSER_E2E=PASSED');
  console.log('LOCAL_CHAT_BROWSER_E2E_CONTEXTS=2');
  console.log('LOCAL_CHAT_BROWSER_E2E_CONVERSATION=' + conversationId);
  console.log('LOCAL_CHAT_BROWSER_E2E_REALTIME=PASSED');
  console.log('LOCAL_CHAT_BROWSER_E2E_RECONNECT_RECONCILIATION=PASSED');
  console.log('LOCAL_CHAT_BROWSER_E2E_MEMBERSHIP_REVOCATION=PASSED');
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  if (conversationId) {
    try { await adminRequest('conversations?id=eq.' + encodeURIComponent(conversationId), 'DELETE'); }
    catch (error) { console.warn('LOCAL_CHAT_BROWSER_E2E_CLEANUP_WARNING=' + (error?.message || error)); }
  }
  for (const context of contexts.reverse()) {
    try { await context.close(); } catch (_) {}
  }
  try { await browser?.close(); } catch (_) {}
  if (server) await new Promise(resolve => server.close(resolve));
}
