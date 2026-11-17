import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { runMessageCleanupBatch } from "./worker-core.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-auto-cleanup-token, apikey"
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }

  const suppliedToken = request.headers.get("x-auto-cleanup-token");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!suppliedToken || !supabaseUrl || !serviceRoleKey) {
    return Response.json({ error: "Cleanup worker configuration is incomplete" }, { status: 503, headers: corsHeaders });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authorized, error: authError } = await admin.rpc(
    "verify_message_cleanup_token",
    { p_candidate: suppliedToken }
  );

  if (authError || authorized !== true) {
    return Response.json({ error: "Unauthorized cleanup invocation" }, { status: 401, headers: corsHeaders });
  }

  try {
    const result = await runMessageCleanupBatch(admin, { limit: 100 });
    return Response.json({ ok: true, ...result }, { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error("Message auto-cleanup failed:", error?.message || "unknown error");
    return Response.json({ error: "Message auto-cleanup failed" }, { status: 500, headers: corsHeaders });
  }
});
