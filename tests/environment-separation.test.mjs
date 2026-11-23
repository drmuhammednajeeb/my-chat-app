import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
test('browser loads explicit deployment config before initializing Supabase', () => {
  const index = read('../index.html');
  assert.equal((index.match(/deployment-config\.js/g) || []).length, 1);
  assert.equal((index.match(/const\s+SUPABASE_URL\s*=/g) || []).length, 1);
  assert.match(index, /<script src="\.\/deployment-config\.js"><\/script>[\s\S]*?supabase\.min\.js/);
  assert.match(index, /BizmindRuntimeConfig\.resolve\(window\.__BIZMIND_DEPLOYMENT_CONFIG__\)/);
  assert.doesNotMatch(index, /const\s+SUPABASE_URL\s*=\s*['"]/);
  assert.doesNotMatch(index, /const\s+SUPABASE_ANON_KEY\s*=\s*['"]/);
});
test('checked-in config is public production-only and contains no privileged key', () => {
  const config = read('../deployment-config.js');
  assert.match(config, /"target":\s*"pages-production"/);
  assert.match(config, /"expectedSupabaseHost":\s*"lvkeohpuucuklagvwpnq\.supabase\.co"/);
  assert.match(config, /"supabaseUrl":\s*"https:\/\/lvkeohpuucuklagvwpnq\.supabase\.co"/);
  assert.doesNotMatch(config, /sb_secret_|service_role|SUPABASE_SERVICE_ROLE_KEY/i);
});
test('no local endpoint can leak into browser runtime assets', () => {
  const assets = ['../index.html','../deployment-config.js','../modules/runtime-config.js','../membership.js','../service-worker.js','../manifest.json'];
  const forbidden = [/localhost/i,/127\.0\.0\.1/i,/0\.0\.0\.0/i,/host\.docker\.internal/i,/https?:\/\/kong(?::|\/)/i,/supabase\.local/i];
  for (const path of assets) for (const pattern of forbidden) assert.doesNotMatch(read(path), pattern, `${path} contains a local-only endpoint`);
});
test('disposable local Supabase runtime is isolated to a temporary runner', () => {
  const workflow = read('../.github/workflows/disposable-local-supabase-runtime.yml');
  assert.match(workflow, /runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /runner\.temp/);
  assert.match(workflow, /supabase start/);
  assert.match(workflow, /supabase stop/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(workflow, /ALLOW_DISPOSABLE_LOCAL_REPLAY:\s*["']1["']/);
  assert.doesNotMatch(workflow, /SUPABASE_URL:\s*\$\{\{\s*secrets\.(?:PROD|PRODUCTION)/i);
});
test('SQL manifest audit is source-only', () => {
  const workflow = read('../.github/workflows/local-supabase-sql-audit.yml');
  assert.match(workflow, /SQL_EXECUTION_AUTHORIZED=false/);
  assert.doesNotMatch(workflow, /supabase\s+(?:start|db\s+reset|db\s+push)/i);
  assert.doesNotMatch(workflow, /docker\s+(?:run|compose)/i);
});

test('runtime configuration is never precached and is fetched with no-store semantics', () => {
  const worker = read('../service-worker.js');
  assert.doesNotMatch(worker, /new URL\("\.\/deployment-config\.js", base\)\.href/);
  assert.match(worker, /url\.pathname\.endsWith\("\/deployment-config\.js"\)/);
  assert.match(worker, /fetch\(request, \{ cache: "no-store" \}\)/);
  assert.match(worker, /Cache-Control", "no-store, max-age=0, must-revalidate"/);
  assert.match(worker, /CACHE_VERSION = "v44"/);
});
test('Vercel production follows every main commit while Preview remains isolated', () => {
  const config = JSON.parse(read('../vercel.json'));
  const builder = read('../scripts/build-vercel.mjs');
  const generator = read('../scripts/generate-deployment-config.mjs');
  const ignore = read('../scripts/ignore-vercel-deployment.mjs');
  assert.match(config.buildCommand, /VERCEL_ENV/);
  assert.match(config.buildCommand, /BIZMIND_VERCEL_STANDBY_APPROVED=true/);
  assert.match(config.buildCommand, /BIZMIND_STANDBY_RELEASE_SHA/);
  assert.match(config.buildCommand, /VERCEL_GIT_COMMIT_SHA/);
  assert.equal(config.outputDirectory, 'dist/vercel-static');
  assert.match(config.ignoreCommand, /VERCEL_ENV/);
  assert.match(config.ignoreCommand, /scripts\\/ignore-vercel-deployment\\.mjs/);
  assert.match(builder, /VERCEL_ENV/);
  assert.match(builder, /BIZMIND_VERCEL_STANDBY_APPROVED/);
  assert.match(builder, /BIZMIND_STANDBY_RELEASE_SHA/);
  assert.match(generator, /BIZMIND_NONPROD_SUPABASE_HOST/);
  assert.match(ignore, /BIZMIND_VERCEL_STANDBY_APPROVED/);
});
