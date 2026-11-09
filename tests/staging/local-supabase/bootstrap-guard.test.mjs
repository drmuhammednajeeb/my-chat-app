import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertBootstrapMayRun, assertLoopbackOnlyEnvironment } from './bootstrap-guard.mjs';

const validEnv = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_DB_URL: 'postgresql://postgres:local-only@127.0.0.1:54322/postgres'
};

test('design-only repository plan is fail-closed even with loopback environment', async () => {
  await assert.rejects(
    () => assertBootstrapMayRun({ env: validEnv }),
    /design-only or not formally approved/
  );
});

test('rejects any non-loopback Supabase API target', () => {
  assert.throws(
    () => assertLoopbackOnlyEnvironment({ ...validEnv, SUPABASE_URL: 'https://example.supabase.co' }),
    /must resolve to loopback/
  );
});

test('rejects any non-loopback database target', () => {
  assert.throws(
    () => assertLoopbackOnlyEnvironment({ ...validEnv, SUPABASE_DB_URL: 'postgresql://db.example.net/postgres' }),
    /database target must resolve to loopback/
  );
});

test('rejects cloud project and privileged credentials', () => {
  assert.throws(
    () => assertLoopbackOnlyEnvironment({ ...validEnv, SUPABASE_ACCESS_TOKEN: 'not-a-real-token' }),
    /cloud\/project\/service-role credentials/
  );
  assert.throws(
    () => assertLoopbackOnlyEnvironment({ ...validEnv, SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key' }),
    /cloud\/project\/service-role credentials/
  );
});

test('permits only a formally approved plan with loopback-only targets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'local-bootstrap-guard-'));
  const planPath = path.join(dir, 'bootstrap-plan.json');
  const approvedPlan = {
    mode: 'APPROVED_LOCAL_EXECUTION',
    status: 'APPROVED',
    approval: { status: 'APPROVED' },
    execution: {
      enabled: true,
      files: ['tests/staging/local-supabase/fixtures/approved-test-schema.sql'],
      allowCloudSupabase: false,
      allowProductionData: false,
      allowCanonicalMigrationMutation: false
    },
    networkPolicy: { requiredMode: 'LOOPBACK_ONLY' }
  };
  try {
    await writeFile(planPath, JSON.stringify(approvedPlan));
    const result = await assertBootstrapMayRun({ planPath, env: validEnv });
    assert.equal(result.approved, true);
    assert.equal(result.target.endpointHost, '127.0.0.1');
    assert.equal(result.target.databaseHost, '127.0.0.1');
    assert.equal(result.sqlFiles.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects an approved-looking plan that enables cloud access', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'local-bootstrap-guard-'));
  const planPath = path.join(dir, 'bootstrap-plan.json');
  const invalidPlan = {
    mode: 'APPROVED_LOCAL_EXECUTION',
    status: 'APPROVED',
    approval: { status: 'APPROVED' },
    execution: {
      enabled: true,
      files: ['tests/staging/local-supabase/fixtures/approved-test-schema.sql'],
      allowCloudSupabase: true,
      allowProductionData: false,
      allowCanonicalMigrationMutation: false
    },
    networkPolicy: { requiredMode: 'LOOPBACK_ONLY' }
  };
  try {
    await writeFile(planPath, JSON.stringify(invalidPlan));
    await assert.rejects(
      () => assertBootstrapMayRun({ planPath, env: validEnv }),
      /violates the local-only safety contract/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
