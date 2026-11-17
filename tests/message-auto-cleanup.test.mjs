import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runMessageCleanupBatch } from "../supabase/functions/message-auto-cleanup/worker-core.mjs";

const migration = await readFile(new URL("../supabase/migrations/20261117130000_message_auto_cleanup_100h_storage.sql", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const overrides = await readFile(new URL("../app-overrides.css", import.meta.url), "utf8");
const edge = await readFile(new URL("../supabase/functions/message-auto-cleanup/index.ts", import.meta.url), "utf8");
const localRuntime = await readFile(new URL("./staging/local-supabase/message-auto-cleanup-storage-runtime.mjs", import.meta.url), "utf8");

test("retention cutoff is 100 hours from original message creation for all conversation types", () => {
  assert.match(migration, /m\.created_at < pg_catalog\.clock_timestamp\(\) - interval '100 hours'/i);
  assert.match(migration, /join public\.conversations c on c\.id = m\.conversation_id/i);
  assert.doesNotMatch(migration, /c\.type\s*=\s*'group'/i);
});

test("pinned messages and official conversations are excluded and protected against races", () => {
  assert.match(migration, /not c\.is_official/i);
  assert.match(migration, /not exists\s*\(\s*select 1 from public\.message_pins p where p\.message_id = m\.id\s*\)/i);
  assert.match(migration, /prevent_pin_while_cleanup_queued/i);
  assert.match(migration, /guard_official_conversation_flag/i);
});

test("orphaned chat-media objects are queued only after 100 hours and are not deleted with SQL", () => {
  assert.match(migration, /from storage\.objects o[\s\S]*?o\.bucket_id = 'chat-media'[\s\S]*?o\.created_at < pg_catalog\.clock_timestamp\(\) - interval '100 hours'/i);
  assert.match(migration, /not exists\s*\(\s*select 1 from public\.chat_messages m where m\.attachment_path = o\.name\s*\)/i);
  assert.doesNotMatch(migration, /delete\s+from\s+storage\.objects/i);
});

test("the old database-only purge now enqueues work instead of deleting message rows", () => {
  const start = migration.indexOf("CREATE OR REPLACE FUNCTION app_private.purge_expired_chat_messages()");
  const end = migration.indexOf("$function$;", start);
  assert.ok(start >= 0 && end > start);
  const body = migration.slice(start, end);
  assert.match(body, /return app_private\.enqueue_expired_chat_messages\(\)/i);
  assert.doesNotMatch(body, /delete\s+from\s+public\.chat_messages/i);
});

test("message metadata cascades, while separately authored reply messages are preserved", () => {
  assert.match(migration, /user_notifications_message_id_fkey[\s\S]*?on delete cascade/i);
  assert.match(migration, /chat_messages_reply_to_fkey[\s\S]*?set null/i);
  assert.match(migration, /private_reply_contexts rows and all other message metadata already cascade/i);
});

test("the UI displays the exact 100-hour retention notice and keeps media paths for cleanup", () => {
  assert.ok(html.includes("الرسائل والمرفقات تُحذف تلقائياً بعد 100 ساعة من إرسالها تعزيزاً للخصوصية وسرعة الأداء"));
  assert.match(overrides, /\.auto-cleanup-notice/);
  const start = html.indexOf("async function deleteMessage(m)");
  const end = html.indexOf("function showAttachmentPreview", start);
  assert.ok(start >= 0 && end > start);
  const deleteHandler = html.slice(start, end);
  assert.match(deleteHandler, /deleted_at:new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(deleteHandler, /attachment_path\s*:\s*null|attachment_type\s*:\s*null/);
});

test("the Edge Function verifies a Vault token and uses a server-only service role", () => {
  assert.match(edge, /x-auto-cleanup-token/);
  assert.match(edge, /withSupabase\(\{ auth: "secret" \}/);
  assert.match(edge, /ctx\.supabaseAdmin/);
  assert.doesNotMatch(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /verify_message_cleanup_token/);
  assert.match(edge, /runMessageCleanupBatch/);
});

test("Storage API deletion completes before database message deletion", async () => {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ kind: "rpc", name, args });
      if (name === "claim_message_cleanup_batch") {
        return { data: [
          { queue_id: 11, item_kind: "message", message_id: "m1", attachment_path: "c1/u1/a.jpg", storage_deleted: false },
          { queue_id: 12, item_kind: "orphan", message_id: null, attachment_path: "c1/u1/orphan.m4a", storage_deleted: false },
          { queue_id: 13, item_kind: "message", message_id: "m2", attachment_path: null, storage_deleted: false }
        ], error: null };
      }
      if (name === "complete_message_cleanup_batch") return { data: 3, error: null };
      return { data: 3, error: null };
    },
    storage: {
      from: bucket => ({
        remove: async paths => {
          calls.push({ kind: "storage-remove", bucket, paths });
          return { data: paths, error: null };
        }
      })
    }
  };
  const result = await runMessageCleanupBatch(client, { limit: 100 });
  assert.equal(result.claimed, 3);
  assert.equal(result.completed, 3);
  assert.equal(result.storageObjectsRemoved, 2);
  assert.equal(calls[0].name, "claim_message_cleanup_batch");
  assert.equal(calls[1].kind, "storage-remove");
  assert.equal(calls[1].bucket, "chat-media");
  assert.equal(calls[2].name, "mark_message_cleanup_storage_deleted");
  assert.equal(calls[3].name, "complete_message_cleanup_batch");
});

test("Storage API failure releases work for retry and never deletes the database rows", async () => {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ kind: "rpc", name, args });
      if (name === "claim_message_cleanup_batch") {
        return { data: [
          { queue_id: 21, item_kind: "message", message_id: "m3", attachment_path: "c1/u1/broken.mp4", storage_deleted: false }
        ], error: null };
      }
      return { data: 1, error: null };
    },
    storage: {
      from: () => ({
        remove: async () => ({ data: null, error: { message: "temporary storage failure" } })
      })
    }
  };
  const result = await runMessageCleanupBatch(client);
  assert.equal(result.retryScheduled, true);
  assert.ok(calls.some(call => call.name === "release_message_cleanup_batch"));
  assert.equal(calls.some(call => call.name === "mark_message_cleanup_storage_deleted"), false);
  assert.equal(calls.some(call => call.name === "complete_message_cleanup_batch"), false);
});

test("already-removed storage paths are not removed a second time after the checkpoint", async () => {
  let storageCalls = 0;
  const names = [];
  const client = {
    rpc: async name => {
      names.push(name);
      if (name === "claim_message_cleanup_batch") {
        return { data: [
          { queue_id: 31, item_kind: "orphan", message_id: null, attachment_path: "old/orphan.png", storage_deleted: true }
        ], error: null };
      }
      if (name === "complete_message_cleanup_batch") return { data: 1, error: null };
      return { data: 1, error: null };
    },
    storage: { from: () => ({ remove: async () => { storageCalls++; return { error: null }; } }) }
  };
  await runMessageCleanupBatch(client);
  assert.equal(storageCalls, 0);
  assert.deepEqual(names, [
    "claim_message_cleanup_batch",
    "mark_message_cleanup_storage_deleted",
    "complete_message_cleanup_batch"
  ]);
});

test("disposable local runtime exercises the real Storage API and stays loopback-only", () => {
  assert.match(localRuntime, /LOCAL_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(localRuntime, /127\.0\.0\.1/);
  assert.match(localRuntime, /storage\/v1\/object/);
  assert.match(localRuntime, /runMessageCleanupBatch/);
  assert.match(localRuntime, /LOCAL_MESSAGE_AUTO_CLEANUP_STORAGE_RUNTIME=PASSED/);
});
