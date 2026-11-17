'use strict';

const PRODUCTION_PROJECT_HOST = 'lvkeohpuucuklagvwpnq.supabase.co';

function resolveRuntimeConfig(env = process.env) {
  const deployment = env.VERCEL_ENV;
  const rawUrl = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;

  if (!['production', 'preview', 'development'].includes(deployment)) {
    return { error: 'Unsupported or missing deployment environment.' };
  }
  if (!rawUrl || !anonKey) {
    return { error: 'Required Supabase environment variables are missing.' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { error: 'SUPABASE_URL is not a valid URL.' };
  }

  if (parsed.protocol !== 'https:' && !(deployment === 'development' && parsed.hostname === '127.0.0.1')) {
    return { error: 'Supabase URL must use HTTPS outside local development.' };
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    return { error: 'SUPABASE_URL must contain only the project origin.' };
  }
  if (!parsed.hostname.endsWith('.supabase.co') && !(deployment === 'development' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    return { error: 'Supabase host is not an approved project host.' };
  }

  if (deployment === 'production' && parsed.hostname !== PRODUCTION_PROJECT_HOST) {
    return { error: 'Production deployment is not configured for the approved production project.' };
  }
  if (deployment === 'preview' && parsed.hostname === PRODUCTION_PROJECT_HOST) {
    return { error: 'Preview deployments are forbidden from using the production Supabase project.' };
  }

  return {
    environment: deployment,
    supabaseUrl: parsed.origin,
    supabaseAnonKey: anonKey
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
