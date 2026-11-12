#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [moduleSource,index,worker] = await Promise.all([
  readFile("modules/backup-restore.js","utf8"),
  readFile("index.html","utf8"),
  readFile("service-worker.js","utf8")
]);

assert.match(moduleSource,/BACKUP_FORMAT='bizmindmakers-chat-backup'/);
assert.match(moduleSource,/BACKUP_KDF_ITERATIONS=310000/);
assert.match(moduleSource,/AES-256-GCM/);
assert.match(moduleSource,/PBKDF2-SHA-256/);
assert.match(moduleSource,/backupEncryptEnvelope/);
assert.match(moduleSource,/backupParseFile/);
assert.match(moduleSource,/backupRestore\(/);
assert.match(moduleSource,/BACKUP_MAX_FILE_BYTES/);
assert.match(moduleSource,/BACKUP_MAX_PLAINTEXT_BYTES/);
assert.match(moduleSource,/RESTORE_COLUMNS/);
assert.match(moduleSource,/backupAssertRestorableTable/);
assert.match(moduleSource,/value\.userId!==user\.id/);
assert.match(moduleSource,/value\.checksum!==expected/);
assert.match(moduleSource,/لا تُحذف أي بيانات حالية/);
assert.match(moduleSource,/conversationArchive/);
assert.match(moduleSource,/backupRestoreAttachments/);
assert.doesNotMatch(moduleSource,/\.truncate\(/);
assert.doesNotMatch(moduleSource,/localStorage|sessionStorage|refresh_token|access_token/);

const scripts=[...index.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map(m=>m[1]);
const backupAt=scripts.indexOf("./modules/backup-restore.js");
const membershipAt=scripts.indexOf("./membership.js");
assert.ok(backupAt>membershipAt,"backup module must load after membership/application shell scripts");
assert.ok(worker.includes('new URL("./modules/backup-restore.js", base).href'));
assert.match(worker,/CACHE_VERSION = "v\\d+"/);
console.log("Encrypted backup/restore integration source checks: PASS");
