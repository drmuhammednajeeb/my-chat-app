import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeploymentConfig, renderDeploymentConfig, PRODUCTION_SUPABASE_HOST } from "./generate-deployment-config.mjs";

const EXCLUDED_TOP_LEVEL = new Set([
  ".git", ".github", ".vercel", "node_modules", "dist", "supabase",
  "database", "docs", "tests", "scripts"
]);

function shouldCopyStaticFile(source, rootDirectory) {
  const relativePath = relative(rootDirectory, source);
  if (!relativePath) return true;
  const parts = relativePath.split(sep);
  if (EXCLUDED_TOP_LEVEL.has(parts[0])) return false;
  if (parts.some(part => /^\.env(?:\.|$)/.test(part))) return false;
  if (relativePath === "deployment-config.js" || relativePath === "vercel.json" ||
      relativePath === "README.md" || relativePath === ".gitignore" ||
      relativePath === ".gitattributes") return false;
  return true;
}

export async function verifyPagesOutput(outputDirectory) {
  const root = resolve(outputDirectory);
  const required = ["index.html", "manifest.json", "service-worker.js", "modules/runtime-config.js", "deployment-config.js", ".nojekyll"];
  for (const item of required) {
    try { await readFile(join(root, item)); }
    catch { throw new Error("Pages artifact is missing required file: " + item); }
  }

  const html = await readFile(join(root, "index.html"), "utf8");
  const configScriptPosition = html.indexOf("./deployment-config.js");
  const runtimeScriptPosition = html.indexOf("./modules/runtime-config.js");
  const supabaseClientPosition = html.indexOf("supabase.min.js");
  if (configScriptPosition < 0 || runtimeScriptPosition < 0 || supabaseClientPosition < 0 ||
      configScriptPosition > supabaseClientPosition) {
    throw new Error("Pages entry point must load generated deployment config before the Supabase client using relative paths.");
  }
  if (/https:\/\/[a-z0-9-]+\.supabase\.co/i.test(html) || /SUPABASE_ANON_KEY\s*=\s*['"]/.test(html)) {
    throw new Error("Supabase runtime credentials must not be hardcoded in index.html.");
  }

  const configText = await readFile(join(root, "deployment-config.js"), "utf8");
  if (!configText.includes('"target":"pages-production"') ||
      !configText.includes(PRODUCTION_SUPABASE_HOST) ||
      /sb_secret_|service_role/i.test(configText)) {
    throw new Error("Generated Pages config is not pinned to the approved public production configuration.");
  }

  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (manifest.start_url !== "./" || manifest.scope !== "./") {
    throw new Error("PWA manifest start_url and scope must remain relative to the Pages project path.");
  }

  const serviceWorker = await readFile(join(root, "service-worker.js"), "utf8");
  if (!serviceWorker.includes("deployment-config.js") || !serviceWorker.includes('cache: "no-store"')) {
    throw new Error("Service Worker must fetch deployment config network-only with no-store.");
  }
  const precacheBlocks = [...serviceWorker.matchAll(/cache\.addAll\(\[([\s\S]*?)\]\);/g)];
  if (!precacheBlocks.length || precacheBlocks.some(match => match[1].includes("deployment-config.js"))) {
    throw new Error("Service Worker must not precache generated deployment config.");
  }

  const metadata = JSON.parse(await readFile(join(root, "release-metadata.json"), "utf8"));
  if (metadata.deploymentTarget !== "pages-production" ||
      !/^[0-9a-f]{40}$/.test(metadata.sourceCommit || "") ||
      metadata.supabaseHost !== PRODUCTION_SUPABASE_HOST) {
    throw new Error("Pages release metadata is invalid or incomplete.");
  }

  return { outputDirectory: root, sourceCommit: metadata.sourceCommit, deploymentTarget: metadata.deploymentTarget };
}

export async function buildPagesOutput(options = {}) {
  const env = options.env || process.env;
  const rootDirectory = resolve(options.rootDirectory || process.cwd());
  const outputDirectory = resolve(options.outputDirectory || join(rootDirectory, "dist", "pages-static"));
  const sourceCommit = String(env.RELEASE_COMMIT_SHA || env.GITHUB_SHA || "").toLowerCase();

  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error("RELEASE_COMMIT_SHA or GITHUB_SHA must be an exact 40-character commit SHA.");
  }
  if (outputDirectory === rootDirectory || !outputDirectory.startsWith(rootDirectory + sep)) {
    throw new Error("Pages output must be a child directory of the source workspace.");
  }

  // Validate the production endpoint and browser-safe key before creating deployable output.
  const config = buildDeploymentConfig({ ...env, BIZMIND_DEPLOYMENT_TARGET: "pages-production" });

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory, { recursive: true });

  const entries = await readdir(rootDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const source = join(rootDirectory, entry.name);
    if (!shouldCopyStaticFile(source, rootDirectory)) continue;
    await cp(source, join(outputDirectory, entry.name), {
      recursive: true,
      filter: item => shouldCopyStaticFile(item, rootDirectory)
    });
  }

  await writeFile(join(outputDirectory, "deployment-config.js"), renderDeploymentConfig(config), {
    encoding: "utf8",
    mode: 0o644
  });
  await writeFile(join(outputDirectory, ".nojekyll"), "", "utf8");
  await writeFile(join(outputDirectory, "release-metadata.json"), JSON.stringify({
    deploymentTarget: "pages-production",
    sourceCommit,
    supabaseHost: config.expectedSupabaseHost
  }, null, 2) + "\n", "utf8");

  return verifyPagesOutput(outputDirectory);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = await buildPagesOutput();
    process.stdout.write("PAGES_PRODUCTION_ARTIFACT_READY=" + result.sourceCommit + "\n");
  } catch (error) {
    process.stderr.write("PAGES_PRODUCTION_ARTIFACT_BLOCKED=" + error.message + "\n");
    process.exitCode = 1;
  }
}
