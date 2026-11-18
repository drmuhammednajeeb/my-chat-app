'use strict';

const PRODUCTION_PROJECT_HOST = 'lvkeohpuucuklagvwpnq.supabase.co';
const LOCAL_DEVELOPMENT_HOSTS = new Set(['localhost', '127.0.0.1']);

function isPublicBrowserKey(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const key = value.trim();

  // Supabase's current publishable key format.
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  if (/^sb_secret_/i.test(key)) return false;

  // Legacy anon keys are JWTs whose role claim must be exactly "anon".
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.role === 'anon';
  } catch {
    return false;
  }
}

function resolveRuntimeConfig(env = process.env) {
  const deployment = env.VERCEL_ENV;
  const rawUrl = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;

  if (!['production', 'preview', 'development'].includes(deployment)) {
    return { error: 'Unsupported or missing deployment environment.' };
  }
  if (typeof rawUrl !== 'string' || !rawUrl.trim() || !isPublicBrowserKey(anonKey)) {
    return { error: 'Required public Supabase environment variables are missing or invalid.' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { error: 'SUPABASE_URL is not a valid URL.' };
  }

  const isLocalDevelopment =
    deployment === 'development' && LOCAL_DEVELOPMENT_HOSTS.has(parsed.hostname);

  if (parsed.protocol !== 'https:' && !(isLocalDevelopment && parsed.protocol === 'http:')) {
    return { error: 'Supabase URL must use HTTPS outside local development.' };
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    return { error: 'SUPABASE_URL must contain only the project origin.' };
  }
  if (parsed.port && !isLocalDevelopment) {
    return { error: 'Custom Supabase URL ports are allowed only for local development.' };
  }
  if (!parsed.hostname.endsWith('.supabase.co') && !isLocalDevelopment) {
    return { error: 'Supabase host is not an approved project host.' };
  }

  if (deployment === 'production' && parsed.hostname !== PRODUCTION_PROJECT_HOST) {
    return { error: 'Production deployment is not configured for the approved production project.' };
  }
  if (
    (deployment === 'preview' || deployment === 'development') &&
    parsed.hostname === PRODUCTION_PROJECT_HOST
  ) {
    return { error: 'Non-production deployments are forbidden from using the production Supabase project.' };
  }

  return {
    environment: deployment,
    supabaseUrl: parsed.origin,
    supabaseAnonKey: anonKey.trim()
  };
}

module.exports = (req, res) => {
  const config = resolveRuntimeConfig(process.env);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  if (config.error) {
    res.statusCode = 503;
    res.end('window.BIZMIND_RUNTIME_CONFIG = ' + JSON.stringify({ error: config.error }) + ';');
    return;
  }
  res.statusCode = 200;
  res.end('window.BIZMIND_RUNTIME_CONFIG = ' + JSON.stringify(config) + ';');
};
module.exports.resolveRuntimeConfig = resolveRuntimeConfig;
