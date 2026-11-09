import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const pattern = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const match = pattern.exec(source);
  assert.ok(match, 'Function not found: ' + name);
  const start = match.index;
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i], next = source[i + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('Unbalanced function body: ' + name);
}

test('all inline JavaScript blocks parse without a bundler', () => {
  const blocks = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/.test(match[1]) && match[2].trim());
  assert.ok(blocks.length > 0, 'Expected inline application scripts');
  blocks.forEach((match, index) => {
    new vm.Script(match[2], { filename: 'inline-script-' + index + '.js' });
  });
});

test('chronological comparator orders timestamps then stable IDs', () => {
  const compare = vm.runInNewContext('(' + extractFunction('compareMessagesChronologically') + ')');
  assert.ok(compare({ created_at: '2026-11-09T10:00:00Z', id: 'a' }, { created_at: '2026-11-09T10:00:00Z', id: 'b' }) < 0);
  assert.ok(compare({ created_at: '2026-11-09T10:00:01Z', id: 'a' }, { created_at: '2026-11-09T10:00:00Z', id: 'z' }) > 0);
});

test('message renderer serializes same-ID work and retries with the newest row', async () => {
  const state = { active: { id: 'c1' }, messageLoadVersion: 7, messages: [], messageIds: new Set(), messageRenderPromises: new Map() };
  let releaseFirst;
  const gate = new Promise(resolve => { releaseFirst = resolve; });
  const calls = [];
  const renderMessageInternal = async message => {
    calls.push(message.version);
    if (calls.length === 1) { await gate; return false; }
    state.messageIds.add(message.id);
    return true;
  };
  const renderMessage = vm.runInNewContext('(' + extractFunction('renderMessage') + ')', { state, renderMessageInternal });
  const oldRow = { id: 'm1', version: 'old' }, newRow = { id: 'm1', version: 'new' };
  state.messages = [oldRow];
  const first = renderMessage(oldRow, 'c1', 7);
  await Promise.resolve();
  state.messages = [newRow];
  const second = renderMessage(oldRow, 'c1', 7);
  releaseFirst();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.deepEqual(calls, ['old', 'new']);
  assert.equal(state.messageIds.has('m1'), true);
  assert.equal(state.messageRenderPromises.size, 0);
});

test('renderer rejects an obsolete request token before starting work', async () => {
  const state = { active: { id: 'c1' }, messageLoadVersion: 9, messages: [], messageIds: new Set(), messageRenderPromises: new Map() };
  let calls = 0;
  const renderMessage = vm.runInNewContext('(' + extractFunction('renderMessage') + ')', { state, renderMessageInternal: async () => { calls += 1; return true; } });
  assert.equal(await renderMessage({ id: 'm1' }, 'c1', 8), false);
  assert.equal(calls, 0);
});

test('poll cadence preserves connected, disconnected and background intervals', () => {
  const state = { realtimeStatus: 'SUBSCRIBED' }, document = { visibilityState: 'visible' };
  const delay = vm.runInNewContext('(' + extractFunction('messagePollingDelay') + ')', { state, document });
  assert.equal(delay(), 30000);
  state.realtimeStatus = 'CHANNEL_ERROR';
  assert.equal(delay(), 8000);
  document.visibilityState = 'hidden';
  assert.equal(delay(), 60000);
});

test('receipt writes are serialized per conversation in one client session', async () => {
  const updates = [], resolvers = [];
  const supabaseClient = {
    from() {
      return { update(patch) {
        updates.push(patch);
        return { eq() { return { eq() { return new Promise(resolve => resolvers.push(resolve)); } }; } };
      } };
    }
  };
  const state = { user: { id: 'u1' }, active: { id: 'c1', members: [] }, messageLoadVersion: 3, memberReads: {}, conversations: [], messages: [] };
  const document = { querySelectorAll: () => [] };
  const receipt = vm.runInNewContext('(' + extractFunction('markConversationReceipt') + ')', {
    state, supabaseClient, document, renderConversations() {}, renderMessageStatus() {}, console
  });
  const first = receipt('c1', false, 3);
  await new Promise(resolve => setImmediate(resolve));
  const second = receipt('c1', true, 3);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates.length, 1);
  resolvers[0]({ error: null });
  assert.equal(await first, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates.length, 2);
  assert.ok('last_read_at' in updates[1]);
  resolvers[1]({ error: null });
  assert.equal(await second, true);
  assert.equal(state.receiptQueues.size, 0);
});

test('render and initial-load paths retain stale-result guards', () => {
  const render = extractFunction('renderMessageInternal'), load = extractFunction('loadMessages');
  assert.match(render, /if\(!isCurrent\(\)\)return false/);
  assert.match(render, /createSignedUrl\(m\.attachment_path,3600\)/);
  assert.match(load, /if\(requestId!==state\.messageLoadVersion\|\|state\.active\?\.id!==conversationId\)return false/);
  assert.match(load, /state\.messagePollCursor=\(data\|\|\)\[0\]/);
});

test('fallback synchronization is cursor-based and reconciles edits and deletions', () => {
  const poll = extractFunction('pollMessagesFallback');
  assert.match(poll, /messagePollCursor/);
  assert.match(poll, /and\(created_at\.eq\./);
  assert.match(poll, /id\.gt\./);
  assert.match(poll, /edited_at\.gt\./);
  assert.match(poll, /deleted_at\.gt\./);
  assert.match(poll, /limit\(200\)/);
  assert.match(poll, /messageRequestId!==state\.messageLoadVersion/);
});

test('send attempts reuse a stable message ID and uploaded attachment on retry', () => {
  const send = extractFunction('sendMessage');
  assert.match(send, /pendingMessageSends/);
  assert.match(send, /id:crypto\.randomUUID\(\)/);
  assert.match(send, /insert\(\{id:pendingSend\.id/);
  assert.match(send, /eq\('id',pendingSend\.id\)/);
  assert.match(send, /pendingSend\?\.attachmentPath/);
  assert.match(send, /Number\(verified\.edit_revision\|\|0\)<=expectedRevision/);
  assert.match(send, /finally\{state\.uploading=false;resizeComposer\(\)\}/);
});

test('group-only-admin restrictions survive composer, polling and voice entry points', () => {
  assert.match(extractFunction('resizeComposer'), /groupBlocked/);
  assert.match(extractFunction('pollMessagesFallback'), /groupReadOnly/);
  assert.match(extractFunction('startVoiceRecording'), /only_admins_can_send/);
});
