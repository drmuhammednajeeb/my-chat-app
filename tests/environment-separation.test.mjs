import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the browser loads Supabase configuration from the environment-specific runtime endpoint', () => {
  const index = read('../index.html');
  const endpoint = read('../api/runtime-config.js');
  assert.ok(index.includes('<script src="/api/runtime-config"></script>'));
  assert.match(index, /window\.BIZMIND_RUNTIME_CONFIG/);
  assert.doesNotMatch(index, /const\s+SUPABASE_URL\s*=\s*['"]https:\/\//);
  assert.doesNotMatch(index, /const\s+SUPABASE_ANON_KEY\s*=\s*['"][^'"]+['"]/);
  assert.match(endpoint, /VERCEL_ENV/);
  assert.match(endpoint, /deployment === 'preview'.*PRODUCTION_PROJECT_HOST/s);\n  assert.match(endpoint, /deployment === 'development'.*PRODUCTION_PROJECT_HOST/s);
  assert.match(endpoint, /deployment === 'production'.*PRODUCTION_PROJECT_HOST/s);
  assert.match(endpoint, /Cache-Control/);
});

test('no local Docker/Supabase endpoint can leak into browser runtime assets', () => {
  const runtimeAssets = [
    '../index.html',
    '../membership.js',
    '../service-worker.js',
    '../manifest.json'
  ];
  const forbidden = [
    /localhost/i,
    /127\.0\.0\.1/i,
    /0\.0\.0\.0/i,
    /host\.docker\.internal/i,
    /https?:\/\/kong(?::|\/)/i,
    /supabase\.local/i
  ];

  for (const path of runtimeAssets) {
    const source = read(path);
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${path} contains a local-only endpoint: ${pattern}`);
    }
  }
});

test('disposable local Supabase runtime is isolated to a temporary GitHub Actions runner', () => {
  const workflow = read('../.github/workflows/disposable-local-supabase-runtime.yml');
  assert.match(workflow, /runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /runner\.temp/);
  assert.match(workflow, /supabase start/);
  assert.match(workflow, /supabase stop/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(workflow, /ALLOW_DISPOSABLE_LOCAL_REPLAY:\s*["']1["']/);
  assert.doesNotMatch(workflow, /SUPABASE_URL:\s*\$\{\{\s*secrets\.(?:PROD|PRODUCTION)/i);
});

test('the SQL manifest audit is source-only and cannot start or reset a local database', () => {
  const workflow = read('../.github/workflows/local-supabase-sql-audit.yml');
  assert.match(workflow, /SQL_EXECUTION_AUTHORIZED=false/);
  assert.doesNotMatch(workflow, /supabase\s+(?:start|db\s+reset|db\s+push)/i);
  assert.doesNotMatch(workflow, /docker\s+(?:run|compose)/i);
});
