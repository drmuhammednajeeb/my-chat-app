import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
export const PRODUCTION_SUPABASE_HOST = "lvkeohpuucuklagvwpnq.supabase.co";
const PRODUCTION_TARGETS = new Set(["pages-production", "vercel-standby"]);
const NON_PRODUCTION_TARGETS = new Set(["preview", "test"]);
function isPublicAnonKey(value) {
  if (typeof value !== "string" || !value || value.trim() !== value || /^(sb_secret_|service_role)/i.test(value)) return false;
  if (value.startsWith("sb_publishable_")) return value.length >= 24;
  const parts = value.split(".");
  if (parts.length !== 3 || !parts[1]) return false;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "anon"; }
  catch { return false; }
}
export function buildDeploymentConfig(env = process.env) {
  const target = String(env.BIZMIND_DEPLOYMENT_TARGET || "");
  const supabaseUrl = String(env.SUPABASE_URL || "").trim();
  const supabaseAnonKey = String(env.SUPABASE_ANON_KEY || "");
  if (!PRODUCTION_TARGETS.has(target) && !NON_PRODUCTION_TARGETS.has(target)) throw new Error("BIZMIND_DEPLOYMENT_TARGET must be pages-production, vercel-standby, preview, or test.");
  if (!supabaseUrl || !supabaseAnonKey) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required; no fallback is permitted.");
  let url;
  try { url = new URL(supabaseUrl); } catch { throw new Error("SUPABASE_URL must be a valid URL."); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || !host.endsWith(".supabase.co") || url.username || url.password || url.port || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("SUPABASE_URL must be an HTTPS Supabase project origin without credentials or paths.");
  }
  if (!isPublicAnonKey(supabaseAnonKey)) throw new Error("SUPABASE_ANON_KEY must be a public publishable key or an anon-role JWT; secret/service-role keys are forbidden.");
  let expectedSupabaseHost;
  if (PRODUCTION_TARGETS.has(target)) {
    expectedSupabaseHost = PRODUCTION_SUPABASE_HOST;
    if (host !== expectedSupabaseHost) throw new Error("Production targets must use the single approved production Supabase project.");
  } else {
    expectedSupabaseHost = String(env.BIZMIND_NONPROD_SUPABASE_HOST || "").trim().toLowerCase();
    if (!expectedSupabaseHost || !/^[a-z0-9-]+\.supabase\.co$/.test(expectedSupabaseHost)) throw new Error("BIZMIND_NONPROD_SUPABASE_HOST must explicitly allowlist the non-production project.");
    if (expectedSupabaseHost === PRODUCTION_SUPABASE_HOST || host !== expectedSupabaseHost) throw new Error("Preview/test targets must match an explicit non-production Supabase allowlist.");
  }
  return Object.freeze({ target, supabaseUrl: url.origin, expectedSupabaseHost, supabaseAnonKey });
}
export function renderDeploymentConfig(config) {
  return "// Generated at build time. Public anon/publishable key only; do not add secrets.\nwindow.__BIZMIND_DEPLOYMENT_CONFIG__ = Object.freeze(" + JSON.stringify(config) + ");\n";
}
export function generateDeploymentConfig(env = process.env, outputPath = "deployment-config.js") {
  const config = buildDeploymentConfig(env);
  writeFileSync(outputPath, renderDeploymentConfig(config), { encoding: "utf8", mode: 0o644 });
  return { outputPath, target: config.target, supabaseHost: config.expectedSupabaseHost };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = generateDeploymentConfig();
    process.stdout.write("DEPLOYMENT_CONFIG_GENERATED=" + result.target + "\n");
  } catch (error) {
    process.stderr.write("DEPLOYMENT_CONFIG_BLOCKED=" + error.message + "\n");
    process.exitCode = 1;
  }
}
