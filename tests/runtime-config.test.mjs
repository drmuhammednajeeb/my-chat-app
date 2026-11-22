import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { buildDeploymentConfig, renderDeploymentConfig, generateDeploymentConfig, PRODUCTION_SUPABASE_HOST } from "../scripts/generate-deployment-config.mjs";
const runtime = createRequire(import.meta.url)("../modules/runtime-config.js");
const productionKey = "sb_publishable_test_key_material_long_enough";
function env(target, host = PRODUCTION_SUPABASE_HOST, key = productionKey) {
  return { BIZMIND_DEPLOYMENT_TARGET: target, SUPABASE_URL: `https://${host}`, SUPABASE_ANON_KEY: key,
    ...(target === "preview" || target === "test" ? { BIZMIND_NONPROD_SUPABASE_HOST: host } : {}) };
}
test("Pages production is pinned to the approved Supabase project", () => {
  const config = buildDeploymentConfig(env("pages-production"));
  assert.equal(runtime.resolve(config).target, "pages-production");
});
test("Vercel standby uses the same production Supabase project", () => {
  const config = buildDeploymentConfig(env("vercel-standby"));
  assert.equal(runtime.resolve(config).supabaseUrl, `https://${PRODUCTION_SUPABASE_HOST}`);
});
test("preview and test require an explicit separate non-production allowlist", () => {
  for (const target of ["preview", "test"]) {
    const host = "isolated-test-project.supabase.co";
    assert.equal(runtime.resolve(buildDeploymentConfig(env(target, host))).target, target);
  }
});
test("preview/test cannot use production even if supplied as allowlisted", () => {
  for (const target of ["preview", "test"]) assert.throws(() => buildDeploymentConfig(env(target)), /non-production Supabase allowlist/);
});
test("production targets reject any other project", () => assert.throws(() => buildDeploymentConfig(env("pages-production", "other-project.supabase.co")), /approved production/));
test("missing target or credentials fail closed", () => {
  assert.throws(() => buildDeploymentConfig({}), /BIZMIND_DEPLOYMENT_TARGET/);
  assert.throws(() => buildDeploymentConfig({ ...env("pages-production"), SUPABASE_ANON_KEY: "" }), /required/);
});
test("local, malformed, credential-bearing, and non-HTTPS endpoints are rejected", () => {
  for (const url of ["http://localhost:54321", "http://lvkeohpuucuklagvwpnq.supabase.co", "https://user:pass@lvkeohpuucuklagvwpnq.supabase.co", "https://lvkeohpuucuklagvwpnq.supabase.co/rest/v1", "not-a-url"]) {
    assert.throws(() => buildDeploymentConfig({ ...env("pages-production"), SUPABASE_URL: url }));
  }
});
test("service-role and secret keys are rejected", () => {
  for (const key of ["sb_secret_not-for-browser", "service_role", "sb_publishable_short"]) assert.throws(() => buildDeploymentConfig({ ...env("pages-production"), SUPABASE_ANON_KEY: key }));
  const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
  const jwt = `eyJhbGciOiJub25lIn0.${payload}.signature`;
  assert.throws(() => buildDeploymentConfig({ ...env("pages-production"), SUPABASE_ANON_KEY: jwt }));
});
test("browser resolver rejects missing config and production host mismatch", () => {
  assert.throws(() => runtime.resolve(null), /missing/);
  assert.throws(() => runtime.resolve({ target: "pages-production", supabaseUrl: "https://attacker.supabase.co", expectedSupabaseHost: "attacker.supabase.co", supabaseAnonKey: productionKey }), /approved production/);
});
test("rendered config contains only explicit public runtime fields", () => {
  const rendered = renderDeploymentConfig(buildDeploymentConfig(env("pages-production")));
  assert.match(rendered, /__BIZMIND_DEPLOYMENT_CONFIG__/);
  assert.doesNotMatch(rendered, /service_role|sb_secret_|SUPABASE_SERVICE_ROLE_KEY/i);
});
test("generator writes the selected target", () => {
  const directory = mkdtempSync(join(tmpdir(), "bizmind-runtime-config-"));
  try {
    const output = join(directory, "deployment-config.js");
    const result = generateDeploymentConfig(env("pages-production"), output);
    const content = readFileSync(output, "utf8");
    assert.equal(result.target, "pages-production");
    assert.match(content, /pages-production/);
    assert.match(content, /sb_publishable_test_key_material/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("publishable keys require the documented safe character set and minimum material", () => {
  for (const key of ["sb_publishable_short", "sb_publishable_!!!!!!!!!!!!!!!!!", "sb_secret_" + "x".repeat(32)]) {
    assert.equal(runtime.isPublicAnonKey(key), false);
  }
  assert.equal(runtime.isPublicAnonKey(productionKey), true);
});
test("legacy JWTs must have a non-none algorithm and anon role", () => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const jwt = role => encode({ alg: "HS256", typ: "JWT" }) + "." + encode({ role }) + ".c2lnbmF0dXJl";
  assert.equal(runtime.isPublicAnonKey(jwt("anon")), true);
  assert.equal(runtime.isPublicAnonKey(jwt("service_role")), false);
  const unsigned = encode({ alg: "none" }) + "." + encode({ role: "anon" }) + ".c2lnbmF0dXJl";
  assert.equal(runtime.isPublicAnonKey(unsigned), false);
});
test("runtime rejects malformed expected hosts and array-shaped configuration", () => {
  assert.throws(() => runtime.resolve([]), /missing/);
  assert.throws(() => runtime.resolve({ target: "preview", supabaseUrl: "https://isolated-test-project.supabase.co", expectedSupabaseHost: "*.supabase.co", supabaseAnonKey: productionKey }), /allowlist/);
});
