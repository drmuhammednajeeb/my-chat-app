#!/usr/bin/env node
// Exercises the real local Supabase Auth + Realtime WebSocket + PostgREST path.
// This runner is only valid against the disposable loopback stack created by CI.
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

function fail(message) {
  console.error('LOCAL_REALTIME_RUNTIME_BLOCKED=' + message);
  process.exit(1);
}

const rawApi = process.env.LOCAL_SUPABASE_URL;
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY;
const password = process.env.LOCAL_SYNTHETIC_AUTH_PASSWORD;
let api;
try { api = new URL(rawApi); } catch { fail('invalid local Supabase API URL'); }
const host = api.hostname.replace(/^\[|\]$/g, '').toLowerCase();
if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(host)
  || api.port !== '54321' || api.pathname !== '/' || api.username || api.password || api.search || api.hash) {
  fail('refusing non-loopback Supabase API target');
}
if (!anonKey || !password) fail('local anon key and synthetic Auth password are required');

const rawDb = process.env.LOCAL_SUPABASE_DB_URL;
let db;
try { db = new URL(rawDb); } catch { fail('invalid local PostgreSQL URL'); }
const dbHost = db.hostname.replace(/^\\[|\\]$/g, '').toLowerCase();
if (!['postgres:', 'postgresql:'].includes(db.protocol)
  || !['127.0.0.1', 'localhost', '::1'].includes(dbHost)
  || db.port !== '54322' || db.username !== 'postgres' || db.pathname !== '/postgres'
  || db.search || db.hash) fail('refusing non-loopback PostgreSQL catalog target');
function psql(sql) {
  const result = spawnSync('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1', '--command', sql, rawDb], {
    encoding: 'utf8', env: { PATH: process.env.PATH, PGCONNECT_TIMEOUT: '5' }
  });
  if (result.error || result.status !== 0) throw new Error('Local PostgreSQL diagnostic query failed: ' + (result.stderr || result.error?.message || result.status));
  return result.stdout.trim();
}
const realtimeTables = psql(`SELECT string_agg(tablename, ',' ORDER BY tablename)
  FROM pg_publication_tables
  WHERE pubname='supabase_realtime' AND schemaname='public'
    AND tablename IN ('chat_messages','message_reactions');`);
if (realtimeTables !== 'chat_messages,message_reactions') {
  throw new Error('Required chat tables are not both in supabase_realtime publication: ' + realtimeTables);
}
console.log('LOCAL_REALTIME_PUBLICATION_TABLES=' + realtimeTables);


let users;
try { users = JSON.parse(process.env.LOCAL_SYNTHETIC_AUTH_USERS_JSON || '{}'); } catch { fail('invalid synthetic Auth identity map'); }
for (const key of ['direct_a', 'direct_b', 'direct_c']) {
  if (typeof users[key] !== 'string') fail('missing synthetic identity ' + key);
}

const makeClient = () => createClient(api.origin, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 20 } },
  global: { fetch: (input, init = {}) => fetch(input, { ...init, signal: init.signal || AbortSignal.timeout(20000) }) }
});
const clientA = makeClient();
const clientC = makeClient();
const events = [];
const waiters = [];

function record(event) {
  events.push(event);
  for (let i = waiters.length - 1; i >= 0; i -= 1) {
    const waiter = waiters[i];
    if (!waiter.predicate(event)) continue;
    waiters.splice(i, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(event);
  }
}
function waitForEvent(predicate, label, timeoutMs = 10000) {
  const existing = events.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, timer: null };
    waiter.timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error('Timed out waiting for Realtime event: ' + label));
    }, timeoutMs);
    waiters.push(waiter);
  });
}
async function signIn(client, email) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data?.session?.access_token) throw new Error('Synthetic Auth sign-in failed for ' + email + ': ' + (error?.message || 'no session'));
  client.realtime.setAuth(data.session.access_token);
  return data.user.id;
}
async function createDirect(client, otherUserId) {
  const { data, error } = await client.rpc('get_or_create_direct_conversation', { p_other_user_id: otherUserId });
  if (error || typeof data !== 'string') throw new Error('Direct conversation RPC failed: ' + (error?.message || 'invalid conversation ID'));
  return data;
}
async function subscribeToConversation(client, conversationId) {
  const channel = client.channel('clean-core-realtime:' + conversationId + ':' + randomUUID(), {
    config: { postgres_changes_options: { wait: true, timeout: 15000 } }
  });
  channel.on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'chat_messages',
    filter: 'conversation_id=eq.' + conversationId
  }, payload => record({ kind: 'message', conversationId, payload }));
  channel.on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'message_reactions',
    filter: 'conversation_id=eq.' + conversationId
  }, payload => record({ kind: 'reaction', conversationId, payload }));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime subscription timed out for ' + conversationId)), 12000);
    channel.subscribe((status, error) => {
      console.log('LOCAL_REALTIME_CHANNEL_STATUS=' + status + ' CONVERSATION=' + conversationId + (error ? ' ERROR=' + JSON.stringify({ name: error.name, message: error.message, cause: error.cause }) : ''));
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) { clearTimeout(timer); reject(new Error('Realtime subscription failed: ' + status)); }
    });
  });
  return channel;
}
async function subscribeUnfilteredMessages(client) {
  const channel = client.channel('clean-core-realtime-unfiltered:' + randomUUID(), {
    config: { postgres_changes_options: { wait: true, timeout: 15000 } }
  });
  channel.on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'chat_messages'
  }, payload => record({ kind: 'message_unfiltered', payload }));
  const bindingState = channel.bindings;
  const bindingShape = Array.isArray(bindingState)
    ? bindingState.map(binding => ({ type: binding?.type || null, filter: binding?.filter || null }))
    : { kind: Object.prototype.toString.call(bindingState), keys: bindingState && typeof bindingState === 'object' ? Object.keys(bindingState) : [] };
  console.log('LOCAL_REALTIME_BINDINGS=' + JSON.stringify(bindingShape));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Unfiltered Realtime subscription timed out')), 12000);
    channel.subscribe((status, error) => {
      console.log('LOCAL_REALTIME_UNFILTERED_STATUS=' + status + (error ? ' ERROR=' + JSON.stringify({ name: error.name, message: error.message, cause: error.cause }) : ''));
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) { clearTimeout(timer); reject(new Error('Unfiltered Realtime subscription failed: ' + status + ' ' + String(error?.message || ''))); }
    });
  });
  return channel;
}
async function insertMessage(client, conversationId, senderId, content) {
  const id = randomUUID();
  const { error } = await client.from('chat_messages').insert({
    id, conversation_id: conversationId, sender_id: senderId, content
  });
  if (error) throw new Error('Authenticated message insert failed: ' + error.message);
  return id;
}

let channel = null;
let unfilteredChannel = null;
let secondConversationId = null;
try {
  console.log('LOCAL_REALTIME_STEP=authenticate-synthetic-users');
  const userA = await signIn(clientA, 'direct-a@bizmindmakers.test');
  await signIn(clientC, 'direct-c@bizmindmakers.test');
  console.log('LOCAL_REALTIME_STEP=create-two-direct-conversations');
  const directConversationId = await createDirect(clientA, users.direct_b);
  secondConversationId = await createDirect(clientA, users.direct_c);

  console.log('LOCAL_REALTIME_STEP=subscribe-authenticated-channel');
  channel = await subscribeToConversation(clientA, directConversationId);
  unfilteredChannel = await subscribeUnfilteredMessages(clientA);
  console.log('LOCAL_REALTIME_STEP=insert-and-await-message-event');
  const firstMessageId = await insertMessage(clientA, directConversationId, userA, 'local realtime delivery probe');
  const { data: persistedMessage, error: persistedMessageError } = await clientA.from('chat_messages').select('id,conversation_id').eq('conversation_id', directConversationId).eq('id', firstMessageId).maybeSingle();
  if (persistedMessageError || persistedMessage?.id !== firstMessageId) throw new Error('PostgREST could not read the just-inserted message: ' + (persistedMessageError?.message || 'row missing'));
  console.log('PASS: authenticated PostgREST insert and read are consistent before Realtime delivery.');
  const unfilteredDelivery = await waitForEvent(
    event => event.kind === 'message_unfiltered' && event.payload.eventType === 'INSERT'
      && event.payload.new?.id === firstMessageId,
    'unfiltered authenticated chat_messages INSERT'
  );
  if (unfilteredDelivery.payload.new.conversation_id !== directConversationId) throw new Error('Unfiltered Realtime delivered a message with the wrong conversation ID');
  const delivered = await waitForEvent(
    event => event.kind === 'message' && event.conversationId === directConversationId
      && event.payload.eventType === 'INSERT' && event.payload.new?.id === firstMessageId,
    'conversation-filtered authenticated chat_messages INSERT'
  );
  if (delivered.payload.new.conversation_id !== directConversationId) throw new Error('Realtime delivered a message with the wrong conversation ID');
  console.log('PASS: authenticated local Realtime delivered both unfiltered and conversation-filtered message events over WebSocket.');

  console.log('LOCAL_REALTIME_STEP=verify-cross-conversation-isolation');
  const secondMessageId = await insertMessage(clientA, secondConversationId, userA, 'cross-conversation isolation probe');
  await new Promise(resolve => setTimeout(resolve, 900));
  if (events.some(event => event.kind === 'message' && event.payload.new?.id === secondMessageId)) {
    throw new Error('Realtime leaked a message from another conversation into the subscribed channel');
  }
  console.log('PASS: conversation-filtered Realtime did not deliver an unrelated conversation message.');

  console.log('LOCAL_REALTIME_STEP=verify-non-member-read-denial');
  const { data: unauthorizedRows, error: unauthorizedError } = await clientC
    .from('chat_messages').select('id').eq('conversation_id', directConversationId);
  if (unauthorizedError) throw new Error('Non-member read probe failed unexpectedly: ' + unauthorizedError.message);
  if ((unauthorizedRows || []).length !== 0) throw new Error('Non-member user read messages from a conversation they do not belong to');
  console.log('PASS: authenticated non-member cannot read the subscribed conversation through PostgREST.');

  console.log('LOCAL_REALTIME_STEP=insert-and-await-reaction-event');
  const { error: reactionError } = await clientA.from('message_reactions').insert({
    conversation_id: directConversationId,
    message_id: firstMessageId,
    user_id: userA,
    reaction_type: 'heart'
  });
  if (reactionError) throw new Error('Authenticated reaction insert failed: ' + reactionError.message);
  const reactionEvent = await waitForEvent(
    event => event.kind === 'reaction' && event.payload.eventType === 'INSERT'
      && event.payload.new?.message_id === firstMessageId && event.payload.new?.reaction_type === 'heart',
    'authenticated message_reactions INSERT'
  );
  if (reactionEvent.payload.new.conversation_id !== directConversationId) throw new Error('Reaction event conversation mismatch');
  console.log('PASS: authenticated local Realtime delivered a message reaction event.');

  console.log('LOCAL_REALTIME_STEP=reconnect-and-reconcile-gap');
  await channel.unsubscribe();
  channel = null;
  const missedMessageId = await insertMessage(clientA, directConversationId, userA, 'reconnect reconciliation probe');
  channel = await subscribeToConversation(clientA, directConversationId);
  const { data: reconciled, error: reconcileError } = await clientA.from('chat_messages')
    .select('id,conversation_id').eq('conversation_id', directConversationId).eq('id', missedMessageId).maybeSingle();
  if (reconcileError || reconciled?.id !== missedMessageId || reconciled?.conversation_id !== directConversationId) {
    throw new Error('Post-reconnect canonical query did not recover the missed message: ' + (reconcileError?.message || 'row missing'));
  }
  console.log('PASS: after a real channel disconnect/re-subscribe, canonical Postgres reconciliation recovered the missed message.');
  console.log('LOCAL_REALTIME_RUNTIME=PASSED');
} catch (error) {
  console.error('LOCAL_REALTIME_RUNTIME=FAILED');
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  const cleanup = Promise.allSettled([
    channel ? channel.unsubscribe() : Promise.resolve(),
    unfilteredChannel ? unfilteredChannel.unsubscribe() : Promise.resolve(),
    clientA.removeAllChannels(),
    clientC.removeAllChannels(),
    clientA.auth.signOut(),
    clientC.auth.signOut()
  ]);
  await Promise.race([cleanup, new Promise(resolve => setTimeout(resolve, 3000))]);
  clientA.realtime.disconnect();
  clientC.realtime.disconnect();
}
