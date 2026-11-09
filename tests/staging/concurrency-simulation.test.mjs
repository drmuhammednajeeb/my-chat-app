import test from 'node:test';
import assert from 'node:assert/strict';

// Deliberately isolated in-memory model. This does not import app code,
// contact Supabase, or represent a real backend load test.
function createFakeMessageStore() {
  const rows = new Map();
  let insertAttempts = 0;
  return {
    async insert(id, payload) {
      insertAttempts += 1;
      await Promise.resolve();
      if (rows.has(id)) return { inserted: false, row: rows.get(id) };
      const row = { id, ...payload };
      rows.set(id, row);
      return { inserted: true, row };
    },
    get size() { return rows.size; },
    get insertAttempts() { return insertAttempts; },
    values() { return [...rows.values()]; }
  };
}

test('simulation: concurrent duplicate requests converge to one stable message ID', async () => {
  const store = createFakeMessageStore();
  const id = 'simulated-message-001';
  const requests = Array.from({ length: 40 }, (_, index) =>
    store.insert(id, { content: 'same logical message', request: index })
  );
  const results = await Promise.all(requests);
  assert.equal(store.size, 1);
  assert.equal(store.insertAttempts, 40);
  assert.equal(results.filter(result => result.inserted).length, 1);
  assert.equal(store.values()[0].id, id);
});

test('simulation: independent message IDs remain independently persisted', async () => {
  const store = createFakeMessageStore();
  await Promise.all(Array.from({ length: 60 }, (_, index) =>
    store.insert(`sim-${index}`, { content: `message-${index}` })
  ));
  assert.equal(store.size, 60);
  assert.equal(new Set(store.values().map(row => row.id)).size, 60);
});
