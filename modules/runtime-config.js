(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BizmindRuntimeConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";
  const PRODUCTION_SUPABASE_HOST = "lvkeohpuucuklagvwpnq.supabase.co";
  const PRODUCTION_TARGETS = new Set(["pages-production", "vercel-standby"]);
  const NON_PRODUCTION_TARGETS = new Set(["preview", "test"]);
  function isPublicAnonKey(value) {
    if (typeof value !== "string" || !value || value.trim() !== value) return false;
    if (/^(sb_secret_|service_role)/i.test(value)) return false;
    if (value.startsWith("sb_publishable_")) return value.length >= 24;
    const parts = value.split(".");
    if (parts.length !== 3 || !parts[1]) return false;
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload?.role === "anon";
    } catch (_) { return false; }
  }
  function resolve(config) {
    if (!config || typeof config !== "object") throw new Error("Runtime deployment configuration is missing.");
    const target = String(config.target || "");
    const expectedHost = String(config.expectedSupabaseHost || "").toLowerCase();
    if (!PRODUCTION_TARGETS.has(target) && !NON_PRODUCTION_TARGETS.has(target)) throw new Error("Runtime deployment target is not allowed.");
    let url;
    try { url = new URL(String(config.supabaseUrl || "")); }
    catch (_) { throw new Error("Runtime Supabase URL is invalid."); }
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || !host.endsWith(".supabase.co") || url.username || url.password || url.port || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
      throw new Error("Runtime Supabase URL is not an approved HTTPS project origin.");
    }
    if (!expectedHost || host !== expectedHost) throw new Error("Runtime Supabase host does not match the build allowlist.");
    if (PRODUCTION_TARGETS.has(target) && host !== PRODUCTION_SUPABASE_HOST) throw new Error("Production deployments must use the approved production Supabase project.");
    if (NON_PRODUCTION_TARGETS.has(target) && host === PRODUCTION_SUPABASE_HOST) throw new Error("Preview and test deployments cannot use production Supabase.");
    if (!isPublicAnonKey(config.supabaseAnonKey)) throw new Error("Runtime key must be a public Supabase anon/publishable key.");
    return Object.freeze({ target, supabaseUrl: url.origin, supabaseAnonKey: config.supabaseAnonKey });
  }
  return Object.freeze({ resolve, isPublicAnonKey, PRODUCTION_SUPABASE_HOST });
});
