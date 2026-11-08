import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { webcrypto } from "node:crypto";

const source = await readFile("modules/backup.js", "utf8");
const instrumented = source.replace(
  /\n\}\)\(\);\s*$/,
  `
globalThis.__backupTestApi = {
  backupEncryptEnvelope,
  backupParseFile,
  backupDigest,
  backupCanonicalPayload,
  backupValidateShape,
  backupRestoreAttachments
};
})();
`
);
assert.notEqual(instrumented, source, "test harness must expose the private backup functions");

const uploads = [];
const user = { id: "test-user-001" };
const state = { user };
const supabaseClient = {
  storage: {
    from(bucket) {
      return {
        async list() { return { data: [] }; },
        async upload(path, blob, options) {
          uploads.push({ bucket, path, bytes: new Uint8Array(await blob.arrayBuffer()), options });
          return { error: null };
        },
        getPublicUrl(path) { return { data: { publicUrl: `https://test.invalid/${bucket}/${path}` } }; }
      };
    }
  },
  from(table) {
    if (table === "chat_messages") {
      return {
        select() {
          return {
            in(_column, ids) {
              return {
                async eq() {
                  return { data: ids.includes("message-1") ? [{
                    id: "message-1", sender_id: user.id,
                    attachment_path: "conversation-1/test-user-001/file.bin"
                  }] : [], error: null };
                }
              };
            }
          };
        }
      };
    }
    if (table === "profiles") {
      return { update() { return { async eq() { return { error: null }; } }; } };
    }
    throw new Error("Unexpected table in attachment test: " + table);
  }
};

const context = {
  state,
  supabaseClient,
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  ArrayBuffer,
  Blob,
  URL,
  btoa,
  atob,
  console,
  document: { readyState: "loading", addEventListener() {} },
  setTimeout,
  clearTimeout
};
context.globalThis = context;
vm.runInNewContext(instrumented, context, { filename: "modules/backup.js" });
const api = context.__backupTestApi;

const emptyPersonal = {
  user_settings: [],
  user_chat_preferences: [],
  user_conversation_settings: [],
  user_message_stars: [],
  user_conversation_labels: [],
  user_conversation_label_items: [],
  user_classification_rules: [],
  user_conversation_classifications: [],
  private_conversation_notes: [],
  user_notifications: [],
  chat_lists: [],
  chat_list_items: []
};
const emptyArchive = {
  conversations: [], messages: [], reactions: [], pins: [],
  documents: [], attachments: [], memberships: [], groupSettings: [],
  membershipEvents: [], privateReplyContexts: [], messageEditHistory: []
};

async function validPayload() {
  const payload = {
    format: "bizmindmakers-chat-backup",
    schemaVersion: 2,
    createdAt: "2026-11-08T00:00:00.000Z",
    userId: user.id,
    profile: { id: user.id, display_name: "Test User", bio: "" },
    personal: structuredClone(emptyPersonal),
    conversationArchive: structuredClone(emptyArchive)
  };
  payload.checksum = await api.backupDigest(api.backupCanonicalPayload(payload));
  return payload;
}
function asFile(text) {
  return { size: new TextEncoder().encode(text).byteLength, async text() { return text; } };
}
const password = "Correct-Horse-Battery-2026";

test("AES-256-GCM encrypt/decrypt round-trip and checksum validation", async () => {
  const payload = await validPayload();
  const envelope = await api.backupEncryptEnvelope(payload, password);
  assert.equal(envelope.encryption.algorithm, "AES-256-GCM");
  assert.equal(envelope.encryption.kdf, "PBKDF2-SHA-256");
  const restored = await api.backupParseFile(asFile(JSON.stringify(envelope)), password);
  assert.equal(restored.userId, user.id);
  assert.equal(restored.checksum, payload.checksum);
});

test("wrong password is rejected before restore", async () => {
  const envelope = await api.backupEncryptEnvelope(await validPayload(), password);
  await assert.rejects(
    api.backupParseFile(asFile(JSON.stringify(envelope)), "Wrong-Password-2026"),
    /تعذر فك تشفير/
  );
});

test("modified ciphertext is rejected by GCM authentication", async () => {
  const envelope = await api.backupEncryptEnvelope(await validPayload(), password);
  const bytes = Buffer.from(envelope.ciphertext, "base64");
  bytes[0] ^= 0x01;
  envelope.ciphertext = bytes.toString("base64");
  await assert.rejects(
    api.backupParseFile(asFile(JSON.stringify(envelope)), password),
    /تعذر فك تشفير/
  );
});

test("malformed JSON and unsupported schema are rejected", async () => {
  await assert.rejects(api.backupParseFile(asFile("{broken"), password), /JSON سليم/);
  const envelope = await api.backupEncryptEnvelope(await validPayload(), password);
  envelope.schemaVersion = 99;
  await assert.rejects(api.backupParseFile(asFile(JSON.stringify(envelope)), password), /غير مدعوم/);
});

test("backup bound to another account is rejected", async () => {
  const envelope = await api.backupEncryptEnvelope(await validPayload(), password);
  envelope.userId = "another-user";
  await assert.rejects(
    api.backupParseFile(asFile(JSON.stringify(envelope)), password),
    /مرتبطة بحساب آخر/
  );
});

test("envelope schema must match the decrypted payload schema", async () => {
  const envelope = await api.backupEncryptEnvelope(await validPayload(), password);
  envelope.schemaVersion = 1;
  await assert.rejects(
    api.backupParseFile(asFile(JSON.stringify(envelope)), password),
    /بنية النسخة ناقصة أو تالفة/
  );
});

test("file size and passphrase bounds are enforced", async () => {
  await assert.rejects(
    api.backupParseFile({ size: 141 * 1024 * 1024, async text() { return ""; } }, password),
    /أكبر من الحد/
  );
  await assert.rejects(api.backupParseFile(asFile("{}"), "short"), /بين 12 و256/);
});

test("owned message attachment and profile avatar are restored with exact bytes", async () => {
  uploads.length = 0;
  const messageBytes = new Uint8Array([0, 1, 2, 127, 255]);
  const avatarBytes = new Uint8Array([9, 8, 7, 6]);
  const b64 = bytes => Buffer.from(bytes).toString("base64");
  const backup = {
    conversationArchive: {
      attachments: [
        {
          bucket: "chat-media", path: "conversation-1/test-user-001/file.bin",
          mimeType: "application/octet-stream", sizeBytes: messageBytes.length,
          data: b64(messageBytes), conversationId: "conversation-1",
          senderId: user.id, messageIds: ["message-1"]
        },
        {
          bucket: "avatars", path: "test-user-001/avatar.png",
          mimeType: "image/png", sizeBytes: avatarBytes.length,
          data: b64(avatarBytes), ownerId: user.id, kind: "profile-avatar"
        }
      ]
    }
  };
  const result = await api.backupRestoreAttachments(backup, user, new Set(["conversation-1"]));
  assert.equal(result.restored, 2);
  assert.equal(result.skipped, 0);
  assert.equal(uploads.length, 2);
  assert.deepEqual([...uploads[0].bytes], [...messageBytes]);
  assert.deepEqual([...uploads[1].bytes], [...avatarBytes]);
});

test("foreign-owned message attachment is skipped", async () => {
  uploads.length = 0;
  const backup = {
    conversationArchive: {
      attachments: [{
        bucket: "chat-media", path: "conversation-1/other-user/file.bin",
        mimeType: "application/octet-stream", sizeBytes: 1,
        data: Buffer.from([1]).toString("base64"), conversationId: "conversation-1",
        senderId: "other-user", messageIds: ["message-1"]
      }]
    }
  };
  const result = await api.backupRestoreAttachments(backup, user, new Set(["conversation-1"]));
  assert.equal(result.restored, 0);
  assert.equal(result.skipped, 1);
  assert.equal(uploads.length, 0);
});

test("attachment upload errors are surfaced instead of silently ignored", async () => {
  const failingContext = { ...context };
  failingContext.supabaseClient = {
    ...supabaseClient,
    storage: {
      from() {
        return {
          async list() { return { data: [] }; },
          async upload() { return { error: { message: "simulated storage failure" } }; }
        };
      }
    }
  };
  vm.runInNewContext(instrumented, failingContext, { filename: "modules/backup.js" });
  const failingApi = failingContext.__backupTestApi;
  const backup = {
    conversationArchive: {
      attachments: [{
        bucket: "avatars", path: "test-user-001/avatar.png",
        mimeType: "image/png", sizeBytes: 1,
        data: Buffer.from([1]).toString("base64"), ownerId: user.id
      }]
    }
  };
  await assert.rejects(
    failingApi.backupRestoreAttachments(backup, user, new Set()),
    /تعذر استعادة الصورة الشخصية/
  );
});
