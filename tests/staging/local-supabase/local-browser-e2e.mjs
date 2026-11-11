#!/usr/bin/env node
// Full UI-to-Supabase E2E against the disposable local stack only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const baseUrl = process.env.LOCAL_SUPABASE_URL;
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY;
const password = process.env.LOCAL_SYNTHETIC_AUTH_PASSWORD;
let users;
try { users = JSON.parse(process.env.LOCAL_SYNTHETIC_AUTH_USERS_JSON || '{}'); }
catch { throw new Error('Invalid synthetic user identity map.'); }

function requireValue(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' is required.');
  return value.trim();
}
const api = new URL(requireValue(baseUrl, 'LOCAL_SUPABASE_URL'));
const apiHost = api.hostname.replace(/^\[|\]$/g, '').toLowerCase();
if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(apiHost)
  || api.port !== '54321' || api.pathname !== '/' || api.username || api.password || api.search || api.hash) {
  throw new Error('Refusing non-local E2E API target.');
}
requireValue(anonKey, 'LOCAL_SUPABASE_ANON_KEY');
requireValue(password, 'LOCAL_SYNTHETIC_AUTH_PASSWORD');
const rawDb = requireValue(process.env.LOCAL_SUPABASE_DB_URL, 'LOCAL_SUPABASE_DB_URL');
const db = new URL(rawDb);
if (!['postgres:', 'postgresql:'].includes(db.protocol)
  || !['127.0.0.1', 'localhost', '::1'].includes(db.hostname.replace(/^\[|\]$/g, '').toLowerCase())
  || db.port !== '54322' || db.username !== 'postgres' || db.pathname !== '/postgres'
  || db.search || db.hash) throw new Error('Refusing non-local realtime diagnostic database target.');
const publicationCheck = spawnSync('psql', [
  '--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1',
  '--command', "SELECT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='chat_messages')::text || '|' || (SELECT pubinsert::text FROM pg_publication WHERE pubname='supabase_realtime');",
  rawDb
], { encoding: 'utf8', env: { PATH: process.env.PATH || '', PGCONNECT_TIMEOUT: '5' } });
if (publicationCheck.error || publicationCheck.status !== 0 || publicationCheck.stdout.trim() !== 'true|true') {
  throw new Error('chat_messages is not enabled for INSERT publication in local Supabase: ' + (publicationCheck.stderr || publicationCheck.stdout || publicationCheck.error?.message || 'unknown error'));
}
console.log('REALTIME_PUBLICATION_CHAT_MESSAGES=true');
for (const key of ['direct_a', 'direct_b', 'direct_c']) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(users[key] || '')) {
    throw new Error('Missing synthetic E2E identity: ' + key);
  }
}

async function apiCall(pathname, { method = 'GET', token = null, body } = {}) {
  const response = await fetch(new URL(pathname, api.origin), {
    method,
    headers: {
      apikey: anonKey,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error('Local Supabase API ' + pathname + ' failed (' + response.status + '): ' + String(text).slice(0, 500));
  return data;
}
async function authenticate(email) {
  const result = await apiCall('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password }
  });
  if (!result?.access_token) throw new Error('Synthetic account authentication returned no access token.');
  return result.access_token;
}

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'], ['.woff2', 'font/woff2']
]);
const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method || '')) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = path.resolve(ROOT, relative);
    if (!target.startsWith(ROOT + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    const info = await stat(target);
    if (!info.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime.get(path.extname(target).toLowerCase()) || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
const appUrl = 'http://127.0.0.1:' + address.port + '/';
let browser;
const productionRequests = [];
const pageErrors = [];

async function createUserPage(email) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  await context.addInitScript(({ url, anonKey }) => {
    window.__BIZMIND_LOCAL_SUPABASE_TEST_CONFIG__ = { url, anonKey };
  }, { url: api.origin, anonKey });
  const page = await context.newPage();
  page.on('request', request => {
    if (request.url().includes('lvkeohpuucuklagvwpnq.supabase.co')) productionRequests.push(request.url());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#auth').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#authSubmit').click();
  await page.locator('#app:not(.hidden)').waitFor({ state: 'visible', timeout: 45000 });
  await page.locator('#auth').waitFor({ state: 'hidden', timeout: 10000 });
  return { context, page };
}

async function openDirectChat(page, otherName) {
  const row = page.locator('#conversationList button.conversation.swipe-conversation').filter({ hasText: otherName }).first();
  await row.waitFor({ state: 'visible', timeout: 30000 });
  await row.click();
  await page.locator('#messageInput:not([disabled])').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#chatTitle').getByText(otherName, { exact: false }).waitFor({ state: 'visible', timeout: 15000 }).catch(async () => {
    const title = await page.locator('#chatTitle').textContent();
    if (!title?.includes(otherName)) throw new Error('Opened chat title does not match expected peer: ' + title);
  });
  try {
    await page.waitForFunction(
      () => document.getElementById('connectionState')?.textContent?.trim() === 'متصل',
      null,
      { timeout: 30000 }
    );
  } catch {
    const connection = await page.locator('#connectionState').textContent().catch(() => 'missing');
    throw new Error('Supabase Realtime did not reach SUBSCRIBED state; connection indicator: ' + connection);
  }
}

try {
  console.log('BROWSER_E2E_STEP=prepare a direct conversation using the authenticated local RPC');
  const tokenA = await authenticate('direct-a@bizmindmakers.test');
  const conversation = await apiCall('/rest/v1/rpc/get_or_create_direct_conversation', {
    method: 'POST',
    token: tokenA,
    body: { p_other_user_id: users.direct_b }
  });
  if (typeof conversation !== 'string' || !/^[0-9a-f-]{36}$/i.test(conversation)) {
    throw new Error('Direct conversation RPC returned an invalid conversation ID.');
  }

  browser = await chromium.launch({ headless: true });
  console.log('BROWSER_E2E_STEP=authenticate both synthetic users through the actual UI');
  const accountA = await createUserPage('direct-a@bizmindmakers.test');
  const accountB = await createUserPage('direct-b@bizmindmakers.test');
  try {
    console.log('BROWSER_E2E_STEP=open the same private conversation in both browser sessions');
    await Promise.all([
      openDirectChat(accountA.page, 'Direct Test B'),
      openDirectChat(accountB.page, 'Direct Test A')
    ]);

    console.log('BROWSER_E2E_STEP=attach an unfiltered authenticated Realtime diagnostic observer');
    await accountB.page.evaluate(() => {
      window.__BIZMIND_E2E_REALTIME_OBSERVER__ = { status: 'CONNECTING', event: null };
      const client = eval('supabaseClient');
      window.__BIZMIND_E2E_REALTIME_CHANNEL__ = client.channel('e2e-observer-' + crypto.randomUUID())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
          window.__BIZMIND_E2E_REALTIME_OBSERVER__.event = {
            id: payload.new?.id || null,
            conversationId: payload.new?.conversation_id || null
          };
        })
        .subscribe(status => { window.__BIZMIND_E2E_REALTIME_OBSERVER__.status = status; });
    });
    await accountB.page.waitForFunction(
      () => window.__BIZMIND_E2E_REALTIME_OBSERVER__?.status === 'SUBSCRIBED',
      null,
      { timeout: 20000 }
    );
    await accountB.page.evaluate(conversationId => {
      const client = eval('supabaseClient');
      const filter = 'conversation_id=eq.' + conversationId;
      window.__BIZMIND_E2E_FILTERED_OBSERVER__ = { status: 'CONNECTING', event: null, filter };
      window.__BIZMIND_E2E_FILTERED_CHANNEL__ = client.channel('e2e-filtered-observer-' + crypto.randomUUID())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter }, payload => {
          window.__BIZMIND_E2E_FILTERED_OBSERVER__.event = {
            id: payload.new?.id || null,
            conversationId: payload.new?.conversation_id || null
          };
        })
        .subscribe(status => { window.__BIZMIND_E2E_FILTERED_OBSERVER__.status = status; });
    }, conversation);
    await accountB.page.waitForFunction(
      () => window.__BIZMIND_E2E_FILTERED_OBSERVER__?.status === 'SUBSCRIBED',
      null,
      { timeout: 20000 }
    );

    const message = 'Local staging E2E ' + Date.now() + ' ' + Math.random().toString(36).slice(2, 10);
    console.log('BROWSER_E2E_STEP=send a message from account A through the real composer');
    await accountA.page.locator('#messageInput').fill(message);
    await accountA.page.locator('#sendBtn').click();
    await accountA.page.locator('#messages .message').filter({ hasText: message }).waitFor({ state: 'visible', timeout: 20000 });

    console.log('BROWSER_E2E_STEP=verify account B receives the message in its browser session');
    await accountB.page.locator('#messages .message').filter({ hasText: message }).waitFor({ state: 'visible', timeout: 45000 });
    const realtime = await accountB.page.evaluate(() => ({
      status: eval('state.realtimeStatus'),
      lastEvent: eval('state.diagnostics.lastRealtimeEvent'),
      lastRealtimeConversation: eval('state.diagnostics.lastRealtimeConversationId'),
      activeConversation: eval('state.active?.id'),
      observer: window.__BIZMIND_E2E_REALTIME_OBSERVER__,
      filteredObserver: window.__BIZMIND_E2E_FILTERED_OBSERVER__
    }));
    assert.equal(realtime.status, 'SUBSCRIBED', 'Account B must be subscribed to Supabase Realtime.');
    assert.equal(realtime.activeConversation, conversation, 'Account B must have the expected conversation active.');
    assert.equal(realtime.observer?.status, 'SUBSCRIBED', 'Independent Realtime observer must be subscribed.');
    assert.equal(realtime.observer?.event?.conversationId, conversation, 'Unfiltered Realtime observer must receive the test insert.');
    assert.equal(realtime.filteredObserver?.status, 'SUBSCRIBED', 'Independent filtered Realtime observer must be subscribed.');
    assert.equal(realtime.filteredObserver?.event?.conversationId, conversation, 'Independent UUID-filtered observer must receive the test insert.');
    assert.equal(realtime.lastEvent, 'INSERT', 'Application channel must receive the message through Realtime, not only polling.');
    assert.equal(realtime.lastRealtimeConversation, conversation, 'Application Realtime handler must record only its active conversation.');

    console.log('BROWSER_E2E_STEP=prove cross-conversation event isolation for a user in two direct chats');
    const tokenB = await authenticate('direct-b@bizmindmakers.test');
    const tokenC = await authenticate('direct-c@bizmindmakers.test');
    const secondConversation = await apiCall('/rest/v1/rpc/get_or_create_direct_conversation', {
      method: 'POST',
      token: tokenB,
      body: { p_other_user_id: users.direct_c }
    });
    if (typeof secondConversation !== 'string' || !/^[0-9a-f-]{36}$/i.test(secondConversation) || secondConversation === conversation) {
      throw new Error('Second isolated direct conversation RPC returned an invalid or duplicate conversation ID.');
    }
    const foreignMessage = 'Foreign conversation isolation ' + Date.now() + ' ' + Math.random().toString(36).slice(2, 10);
    await accountB.page.evaluate(value => { window.__BIZMIND_E2E_FOREIGN_MESSAGE__ = value; }, foreignMessage);
    await apiCall('/rest/v1/chat_messages', {
      method: 'POST',
      token: tokenC,
      body: { conversation_id: secondConversation, sender_id: users.direct_c, content: foreignMessage }
    });
    await accountB.page.waitForFunction(
      expected => window.__BIZMIND_E2E_REALTIME_OBSERVER__?.event?.conversationId === expected,
      secondConversation,
      { timeout: 20000 }
    );
    const isolation = await accountB.page.evaluate(() => ({
      appConversation: eval('state.diagnostics.lastRealtimeConversationId'),
      activeConversation: eval('state.active?.id'),
      foreignMessageVisible: document.querySelector('#messages')?.innerText.includes(window.__BIZMIND_E2E_FOREIGN_MESSAGE__ || '__not_set__') || false
    }));
    assert.equal(isolation.activeConversation, conversation, 'Account B must remain in the original active conversation.');
    assert.equal(isolation.appConversation, conversation, 'Foreign conversation CDC events must not enter the active app handler.');
    assert.equal(isolation.foreignMessageVisible, false, 'A message from another conversation must never render in the active chat.');

    console.log('BROWSER_E2E_STEP=reload account B and verify durable message history');
    await accountB.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await accountB.page.locator('#app:not(.hidden)').waitFor({ state: 'visible', timeout: 45000 });
    await openDirectChat(accountB.page, 'Direct Test A');
    await accountB.page.locator('#messages .message').filter({ hasText: message }).waitFor({ state: 'visible', timeout: 20000 });

    assert.deepEqual(productionRequests, [], 'The browser attempted to contact the production Supabase project.');
    assert.deepEqual(pageErrors, [], 'The browser raised an uncaught JavaScript exception.');
    console.log('BROWSER_E2E_RESULT=PASSED');
    console.log('BROWSER_E2E_ACCOUNTS=2');
    console.log('BROWSER_E2E_MESSAGE_PERSISTENCE=PASSED');
    console.log('BROWSER_E2E_CROSS_SESSION_DELIVERY=PASSED');
    console.log('BROWSER_E2E_PRODUCTION_REQUESTS=0');
  } finally {
    await accountA.context.close();
    await accountB.context.close();
  }
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
