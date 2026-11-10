#!/usr/bin/env node
// Manual disposable-local-only runner for the RLS least-privilege overlay.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function fail(message) {
  console.error('RLS_LEAST_PRIVILEGE_RUN_BLOCKED=' + message);
  process.exit(1);
}

const raw = process.env.LOCAL_SUPABASE_DB_URL;
if (!raw) fail('LOCAL_SUPABASE_DB_URL is required');
let url;
try { url = new URL(raw); } catch { fail('invalid database URL'); }
const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
if (!['postgres:', 'postgresql:'].includes(url.protocol)
  || !['127.0.0.1', 'localhost', '::1'].includes(host)
  || url.port !== '54322'
  || url.username !== 'postgres'
  || url.pathname !== '/postgres'
  || url.search
  || url.hash) {
  fail('refusing non-local database target; expected postgres@loopback:54322/postgres without query or hash');
}

const rawIds = process.env.LOCAL_SYNTHETIC_AUTH_USERS_JSON;
if (!rawIds) fail('LOCAL_SYNTHETIC_AUTH_USERS_JSON is required');
let syntheticIds;
try { syntheticIds = JSON.parse(rawIds); } catch { fail('invalid synthetic Auth identity map'); }
const identityKeys = ['direct_a', 'direct_b'];
const identityArgs = [];
for (const key of identityKeys) {
  const id = syntheticIds?.[key];
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    fail('missing or invalid synthetic Auth identity: ' + key);
  }
  identityArgs.push('--set=' + key + '_id=' + id);
}

const overlay = path.join(ROOT, 'tests/staging/local-supabase/fixtures/rls-least-privilege-overlay.test-only.sql');
const assertions = path.join(ROOT, 'tests/staging/local-supabase/fixtures/rls-least-privilege.assert.sql');
const crudCompatibility = path.join(ROOT, 'tests/staging/local-supabase/fixtures/rls-crud-compatibility.runtime.test.sql');
const result = spawnSync('psql', [
  '--no-psqlrc',
  '--set=ON_ERROR_STOP=1',
  ...identityArgs,
  '--file', overlay,
  '--file', assertions,
  '--file', crudCompatibility,
  raw
], {
  encoding: 'utf8',
  timeout: 30000,
  env: {
    PATH: process.env.PATH ?? '',
    PGCONNECT_TIMEOUT: '5',
    PGOPTIONS: '-c app.test_only_local_replay=enabled -c statement_timeout=15s -c lock_timeout=5s'
  },
  stdio: 'inherit'
});
if (result.error) fail('psql runner error: ' + result.error.message);
if (result.status !== 0) fail('overlay or read-only assertions failed with exit code ' + result.status);
console.log('RLS_LEAST_PRIVILEGE_LOCAL_RUNTIME=PASSED');
