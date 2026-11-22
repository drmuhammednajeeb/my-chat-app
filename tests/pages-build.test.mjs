import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPagesOutput } from "../scripts/build-pages.mjs";

const COMMIT = "a".repeat(40);
const KEY = "sb_publishable_" + "A".repeat(32);

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "bizmind-pages-source-"));
  await mkdir(join(root, "modules"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "index.html"), '<script src="./deployment-config.js"></script><script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script><script src="./modules/runtime-config.js"></script><script>const SUPABASE_ANON_KEY=window.__BIZMIND_DEPLOYMENT_CONFIG__.supabaseAnonKey; window.supabase.createClient();</script>');
  await writeFile(join(root, "manifest.json"), JSON.stringify({ start_url: "./", scope: "./" }));
  await writeFile(join(root, "service-worker.js"), 'await cache.addAll(["./index.html"]); if (url.pathname.endsWith("/deployment-config.js")) fetch(request, { cache: "no-store" });');
  await writeFile(join(root, "modules/runtime-config.js"), "/* runtime validator */");
  await writeFile(join(root, "modules/app-updater.js"), 'navigator.serviceWorker.register(new URL("./service-worker.js", doc.baseURI));');
  await writeFile(join(root, "deployment-config.js"), "DO_NOT_COPY_CHECKED_IN_CONFIG");
  await writeFile(join(root, "docs/private-notes.md"), "source only");
  await writeFile(join(root, ".env"), "SHOULD_NOT_SHIP=true");
  return root;
}

function validEnv(overrides = {}) {
  return {
    SUPABASE_URL: "https://lvkeohpuucuklagvwpnq.supabase.co",
    SUPABASE_ANON_KEY: KEY,
    RELEASE_COMMIT_SHA: COMMIT,
    ...overrides
  };
}

test("Pages artifact replaces checked-in config and excludes source-only files", async () => {
  const root = await createFixture();
  const output = join(root, "dist", "pages-static");
  try {
    const result = await buildPagesOutput({ rootDirectory: root, outputDirectory: output, env: validEnv() });
    assert.equal(result.sourceCommit, COMMIT);
    const config = await readFile(join(output, "deployment-config.js"), "utf8");
    assert.match(config, /pages-production/);
    assert.doesNotMatch(config, /DO_NOT_COPY_CHECKED_IN_CONFIG/);
    assert.equal(await readFile(join(output, ".nojekyll"), "utf8"), "");
    await assert.rejects(readFile(join(output, ".env")));
    await assert.rejects(readFile(join(output, "docs", "private-notes.md")));
    await assert.rejects(readFile(join(output, "scripts", "generate-deployment-config.mjs")));
    const metadata = JSON.parse(await readFile(join(output, "release-metadata.json"), "utf8"));
    assert.deepEqual(metadata, {
      deploymentTarget: "pages-production",
      sourceCommit: COMMIT,
      supabaseHost: "lvkeohpuucuklagvwpnq.supabase.co"
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pages build rejects a non-production Supabase project before output creation", async () => {
  const root = await createFixture();
  const output = join(root, "dist", "pages-static");
  try {
    await assert.rejects(
      buildPagesOutput({
        rootDirectory: root,
        outputDirectory: output,
        env: validEnv({ SUPABASE_URL: "https://not-production.supabase.co" })
      }),
      /single approved production Supabase project/
    );
    await assert.rejects(readFile(output));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pages build rejects missing commit provenance and invalid browser keys", async () => {
  const root = await createFixture();
  try {
    await assert.rejects(
      buildPagesOutput({ rootDirectory: root, env: validEnv({ RELEASE_COMMIT_SHA: "" }) }),
      /exact 40-character commit SHA/
    );
    await assert.rejects(
      buildPagesOutput({ rootDirectory: root, env: validEnv({ SUPABASE_ANON_KEY: "service_role_invalid" }) }),
      /public publishable key or an anon-role JWT/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("actual reviewed repository source satisfies the Pages path and runtime contract", async () => {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = join(repositoryRoot, "dist", "pages-contract-test-" + process.pid);
  try {
    const result = await buildPagesOutput({ rootDirectory: repositoryRoot, outputDirectory: output, env: validEnv() });
    assert.equal(result.deploymentTarget, "pages-production");
    assert.equal(result.sourceCommit, COMMIT);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});


test("Pages artifact workflow preserves executable GitHub Actions expressions and production gates", async () => {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workflow = await readFile(join(repositoryRoot, ".github", "workflows", "pages-production-artifact.yml"), "utf8");
  assert.doesNotMatch(workflow, /\\\$\{\{/);
  assert.match(workflow, /SELECTED_REF:\s*\$\{\{\s*github\.ref\s*\}\}/);
  assert.match(workflow, /CONFIRMATION:\s*\$\{\{\s*inputs\.confirm_production_artifact\s*\}\}/);
  assert.match(workflow, /SUPABASE_URL:\s*\$\{\{\s*vars\.PAGES_PRODUCTION_SUPABASE_URL\s*\}\}/);
  assert.match(workflow, /SUPABASE_ANON_KEY:\s*\$\{\{\s*secrets\.PAGES_PRODUCTION_SUPABASE_ANON_KEY\s*\}\}/);
  assert.match(workflow, /test "\$SELECTED_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /test "\$CONFIRMATION" = "BUILD-PAGES-ARTIFACT"/);
  assert.match(workflow, /Upload review-only candidate artifact/);
  assert.doesNotMatch(workflow, /actions\/deploy-pages|peaceiris\/actions-gh-pages/);
});
