#!/usr/bin/env node
// Disposable-local-only sustained message-write pressure probe.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const rawIds = process.env.LOCAL_SYNTHETIC_AUTH_USERS_JSON;
if (!rawIds) throw new Error('LOCAL_SYNTHETIC_AUTH_USERS_JSON is required.');
let users;
try { users = JSON.parse(rawIds); } catch { throw new Error('Invalid synthetic identity map.'); }
const userA = users?.direct_a, userB = users?.direct_b;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!uuid.test(userA || '') || !uuid.test(userB || '')) throw new Error('Invalid synthetic load-test identities.');

const rawDb = process.env.LOCAL_SUPABASE_DB_URL;
if (!rawDb) throw new Error('LOCAL_SUPABASE_DB_URL is required.');
const db = new URL(rawDb);
const host = db.hostname.replace(/^\[|\]$/g, '').toLowerCase();
if (!['postgres:', 'postgresql:'].includes(db.protocol)
  || !['127.0.0.1', 'localhost', '::1'].includes(host)
  || db.port !== '54322' || db.username !== 'postgres' || db.pathname !== '/postgres'
  || db.search || db.hash) throw new Error('Refusing non-local message load target.');

function psql(sql) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn('psql', [
      '--no-psqlrc', '--quiet', '--tuples-only', '--no-align',
      '--set=ON_ERROR_STOP=1', '--command', sql, rawDb
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH || '', PGCONNECT_TIMEOUT: '5', PGOPTIONS: '-c statement_timeout=30s -c lock_timeout=10s' }
    });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', value => { stdout += value; });
    child.stderr.setEncoding('utf8').on('data', value => { stderr += value; });
    child.once('error', reject);
    child.once('close', code => {
      const elapsed = performance.now() - started;
      if (code !== 0) reject(new Error('Local load query failed (' + code + '): ' + stderr.trim()));
      else resolve({ stdout: stdout.trim(), elapsed });
    });
  });
}

const conversation = await psql(
  "SELECT c.id::text FROM public.conversations c " +
  "WHERE c.type='direct' " +
  "AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id AND m.user_id='" + userA + "'::uuid) " +
  "AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id AND m.user_id='" + userB + "'::uuid) " +
  "AND (SELECT count(*) FROM public.conversation_members m WHERE m.conversation_id=c.id)=2 " +
  "ORDER BY c.created_at DESC LIMIT 1;"
);
const conversationId = conversation.stdout.split(/\s+/).find(value => uuid.test(value));
if (!conversationId) throw new Error('No two-member synthetic direct conversation exists for the local load probe.');

const marker = 'bizmindmakers-local-pressure-' + randomUUID();
const batchSize = 40, batches = 3, expected = batchSize * batches;
const latencies = [];
const persistedIds = new Set();
let succeeded = 0;

try {
  console.log('MESSAGE_LOAD_TARGET=disposable-local-postgres');
  console.log('MESSAGE_LOAD_CONCURRENCY=' + batchSize);
  console.log('MESSAGE_LOAD_BATCHES=' + batches);
  console.log('MESSAGE_LOAD_EXPECTED_WRITES=' + expected);

  for (let batch = 0; batch < batches; batch += 1) {
    const started = performance.now();
    const tasks = Array.from({ length: batchSize }, (_, index) => {
      const ordinal = batch * batchSize + index;
      const sender = ordinal % 2 === 0 ? userA : userB;
      const content = marker + '-' + ordinal;
      const sql = "BEGIN;\nSET LOCAL ROLE authenticated;\n" +
        "SELECT set_config('request.jwt.claim.sub', '" + sender + "', true);\n" +
        "INSERT INTO public.chat_messages(conversation_id, sender_id, content) VALUES ('" +
        conversationId + "'::uuid, '" + sender + "'::uuid, '" + content + "') RETURNING id;\nCOMMIT;";
      return psql(sql).then(result => ({ ...result, content }));
    });
    const results = await Promise.allSettled(tasks);
    const failure = results.find(item => item.status === 'rejected');
    if (failure) throw failure.reason;
    const elapsed = performance.now() - started;
    for (const item of results) {
      const id = item.value.stdout.split(/\s+/).find(value => uuid.test(value));
      if (!id || persistedIds.has(id)) throw new Error('Missing or duplicate persisted message ID during load batch.');
      persistedIds.add(id);
      latencies.push(item.value.elapsed);
    }
    succeeded += results.length;
    console.log('MESSAGE_LOAD_BATCH=' + (batch + 1) + ';writes=' + results.length + ';wall_ms=' + Math.round(elapsed));
  }

  const persisted = await psql(
    "SELECT count(*)::text || '|' || count(DISTINCT id)::text FROM public.chat_messages " +
    "WHERE conversation_id='" + conversationId + "'::uuid AND content LIKE '" + marker + "-%';"
  );
  const [count, unique] = persisted.stdout.split('|');
  if (Number(count) !== expected || Number(unique) !== expected || persistedIds.size !== expected || succeeded !== expected) {
    throw new Error('Message load verification mismatch: expected ' + expected + ', got ' + persisted.stdout);
  }
  const sorted = latencies.slice().sort((a, b) => a - b);
  const percentile = p => Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] * 10) / 10;
  console.log('MESSAGE_LOAD_PERSISTED=' + count);
  console.log('MESSAGE_LOAD_UNIQUE_IDS=' + unique);
  console.log('MESSAGE_LOAD_P50_CLIENT_MS=' + percentile(0.50));
  console.log('MESSAGE_LOAD_P95_CLIENT_MS=' + percentile(0.95));
  console.log('MESSAGE_LOAD_MAX_CLIENT_MS=' + Math.round(sorted.at(-1) * 10) / 10);
  console.log('MESSAGE_LOAD_RESULT=PASSED');
} finally {
  await psql(
    "DELETE FROM public.chat_messages WHERE conversation_id='" + conversationId + "'::uuid AND content LIKE '" + marker + "-%';"
  );
}
