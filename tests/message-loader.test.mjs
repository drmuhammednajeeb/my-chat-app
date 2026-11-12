import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../modules/message-loader.js', import.meta.url), 'utf8');
const sandbox = { console, Date, Set, Map, Array, Number, String, Promise, Object };
vm.runInNewContext(source, sandbox, { filename: 'message-loader.js' });
const { loadMessages } = sandbox.BizmindMessageLoader;

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.childNodes = this.children;
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 100;
    this.style = {};
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this.childNodes = this.children; }
  querySelectorAll(selector) { return selector === '.message' ? this.children.filter(node => node.className === 'message') : []; }
  getBoundingClientRect() { return { top: 0, bottom: 100 }; }
}
function queryResult(result, hooks = {}) {
  const query = {
    select() { return this; },
    eq() { return this; },
    gt() { return this; },
    in() { return this; },
    order() { return this; },
    limit() { return this; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); }
  };
  return query;
}
function harness({ rows = [], error = null, render = null, metadata = {}, beforeResolve = null } = {}) {
  const area = new Element('section');
  const state = {
    active: { id: 'conversation-1' },
    messageLoadVersion: 0,
    messageTimelineConversationId: 'conversation-1',
    messages: [{ id: 'old', conversation_id: 'conversation-1', created_at: '2025-12-31T00:00:00Z' }],
    messageIds: new Set(['old']),
    replyMessages: new Map(),
    diagnostics: {},
    activeChatPreference: null
  };
  const oldNode = new Element('article'); oldNode.className = 'message'; oldNode.dataset.messageId = 'old';
  area.append(oldNode);
  const calls = { render: [], receipt: 0, toast: [], logs: [] };
  const supabaseClient = {
    from(table) {
      if (table === 'chat_messages') return queryResult({ data: rows, error }, {
        then: beforeResolve
      });
      throw new Error('Unexpected table: ' + table);
    }
  };
  const deps = {
    state, $: () => area, supabaseClient,
    document: { visibilityState: 'visible', createElement: tag => new Element(tag) },
    updateNewMessagesIndicator() {},
    diagLog: (...args) => calls.logs.push(args),
    recordPerf() {},
    compareMessagesChronologically: (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || String(a.id).localeCompare(String(b.id)),
    loadMessagePins: async () => metadata.pins ?? true,
    loadPrivateReplyContexts: async () => metadata.privateReplies ?? true,
    renderMessage: async message => {
      calls.render.push(message.id);
      if (render) return render(message, area, state);
      const node = new Element('article'); node.className = 'message'; node.dataset.messageId = message.id;
      area.append(node); state.messageIds.add(message.id); return true;
    },
    markConversationReceipt: async () => { calls.receipt += 1; },
    toast: message => calls.toast.push(message),
    performance: { now: () => 10 }
  };
  return { area, state, calls, deps, oldNode };
}

test('empty conversation completes without scope errors and renders a deliberate empty state', async () => {
  const h = harness({ rows: [] });
  assert.equal(await loadMessages(h.deps), true);
  assert.equal(h.area.children.length, 1);
  assert.equal(h.area.children[0].children[0].textContent, 'بداية محادثة جديدة');
  assert.equal(h.calls.receipt, 1);
  assert.equal(h.state.isLoadingMessages, false);
  assert.equal(h.state.messageTimelineConversationId, 'conversation-1');
});

test('populated conversation renders all rows and marks receipt once', async () => {
  const rows = [
    { id: 'm2', conversation_id: 'conversation-1', created_at: '2026-01-02T00:00:00Z' },
    { id: 'm1', conversation_id: 'conversation-1', created_at: '2026-01-01T00:00:00Z' }
  ];
  const h = harness({ rows });
  assert.equal(await loadMessages(h.deps), true);
  assert.deepEqual(h.calls.render, ['m1', 'm2']);
  assert.equal(h.state.messages.length, 2);
  assert.equal(h.calls.receipt, 1);
  assert.equal(h.state.hasMoreMessages, false);
});

test('optional pin and private-reply metadata failures do not block authoritative message rendering', async () => {
  const rows = [{ id: 'm1', conversation_id: 'conversation-1', created_at: '2026-01-01T00:00:00Z' }];
  const h = harness({ rows, metadata: { pins: Promise.reject(new Error('pins offline')), privateReplies: Promise.reject(new Error('private replies offline')) } });
  assert.equal(await loadMessages(h.deps), true);
  assert.deepEqual(h.calls.render, ['m1']);
});

test('same-conversation fetch failure preserves the rendered timeline and message state', async () => {
  const h = harness({ error: new Error('network unavailable') });
  const beforeMessages = h.state.messages;
  assert.equal(await loadMessages(h.deps), false);
  assert.equal(h.area.children[0], h.oldNode);
  assert.equal(h.state.messages, beforeMessages);
  assert.equal(h.state.messageIds.has('old'), true);
  assert.equal(h.state.isLoadingMessages, false);
  assert.ok(h.state.diagnostics.lastFetchError);
});

test('stale request cannot render into a conversation opened while fetch is pending', async () => {
  let resolveQuery;
  const pending = new Promise(resolve => { resolveQuery = resolve; });
  const h = harness();
  h.deps.supabaseClient.from = () => ({
    select() { return this; }, eq() { return this; }, gt() { return this; },
    order() { return this; }, limit() { return pending; }
  });
  const operation = loadMessages(h.deps);
  await Promise.resolve();
  h.state.active = { id: 'conversation-2' };
  resolveQuery({ data: [{ id: 'late', conversation_id: 'conversation-1', created_at: '2026-01-03T00:00:00Z' }], error: null });
  assert.equal(await operation, false);
  assert.deepEqual(h.calls.render, []);
});

test('failed render rolls back the entire timeline instead of leaving a partial transcript', async () => {
  const rows = [{ id: 'new', conversation_id: 'conversation-1', created_at: '2026-01-02T00:00:00Z' }];
  const h = harness({ rows, render: async () => false });
  assert.equal(await loadMessages(h.deps), false);
  assert.equal(h.area.children[0], h.oldNode);
  assert.deepEqual(h.state.messages.map(message => message.id), ['old']);
  assert.equal(h.state.messageIds.has('old'), true);
  assert.equal(h.state.isLoadingMessages, false);
});

test('initial transcript rendering overlaps bounded attachment work and reconciles once', async () => {
  const rows = Array.from({ length: 14 }, (_, index) => ({
    id: 'm' + String(index + 1).padStart(2, '0'),
    conversation_id: 'conversation-1',
    created_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString()
  })).reverse();
  const h = harness({ rows });
  let active = 0, maximumActive = 0, reconciliations = 0;
  h.deps.renderMessage = async message => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, 4));
    const node = new Element('article');
    node.className = 'message';
    node.dataset.messageId = message.id;
    h.area.append(node);
    h.state.messageIds.add(message.id);
    active -= 1;
    return true;
  };
  h.deps.reconcileMessageTimeline = () => { reconciliations += 1; };
  assert.equal(await loadMessages(h.deps), true);
  assert.ok(maximumActive > 1, 'independent message rendering should overlap');
  assert.ok(maximumActive <= 6, 'render concurrency must remain bounded');
  assert.equal(reconciliations, 1, 'timeline order should be reconciled once per initial batch');
  assert.equal(h.state.batchRenderingMessages, undefined);
  assert.equal(h.state.batchRenderingConversationId, undefined);
});

test('source declares render completion before the empty/populated branch', async () => {
  const declaration = source.indexOf('let allMessagesRendered = true;');
  const emptyBranch = source.indexOf('if (!messages.length)');
  assert.ok(declaration >= 0 && emptyBranch > declaration);
});


test('overlapping loads serialize and roll back a superseded partial render before the next commit', async () => {
  const rows = [
    { id: 'm2', conversation_id: 'conversation-1', created_at: '2026-01-02T00:00:00Z' },
    { id: 'm1', conversation_id: 'conversation-1', created_at: '2026-01-01T00:00:00Z' }
  ];
  let releaseFirst, startedFirst;
  const gate = new Promise(resolve => { releaseFirst = resolve; });
  const started = new Promise(resolve => { startedFirst = resolve; });
  const h = harness({ rows });
  let renderCalls = 0;
  h.deps.renderMessage = async message => {
    renderCalls += 1;
    if (renderCalls === 1) {
      const partial = new Element('article'); partial.className = 'message'; partial.dataset.messageId = message.id;
      h.area.append(partial); h.state.messageIds.add(message.id);
      startedFirst();
      await gate;
      return true;
    }
    const node = new Element('article'); node.className = 'message'; node.dataset.messageId = message.id;
    h.area.append(node); h.state.messageIds.add(message.id);
    return true;
  };
  const first = loadMessages(h.deps);
  await started;
  const second = loadMessages(h.deps);
  releaseFirst();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.deepEqual(h.area.children.filter(node => node.className === 'message').map(node => node.dataset.messageId), ['m1', 'm2']);
  assert.equal(h.state.messageIds.size, 2);
  assert.equal(h.state.isLoadingMessages, false);
});
