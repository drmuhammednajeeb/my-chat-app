'use strict';

/**
 * BizmindMakers Chat Pro — Supabase browser client bootstrap.
 * Loaded after the pinned Supabase UMD bundle and before application code.
 * The staging override is injected into an in-memory HTML copy by the E2E
 * harness only; production always uses the public application configuration.
 */
(function initializeSupabaseClient(global) {
  const bootStartedAt = performance.now();
  const testConfig = global.__BIZMIND_TEST_SUPABASE_CONFIG__;
  const SUPABASE_URL = typeof testConfig?.url === 'string' && testConfig.url
    ? testConfig.url
    : 'https://lvkeohpuucuklagvwpnq.supabase.co';
  const SUPABASE_ANON_KEY = typeof testConfig?.anonKey === 'string' && testConfig.anonKey
    ? testConfig.anonKey
    : 'sb_publishable_3OM0vlZU0dkqK4X6aoGZsA_ZBawbYDR';

  if (!global.supabase || typeof global.supabase.createClient !== 'function') {
    throw new Error('Supabase UMD SDK must load before js/bootstrap/supabase-client.js');
  }

  const supabaseClient = global.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } }
  );

  // Preserve the global names consumed by the existing classic-script app.
  global.SUPABASE_URL = SUPABASE_URL;
  global.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
  global.supabaseClient = supabaseClient;

  const supabaseResource = performance.getEntriesByType('resource').find(entry =>
    entry.name.includes('/supabase.js') || entry.name.includes('/supabase.min.js')
  );
  global.__BIZMIND_BOOT_TIMINGS__ = {
    mainScriptStarted: bootStartedAt,
    supabaseScriptMs: supabaseResource ? Math.round(supabaseResource.duration) : null,
    clientReady: performance.now()
  };
})(window);
