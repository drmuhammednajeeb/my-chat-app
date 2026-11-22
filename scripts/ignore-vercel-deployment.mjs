export function shouldBuildVercelDeployment(env = process.env) {
  const target = String(env.VERCEL_ENV || "");
  if (target === "preview") {
    return Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.BIZMIND_NONPROD_SUPABASE_HOST);
  }
  if (target === "production") {
    const deployedSha = String(env.VERCEL_GIT_COMMIT_SHA || "").toLowerCase();
    const approvedSha = String(env.BIZMIND_STANDBY_RELEASE_SHA || "").toLowerCase();
    return env.BIZMIND_VERCEL_STANDBY_APPROVED === "true" &&
      /^[0-9a-f]{40}$/.test(deployedSha) &&
      approvedSha === deployedSha;
  }
  return false;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const shouldBuild = shouldBuildVercelDeployment();
  process.stdout.write(shouldBuild
    ? "VERCEL_DEPLOYMENT_ALLOWED=environment gate passed\n"
    : "VERCEL_DEPLOYMENT_SKIPPED=required isolated environment or explicit standby approval is absent\n");
  process.exitCode = shouldBuild ? 1 : 0;
}
