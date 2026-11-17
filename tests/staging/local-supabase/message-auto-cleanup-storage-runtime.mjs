#!/usr/bin/env node
// End-to-end disposable-local proof: Storage API removal precedes DB queue completion.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { runMessageCleanupBatch } from "../../../supabase/functions/message-auto-cleanup/worker-core.mjs";

function fail(message) {
  console.error("LOCAL_MESSAGE_AUTO_CLEANUP_BLOCKED=" + message);
  process.exit(1);
}

const rawApi = process.env.LOCAL_SUPABASE_URL;
const dbUrl = process.env.LOCAL_SUPABASE_DB_URL;
const serviceKey = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!rawApi || !dbUrl || !serviceKey) fail("local API URL, database URL, and service-role key are required");

let api;
try { api = new URL(rawApi); } catch { fail("invalid local Supabase URL"); }
const host = api.hostname.replace(/^\[|\]$/g, "").toLowerCase();
if (api.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(host) || api.port !== "54321") {
  fail("refusing non-local Storage API target");
}
let database;
try { database = new URL(dbUrl); } catch { fail("invalid local database URL"); }
const dbHost = database.hostname.replace(/^\[|\]$/g, "").toLowerCase();
if (!["127.0.0.1", "localhost", "::1"].includes(dbHost) || database.port !== "54322") {
  fail("refusing non-local database target");
}

const objectPath = "auto-cleanup-runtime/" + randomBytes(12).toString("hex") + ".png";
const objectPathLiteral = "'" + objectPath.replaceAll("'", "''") + "'";
const authHeaders = {
  apikey: serviceKey,
  Authorization: "Bearer " + serviceKey
};
let uploaded = false;

function psql(sql) {
  const result = spawnSync("psql", [
    "--no-psqlrc",
    "--set=ON_ERROR_STOP=1",
    "--tuples-only",
    "--no-align",
    "--command", sql.replaceAll(":'object_path'", objectPathLiteral),
    dbUrl
  ], { encoding: "utf8", env: { ...process.env, PGCONNECT_TIMEOUT: "5" }, timeout: 30000 });
  if (result.error || result.status !== 0) {
    fail("local SQL assertion failed: " + (result.stderr || result.error?.message || "unknown error").slice(0, 500));
  }
  return result.stdout.trim();
}

async function removeStoragePaths(bucket, paths) {
  const response = await fetch(new URL("/storage/v1/object/" + encodeURIComponent(bucket), api.origin), {
    method: "DELETE",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
    signal: AbortSignal.timeout(20000)
  });
  const body = await response.text();
  if (!response.ok) return { data: null, error: { message: "HTTP " + response.status + ": " + body.slice(0, 300) } };
  return { data: body ? body : null, error: null };
}

try {
  const uploadUrl = new URL(
    "/storage/v1/object/chat-media/" + objectPath.split("/").map(encodeURIComponent).join("/"),
    api.origin
  );
  const upload = await fetch(uploadUrl, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "image/png", "x-upsert": "false" },
    body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    signal: AbortSignal.timeout(20000)
  });
  if (!upload.ok) fail("could not upload disposable chat-media object: HTTP " + upload.status + " " + (await upload.text()).slice(0, 300));
  uploaded = true;

  const agedRows = psql(`
    UPDATE storage.objects
    SET created_at = pg_catalog.clock_timestamp() - interval '101 hours'
    WHERE bucket_id = 'chat-media' AND name = :'object_path';
    SELECT pg_catalog.count(*)
    FROM storage.objects
    WHERE bucket_id = 'chat-media' AND name = :'object_path'
      AND created_at < pg_catalog.clock_timestamp() - interval '100 hours';
  `);
  if (agedRows.split(/\s+/).at(-1) !== "1") fail("test object was not aged past the 100-hour threshold");

  psql("SELECT app_private.enqueue_expired_chat_messages();");

  const client = {
    async rpc(name, args) {
      const response = await fetch(new URL("/rest/v1/rpc/" + name, api.origin), {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(20000)
      });
      const body = await response.text();
      if (!response.ok) return { data: null, error: { message: "HTTP " + response.status + ": " + body.slice(0, 400) } };
      let data = null;
      try { data = body ? JSON.parse(body) : null; } catch { data = body; }
      return { data, error: null };
    },
    storage: {
      from(bucket) {
        return { remove: paths => removeStoragePaths(bucket, paths) };
      }
    }
  };

  const result = await runMessageCleanupBatch(client, { limit: 100 });
  if (result.claimed < 1 || result.completed < 1 || result.storageObjectsRemoved < 1 || result.retryScheduled) {
    fail("worker did not complete the aged orphan object: " + JSON.stringify(result));
  }

  const remaining = psql(`
    SELECT pg_catalog.count(*)
    FROM storage.objects
    WHERE bucket_id = 'chat-media' AND name = :'object_path';
  `).split(/\s+/).at(-1);
  if (remaining !== "0") fail("Storage API returned success but the object remains in storage.objects");

  const queued = psql(`
    SELECT pg_catalog.count(*)
    FROM app_private.message_cleanup_queue
    WHERE item_kind = 'orphan' AND storage_path = :'object_path';
  `).split(/\s+/).at(-1);
  if (queued !== "0") fail("completed orphan still exists in the cleanup queue");

  uploaded = false;
  console.log("LOCAL_MESSAGE_AUTO_CLEANUP_STORAGE_RUNTIME=PASSED");
  console.log("LOCAL_MESSAGE_AUTO_CLEANUP_STORAGE_OBJECTS_REMOVED=" + result.storageObjectsRemoved);
  console.log("LOCAL_MESSAGE_AUTO_CLEANUP_QUEUE_ITEMS_COMPLETED=" + result.completed);
} finally {
  if (uploaded) {
    const cleanup = await removeStoragePaths("chat-media", [objectPath]);
    if (cleanup.error) console.error("LOCAL_MESSAGE_AUTO_CLEANUP_TEST_OBJECT_CLEANUP_WARNING=" + cleanup.error.message);
  }
}
