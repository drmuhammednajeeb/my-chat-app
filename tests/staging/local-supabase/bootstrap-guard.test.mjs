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

test('bootstrap plan requires platform, direct-RPC, concurrency, and cron runtime evidence while remaining disabled', async () => {
  const plan = JSON.parse(await readFile(new URL('./bootstrap-plan.json', import.meta.url), 'utf8'));
  assert.equal(plan.mode, 'DESIGN_ONLY');
  assert.equal(plan.status, 'BLOCKED');
  assert.equal(plan.execution.enabled, false);
  assert.equal(plan.execution.allowCloudSupabase, false);
  assert.equal(plan.execution.allowProductionData, false);
  const platform = plan.dependencyLayers.find(layer => layer.id === 'managed-platform-prerequisites');
  assert.equal(platform.status, 'READ_ONLY_ASSERTIONS_PREPARED_NOT_EXECUTED');
  for (const evidence of [
    'A successful read-only local platform preflight and postflight',
    'A successful rollback-only PostgreSQL direct-conversation eligibility',
    'A successful two-session reversed-pair concurrency test',
    'A local pg_cron scheduler execution check',
    'A successful loopback-only least-privilege overlay'
  ]) assert.ok(plan.approval.requiredEvidence.some(item => item.includes(evidence)), 'missing bootstrap approval evidence: ' + evidence);
  assert.ok(plan.knownBlockers.some(item => item.id === 'RLS_LEAST_PRIVILEGE_016' && item.severity === 'BLOCKER'));
});
