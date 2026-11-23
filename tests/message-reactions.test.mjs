import test from 'node:test';
import assert from 'node:assert/strict';
import reactions from '../modules/message-reactions.js';

function fakeReactionDatabase(initialRows = [], options = {}) {
  const rows = new Map(initialRows.map(row => [row.message_id + ':' + row.user_id, { ...row }]));
  const calls = [];
  let failedInserts = Number(options.failedInserts || 0);
  const client = {
    from(table) {
      assert.equal(table, 'message_reactions');
      return {
        insert(payload) {
          calls.push({ kind: 'insert', payload: { ...payload } });
          if (failedInserts > 0) {
            failedInserts -= 1;
            return Promise.resolve({ error: new Error('insert denied') });
          }
          const key = payload.message_id + ':' + payload.user_id;
          if (rows.has(key)) return Promise.resolve({ error: Object.assign(new Error('duplicate key'), { code: '23505' }) });
          rows.set(key, { ...payload });
          return Promise.resolve({ error: null });
        },
        delete() {
          const filters = [];
          const query = {
            eq(key, value) { filters.push([key, value]); return this; },
            then(resolve, reject) {
              calls.push({ kind: 'delete', filters: filters.slice() });
              const messageId = filters.find(([key]) => key === 'message_id')?.[1];
              const userId = filters.find(([key]) => key === 'user_id')?.[1];
              rows.delete(messageId + ':' + userId);
              return Promise.resolve({ error: null }).then(resolve, reject);
            }
          };
          return query;
        },
        select() {
          const filters = [];
          return {
            eq(key, value) { filters.push([key, value]); return this; },
            maybeSingle() {
              const messageId = filters.find(([key]) => key === 'message_id')?.[1];
              const userId = filters.find(([key]) => key === 'user_id')?.[1];
              return Promise.resolve({ data: rows.get(messageId + ':' + userId) || null, error: null });
            }
          };
        }
      };
    }
  };
  return { client, rows, calls };
}

function createHarness(database, initialRows = [], notices = []) {
  const state = {
    user: { id: 'u1' }, active: { id: 'c1' }, messageLoadVersion: 4,
    reactions: new Map(initialRows.length ? [['m1', initialRows.map(row => ({ ...row }))]] : [])
  };
  const document = {
    querySelectorAll: () => [],
    addEventListener() {},
    documentElement: { dir: 'rtl' }
  };
  const api = reactions.create({
    state, supabaseClient: database.client, document,
    toast: value => notices.push(value)
  });
  return { state, api };
}

test('reaction options stay aligned with the production database constraint', () => {
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

test('add, switch and remove use only INSERT and DELETE privileges', async () => {
  const database = fakeReactionDatabase();
  const { state, api } = createHarness(database);
  const message = { id: 'm1', conversation_id: 'c1' };

  assert.equal(await api.toggle(message, 'like'), true);
  assert.equal(state.reactions.get('m1')[0].reaction_type, 'like');
  assert.equal(await api.toggle(message, 'heart'), true);
  assert.equal(state.reactions.get('m1')[0].reaction_type, 'heart');
  assert.equal(await api.toggle(message, 'heart'), true);
  assert.equal(state.reactions.has('m1'), false);

  assert.deepEqual(database.calls.map(call => call.kind), ['insert', 'delete', 'insert', 'delete']);
  assert.equal(database.rows.size, 0);
  assert.equal(database.calls.some(call => call.kind === 'upsert'), false);
});

test('failed reaction switch restores the previous persisted reaction', async () => {
  const previous = {
    conversation_id: 'c1', message_id: 'm1', user_id: 'u1', reaction_type: 'like'
  };
  const database = fakeReactionDatabase([previous], { failedInserts: 1 });
  const notices = [];
  const { state, api } = createHarness(database, [previous], notices);

  assert.equal(await api.toggle({ id: 'm1', conversation_id: 'c1' }, 'heart'), false);
  assert.equal(database.rows.get('m1:u1')?.reaction_type, 'like');
  assert.equal(state.reactions.get('m1')[0].reaction_type, 'like');
  assert.equal(database.calls.map(call => call.kind).join(','), 'delete,insert,insert');
  assert.equal(notices.length, 1);
});

test('failed first insert leaves no optimistic reaction behind', async () => {
  const database = fakeReactionDatabase([], { failedInserts: 1 });
  const notices = [];
  const { state, api } = createHarness(database, [], notices);

  assert.equal(await api.toggle({ id: 'm1', conversation_id: 'c1' }, 'like'), false);
  assert.equal(state.reactions.has('m1'), false);
  assert.equal(database.rows.size, 0);
  assert.equal(notices.length, 1);
});

test('stale conversation cannot mutate a different conversation', async () => {
  const database = fakeReactionDatabase();
  const { state, api } = createHarness(database);
  state.active = { id: 'c2' };
  assert.equal(await api.toggle({ id: 'm1', conversation_id: 'c1' }, 'like'), false);
  assert.equal(database.calls.length, 0);
});
