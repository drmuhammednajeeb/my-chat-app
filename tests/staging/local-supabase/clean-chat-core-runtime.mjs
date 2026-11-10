#!/usr/bin/env node
// Disposable-local-only acceptance tests for the rebuilt message/conversation core.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const rawDb = process.env.LOCAL_SUPABASE_DB_URL;
if (!rawDb) throw new Error('LOCAL_SUPABASE_DB_URL is required');
const dbUrl = new URL(rawDb);
const dbHost = dbUrl.hostname.replace(/^\[|\]$/g, '');
if (!['127.0.0.1', 'localhost', '::1'].includes(dbHost)
  || dbUrl.port !== '54322'
  || dbUrl.username !== 'postgres'
  || dbUrl.pathname !== '/postgres'
  || !['postgres:', 'postgresql:'].includes(dbUrl.protocol)) {
  throw new Error('Refusing non-local database target; expected postgres@loopback:54322/postgres');
}
if (process.env.ALLOW_DISPOSABLE_LOCAL_REPLAY !== '1') {
  throw new Error('ALLOW_DISPOSABLE_LOCAL_REPLAY=1 is required');
}

const rawIds = process.env.LOCAL_SYNTHETIC_AUTH_USERS_JSON;
if (!rawIds) throw new Error('LOCAL_SYNTHETIC_AUTH_USERS_JSON is required');
const ids = JSON.parse(rawIds);
const a = ids.direct_a, b = ids.direct_b, suspended = ids.direct_suspended;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
for (const [name, value] of Object.entries({ direct_a: a, direct_b: b, direct_suspended: suspended })) {
  if (!uuid.test(value || '')) throw new Error('Invalid synthetic Auth identity: ' + name);
}

function psql(sql, { expectFailure = false, expectedError = null, label = 'SQL assertion' } = {}) {
  const result = spawnSync('psql', [
    '--no-psqlrc', '--quiet', '--tuples-only', '--no-align',
    '--set=ON_ERROR_STOP=1', '--command', sql, rawDb
  ], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      PATH: process.env.PATH ?? '',
      PGCONNECT_TIMEOUT: '5',
      PGOPTIONS: '-c app.test_only_local_replay=enabled -c statement_timeout=30s -c lock_timeout=10s'
    }
  });
  if (result.error) throw new Error(label + ' could not start: ' + result.error.message);
  if (expectFailure) {
    if (result.status === 0) throw new Error(label + ' unexpectedly succeeded');
    const output = (result.stderr || '') + (result.stdout || '');
    if (expectedError && !expectedError.test(output)) throw new Error(label + ' failed for an unexpected reason: ' + output.trim());
    return output;
  }
  if (result.status !== 0) throw new Error(label + ' failed: ' + (result.stderr || result.stdout).trim());
  return result.stdout.trim();
}
function asUser(userId, statements) {
  return `BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '${userId}', true);
${statements}
COMMIT;`;
}
function lastUuid(output) {
  const matches = output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi) || [];
  return matches.at(-1);
}

async function clearLocalChatStorage() {
  const rawApi = process.env.LOCAL_SUPABASE_URL;
  const serviceKey = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY;
  if (!rawApi || !serviceKey) throw new Error('Local Supabase API URL and service role key are required for Storage cleanup');
  const api = new URL(rawApi);
  const apiHost = api.hostname.replace(/^\\[|\\]$/g, '').toLowerCase();
  if (api.protocol !== 'http:' || !['127.0.0.1','localhost','::1'].includes(apiHost)
    || api.port !== '54321' || api.pathname !== '/' || api.username || api.password || api.search || api.hash) {
    throw new Error('Refusing Storage cleanup against a non-local Supabase API');
  }
  const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };

  async function listPrefix(bucket, prefix = '') {
    const paths = [];
    let offset = 0;
    while (true) {
      const response = await fetch(new URL('/storage/v1/object/list/' + encodeURIComponent(bucket), api), {
        method: 'POST', headers,
        body: JSON.stringify({ prefix: prefix ? prefix + '/' : '', limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
      });
      if (!response.ok) throw new Error('Storage list failed for ' + bucket + ' (HTTP ' + response.status + ')');
      const entries = await response.json();
      if (!Array.isArray(entries)) throw new Error('Storage list returned a non-array result for ' + bucket);
      for (const entry of entries) {
        if (!entry || typeof entry.name !== 'string' || !entry.name) continue;
        const entryName = entry.name.replace(/\\/+$/, '');
        if (!entryName) continue;
        const objectPath = prefix ? prefix + '/' + entryName : entryName;
        if (entry.id == null && entry.metadata == null) {
          paths.push(...await listPrefix(bucket, objectPath));
        } else {
          paths.push(objectPath);
        }
      }
      if (entries.length < 100) break;
      offset += entries.length;
    }
    return paths;
  }

  for (const bucket of ['chat-media', 'conversation-documents', 'channel-avatars']) {
    const paths = await listPrefix(bucket);
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
      const response = await fetch(new URL('/storage/v1/object/' + encodeURIComponent(bucket), api), {
        method: 'DELETE', headers, body: JSON.stringify({ prefixes: batch })
      });
      if (!response.ok) throw new Error('Storage removal failed for ' + bucket + ' (HTTP ' + response.status + ')');
    }
    const remaining = await listPrefix(bucket);
    if (remaining.length) throw new Error('Storage cleanup left ' + remaining.length + ' objects in ' + bucket);
    console.log('CLEAN_CHAT_STORAGE_BUCKET=' + bucket + ' REMOVED=' + paths.length + ' VERIFIED_EMPTY=true');
  }
}
await clearLocalChatStorage();
const directConversationId = lastUuid(psql(asUser(a, `SELECT public.get_or_create_direct_conversation('${b}'::uuid);`), { label: 'create clean direct conversation' }));
if (!directConversationId) throw new Error('Direct conversation RPC returned no UUID');
let groupConversationId = null;
const directMessageId = randomUUID();
const groupMessageId = randomUUID();
const messageContent = 'clean-core-direct-' + randomUUID();
const groupContent = 'clean-core-group-' + randomUUID();

try {
  const reverseId = lastUuid(psql(asUser(b, `SELECT public.get_or_create_direct_conversation('${a}'::uuid);`), { label: 'reverse-order direct conversation lookup' }));
  if (reverseId !== directConversationId) throw new Error('A→B and B→A did not resolve to the same direct conversation');
  process.stdout.write('PASS: direct conversation identity is symmetric and idempotent.\n');
  psql(`INSERT INTO public.conversations(type, title, created_by, direct_user_low, direct_user_high)
    VALUES ('direct', NULL, '${a}'::uuid, LEAST('${a}'::uuid, '${b}'::uuid), GREATEST('${a}'::uuid, '${b}'::uuid));`,
    { expectFailure: true, expectedError: /duplicate key value violates unique constraint/i, label: 'direct pair unique index must reject a duplicate row' });
  process.stdout.write('PASS: the database unique index independently rejects duplicate direct pairs.\\n');

  psql(asUser(a, `INSERT INTO public.chat_messages(id, conversation_id, sender_id, content)
    VALUES ('${directMessageId}'::uuid, '${directConversationId}'::uuid, '${a}'::uuid, '${messageContent}');`), { label: 'insert direct message' });
  psql(asUser(a, `INSERT INTO public.chat_messages(id, conversation_id, sender_id, content)
    VALUES ('${directMessageId}'::uuid, '${directConversationId}'::uuid, '${a}'::uuid, '${messageContent}');`), { expectFailure: true, expectedError: /duplicate key value violates unique constraint/i, label: 'duplicate message ID must be rejected' });
  process.stdout.write('PASS: stable client message ID prevents duplicate persistence on retry.\n');

  const groupOutput = psql(`INSERT INTO public.conversations(type, title, created_by)
    VALUES ('group', 'Clean Core Isolation Fixture', '${a}'::uuid) RETURNING id;`);
  groupConversationId = lastUuid(groupOutput);
  if (!groupConversationId) throw new Error('Could not create second conversation for isolation test');
  psql(`INSERT INTO public.conversation_members(conversation_id, user_id, role)
    VALUES ('${groupConversationId}'::uuid, '${a}'::uuid, 'owner'),
           ('${groupConversationId}'::uuid, '${b}'::uuid, 'member');`);
  psql(asUser(a, `INSERT INTO public.chat_messages(id, conversation_id, sender_id, content)
    VALUES ('${groupMessageId}'::uuid, '${groupConversationId}'::uuid, '${a}'::uuid, '${groupContent}');`), { label: 'insert group message' });

  psql(asUser(a, `INSERT INTO public.message_reactions(conversation_id, message_id, user_id, reaction_type)
    VALUES ('${directConversationId}'::uuid, '${directMessageId}'::uuid, '${a}'::uuid, 'heart')
    ON CONFLICT (message_id, user_id) DO UPDATE SET reaction_type = EXCLUDED.reaction_type;
    INSERT INTO public.message_reactions(conversation_id, message_id, user_id, reaction_type)
    VALUES ('${directConversationId}'::uuid, '${directMessageId}'::uuid, '${a}'::uuid, 'fire')
    ON CONFLICT (message_id, user_id) DO UPDATE SET reaction_type = EXCLUDED.reaction_type;
    INSERT INTO public.user_message_stars(user_id, conversation_id, message_id)
    VALUES ('${a}'::uuid, '${directConversationId}'::uuid, '${directMessageId}'::uuid)
    ON CONFLICT (user_id, message_id) DO NOTHING;
    INSERT INTO public.user_message_stars(user_id, conversation_id, message_id)
    VALUES ('${a}'::uuid, '${directConversationId}'::uuid, '${directMessageId}'::uuid)
    ON CONFLICT (user_id, message_id) DO NOTHING;`), { label: 'persist reactions and stars' });

  const ownCounts = psql(asUser(a, `SELECT
    (SELECT count(*) FROM public.chat_messages WHERE conversation_id='${directConversationId}'::uuid AND id='${directMessageId}'::uuid)
    || '|' ||
    (SELECT count(*) FROM public.message_reactions WHERE conversation_id='${directConversationId}'::uuid AND message_id='${directMessageId}'::uuid)
    || '|' ||
    (SELECT count(*) FROM public.user_message_stars WHERE conversation_id='${directConversationId}'::uuid AND message_id='${directMessageId}'::uuid);`), { label: 'verify owner message/reaction/star state' }).split(/\s+/).at(-1);
  if (ownCounts !== '1|1|1') throw new Error('Expected one message, one reaction, one star; observed ' + ownCounts);

  const peerCounts = psql(asUser(b, `SELECT
    (SELECT count(*) FROM public.chat_messages WHERE conversation_id='${directConversationId}'::uuid AND id='${directMessageId}'::uuid)
    || '|' ||
    (SELECT count(*) FROM public.message_reactions WHERE conversation_id='${directConversationId}'::uuid AND message_id='${directMessageId}'::uuid)
    || '|' ||
    (SELECT count(*) FROM public.user_message_stars WHERE conversation_id='${directConversationId}'::uuid AND message_id='${directMessageId}'::uuid);`), { label: 'verify peer visibility and private stars' }).split(/\s+/).at(-1);
  if (peerCounts !== '1|1|0') throw new Error('Peer should see message/reaction but not another user star; observed ' + peerCounts);
  process.stdout.write('PASS: reactions are shared with conversation members; stars remain owner-private.\n');

  const suspendedCount = psql(asUser(suspended, `SELECT count(*) FROM public.chat_messages WHERE conversation_id='${directConversationId}'::uuid;`), { label: 'inactive member message isolation' }).split(/\s+/).at(-1);
  if (suspendedCount !== '0') throw new Error('Suspended user unexpectedly read conversation messages');
  process.stdout.write('PASS: suspended/non-member identity cannot read the conversation timeline.\n');

  psql(asUser(a, `INSERT INTO public.message_reactions(conversation_id, message_id, user_id, reaction_type)
    VALUES ('${directConversationId}'::uuid, '${directMessageId}'::uuid, '${a}'::uuid, 'clap');`), { expectFailure: true, expectedError: /violates check constraint/i, label: 'invalid reaction type must be rejected' });
  psql(asUser(b, `INSERT INTO public.user_message_stars(user_id, conversation_id, message_id)
    VALUES ('${a}'::uuid, '${directConversationId}'::uuid, '${directMessageId}'::uuid);`), { expectFailure: true, expectedError: /row-level security policy/i, label: 'star impersonation must be rejected' });
  psql(`DELETE FROM public.message_reactions WHERE message_id='${directMessageId}'::uuid AND user_id='${a}'::uuid;
    DELETE FROM public.user_message_stars WHERE message_id='${directMessageId}'::uuid AND user_id='${a}'::uuid;`);
  psql(`INSERT INTO public.message_reactions(conversation_id, message_id, user_id, reaction_type)
    VALUES ('${groupConversationId}'::uuid, '${directMessageId}'::uuid, '${a}'::uuid, 'like');`, { expectFailure: true, expectedError: /violates foreign key constraint/i, label: 'cross-conversation reaction reference must be rejected' });
  psql(`INSERT INTO public.user_message_stars(user_id, conversation_id, message_id)
    VALUES ('${a}'::uuid, '${groupConversationId}'::uuid, '${directMessageId}'::uuid);`, { expectFailure: true, expectedError: /violates foreign key constraint/i, label: 'cross-conversation star reference must be rejected' });
  process.stdout.write('PASS: invalid reaction types, star impersonation, and cross-conversation references are rejected.\n');

  const directCount = psql(`SELECT count(*) FROM public.chat_messages WHERE conversation_id='${directConversationId}'::uuid;`).split(/\s+/).at(-1);
  const groupCount = psql(`SELECT count(*) FROM public.chat_messages WHERE conversation_id='${groupConversationId}'::uuid;`).split(/\s+/).at(-1);
  if (directCount !== '1' || groupCount !== '1') throw new Error('Messages leaked or mixed across conversation IDs');
  process.stdout.write('PASS: interleaved direct/group timelines remain isolated by conversation ID.\n');
} finally {
  const idsToDelete = [directConversationId, groupConversationId].filter(Boolean).map(id => `'${id}'::uuid`).join(',');
  if (idsToDelete) psql(`
    -- Membership audit triggers write event rows on member deletion. Remove members first,
    -- then their audit rows, before deleting the conversation parent rows.
    DELETE FROM public.conversation_members WHERE conversation_id IN (${idsToDelete});
    DELETE FROM public.conversation_member_events WHERE conversation_id IN (${idsToDelete});
    DELETE FROM public.user_notifications WHERE conversation_id IN (${idsToDelete});
    DELETE FROM public.conversations WHERE id IN (${idsToDelete});
  `, { label: 'clean clean-core fixtures' });
}

console.log('CLEAN_CHAT_CORE_LOCAL_RUNTIME=PASSED');
