#!/usr/bin/env node
// Full browser E2E against the disposable loopback Supabase stack only.
// The app's source is served unchanged except for test-local Supabase URL/key injection.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const rawApi = process.env.LOCAL_SUPABASE_URL;
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY;
const password = process.env.LOCAL_SYNTHETIC_AUTH_PASSWORD;
const rawDb = process.env.LOCAL_SUPABASE_DB_URL;
if (process.env.ALLOW_DISPOSABLE_LOCAL_REPLAY !== '1') throw new Error('Local browser E2E requires explicit disposable-stack authorization');
let api, db;
try { api = new URL(rawApi); } catch { throw new Error('Invalid LOCAL_SUPABASE_URL'); }
try { db = new URL(rawDb); } catch { throw new Error('Invalid LOCAL_SUPABASE_DB_URL'); }
const loopback = host => ['127.0.0.1', 'localhost', '::1'].includes(host.replace(/^\[|\]$/g, '').toLowerCase());
if (api.protocol !== 'http:' || !loopback(api.hostname) || api.port !== '54321' || api.pathname !== '/' || api.username || api.password || api.search || api.hash) {
  throw new Error('Refusing non-loopback Supabase API target');
}
if (!['postgres:', 'postgresql:'].includes(db.protocol) || !loopback(db.hostname) || db.port !== '54322'
  || db.username !== 'postgres' || db.pathname !== '/postgres' || db.search || db.hash) {
  throw new Error('Refusing non-loopback PostgreSQL target');
}
if (!anonKey || !password) throw new Error('Local anon key and synthetic Auth password are required');
let users;
try { users = JSON.parse(process.env.LOCAL_SYNTHETIC_AUTH_USERS_JSON || '{}'); }
catch { throw new Error('Invalid synthetic Auth identity map'); }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
for (const key of ['direct_a', 'direct_b']) {
  if (typeof users[key] !== 'string' || !UUID_RE.test(users[key])) throw new Error('Missing or invalid synthetic identity ' + key);
}

const vendorPackageEntry = require.resolve('@supabase/supabase-js');
const packageRoot = path.resolve(path.dirname(vendorPackageEntry), '..');
const vendorPath = path.join(packageRoot, 'dist/umd/supabase.js');
await stat(vendorPath);

const indexPath = path.join(ROOT, 'index.html');
const bootstrapPath = path.join(ROOT, 'js/00-bootstrap.js');
let indexHtml = await readFile(indexPath, 'utf8');
let bootstrap = await readFile(bootstrapPath, 'utf8');
const cdnScript = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+"><\/script>/;
if (!cdnScript.test(indexHtml)) throw new Error('Could not locate the Supabase browser SDK script tag');
indexHtml = indexHtml.replace(cdnScript, '<script src="/vendor/supabase.min.js"></script>');
const urlConstant = /const SUPABASE_URL='[^']+';/;
const keyConstant = /const SUPABASE_ANON_KEY='[^']+';/;
if (!urlConstant.test(bootstrap) || !keyConstant.test(bootstrap)) throw new Error('Could not locate app Supabase bootstrap constants');
bootstrap = bootstrap.replace(urlConstant, "const SUPABASE_URL='" + api.origin + "';")
  .replace(keyConstant, "const SUPABASE_ANON_KEY='" + anonKey + "';");

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (pathname === '/vendor/supabase.min.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(await readFile(vendorPath));
      return;
    }
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(indexHtml);
      return;
    }
    if (pathname === '/js/00-bootstrap.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(bootstrap);
      return;
    }
    const filePath = path.resolve(ROOT, '.' + pathname);
    if (!filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
const appUrl = 'http://127.0.0.1:' + address.port + '/';

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const clientA = createClient(api.origin, anonKey, clientOptions);
const clientB = createClient(api.origin, anonKey, clientOptions);
let browser;
let pageA = null, pageB = null;
const pageErrors = [], pageConsole = [];
function logStep(step) { console.log('LOCAL_CHAT_E2E_STEP=' + step); }
async function signIn(client, email) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data?.session?.access_token) throw new Error('Synthetic sign-in failed for ' + email + ': ' + (error?.message || 'no session'));
  return data.user.id;
}
async function loginPage(page, email) {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#authSubmit').click();
  try {
    await page.waitForFunction(() => {
      const app = document.getElementById('app');
      return app && !app.classList.contains('hidden');
    }, null, { timeout: 45000 });
  } catch {
    const error = await page.locator('#authError').textContent().catch(() => '');
    throw new Error('App login did not complete for ' + email + ': ' + (error || 'app shell remained hidden'));
  }
}
async function openDirectChat(page, otherName) {
  const row = page.locator('#conversationList button.conversation').filter({ hasText: otherName }).first();
  await row.waitFor({ state: 'visible', timeout: 30000 });
  await row.click();
  await page.waitForFunction(() => {
    const input = document.getElementById('messageInput');
    return input && !input.disabled;
  }, null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const status = document.getElementById('connectionState')?.textContent?.trim();
    return status === 'متصل' || status === 'مشكلة اتصال — إعادة المحاولة';
  }, null, { timeout: 30000 });
  const connectionStatus = await page.locator('#connectionState').textContent();
  if (connectionStatus?.trim() !== 'متصل') {
    const diagnostics = await page.evaluate(() => ({
      realtimeStatus: state.realtimeStatus,
      activeConversation: state.active?.id || null,
      events: (state.diagnostics?.events || []).slice(-15),
      channelState: state.channel?.state || null,
      bindingKeys: state.channel?.bindings ? Object.keys(state.channel.bindings) : []
    })).catch(error => ({ diagnosticError: error.message }));
    throw new Error('Chat Realtime did not reach SUBSCRIBED: ' + JSON.stringify({ connectionStatus, diagnostics }));
  }
}
async function sendFrom(page, message) {
  await page.locator('#messageInput').fill(message);
  await page.locator('#sendBtn').click();
  await page.locator('#messages .message').filter({ hasText: message }).waitFor({ state: 'visible', timeout: 25000 });
}
function psql(sql) {
  const result = spawnSync('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1', '--command', sql, rawDb], {
    encoding: 'utf8', env: { PATH: process.env.PATH, PGCONNECT_TIMEOUT: '5' }, timeout: 15000
  });
  if (result.error || result.status !== 0) throw new Error('Local membership revocation SQL failed: ' + (result.stderr || result.error?.message || result.status));
  return result.stdout.trim();
}

try {
  logStep('authenticate-synthetic-users');
  const userA = await signIn(clientA, 'direct-a@bizmindmakers.test');
  const userB = await signIn(clientB, 'direct-b@bizmindmakers.test');
  const { data: selfChatA, error: selfChatAError } = await clientA.rpc('ensure_self_chat');
  const { data: selfChatARepeat, error: selfChatARepeatError } = await clientA.rpc('ensure_self_chat');
  const { data: selfChatB, error: selfChatBError } = await clientB.rpc('ensure_self_chat');
  if (selfChatAError || selfChatARepeatError || selfChatBError || !UUID_RE.test(selfChatA || '')
    || selfChatA !== selfChatARepeat || selfChatA === selfChatB) {
    throw new Error('Secure self-chat RPC failed idempotency/isolation checks: ' + JSON.stringify({
      first: selfChatAError?.message, repeat: selfChatARepeatError?.message, second: selfChatBError?.message
    }));
  }
  console.log('PASS: authenticated self-chat RPC is idempotent and isolated per user.');

  logStep('create-or-resolve-direct-conversation');
  const { data: conversationId, error: directError } = await clientA.rpc('get_or_create_direct_conversation', { p_other_user_id: userB });
  if (directError || typeof conversationId !== 'string' || !UUID_RE.test(conversationId)) throw new Error('Direct conversation setup failed: ' + (directError?.message || 'missing or invalid ID'));

  browser = await chromium.launch({ headless: true });
  const contextA = await browser.newContext({ serviceWorkers: 'block', locale: 'ar-SA' });
  const contextB = await browser.newContext({ serviceWorkers: 'block', locale: 'ar-SA' });
  pageA = await contextA.newPage();
  pageB = await contextB.newPage();
  pageA.on('pageerror', error => pageErrors.push('A: ' + error.message));
  pageB.on('pageerror', error => pageErrors.push('B: ' + error.message));
  pageA.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') pageConsole.push('A: ' + message.type() + ': ' + message.text()); });
  pageB.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') pageConsole.push('B: ' + message.type() + ': ' + message.text()); });

  logStep('login-two-independent-browser-contexts');
  await Promise.all([
    loginPage(pageA, 'direct-a@bizmindmakers.test'),
    loginPage(pageB, 'direct-b@bizmindmakers.test')
  ]);
  const selfChatErrors = pageConsole.filter(message => message.includes('Self chat initialization failed'));
  if (selfChatErrors.length) throw new Error('App login could not initialize the user's private self-chat: ' + selfChatErrors.join(' | '));

  logStep('open-same-direct-conversation-on-both-clients');
  await Promise.all([
    openDirectChat(pageA, 'Direct Test B'),
    openDirectChat(pageB, 'Direct Test A')
  ]);
  const messageLoadErrors = pageConsole.filter(message => message.includes('Message loading failed') || message.includes('allMessagesRendered is not defined'));
  if (messageLoadErrors.length) throw new Error('Message timeline load emitted runtime errors: ' + messageLoadErrors.join(' | '));

  logStep('authenticated-message-delivery');
  const firstMessage = 'E2E realtime delivery ' + Date.now();
  await sendFrom(pageA, firstMessage);
  await pageB.locator('#messages .message').filter({ hasText: firstMessage }).waitFor({ state: 'visible', timeout: 20000 });

  logStep('disconnect-reconnect-and-canonical-reconciliation');
  await contextB.setOffline(true);
  await new Promise(resolve => setTimeout(resolve, 1200));
  const reconnectMessage = 'E2E reconnect reconciliation ' + Date.now();
  await sendFrom(pageA, reconnectMessage);
  await contextB.setOffline(false);
  await pageB.locator('#messages .message').filter({ hasText: reconnectMessage }).waitFor({ state: 'visible', timeout: 35000 });

  logStep('revoke-membership-and-verify-read-isolation');
  const deleted = psql("DELETE FROM public.conversation_members WHERE conversation_id = '" + conversationId + "'::uuid AND user_id = '" + userB + "'::uuid; SELECT count(*) FROM public.conversation_members WHERE conversation_id = '" + conversationId + "'::uuid AND user_id = '" + userB + "'::uuid;");
  if (deleted.split(/\s+/).filter(Boolean).at(-1) !== '0') throw new Error('Membership revocation did not remove the target member');
  const { data: deniedRows, error: deniedError } = await clientB.from('chat_messages').select('id').eq('conversation_id', conversationId);
  if (deniedError || (deniedRows || []).length !== 0) throw new Error('Revoked member retained message read access');
  await pageB.waitForFunction(() => {
    const input = document.getElementById('messageInput');
    const title = document.getElementById('chatTitle')?.textContent || '';
    return input?.disabled === true && title.includes('سحب عضويتك');
  }, null, { timeout: 15000 });

  const postRevocationMessage = 'E2E revoked-member isolation ' + Date.now();
  await sendFrom(pageA, postRevocationMessage);
  await pageB.waitForTimeout(1800);
  const leaked = await pageB.locator('#messages .message').filter({ hasText: postRevocationMessage }).count();
  if (leaked !== 0) throw new Error('A revoked member received a later message event');

  logStep('assert-no-browser-runtime-errors');
  if (pageErrors.length) throw new Error('Browser runtime errors: ' + pageErrors.join(' | '));
  console.log('PASS: two authenticated browser contexts exchanged a message through the real app and local Realtime.');
  console.log('PASS: a disconnected client recovered a missed message after reconnect through canonical reconciliation.');
  console.log('PASS: membership revocation removed PostgREST read access and prevented later message delivery.');
  console.log('LOCAL_CHAT_E2E_BROWSER=PASSED');
} catch (error) {
  console.error('LOCAL_CHAT_E2E_BROWSER=FAILED');
  console.error(error?.stack || error);
  if (pageErrors.length) console.error('LOCAL_CHAT_E2E_PAGE_ERRORS=' + JSON.stringify(pageErrors));
  if (pageConsole.length) console.error('LOCAL_CHAT_E2E_PAGE_CONSOLE=' + JSON.stringify(pageConsole.slice(-80)));
  const diagnostics = await Promise.all([pageA, pageB].filter(Boolean).map(async (page, index) => page.evaluate(() => ({
    realtimeStatus: state.realtimeStatus,
    activeConversation: state.active?.id || null,
    events: (state.diagnostics?.events || []).slice(-20),
    channelState: state.channel?.state || null,
    bindingKeys: state.channel?.bindings ? Object.keys(state.channel.bindings) : []
  })).catch(error => ({ page: index, diagnosticError: error.message }))));
  if (diagnostics.length) console.error('LOCAL_CHAT_E2E_REALTIME_DIAGNOSTICS=' + JSON.stringify(diagnostics));
  process.exitCode = 1;
} finally {
  await Promise.allSettled([clientA.auth.signOut(), clientB.auth.signOut()]);
  clientA.realtime.disconnect();
  clientB.realtime.disconnect();
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
