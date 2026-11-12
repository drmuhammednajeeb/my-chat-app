import test from 'node:test';
import assert from 'node:assert/strict';
import reactions from '../modules/message-reactions.js';

test('reaction options stay aligned with the existing database constraint', () => {
  assert.deepEqual(reactions.REACTION_OPTIONS.map(item => item.type), ['like', 'heart']);
  assert.deepEqual(reactions.REACTION_OPTIONS.map(item => item.emoji), ['👍', '❤️']);
});

test('normalizes persisted rows by message and prevents duplicate user reactions', () => {
  const rows = [
    { message_id: 'm1', user_id: 'u1', reaction_type: 'like' },
    { message_id: 'm1', user_id: 'u1', reaction_type: 'heart' },
    { message_id: 'm1', user_id: 'u2', reaction_type: 'heart' },
    { message_id: 'm2', user_id: 'u3', reaction_type: 'fire' }
  ];
  const grouped = reactions.normalizeRows(rows, ['m1']);
  assert.deepEqual(grouped.get('m1').map(row => row.user_id), ['u1', 'u2']);
  assert.equal(grouped.has('m2'), false);
});

test('realtime insert and update replace one member row; delete is idempotent', () => {
  const initial = [{ message_id: 'm1', user_id: 'u1', reaction_type: 'like' }];
  const updated = reactions.applyRealtimeEvent(initial, {
    eventType: 'UPDATE',
    new: { message_id: 'm1', conversation_id: 'c1', user_id: 'u1', reaction_type: 'heart' },
    old: initial[0]
  }, 'c1');
  assert.deepEqual(updated.map(row => [row.user_id, row.reaction_type]), [['u1', 'heart']]);
  const removed = reactions.applyRealtimeEvent(updated, {
    eventType: 'DELETE',
    old: { message_id: 'm1', conversation_id: 'c1', user_id: 'u1' }
  }, 'c1');
  assert.deepEqual(removed, []);
  assert.deepEqual(reactions.applyRealtimeEvent(removed, {
    eventType: 'DELETE',
    old: { message_id: 'm1', conversation_id: 'c1', user_id: 'u1' }
  }, 'c1'), []);
});

test('optimistic toggle persists add, change and remove with one reaction per user', async () => {
  const writes = [];
  const state = { user: { id: 'u1' }, active: { id: 'c1' }, messageLoadVersion: 4, reactions: new Map() };
  const supabaseClient = {
    from(table) {
      assert.equal(table, 'message_reactions');
      return {
        upsert(payload, options) { writes.push({ kind: 'upsert', payload, options }); return Promise.resolve({ error: null }); },
        delete() {
          const query = { filters: [], eq(key, value) { this.filters.push([key, value]); return this; }, then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); } };
          return query;
        }
      };
    }
  };
  const document = { querySelectorAll: () => [], addEventListener() {}, documentElement: { dir: 'rtl' } };
  const api = reactions.create({ state, supabaseClient, document, toast() {} });
  const message = { id: 'm1', conversation_id: 'c1' };
  assert.equal(await api.toggle(message, 'like'), true);
  assert.equal(state.reactions.get('m1')[0].reaction_type, 'like');
  assert.equal(await api.toggle(message, 'heart'), true);
  assert.equal(state.reactions.get('m1')[0].reaction_type, 'heart');
  assert.equal(await api.toggle(message, 'heart'), true);
  assert.equal(state.reactions.has('m1'), false);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].options.onConflict, 'message_id,user_id');
});

test('failed persistence rolls back only the current user and preserves other members', async () => {
  const state = {
    user: { id: 'u1' }, active: { id: 'c1' }, messageLoadVersion: 9,
    reactions: new Map([['m1', [{ message_id: 'm1', user_id: 'u2', reaction_type: 'heart' }]]])
  };
  const supabaseClient = {
    from() { return { upsert() { return Promise.resolve({ error: new Error('offline') }); } }; }
  };
  const document = { querySelectorAll: () => [], addEventListener() {}, documentElement: { dir: 'rtl' } };
  const notices = [];
  const api = reactions.create({ state, supabaseClient, document, toast: value => notices.push(value) });
  assert.equal(await api.toggle({ id: 'm1', conversation_id: 'c1' }, 'like'), false);
  assert.deepEqual(state.reactions.get('m1').map(row => [row.user_id, row.reaction_type]), [['u2', 'heart']]);
  assert.equal(notices.length, 1);
});
