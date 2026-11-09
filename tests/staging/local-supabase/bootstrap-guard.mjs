import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = path.join(HERE, 'bootstrap-plan.json');

export function assertLoopbackOnlyEnvironment(env = process.env) {
  const requiredUrl = env.SUPABASE_URL;
  if (!requiredUrl) throw new Error('BLOCKED: SUPABASE_URL is required for a future local-only run.');
  let parsed;
  try { parsed = new URL(requiredUrl); }
  catch { throw new Error('BLOCKED: SUPABASE_URL is not a valid URL.'); }

  const allowed = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!allowed.has(parsed.hostname)) {
    throw new Error('BLOCKED: Supabase endpoint must resolve to loopback; cloud and remote endpoints are forbidden.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('BLOCKED: Supabase endpoint must use HTTP or HTTPS.');
  }

  const databaseUrl = env.SUPABASE_DB_URL;
  if (databaseUrl) {
    let db;
    try { db = new URL(databaseUrl); }
    catch { throw new Error('BLOCKED: SUPABASE_DB_URL is not a valid URL.'); }
    if (!allowed.has(db.hostname)) {
      throw new Error('BLOCKED: database target must resolve to loopback; remote database targets are forbidden.');
    }
  }

  for (const name of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (env[name]) throw new Error('BLOCKED: cloud/project/service-role credentials are not accepted by the local test runner.');
  }
  return { endpointHost: parsed.hostname, databaseHost: databaseUrl ? new URL(databaseUrl).hostname : null };
}

export async function assertBootstrapMayRun({ planPath = PLAN_PATH, env = process.env } = {}) {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  if (plan.mode !== 'APPROVED_LOCAL_EXECUTION'
      || plan.status !== 'APPROVED'
      || plan.approval?.status !== 'APPROVED'
      || plan.execution?.enabled !== true
      || !Array.isArray(plan.execution.files)
      || plan.execution.files.length === 0) {
    throw new Error('BLOCKED: bootstrap plan is design-only or not formally approved. No SQL will be executed.');
  }
  if (plan.execution.allowCloudSupabase !== false
      || plan.execution.allowProductionData !== false
      || plan.execution.allowCanonicalMigrationMutation !== false
      || plan.networkPolicy?.requiredMode !== 'LOOPBACK_ONLY') {
    throw new Error('BLOCKED: bootstrap plan violates the local-only safety contract.');
  }
  const target = assertLoopbackOnlyEnvironment(env);
  return { approved: true, target, sqlFiles: plan.execution.files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await assertBootstrapMayRun();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 78;
  }
}
