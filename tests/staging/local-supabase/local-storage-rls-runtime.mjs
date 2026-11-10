#!/usr/bin/env node
// Disposable-local Supabase Storage API RLS integration probe.
// Requires the fully replayed synthetic local Auth/profile fixtures and RLS overlay.
import { randomUUID } from 'node:crypto';

function fail(message) {
  console.error('STORAGE_RLS_RUNTIME_BLOCKED=' + message);
  process.exit(1);
}
function required(name) {
  const value = process.env[name];
  if (!value) fail(name + ' is required');
  return value;
}

const base = required('LOCAL_SUPABASE_URL').replace(/\/$/, '');
const anonKey = required('LOCAL_SUPABASE_ANON_KEY');
let endpoint;
try { endpoint = new URL(base); } catch { fail('invalid LOCAL_SUPABASE_URL'); }
const host = endpoint.hostname.replace(/^\[|\]$/g, '').toLowerCase();
if (endpoint.protocol !== 'http:'
  || !['127.0.0.1', 'localhost', '::1'].includes(host)
  || endpoint.port !== '54321'
  || endpoint.pathname !== '/'
  || endpoint.username || endpoint.password
  || endpoint.search || endpoint.hash) {
  fail('refusing non-local API target; expected http://loopback:54321 without credentials/query/hash');
}

const userA = { id: '22222222-2222-4222-8222-222222222201', email: 'direct-a@bizmindmakers.test' };
const userB = { id: '22222222-2222-4222-8222-222222222202', email: 'direct-b@bizmindmakers.test' };
const password = required('LOCAL_SYNTHETIC_AUTH_PASSWORD');
if (password.length < 32 || !/^[A-Za-z0-9!-]+$/.test(password)) fail('LOCAL_SYNTHETIC_AUTH_PASSWORD is invalid');
const nonce = randomUUID();
const uploaded = [];
let documentId = null;
let conversationId = null;
let tokenA = null;
let tokenB = null;

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
}
async function call(path, { method = 'GET', key = anonKey, token = null, body, headers = {} } = {}) {
  console.log('STORAGE_PROBE_STEP=' + method + ' ' + path);
  const response = await fetchWithTimeout(base + path, {
    method,
    headers: {
      apikey: key,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data, text };
}
function assertOk(result, label) {
  if (!result.response.ok) throw new Error(label + ' failed (' + result.response.status + '): ' + String(result.text).slice(0, 500));
  return result.data;
}
function assertDenied(result, label) {
  if (result.response.ok || result.response.status >= 500) {
    throw new Error(label + ' expected a policy denial, received HTTP ' + result.response.status + ': ' + String(result.text).slice(0, 300));
  }
}
function objectPath(bucket, name) {
  return '/storage/v1/object/' + encodeURIComponent(bucket) + '/' + name.split('/').map(encodeURIComponent).join('/');
}
async function upload(bucket, name, bytes, token, upsert = false, contentType = 'application/octet-stream') {
  console.log('STORAGE_PROBE_STEP=upload ' + bucket + '/' + name);
  const response = await fetchWithTimeout(base + objectPath(bucket, name), {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: 'Bearer ' + token,
      'Content-Type': contentType,
      'x-upsert': upsert ? 'true' : 'false'
    },
    body: bytes
  });
  const text = await response.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const result = { response, data, text };
  assertOk(result, 'upload ' + bucket + '/' + name);
  if (!uploaded.some(item => item.bucket === bucket && item.name === name)) uploaded.push({ bucket, name, token });
  return data;
}
async function sign(bucket, name, token) {
  const path = '/storage/v1/object/sign/' + encodeURIComponent(bucket) + '/' + name.split('/').map(encodeURIComponent).join('/');
  return call(path, { method: 'POST', token, body: { expiresIn: 60 } });
}
function assertSigned(result, label) {
  const data = assertOk(result, label);
  if (!data?.signedURL && !data?.signedUrl) throw new Error(label + ' returned no signed URL');
  return data;
}
async function remove(bucket, name, token) {
  return call('/storage/v1/object/' + encodeURIComponent(bucket), {
    method: 'DELETE', token, body: { prefixes: [name] }
  });
}
async function login(user) {
  const result = assertOk(await call('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email: user.email, password }
  }), 'login ' + user.email);
  if (!result.access_token) throw new Error('Auth login returned no access token for ' + user.email);
  return result.access_token;
}
async function rest(path, token, method = 'GET', body, prefer = null) {
  return call('/rest/v1/' + path, {
    method, token, body,
    headers: prefer ? { Prefer: prefer } : {}
  });
}
async function cleanup() {
  if (documentId && tokenA) {
    await rest('conversation_documents?id=eq.' + encodeURIComponent(documentId), tokenA, 'DELETE').catch(() => {});
  }
  for (const item of uploaded.reverse()) {
    const result = await remove(item.bucket, item.name, item.token).catch(() => null);
    if (result && !result.response.ok) console.warn('Scoped cleanup did not remove ' + item.bucket + '/' + item.name + ' (HTTP ' + result.response.status + ')');
  }
}

try {
  console.log('STORAGE_PROBE_STEP=authenticate pre-provisioned synthetic users');
  tokenA = await login(userA);
  tokenB = await login(userB);

  console.log('STORAGE_PROBE_STEP=create direct conversation');
  const rpc = assertOk(await rest('rpc/get_or_create_direct_conversation', tokenA, 'POST', { p_other_user_id: userB.id }), 'direct conversation RPC');
  conversationId = typeof rpc === 'string' ? rpc : rpc?.id;
  if (!conversationId || !/^[0-9a-f-]{36}$/i.test(conversationId)) throw new Error('direct conversation RPC returned an invalid UUID');

  // Chat media: valid uploader folder succeeds; another member cannot impersonate it.
  const pdf = Buffer.from('%PDF-1.4\\n% local RLS runtime probe\\n');
  const chatPath = conversationId + '/' + userA.id + '/runtime-' + nonce + '.pdf';
  await upload('chat-media', chatPath, pdf, tokenA, false, 'application/pdf');
  assertSigned(await sign('chat-media', chatPath, tokenB), 'conversation member signed read of chat media');
  const spoofPath = conversationId + '/' + userA.id + '/spoof-' + nonce + '.bin';
  const spoof = await fetchWithTimeout(base + objectPath('chat-media', spoofPath), {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: 'Bearer ' + tokenB, 'Content-Type': 'application/octet-stream', 'x-upsert': 'false' },
    body: Buffer.from('spoof')
  }).then(async response => ({ response, text: await response.text() }));
  assertDenied(spoof, 'cross-user chat-media uploader-folder spoof');

  // Private conversation documents: owner-only until explicitly shared with conversation members.
  const pdfPath = conversationId + '/' + userA.id + '/runtime-' + nonce + '.pdf';
  await upload('conversation-documents', pdfPath, pdf, tokenA, false, 'application/pdf');
  const metadata = assertOk(await rest('conversation_documents', tokenA, 'POST', {
    owner_id: userA.id,
    conversation_id: conversationId,
    storage_path: pdfPath,
    file_name: 'runtime-probe.pdf',
    mime_type: 'application/pdf',
    size_bytes: pdf.length,
    visibility: 'private',
    shared_at: null
  }, 'return=representation'), 'insert private conversation document metadata');
  documentId = Array.isArray(metadata) ? metadata[0]?.id : metadata?.id;
  if (!documentId) throw new Error('conversation_documents insert returned no row ID');
  assertSigned(await sign('conversation-documents', pdfPath, tokenA), 'owner signed read of private document');
  assertDenied(await sign('conversation-documents', pdfPath, tokenB), 'other member signed read of private document');

  assertOk(await rest('conversation_documents?id=eq.' + encodeURIComponent(documentId), tokenA, 'PATCH', {
    visibility: 'shared',
    shared_at: new Date().toISOString()
  }), 'share conversation document');
  assertSigned(await sign('conversation-documents', pdfPath, tokenB), 'shared conversation member signed read');

  const foreignDelete = await remove('conversation-documents', pdfPath, tokenB);
  if (foreignDelete.response.status >= 500) throw new Error('non-owner document delete returned a server error');
  // Storage may return an empty success for an RLS-filtered DELETE; verify the object still exists.
  assertSigned(await sign('conversation-documents', pdfPath, tokenA), 'document remains after non-owner delete attempt');

  // Avatar: own upsert succeeds; another user cannot overwrite it; public bucket URL is readable.
  const avatarPath = userA.id + '/runtime-' + nonce + '.png';
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/r4sAAAAASUVORK5CYII=', 'base64');
  await upload('avatars', avatarPath, pixel, tokenA, true, 'image/png');
  await upload('avatars', avatarPath, pixel, tokenA, true, 'image/png');
  const avatarSpoof = await fetchWithTimeout(base + objectPath('avatars', avatarPath), {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: 'Bearer ' + tokenB, 'Content-Type': 'image/png', 'x-upsert': 'true' },
    body: Buffer.from('avatar-spoof')
  }).then(async response => ({ response, text: await response.text() }));
  assertDenied(avatarSpoof, 'cross-user avatar overwrite');
  const publicAvatarUrl = base + '/storage/v1/object/public/avatars/' + avatarPath.split('/').map(encodeURIComponent).join('/');
  const publicAvatar = await fetchWithTimeout(publicAvatarUrl);
  if (!publicAvatar.ok || !publicAvatar.headers.get('content-type')?.includes('image/png')) throw new Error('public avatar delivery failed after owner upsert');

  // Owner delete paths must continue to work for each private/public bucket.
  for (const item of [...uploaded].reverse()) {
    if (item.bucket === 'chat-media' || item.bucket === 'avatars' || item.bucket === 'conversation-documents') {
      const removed = await remove(item.bucket, item.name, tokenA);
      assertOk(removed, 'owner delete ' + item.bucket + '/' + item.name);
      const index = uploaded.findIndex(entry => entry.bucket === item.bucket && entry.name === item.name);
      if (index >= 0) uploaded.splice(index, 1);
    }
  }
  if (documentId) {
    assertOk(await rest('conversation_documents?id=eq.' + encodeURIComponent(documentId), tokenA, 'DELETE'), 'owner delete document metadata');
    documentId = null;
  }
  console.log('STORAGE_RLS_RUNTIME=PASSED');
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
