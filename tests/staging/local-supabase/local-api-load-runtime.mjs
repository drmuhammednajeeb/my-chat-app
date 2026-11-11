import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

assert.equal(process.env.ALLOW_DISPOSABLE_LOCAL_REPLAY, '1',
  'LOCAL_API_LOAD_RUNTIME_REQUIRES_EXPLICIT_DISPOSABLE_REPLAY');

for (const forbidden of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_ID']) {
  assert.equal(process.env[forbidden], undefined,
    `Refusing load test with cloud-linked credential: ${forbidden}`);
}

const rawUrl = process.env.LOCAL_SUPABASE_URL ?? '';
const api = new URL(rawUrl);
assert.equal(api.protocol, 'http:', 'Local API must use HTTP loopback only');
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(api.hostname),
  'Local API host must be loopback');
assert.equal(api.port, '54321', 'Local API must use disposable Supabase port 54321');

const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY ?? '';
const password = process.env.LOCAL_SYNTHETIC_AUTH_PASSWORD ?? '';
const userIds = JSON.parse(process.env.LOCAL_SYNTHETIC_AUTH_USERS_JSON ?? '{}');
assert.ok(anonKey.length > 20, 'Local anon key is required');
assert.ok(password.length >= 20, 'Synthetic auth password is required');

const users = [
  { key: 'direct_a', email: 'direct-a@bizmindmakers.test' },
  { key: 'direct_b', email: 'direct-b@bizmindmakers.test' }
];
for (const user of users) {
  assert.match(userIds[user.key] ?? '', /^[0-9a-f-]{36}$/i,
    `Missing synthetic user ID for ${user.key}`);
}

async function signIn(user) {
  const endpoint = new URL('/auth/v1/token?grant_type=password', api);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({ email: user.email, password }),
    signal: AbortSignal.timeout(10000)
  });
  const body = await response.text();
  assert.ok(response.ok, `Synthetic sign-in failed (${response.status}): ${body.slice(0, 240)}`);
  const session = JSON.parse(body);
  assert.ok(session.access_token, 'Auth response must contain an access token');
  assert.equal(session.user?.id, userIds[user.key],
    'Auth response must match the expected synthetic identity');
  return session.access_token;
}

const sessions = await Promise.all(users.map(async user => ({
  ...user,
  token: await signIn(user)
})));

const messagesUrl = new URL('/rest/v1/chat_messages', api);
messagesUrl.searchParams.set('select', 'id,conversation_id,created_at');
messagesUrl.searchParams.set('order', 'created_at.desc');
messagesUrl.searchParams.set('limit', '10');

async function readMessages(user, token) {
  const started = performance.now();
  const response = await fetch(messagesUrl, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      accept: 'application/json'
    },
    signal: AbortSignal.timeout(8000)
  });
  const body = await response.text();
  const elapsed = performance.now() - started;
  assert.ok(response.ok,
    `Authenticated message read failed for ${user.key} (${response.status}): ${body.slice(0, 240)}`);
  const rows = JSON.parse(body);
  assert.ok(Array.isArray(rows), 'PostgREST response must be an array');
  return { elapsed, rows };
}

// Warm up both identities and prove that RLS returns the seeded conversation history.
for (const user of sessions) {
  const warmup = await readMessages(user, user.token);
  assert.ok(warmup.rows.length > 0,
    `Expected visible chat history for synthetic member ${user.key}`);
}

const concurrency = 8;
const requestsPerWorker = 25;
const latencies = [];
const started = performance.now();

await Promise.all(Array.from({ length: concurrency }, async (_, workerIndex) => {
  const user = sessions[workerIndex % sessions.length];
  for (let i = 0; i < requestsPerWorker; i += 1) {
    const result = await readMessages(user, user.token);
    latencies.push(result.elapsed);
  }
}));

const elapsed = performance.now() - started;
latencies.sort((a, b) => a - b);
const percentile = p => latencies[Math.min(latencies.length - 1, Math.ceil(p * latencies.length) - 1)];
const p50 = percentile(0.50);
const p95 = percentile(0.95);
const max = latencies[latencies.length - 1];
const requests = latencies.length;
const rps = requests / (elapsed / 1000);

assert.equal(requests, concurrency * requestsPerWorker,
  'Every bounded load-test request must complete');
assert.ok(p95 <= 2500,
  `Local PostgREST p95 exceeded 2500ms: ${p95.toFixed(1)}ms`);
assert.ok(max <= 8000,
  `Local PostgREST max latency exceeded 8000ms: ${max.toFixed(1)}ms`);

console.log(`LOCAL_API_LOAD_REQUESTS=${requests}`);
console.log(`LOCAL_API_LOAD_CONCURRENCY=${concurrency}`);
console.log(`LOCAL_API_LOAD_P50_MS=${p50.toFixed(1)}`);
console.log(`LOCAL_API_LOAD_P95_MS=${p95.toFixed(1)}`);
console.log(`LOCAL_API_LOAD_MAX_MS=${max.toFixed(1)}`);
console.log(`LOCAL_API_LOAD_RPS=${rps.toFixed(1)}`);
console.log('LOCAL_API_LOAD=PASSED');
