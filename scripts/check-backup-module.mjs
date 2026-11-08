#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [backup,index,worker] = await Promise.all([
  readFile("modules/backup.js","utf8"),
  readFile("index.html","utf8"),
  readFile("service-worker.js","utf8")
]);

assert.match(backup,/const BACKUP_FORMAT='bizmindmakers-chat-backup'/);
assert.match(backup,/const BACKUP_SCHEMA_VERSION=1/);
assert.match(backup,/crypto\.subtle\.digest\('SHA-256'/);
assert.match(backup,/value\.userId!==user\.id/);
assert.match(backup,/value\.checksum!==expected/);
assert.match(backup,/row\.recipient_id!==user\.id/);
assert.match(backup,/row\.user_id!==user\.id/);
assert.match(backup,/function backupAssertRestorableTable/);
assert.match(backup,/const RESTORE_TABLES=\[/);
assert.match(backup,/\.upsert\(/);
assert.doesNotMatch(backup,/\.delete\(\s*\)/);
assert.doesNotMatch(backup,/\.truncate\(/);
assert.doesNotMatch(backup,/localStorage|sessionStorage|auth\.getSession|refresh_token|access_token/);

const restoreStart=backup.indexOf("async function backupRestore(");
const restoreEnd=backup.indexOf("function backupSetBusy(",restoreStart);
assert.ok(restoreStart>=0&&restoreEnd>restoreStart,"restore implementation must be present");
const restoreBody=backup.slice(restoreStart,restoreEnd);
assert.doesNotMatch(restoreBody,/conversationArchive\.(?:conversations|messages|reactions|pins)\s*\).*?upsert/s,
  "shared archive data must never be restored");
assert.match(restoreBody,/backupAssertRestorableTable\('user_settings'\)/);
assert.match(restoreBody,/backupAssertRestorableTable\('user_conversation_labels'\)/);
assert.match(restoreBody,/backupAssertRestorableTable\('user_conversation_label_items'\)/);

const scriptSources=[...index.matchAll(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(match=>match[1]);
const backupScript=scriptSources.indexOf("./modules/backup.js");
const membershipScript=scriptSources.indexOf("./membership.js");
const appScript=scriptSources.indexOf("./app.js");
assert.ok(backupScript>membershipScript&&backupScript>appScript,
  "backup module must load after app state and membership initialization");
assert.ok(worker.includes('./modules/backup.js'),"backup module must be included in shell precache");
assert.match(backup,/const BACKUP_MAX_FILE_BYTES=100\*1024\*1024/);

console.log("Backup module static regression checks: PASS");
