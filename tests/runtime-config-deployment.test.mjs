import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildVercelOutput, resolveVercelDeploymentConfig } from "../scripts/build-vercel.mjs";

const publicKey = "sb_publishable_test_key_material_long_enough";
const previewHost = "isolated-preview-project.supabase.co";
const previewEnv = {
  VERCEL_ENV: "preview",
  SUPABASE_URL: "https://" + previewHost,
  SUPABASE_ANON_KEY: publicKey,
  BIZMIND_NONPROD_SUPABASE_HOST: previewHost
};
const productionSha = "a".repeat(40);
const productionEnv = {
  VERCEL_ENV: "production",
  SUPABASE_URL: "https://lvkeohpuucuklagvwpnq.supabase.co",
  SUPABASE_ANON_KEY: publicKey,
  BIZMIND_VERCEL_STANDBY_APPROVED: "true",
  BIZMIND_STANDBY_RELEASE_SHA: productionSha,
  VERCEL_GIT_COMMIT_SHA: productionSha
};

test("Vercel Preview requires an explicitly allowlisted non-production Supabase project", () => {
  assert.equal(resolveVercelDeploymentConfig(previewEnv).target, "preview");
  assert.throws(() => resolveVercelDeploymentConfig({ VERCEL_ENV: "preview" }), /SUPABASE_URL and SUPABASE_ANON_KEY are required/);
  assert.throws(() => resolveVercelDeploymentConfig({
    ...previewEnv,
    SUPABASE_URL: "https://lvkeohpuucuklagvwpnq.supabase.co",
    BIZMIND_NONPROD_SUPABASE_HOST: "lvkeohpuucuklagvwpnq.supabase.co"
  }), /non-production allowlist/);
});

test("Vercel Production is blocked without explicit standby approval and exact commit pinning", () => {
  assert.throws(() => resolveVercelDeploymentConfig({ ...productionEnv, BIZMIND_VERCEL_STANDBY_APPROVED: "false" }), /owner approval/);
  assert.throws(() => resolveVercelDeploymentConfig({ ...productionEnv, BIZMIND_STANDBY_RELEASE_SHA: "b".repeat(40) }), /exact approved/);
  assert.equal(resolveVercelDeploymentConfig(productionEnv).target, "vercel-standby");
});

test("Vercel development or unknown build contexts fail closed", () => {
  assert.throws(() => resolveVercelDeploymentConfig({ VERCEL_ENV: "development" }), /Unsupported VERCEL_ENV/);
  assert.throws(() => resolveVercelDeploymentConfig({}), /Unsupported VERCEL_ENV/);
});

test("Vercel output replaces the checked-in production config and excludes source-only files", async () => {
  const root = await mkdtemp(join(tmpdir(), "bizmind-vercel-build-"));
  const output = join(root, "dist", "vercel-static");
  try {
    await mkdir(join(root, "modules"), { recursive: true });
    await mkdir(join(root, "supabase", "migrations"), { recursive: true });
    await writeFile(join(root, "index.html"), "<script src='./deployment-config.js'></script>");
    await writeFile(join(root, "deployment-config.js"), "PRODUCTION_CONFIG_SENTINEL");
    await writeFile(join(root, "modules", "runtime-config.js"), "runtime");
    await writeFile(join(root, "supabase", "migrations", "private.sql"), "source-only");
    await writeFile(join(root, ".env"), "must-not-copy");
    const result = await buildVercelOutput({ env: previewEnv, rootDirectory: root, outputDirectory: output });
    const generated = await readFile(join(output, "deployment-config.js"), "utf8");
    assert.equal(result.target, "preview");
    assert.match(generated, /"target":"preview"/);
    assert.ok(generated.includes(previewHost));
    assert.doesNotMatch(generated, /PRODUCTION_CONFIG_SENTINEL/);
    assert.equal(existsSync(join(output, "index.html")), true);
    assert.equal(existsSync(join(output, "modules", "runtime-config.js")), true);
    assert.equal(existsSync(join(output, "supabase")), false);
    assert.equal(existsSync(join(output, ".env")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
