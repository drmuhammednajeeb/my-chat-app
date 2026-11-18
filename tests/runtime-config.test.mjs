import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const handler = require('../api/runtime-config.js');
const resolve = handler.resolveRuntimeConfig;

const base = {
  VERCEL_ENV: 'preview',
  SUPABASE_URL: 'https://staging-project.supabase.co',
  SUPABASE_ANON_KEY: 'header.' + Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url') + '.signature'
};

test('preview accepts a separate HTTPS Supabase project', () => {
  const config = resolve(base);
  assert.equal(config.environment, 'preview');
  assert.equal(config.supabaseUrl, base.SUPABASE_URL);
  assert.equal(config.supabaseAnonKey, base.SUPABASE_ANON_KEY);
});

test('preview rejects the production Supabase project', () => {
  const config = resolve({ ...base, SUPABASE_URL: 'https://lvkeohpuucuklagvwpnq.supabase.co' });
  assert.match(config.error, /forbidden/i);
});

test('production accepts only the approved production project', () => {
  const config = resolve({ ...base, VERCEL_ENV: 'production', SUPABASE_URL: 'https://lvkeohpuucuklagvwpnq.supabase.co' });
  assert.equal(config.environment, 'production');
  assert.equal(config.error, undefined);
});

test('development rejects the production Supabase project', () => {
  const config = resolve({
    ...base,
    VERCEL_ENV: 'development',
    SUPABASE_URL: 'https://lvkeohpuucuklagvwpnq.supabase.co'
  });
  assert.match(config.error, /non-production deployments/i);
});

test('development allows only local HTTP endpoints and non-production HTTPS projects', () => {
  assert.equal(resolve({
    ...base,
    VERCEL_ENV: 'development',
    SUPABASE_URL: 'http://127.0.0.1:54321'
  }).environment, 'development');
  assert.ok(resolve({
    ...base,
    VERCEL_ENV: 'development',
    SUPABASE_URL: 'https://staging-project.supabase.co:8443'
  }).error);
});

test('production rejects a staging project', () => {
  const config = resolve({ ...base, VERCEL_ENV: 'production' });
  assert.match(config.error, /approved production project/i);
});

test('service-role and secret API keys are never exposed to the browser', () => {
  const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  const serviceRoleJwt = 'header.' + payload + '.signature';
  assert.ok(resolve({ ...base, SUPABASE_ANON_KEY: serviceRoleJwt }).error);
  assert.ok(resolve({ ...base, SUPABASE_ANON_KEY: 'sb_secret_sensitive-value' }).error);\n  assert.ok(resolve({ ...base, SUPABASE_ANON_KEY: 'not-a-supabase-public-key' }).error);\n  assert.equal(resolve({ ...base, SUPABASE_ANON_KEY: 'sb_publishable_valid-public-key' }).environment, 'preview');
  assert.ok(resolve({ ...base, SUPABASE_ANON_KEY: 12345 }).error);
});

test('missing variables fail closed', () => {
  const config = resolve({ VERCEL_ENV: 'preview' });
  assert.match(config.error, /missing/i);
});

test('invalid protocols and URL components are rejected', () => {
  assert.ok(resolve({ ...base, SUPABASE_URL: 'http://staging-project.supabase.co' }).error);
  assert.ok(resolve({ ...base, SUPABASE_URL: 'https://user:pass@staging-project.supabase.co' }).error);
  assert.ok(resolve({ ...base, SUPABASE_URL: 'https://staging-project.supabase.co/path' }).error);
});

test('runtime endpoint emits no-store JavaScript and a safe failure payload', () => {
  const previous = { ...process.env };
  try {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    process.env.VERCEL_ENV = 'preview';
    const headers = {};
    let body = '';
    const res = {
      setHeader: (name, value) => { headers[name] = value; },
      end: value => { body = value; }
    };
    handler({}, res);
    assert.equal(res.statusCode, 503);
    assert.match(headers['Cache-Control'], /no-store/);
    assert.match(headers['Content-Type'], /javascript/);
    assert.match(body, /BIZMIND_RUNTIME_CONFIG/);
    assert.doesNotMatch(body, /sb_publishable_|service_role/i);
  } finally {
    for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VERCEL_ENV']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
