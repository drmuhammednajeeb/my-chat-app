import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../modules/older-message-loader.js', import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(source, { window, Set, Map, Array, Promise, Number, String, Object, console });
const api = window.BizmindOlderHistory;

test('module exposes a pagination API', () => {
  assert.equal(typeof api.loadOlderMessages, 'function');
});

test('pagination exits safely when required state or area is unavailable', async () => {
  assert.equal(await api.loadOlderMessages({ state: {}, $: () => null }), false);
  const state = { active: { id: 'c' }, loadingOlderMessages: false, hasMoreMessages: true, messages: [] };
  assert.equal(await api.loadOlderMessages({ state, $: () => null }), false);
});

test('older history request uses a stable cursor and commits only in the current conversation', async () => {
  const area = {
    childNodes: [], children: [], style: {}, scrollTop: 0,
    prepend(node) { this.children.unshift(node); this.childNodes = this.children; node.nextSibling=this.children[1]||null; },
    querySelectorAll(selector) { return selector === '.message' ? this.children.filter(node => node.className === 'message') : []; },
    getBoundingClientRect() { return { top: 0, bottom: 400 }; },
    insertBefore(fragment, target) { const at = this.children.indexOf(target); this.children.splice(at < 0 ? this.children.length : at, 0, ...fragment.childNodes); this.childNodes = this.children; },
  };
  const original = { id: 'm3', conversation_id: 'c', created_at: '2026-01-03T00:00:00Z' };
  const oldNode = { className: 'message', dataset: { messageId: 'm3' }, getBoundingClientRect() { return { top: 300, bottom: 340 }; } };
  area.children.push(oldNode); area.childNodes = area.children;
  const state = { active: { id: 'c' }, loadingOlderMessages: false, hasMoreMessages: true,
    messages: [original], messageIds: new Set(['m3']), messageLoadVersion: 4,
    loadedHistoryIds: new Set(), replyMessages: new Map() };
  const older = [{ id: 'm2', conversation_id: 'c', created_at: '2026-01-02T00:00:00Z' }, { id: 'm1', conversation_id: 'c', created_at: '2026-01-01T00:00:00Z' }];
  let cursor = '';
  const query = {
    select() { return this; }, eq() { return this; }, or(value) { cursor = value; return this; },
    gt() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: older.slice().reverse(), error: null }); }
  };
  const supabaseClient = { from(table) { assert.equal(table, 'chat_messages'); return query; } };
  const document = { createElement() { return { className: '', textContent: '', remove() { area.children.splice(area.children.indexOf(this), 1); area.childNodes=area.children; } }; },
    createDocumentFragment() { return { childNodes: [], append(node) { const i=area.children.indexOf(node); if(i>=0) area.children.splice(i,1); this.childNodes.push(node); area.childNodes=area.children; } }; },
  const renderMessage = async message => {
    const node = { className: 'message', dataset: { messageId: message.id, createdAt: message.created_at }, getBoundingClientRect() { return { top: 100, bottom: 140 }; }, remove() {} };
    area.children.push(node); area.childNodes=area.children; state.messageIds.add(message.id); return true;
  };
  const deps = { state, $: () => area, supabaseClient, document, loadMessagePins: async()=>true,
    loadPrivateReplyContexts: async()=>true, messageReactions:{load:async()=>true}, renderMessage,
    compareMessagesChronologically:(a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at),
    rollbackCancelledOlderHistory:()=>true, reconcileMessageTimeline:()=>{}, toast:()=>{} };
  const result = await api.loadOlderMessages(deps);
  assert.equal(result, true);
  assert.match(cursor, /created_at\.lt\.2026-01-03T00:00:00Z/);
  assert.equal(state.messages.map(row=>row.id).join(','), 'm1,m2,m3');
  assert.equal(state.loadingOlderMessages, false);
  assert.equal(state.hasMoreMessages, false);
});
