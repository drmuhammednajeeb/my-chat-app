import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const rawSyntheticIds = process.env.LOCAL_SYNTHETIC_AUTH_USERS_JSON;
if (!rawSyntheticIds) throw new Error('Set LOCAL_SYNTHETIC_AUTH_USERS_JSON from the disposable Auth provisioning step.');
let syntheticIds;
try { syntheticIds = JSON.parse(rawSyntheticIds); } catch { throw new Error('Invalid LOCAL_SYNTHETIC_AUTH_USERS_JSON.'); }
const callerA = syntheticIds?.direct_a;
const callerB = syntheticIds?.direct_b;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!uuidPattern.test(callerA || '') || !uuidPattern.test(callerB || '')) {
  throw new Error('Synthetic direct-chat participants must be valid Auth-generated UUIDs.');
}

function localDatabaseUrl() {
  const raw = process.env.LOCAL_SUPABASE_DB_URL;
  if (!raw) throw new Error('Set LOCAL_SUPABASE_DB_URL to the disposable local Supabase PostgreSQL URL.');
  const url = new URL(raw);
  const expectedDatabasePort = process.env.LOCAL_SUPABASE_EXPECTED_DB_PORT || '54322';
if (!['54322', '54329'].includes(expectedDatabasePort)) if (!['54322', '54329'].includes(expectedDatabasePort)) throw new Error('LOCAL_SUPABASE_EXPECTED_DB_PORT is not allowlisted');
const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) ||
      url.port !== expectedDatabasePort || url.username !== 'postgres' || url.pathname !== '/postgres' ||
      !['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('throw new Error('LOCAL_SUPABASE_EXPECTED_DB_PORT is not allowlisted');');
  }
  return raw;
}

function psql(databaseUrl, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', [
      '--no-psqlrc', '--quiet', '--tuples-only', '--no-align',
      '--set=ON_ERROR_STOP=1', '--command', sql, databaseUrl
    ], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, PGCONNECT_TIMEOUT: '5', PGOPTIONS: '-c statement_timeout=60s -c lock_timeout=30s' } });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) reject(new Error('psql failed (' + code + '): ' + stderr.trim()));
      else resolve(stdout.trim());
    });
  });
}

const db = localDatabaseUrl();

// The preceding eligibility matrix is intentionally rollback-only. Promote only the
// two reserved synthetic users in this disposable database so concurrency and later
// CRUD/Storage probes have a stable eligible pair for their own transactions.
await psql(db, `BEGIN;\nSET LOCAL statement_timeout = '60s';\nSET LOCAL lock_timeout = '30s';\nSET LOCAL ROLE authenticated;\nSELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);\nSELECT public.admin_set_member_official_number('${callerA}', '971001000002');\nSELECT public.admin_set_member_official_number('${callerB}', '971001000003');\nCOMMIT;`);

const eligibleSql = `SELECT count(*)::text
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.id IN ('${callerA}'::uuid, '${callerB}'::uuid)
  AND p.membership_status = 'active'
  AND p.membership_number_verified IS TRUE
  AND p.membership_number ~ '^971[0-9]{9}$'
  AND u.email_confirmed_at IS NOT NULL;`;
const eligible = await psql(db, eligibleSql);
if (eligible !== '2') throw new Error('Synthetic participant pair is not fully eligible.');

const preflight = `SELECT count(*)::text
FROM public.conversations c
WHERE c.type = 'direct'
  AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id AND m.user_id='${callerA}'::uuid)
  AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id AND m.user_id='${callerB}'::uuid)
  AND (SELECT count(*) FROM public.conversation_members m WHERE m.conversation_id=c.id)=2;`;
const existing = await psql(db, preflight);
if (existing !== '0') throw new Error('Refusing to run: a direct conversation already exists for the synthetic pair.');
function callSql(caller, target) {
  return `BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '30s';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '${caller}', true);
SELECT pg_sleep(0.25);
SELECT public.get_or_create_direct_conversation('${target}'::uuid);
COMMIT;`;
}

const conversationIds = new Set();
const loadMarker = 'bizmindmakers-load-' + randomUUID();
try {
  // 24 real PostgreSQL sessions race from both sides of the same pair.
  const requests = Array.from({ length: 24 }, (_, index) =>
    index % 2 === 0
      ? psql(db, callSql(callerA, callerB))
      : psql(db, callSql(callerB, callerA))
  );
  const results = await Promise.allSettled(requests);
  const failure = results.find(result => result.status === 'rejected');
  const outputs = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  const conversationResultIds = outputs
    .map(output => output.split(/\s+/).filter(value => uuidPattern.test(value)).at(-1))
    .filter(Boolean);
  for (const id of conversationResultIds) conversationIds.add(id);
  if (failure) throw failure.reason;
  if (outputs.length !== 24 || conversationResultIds.length !== 24
    || new Set(conversationResultIds).size !== 1) {
    throw new Error('24 concurrent requests did not converge on one conversation ID.');
  }

  const conversationId = conversationResultIds[0];
  const count = await psql(db, `SELECT count(*)::text FROM public.conversations c
    WHERE c.type='direct'
      AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id AND m.user_id='${callerA}'::uuid)
      AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id AND m.user_id='${callerB}'::uuid)
      AND (SELECT count(*) FROM public.conversation_members m WHERE m.conversation_id=c.id)=2;`);
  if (count !== '1') throw new Error('Expected exactly one two-member direct conversation; observed ' + count);
  process.stdout.write('PASS: 24 concurrent reversed requests converged on one direct conversation.\n');

  // 40 authenticated transactions concurrently insert distinct messages into that conversation.
  const messageWrites = Array.from({ length: 40 }, (_, index) => {
    const sender = index % 2 === 0 ? callerA : callerB;
    const content = loadMarker + '-' + index;
    return psql(db, `BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '30s';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '${sender}', true);
INSERT INTO public.chat_messages(conversation_id, sender_id, content)
VALUES ('${conversationId}'::uuid, '${sender}'::uuid, '${content}')
RETURNING id;
COMMIT;`);
  });
  const writeResults = await Promise.allSettled(messageWrites);
  const writeFailure = writeResults.find(result => result.status === 'rejected');
  const messageIds = writeResults
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value.split(/\s+/).filter(value => uuidPattern.test(value)).at(-1))
    .filter(Boolean);
  if (writeFailure) throw writeFailure.reason;
  if (messageIds.length !== 40 || new Set(messageIds).size !== 40) {
    throw new Error('40 concurrent message writes did not persist 40 unique message IDs.');
  }
  const persisted = await psql(db, `SELECT count(*)::text FROM public.chat_messages
    WHERE conversation_id='${conversationId}'::uuid
      AND content LIKE '${loadMarker}-%';`);
  if (persisted !== '40') throw new Error('Expected 40 persisted concurrent messages; observed ' + persisted);
  process.stdout.write('PASS: 40 concurrent authenticated message writes persisted uniquely.\n');
} finally {
  for (const conversationId of conversationIds) {
    await psql(db, `BEGIN;
DELETE FROM public.chat_messages
WHERE conversation_id='${conversationId}'::uuid
  AND content LIKE '${loadMarker}-%';
DELETE FROM public.conversation_members
WHERE conversation_id='${conversationId}'::uuid
  AND user_id IN ('${callerA}'::uuid, '${callerB}'::uuid);
DELETE FROM public.conversations c
WHERE c.id='${conversationId}'::uuid AND c.type='direct'
  AND c.created_by IN ('${callerA}'::uuid, '${callerB}'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id)
  AND NOT EXISTS (SELECT 1 FROM public.chat_messages m WHERE m.conversation_id=c.id);
COMMIT;`);
  }
}
