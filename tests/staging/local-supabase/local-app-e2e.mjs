#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rawApi = process.env.LOCAL_SUPABASE_URL;
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY;
const password = process.env.LOCAL_SYNTHETIC_AUTH_PASSWORD;
const allowedEmails = {
  direct_a: 'direct-a@bizmindmakers.test',
  direct_b: 'direct-b@bizmindmakers.test'
};

function requireLoopbackApi(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid local Supabase API URL'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  assert.equal(url.protocol, 'http:', 'E2E must use HTTP only on loopback');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host), 'E2E refuses non-loopback Supabase hosts');
  assert.equal(url.port, '54321', 'E2E requires the disposable local Supabase API port');
  assert.equal(url.pathname, '/');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  return url.origin;
}

assert.ok(rawApi && anonKey && password, 'Local Supabase URL, anon key, and synthetic password are required');
const apiOrigin = requireLoopbackApi(rawApi);
const sourceHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const urlPattern = /const SUPABASE_URL\s*=\s*(['"])[^'"]+\1\s*;/g;
const keyPattern = /const SUPABASE_ANON_KEY\s*=\s*(['"])[^'"]+\1\s*;/g;
assert.equal([...sourceHtml.matchAll(urlPattern)].length, 1, 'Expected exactly one Supabase URL declaration');
assert.equal([...sourceHtml.matchAll(keyPattern)].length, 1, 'Expected exactly one Supabase anon-key declaration');
const testHtml = sourceHtml
  .replace(urlPattern, 'const SUPABASE_URL=' + JSON.stringify(apiOrigin) + ';')
  .replace(keyPattern, 'const SUPABASE_ANON_KEY=' + JSON.stringify(anonKey) + ';');
assert.ok(testHtml.includes('const SUPABASE_URL=' + JSON.stringify(apiOrigin) + ';'));
assert.ok(!testHtml.includes('https://lvkeohpuucuklagvwpnq.supabase.co'));

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf']
]);

const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1:4173').pathname); }
  catch { response.writeHead(400).end(); return; }

  if (pathname === '/' || pathname === '/index.html') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(request.method === 'HEAD' ? undefined : testHtml);
    return;
  }

  const filePath = path.resolve(ROOT, '.' + pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'Content-Type': mime.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(4173, '127.0.0.1', resolve);
});

let browser;
const pageErrors = [];
const appOrigin = 'http://127.0.0.1:4173';

async function restrictBrowserNetwork(context) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
      && ['4173', '54321'].includes(url.port);
    const pinnedCdn = url.protocol === 'https:' && ['cdn.jsdelivr.net', 'unpkg.com'].includes(url.hostname);
    if (local || pinnedCdn) return route.continue();
    return route.abort('blockedbyclient');
  });
}

async function signIn(page, email) {
  await page.goto(appOrigin, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !!window.supabase, null, { timeout: 30000 });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#authSubmit').click();
  try {
    await page.waitForSelector('#app:not(.hidden)', { timeout: 30000 });
  } catch {
    const authError = await page.locator('#authError').textContent().catch(() => '');
    throw new Error('Synthetic sign-in failed for ' + email + ': ' + (authError || 'application did not open'));
  }
  await page.locator('#browseUsersBtn').waitFor({ state: 'visible', timeout: 15000 });
}

try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  const contextA = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 1000 }
  });
  await restrictBrowserNetwork(contextA);
  const pageA = await contextA.newPage();
  pageA.on('pageerror', error => pageErrors.push('A: ' + error.message));
  await signIn(pageA, allowedEmails.direct_a);

  await pageA.locator('#browseUsersBtn').click();
  const targetRow = pageA.locator('#directoryList .directory-user').filter({ hasText: 'Direct Test B' }).first();
  await targetRow.waitFor({ state: 'visible', timeout: 30000 });
  await targetRow.locator('.directory-message-btn').click();

  await pageA.waitForFunction(() =>
    (document.querySelector('#chatTitle')?.textContent || '').includes('Direct Test B')
    && document.querySelector('#messageInput')
    && !document.querySelector('#messageInput').disabled,
    null,
    { timeout: 30000 }
  );

  const message = 'BIZMIND_E2E_' + Date.now();
  await pageA.locator('#messageInput').fill(message);
  await pageA.locator('#sendBtn').click();
  const sentMessage = pageA.locator('#messages').getByText(message, { exact: true });
  await sentMessage.waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await sentMessage.count(), 1, 'Sender should render exactly one persisted message');
  console.log('LOCAL_APP_E2E_SENDER_SEND=PASSED');

  const contextB = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 1000 }
  });
  await restrictBrowserNetwork(contextB);
  const pageB = await contextB.newPage();
  pageB.on('pageerror', error => pageErrors.push('B: ' + error.message));
  await signIn(pageB, allowedEmails.direct_b);

  const conversationRow = pageB.locator('#conversationList .conversation').filter({ hasText: 'Direct Test A' }).first();
  await conversationRow.waitFor({ state: 'visible', timeout: 30000 });
  await conversationRow.click();
  await pageB.waitForFunction(() =>
    (document.querySelector('#chatTitle')?.textContent || '').includes('Direct Test A')
    && document.querySelector('#messageInput')
    && !document.querySelector('#messageInput').disabled,
    null,
    { timeout: 30000 }
  );
  const receivedMessage = pageB.locator('#messages').getByText(message, { exact: true });
  await receivedMessage.waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await receivedMessage.count(), 1, 'Recipient should load exactly one persisted message');
  console.log('LOCAL_APP_E2E_RECIPIENT_READ=PASSED');

  await pageB.reload({ waitUntil: 'domcontentloaded' });
  await pageB.waitForSelector('#app:not(.hidden)', { timeout: 30000 });
  const reloadedRow = pageB.locator('#conversationList .conversation').filter({ hasText: 'Direct Test A' }).first();
  await reloadedRow.waitFor({ state: 'visible', timeout: 30000 });
  await reloadedRow.click();
  const reloadedMessage = pageB.locator('#messages').getByText(message, { exact: true });
  await reloadedMessage.waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await reloadedMessage.count(), 1, 'Reloaded recipient view should not duplicate the message');
  console.log('LOCAL_APP_E2E_RELOAD_PERSISTENCE=PASSED');

  if (pageErrors.length) throw new Error('Browser page errors: ' + pageErrors.join(' | '));
  console.log('LOCAL_APP_E2E=PASSED');
  await contextB.close();
  await contextA.close();
} finally {
  if (browser) await browser.close().catch(() => {});
  await new Promise(resolve => server.close(resolve));
}
