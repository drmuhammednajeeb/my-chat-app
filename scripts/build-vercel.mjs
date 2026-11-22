import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeploymentConfig, renderDeploymentConfig } from "./generate-deployment-config.mjs";

const EXCLUDED_TOP_LEVEL = new Set([
  ".git", ".github", ".vercel", "node_modules", "dist", "supabase",
  "database", "docs", "tests", "scripts"
]);

export function resolveVercelDeploymentConfig(env = process.env) {
  const vercelEnvironment = String(env.VERCEL_ENV || "");
  if (vercelEnvironment === "preview") {
    return buildDeploymentConfig({ ...env, BIZMIND_DEPLOYMENT_TARGET: "preview" });
  }
  if (vercelEnvironment === "production") {
    if (env.BIZMIND_VERCEL_STANDBY_APPROVED !== "true") {
      throw new Error("Vercel standby is disabled; explicit owner approval is required.");
    }
    const deployedSha = String(env.VERCEL_GIT_COMMIT_SHA || "").toLowerCase();
    const approvedSha = String(env.BIZMIND_STANDBY_RELEASE_SHA || "").toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(deployedSha) || approvedSha !== deployedSha) {
      throw new Error("Vercel standby requires an exact approved BIZMIND_STANDBY_RELEASE_SHA matching VERCEL_GIT_COMMIT_SHA.");
    }
    return buildDeploymentConfig({ ...env, BIZMIND_DEPLOYMENT_TARGET: "vercel-standby" });
  }
  throw new Error("Unsupported VERCEL_ENV; only isolated preview or explicitly approved standby production builds are allowed.");
}

function shouldCopyStaticFile(source, rootDirectory) {
  const relativePath = relative(rootDirectory, source);
  if (!relativePath) return true;
  const parts = relativePath.split(sep);
  if (EXCLUDED_TOP_LEVEL.has(parts[0])) return false;
  if (parts.some(part => /^\\.env(?:\\.|$)/.test(part))) return false;
  if (relativePath === "deployment-config.js" || relativePath === "vercel.json" ||
      relativePath === "README.md" || relativePath === ".gitignore" || relativePath === ".gitattributes") return false;
  return true;
}

export async function buildVercelOutput(options = {}) {
  const env = options.env || process.env;
  const rootDirectory = resolve(options.rootDirectory || process.cwd());
  const outputDirectory = resolve(options.outputDirectory || join(rootDirectory, "dist", "vercel-static"));

  // Validate before creating output: invalid or missing environment never produces deployable output.
  const config = resolveVercelDeploymentConfig(env);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  await cp(rootDirectory, outputDirectory, {
    recursive: true,
    filter: source => shouldCopyStaticFile(source, rootDirectory)
  });
  await writeFile(join(outputDirectory, "deployment-config.js"), renderDeploymentConfig(config), {
    encoding: "utf8",
    mode: 0o644
  });
  return { outputDirectory, target: config.target, supabaseHost: config.expectedSupabaseHost };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = await buildVercelOutput();
    process.stdout.write("VERCEL_STATIC_OUTPUT_READY=" + result.target + " host=" + result.supabaseHost + "\n");
  } catch (error) {
    process.stderr.write("VERCEL_STATIC_BUILD_BLOCKED=" + error.message + "\n");
    process.exitCode = 1;
  }
}
