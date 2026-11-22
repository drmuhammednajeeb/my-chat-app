(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BizmindRuntimeConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";
  const PRODUCTION_SUPABASE_HOST = "lvkeohpuucuklagvwpnq.supabase.co";
  const PRODUCTION_TARGETS = new Set(["pages-production", "vercel-standby"]);
  const NON_PRODUCTION_TARGETS = new Set(["preview", "test"]);
  const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{20,128}$/;

  function decodeJwtSegment(segment) {
    if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error("Invalid JWT segment.");
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)));
  }

  function isPublicAnonKey(value) {
    if (typeof value !== "string" || !value || value.trim() !== value) return false;
    if (/^(sb_secret_|service_role)/i.test(value)) return false;
    if (value.startsWith("sb_publishable_")) return PUBLISHABLE_KEY_PATTERN.test(value);
    const parts = value.split(".");
    if (parts.length !== 3) return false;
    try {
      const header = decodeJwtSegment(parts[0]);
      const payload = decodeJwtSegment(parts[1]);
      return header.alg !== "none" && payload.role === "anon" && /^[A-Za-z0-9_-]+$/.test(parts[2]);
    } catch (_) {
      return false;
    }
  }

  function resolve(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("Runtime deployment configuration is missing.");
    }
    if (typeof config.target !== "string" || typeof config.expectedSupabaseHost !== "string") {
      throw new Error("Runtime deployment target and allowlist must be explicit strings.");
    }
    const target = config.target;
    const expectedHost = config.expectedSupabaseHost.toLowerCase();
    if (!PRODUCTION_TARGETS.has(target) && !NON_PRODUCTION_TARGETS.has(target)) {
      throw new Error("Runtime deployment target is not allowed.");
    }
    let url;
    try { url = new URL(String(config.supabaseUrl || "")); }
    catch (_) { throw new Error("Runtime Supabase URL is invalid."); }
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const validProjectHost = /^[a-z0-9-]+\.supabase\.co$/;
    if (url.protocol !== "https:" || !validProjectHost.test(host) || url.username || url.password ||
        url.port || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
      throw new Error("Runtime Supabase URL is not an approved HTTPS project origin.");
    }
    if (!validProjectHost.test(expectedHost) || host !== expectedHost) {
      throw new Error("Runtime Supabase host does not match the build allowlist.");
    }
    if (PRODUCTION_TARGETS.has(target) && host !== PRODUCTION_SUPABASE_HOST) {
      throw new Error("Production deployments must use the approved production Supabase project.");
    }
    if (NON_PRODUCTION_TARGETS.has(target) && host === PRODUCTION_SUPABASE_HOST) {
      throw new Error("Preview and test deployments cannot use production Supabase.");
    }
    if (!isPublicAnonKey(config.supabaseAnonKey)) {
      throw new Error("Runtime key must be a valid public Supabase anon/publishable key.");
    }
    return Object.freeze({ target, supabaseUrl: url.origin, supabaseAnonKey: config.supabaseAnonKey });
  }

  return Object.freeze({ resolve, isPublicAnonKey, PRODUCTION_SUPABASE_HOST });
});
