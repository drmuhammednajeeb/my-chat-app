// Safe configuration gate for future isolated Supabase staging tests.
// This script performs no network requests and never prints secret values.
import process from 'node:process';

export const PRODUCTION_SUPABASE_HOST = 'lvkeohpuucuklagvwpnq.supabase.co';
const REQUIRED = [
  'STAGING_SUPABASE_URL',
  'STAGING_SUPABASE_ANON_KEY',
  'STAGING_TEST_USER_EMAIL',
  'STAGING_TEST_USER_PASSWORD',
  'STAGING_TEST_PEER_EMAIL',
  'STAGING_TEST_PEER_PASSWORD'
];

export function inspectStagingConfig(env = process.env) {
  const present = REQUIRED.filter(name => typeof env[name] === 'string' && env[name].trim());
  const missing = REQUIRED.filter(name => !present.includes(name));
  if (present.length === 0) {
    return { mode: 'VALIDATION_ONLY', missing: REQUIRED, reason: 'No staging secrets configured; no backend test will run.' };
  }
  if (missing.length) {
    return { mode: 'BLOCKED_PARTIAL_CONFIG', missing, reason: 'Staging configuration is incomplete.' };
  }

  let url;
  try { url = new URL(env.STAGING_SUPABASE_URL); }
  catch { return { mode: 'BLOCKED_INVALID_URL', missing: [], reason: 'STAGING_SUPABASE_URL is not a valid URL.' }; }

  if (url.protocol !== 'https:') {
    return { mode: 'BLOCKED_INSECURE_URL', missing: [], reason: 'Staging URL must use HTTPS.' };
  }
  if (url.hostname.toLowerCase() === PRODUCTION_SUPABASE_HOST) {
    return { mode: 'BLOCKED_PRODUCTION_HOST', missing: [], reason: 'Production Supabase host is forbidden for staging tests.' };
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    return { mode: 'BLOCKED_URL_SHAPE', missing: [], reason: 'Provide only the Supabase project origin; do not embed credentials or paths.' };
  }
  if (env.STAGING_TEST_USER_EMAIL.trim().toLowerCase() === env.STAGING_TEST_PEER_EMAIL.trim().toLowerCase()) {
    return { mode: 'BLOCKED_TEST_IDENTITIES', missing: [], reason: 'Two distinct dedicated test accounts are required.' };
  }

  return {
    mode: 'CONFIGURED_NOT_EXECUTED',
    missing: [],
    reason: 'Isolated staging credentials are present. Full-app E2E runner is not implemented; no backend calls were made.'
  };
}

const result = inspectStagingConfig();
console.log(`STAGING_PREFLIGHT=${result.mode}`);
console.log(result.reason);
if (result.missing.length) console.log(`Missing configuration names: ${result.missing.join(', ')}`);
if (result.mode.startsWith('BLOCKED_')) process.exitCode = 1;
