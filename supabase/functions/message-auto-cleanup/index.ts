import { withSupabase } from "npm:@supabase/server@1";
import { runMessageCleanupBatch } from "./worker-core.mjs";

export default {
  fetch: withSupabase({ auth: "secret" }, async (request: Request, ctx) => {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const suppliedToken = request.headers.get("x-auto-cleanup-token");
    if (!suppliedToken) {
      return Response.json({ error: "Unauthorized cleanup invocation" }, { status: 401 });
    }

    try {
      const admin = ctx.supabaseAdmin;
      const { data: authorized, error: authError } = await admin.rpc(
        "verify_message_cleanup_token",
        { p_candidate: suppliedToken }
      );

      if (authError || authorized !== true) {
        return Response.json({ error: "Unauthorized cleanup invocation" }, { status: 401 });
      }

      const result = await runMessageCleanupBatch(admin, { limit: 100 });
      return Response.json({ ok: true, ...result }, { status: 200 });
    } catch (error) {
      console.error("Message auto-cleanup failed:", error?.message || "unknown error");
      return Response.json({ error: "Message auto-cleanup failed" }, { status: 500 });
    }
  })
};
