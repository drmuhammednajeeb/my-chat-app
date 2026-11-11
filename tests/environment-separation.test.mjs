import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the published browser app is pinned to the approved Cloud Supabase project', () => {
  const index = read('../index.html');
  const declarations = [...index.matchAll(/const\s+SUPABASE_URL\s*=/g)];
  assert.equal(declarations.length, 1, 'the browser must have exactly one Supabase URL declaration');
  assert.match(
    index,
    /const\s+SUPABASE_URL\s*=\s*'https:\/\/lvkeohpuucuklagvwpnq\.supabase\.co'/,
    'the deployed app must target the approved Cloud Supabase project'
  );
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
