import { spawn } from 'node:child_process';

const callerA = '22222222-2222-4222-8222-222222222201';
const callerB = '22222222-2222-4222-8222-222222222202';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function localDatabaseUrl() {
  const raw = process.env.LOCAL_SUPABASE_DB_URL;
  if (!raw) throw new Error('Set LOCAL_SUPABASE_DB_URL to the disposable local Supabase PostgreSQL URL.');
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname) ||
      url.port !== '54322' || url.username !== 'postgres' || url.pathname !== '/postgres' ||
      !['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Refusing non-local database target: expected postgres@loopback:54322 only.');
  }
  return raw;
}

function psql(databaseUrl, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', [
      '--no-psqlrc', '--quiet', '--tuples-only', '--no-align',
      '--set=ON_ERROR_STOP=1', '--command', sql, databaseUrl
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
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
const eligibleSql = \`SELECT count(*)::text
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.id IN ('\${callerA}'::uuid, '\${callerB}'::uuid)
  AND p.membership_status = 'active'
  AND p.membership_number_verified IS TRUE
  AND p.membership_number ~ '^971[0-9]{9}$'
  AND u.email_confirmed_at IS NOT NULL;\`;
const eligible = await psql(db, eligibleSql);
if (eligible !== '2') throw new Error('Synthetic participant pair is not fully eligible.');

const preflight = \`SELECT count(*)::text
FROM public.conversations c
WHERE c.type = 'direct'
  AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id AND m.user_id='\${callerA}'::uuid)
  AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id AND m.user_id='\${callerB}'::uuid)
  AND (SELECT count(*) FROM public.conversation_members m WHERE m.conversation_id=c.id)=2;\`;
const existing = await psql(db, preflight);
if (existing !== '0') throw new Error('Refusing to run: a direct conversation already exists for the synthetic pair.');

function callSql(caller, target) {
  return `BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '10s';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '${caller}', true);
SELECT public.get_or_create_direct_conversation('${target}'::uuid);
COMMIT;`;
}

const conversationIds = new Set();
try {
  const results = await Promise.allSettled([
    psql(db, callSql(callerA, callerB)),
    psql(db, callSql(callerB, callerA))
  ]);
  const outputs = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  for (const output of outputs) {
    const id = output.split(/\s+/).filter(value => uuidPattern.test(value)).at(-1);
    if (id) conversationIds.add(id);
  }
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  const [a, b] = outputs;
  const idA = a?.split(/\s+/).filter(value => uuidPattern.test(value)).at(-1);
  const idB = b?.split(/\s+/).filter(value => uuidPattern.test(value)).at(-1);
  if (!idA || !idB || idA !== idB) {
    throw new Error('Reversed concurrent calls did not converge on one conversation ID.');
  }
  const conversationId = idA;
  const count = await psql(db, `SELECT count(*)::text FROM public.conversations c
    WHERE c.id='${conversationId}'::uuid AND c.type='direct'
      AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id AND m.user_id='${callerA}'::uuid)
      AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id AND m.user_id='${callerB}'::uuid)
      AND (SELECT count(*) FROM public.conversation_members m WHERE m.conversation_id=c.id)=2;`);
  if (count !== '1') throw new Error('Expected exactly one two-member direct conversation; observed ' + count);
  process.stdout.write('PASS: reversed concurrent calls converged on one direct conversation.\n');
} finally {
  for (const conversationId of conversationIds) {
    await psql(db, `BEGIN;
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

  AND u.email_confirmed_at IS NOT NULL;`);
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
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '${caller}', true);
SELECT public.get_or_create_direct_conversation('${target}'::uuid);
COMMIT;`;
}

const conversationIds = new Set();
try {
  const results = await Promise.allSettled([
    psql(db, callSql(callerA, callerB)),
    psql(db, callSql(callerB, callerA))
  ]);
  const outputs = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  for (const output of outputs) {
    const id = output.split(/\s+/).filter(value => uuidPattern.test(value)).at(-1);
    if (id) conversationIds.add(id);
  }
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  const [a, b] = outputs;
  const idA = a?.split(/\s+/).filter(value => uuidPattern.test(value)).at(-1);
  const idB = b?.split(/\s+/).filter(value => uuidPattern.test(value)).at(-1);
  if (!idA || !idB || idA !== idB) {
    throw new Error('Reversed concurrent calls did not converge on one conversation ID.');
  }
  const conversationId = idA;
  const count = await psql(db, `SELECT count(*)::text FROM public.conversations c
    WHERE c.id='${conversationId}'::uuid AND c.type='direct'
      AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id AND m.user_id='${callerA}'::uuid)
      AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id AND m.user_id='${callerB}'::uuid)
      AND (SELECT count(*) FROM public.conversation_members m WHERE m.conversation_id=c.id)=2;`);
  if (count !== '1') throw new Error('Expected exactly one two-member direct conversation; observed ' + count);
  process.stdout.write('PASS: reversed concurrent calls converged on one direct conversation.\n');
} finally {
  for (const conversationId of conversationIds) {
    await psql(db, `BEGIN;
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
