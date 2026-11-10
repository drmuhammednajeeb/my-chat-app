import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectStagingConfig, PRODUCTION_SUPABASE_HOST } from './preflight.mjs';

const complete = {
  STAGING_SUPABASE_URL: 'https://isolated-project.supabase.co',
  STAGING_SUPABASE_ANON_KEY: 'test-only-placeholder',
  STAGING_TEST_USER_EMAIL: 'sender@example.invalid',
  STAGING_TEST_USER_PASSWORD: 'not-a-real-password',
  STAGING_TEST_PEER_EMAIL: 'receiver@example.invalid',
  STAGING_TEST_PEER_PASSWORD: 'not-a-real-password'
};

test('missing secrets selects validation-only mode without backend access', () => {
  assert.equal(inspectStagingConfig({}).mode, 'VALIDATION_ONLY');
});

test('partial secrets fail closed', () => {
  assert.equal(inspectStagingConfig({ STAGING_SUPABASE_URL: complete.STAGING_SUPABASE_URL }).mode, 'BLOCKED_PARTIAL_CONFIG');
});

test('production Supabase host is always rejected', () => {
  const result = inspectStagingConfig({ ...complete, STAGING_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_HOST}` });
  assert.equal(result.mode, 'BLOCKED_PRODUCTION_HOST');
  const trailingDot = inspectStagingConfig({ ...complete, STAGING_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_HOST}.` });
  assert.equal(trailingDot.mode, 'BLOCKED_PRODUCTION_HOST');
});

test('non-HTTPS endpoint is rejected', () => {
  assert.equal(inspectStagingConfig({ ...complete, STAGING_SUPABASE_URL: 'http://isolated-project.supabase.co' }).mode, 'BLOCKED_INSECURE_URL');
});

test('embedded credentials, paths, query strings and fragments are rejected', () => {
  for (const url of [
    'https://user:pass@isolated-project.supabase.co',
    'https://isolated-project.supabase.co/rest/v1',
    'https://isolated-project.supabase.co?apikey=x',
    'https://isolated-project.supabase.co#fragment'
  ]) {
    assert.equal(inspectStagingConfig({ ...complete, STAGING_SUPABASE_URL: url }).mode, 'BLOCKED_URL_SHAPE');
  }
});

test('same account cannot be used as both test participants', () => {
  assert.equal(inspectStagingConfig({ ...complete, STAGING_TEST_PEER_EMAIL: complete.STAGING_TEST_USER_EMAIL }).mode, 'BLOCKED_TEST_IDENTITIES');
});

test('complete isolated configuration is recognized but never treated as a passed E2E run', () => {
  const result = inspectStagingConfig(complete);
  assert.equal(result.mode, 'CONFIGURED_NOT_EXECUTED');
  assert.match(result.reason, /Full-app E2E runner is not implemented/);
});
