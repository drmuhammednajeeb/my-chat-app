import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('local replay runtime is explicitly authorized and loopback-only', async () => {
  const source = await readFile(path.join(root, 'tests/staging/local-supabase/local-supabase-replay-runtime.mjs'), 'utf8');
  for (const token of [
    'ALLOW_DISPOSABLE_LOCAL_REPLAY',
    "url.port !== '54322'",
    "url.username !== 'postgres'",
    "url.pathname !== '/postgres'",
    "'127.0.0.1'",
    "'localhost'",
    "'::1'",
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_DB_PASSWORD',
    'SUPABASE_PROJECT_ID',
    "manifest.mode !== 'DESIGN_ONLY'",
    'manifest.execution?.enabled !== false',
    'manifest.execution?.localStackStarted !== false',
    'manifest.execution?.networkEgressAllowed !== false',
    'dag.executionAuthorized !== false',
    'dag.safety?.sqlExecutionEnabled !== false',
    'dag.safety?.supabaseStartupAuthorized !== false',
    'dag.safety?.costBearingResourcesAllowed !== false',
    'candidate replay order is not the exact reviewed topological DAG order',
    'test-fixture.local-platform-preflight',
    'local-rls-least-privilege-runtime.mjs',
    'channel-avatar-rls-runtime.test.sql',
    'DAG-006:channel-avatar-rls-runtime',
    'direct-conversation-concurrency.mjs',
    'local-pg-cron-runtime.mjs',
    'local-storage-rls-runtime.mjs',
    'expectedSqlCount',
    'synthetic-fixture-patches.json',
    'patchManifest.patches.length',
    'executedSqlFiles',
    'mappedSourcesReplacedByFixtures',
    'LOCAL_SUPABASE_REPLAY_RUNTIME=PASSED',
    'clean-chat-core-rebuild.test-only.sql',
    'clean-chat-core-runtime.mjs',
    'clean-chat-core-destructive-local-reset',
    'clean-chat-core-direct-conversation-concurrency',
    'clean-chat-core-message-reactions-stars',
    'CLEAN_CHAT_CORE_LOCAL_RUNTIME=PASSED',
    '/auth/v1/admin/users',
    'syntheticAuthIds[user.key] = data.id',
    'LOCAL_SYNTHETIC_AUTH_USERS_JSON',
    'identityArgs'
  ]) assert.ok(source.includes(token), 'missing replay safety/coverage token: ' + token);
  assert.match(source, /refusing non-local database target/i);
  assert.doesNotMatch(source, /supabase\.co|--remote|--linked/i);
});

test('clean chat core reset is destructive only inside the loopback disposable runner', async () => {
  const runner = await readFile(path.join(root, 'tests/staging/local-supabase/clean-chat-core-runtime.mjs'), 'utf8');
  const fixture = await readFile(path.join(root, 'tests/staging/local-supabase/fixtures/clean-chat-core-rebuild.test-only.sql'), 'utf8');
  const syntax = spawnSync(process.execPath, ['--check', path.join(root, 'tests/staging/local-supabase/clean-chat-core-runtime.mjs')], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr || 'clean core runner syntax check failed');
  for (const token of [
    "dbUrl.port !== '54322'",
    "dbUrl.username !== 'postgres'",
    "ALLOW_DISPOSABLE_LOCAL_REPLAY",
    'LOCAL_SYNTHETIC_AUTH_USERS_JSON',
    'public.get_or_create_direct_conversation',
    'message_reactions',
    'user_message_stars',
    'LOCAL_SUPABASE_SERVICE_ROLE_KEY',
    '/storage/v1/object/list/',
    '/storage/v1/object/',
    "'chat-media', 'conversation-documents', 'channel-avatars'",
    '__clean_core_reset_probe__',
    "'Content-Type': 'image/png'",
    'PROBE_UPLOADED=true',
    'VERIFIED_EMPTY=true',
    'SELECT count(*) FROM storage.objects'
  ]) assert.ok(runner.includes(token), 'missing clean core runtime safety/coverage token: ' + token);
  assert.ok(fixture.includes("current_setting('app.test_only_local_replay', true) IS DISTINCT FROM 'enabled'"));
  assert.ok(fixture.includes('TRUNCATE TABLE public.conversations CASCADE'));
  assert.ok(!fixture.includes('DELETE FROM storage.objects'), 'Storage metadata must be changed through the Storage API');
  assert.ok(fixture.includes('Storage objects are removed through the local Storage API'));
  assert.ok(fixture.includes('direct_user_low'));
  assert.ok(fixture.includes('direct_user_high'));
  assert.ok(fixture.includes('conversations_direct_pair_unique_idx'));
  assert.ok(fixture.includes('message_reactions_conversation_message_v2_fkey'));
  assert.ok(fixture.includes('user_message_stars_conversation_message_v2_fkey'));
  assert.ok(fixture.includes('app_private.get_or_create_direct_conversation_impl'));
});

test('runtime workflow uses an isolated temporary project and pinned local CLI only', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/disposable-local-supabase-runtime.yml'), 'utf8');
  for (const token of [
    'workflow_dispatch',
    'supabase/setup-cli@v1',
    'version: 3.0.0',
    'supabase init',
    'supabase start --exclude',
    'major_version = 17',
    'LOCAL_SUPABASE_DB_URL',
    'LOCAL_SUPABASE_SERVICE_ROLE_KEY',
    'local-supabase-replay-runtime.mjs',
    'supabase stop'
  ]) assert.ok(workflow.includes(token), 'missing isolated runtime workflow contract: ' + token);
  assert.doesNotMatch(workflow, /supabase link|--remote|--linked|SUPABASE_ACCESS_TOKEN/i);
});
