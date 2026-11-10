import { spawn } from 'node:child_process';

function localDatabaseUrl() {
  const raw = process.env.LOCAL_SUPABASE_DB_URL;
  if (!raw) throw new Error('Set LOCAL_SUPABASE_DB_URL to the disposable local Supabase PostgreSQL URL.');
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) ||
      url.port !== '54322' || url.username !== 'postgres' || url.pathname !== '/postgres' ||
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.search || url.hash) {
    throw new Error('Refusing non-local database target: expected postgres@loopback:54322/postgres without query or fragment.');
  }
  return raw;
}

function psql(databaseUrl, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', [
      '--no-psqlrc', '--quiet', '--tuples-only', '--no-align',
      '--set=ON_ERROR_STOP=1', '--command', sql, databaseUrl
    ], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, PGCONNECT_TIMEOUT: '5', PGOPTIONS: '-c statement_timeout=10s -c lock_timeout=5s' } });
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
const prerequisites = await psql(db, `SELECT CASE WHEN
  to_regclass('cron.job') IS NOT NULL
  AND to_regclass('cron.job_run_details') IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='cron' AND p.proname='schedule')
  AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='cron' AND p.proname='unschedule')
  THEN 'ready' ELSE 'missing' END;`);
if (prerequisites !== 'ready') throw new Error('pg_cron runtime prerequisites are missing.');

const jobName = 'bizmindmakers-local-cron-probe-' + process.pid + '-' + Date.now();
if (!/^bizmindmakers-local-cron-probe-[0-9]+-[0-9]+$/.test(jobName)) {
  throw new Error('Generated pg_cron probe name did not pass its strict allowlist.');
}
const duplicate = await psql(db, `SELECT count(*)::text FROM cron.job WHERE jobname='${jobName}';`);
if (duplicate !== '0') throw new Error('Refusing to reuse an existing pg_cron job name.');

let jobId = null;
let passed = false;
try {
  const scheduled = await psql(db, `SELECT cron.schedule('${jobName}', '* * * * *', 'SELECT 1;');`);
  if (!/^[0-9]+$/.test(scheduled)) throw new Error('pg_cron did not return a valid job ID.');
  jobId = scheduled;

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const result = await psql(db, `SELECT coalesce((SELECT status || '|' || coalesce(return_message, '')
      FROM cron.job_run_details
      WHERE jobid=${jobId}
      ORDER BY start_time DESC
      LIMIT 1), 'pending');`);
    if (result.startsWith('succeeded|')) {
      passed = true;
      process.stdout.write('PASS: disposable local pg_cron probe executed successfully.\\n');
      break;
    }
    if (result.startsWith('failed|')) {
      throw new Error('pg_cron probe execution failed: ' + result.slice('failed|'.length));
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  if (!passed) throw new Error('Timed out waiting for the local pg_cron probe to execute within 90 seconds.');
} finally {
  let cleanupJobId = jobId;
  if (cleanupJobId === null) {
    const recovered = await psql(db, `SELECT jobid::text FROM cron.job WHERE jobname='${jobName}';`);
    if (/^[0-9]+$/.test(recovered)) cleanupJobId = recovered;
  }
  if (cleanupJobId !== null) {
    await psql(db, `SELECT cron.unschedule(${cleanupJobId});
DELETE FROM cron.job_run_details WHERE jobid=${cleanupJobId};`);
  }
}
