#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [backup,index,worker,architecture] = await Promise.all([
  readFile("modules/backup.js","utf8"),
  readFile("index.html","utf8"),
  readFile("service-worker.js","utf8"),
  readFile("scripts/check-module-architecture.mjs","utf8")
]);

assert.match(backup,/const BACKUP_FORMAT='bizmindmakers-chat-backup'/);
assert.match(backup,/const BACKUP_SCHEMA_VERSION=2/);
assert.match(backup,/\[1,2\]\.includes\(value\.schemaVersion\)/);
assert.match(backup,/function backupValidateShape\(value,user,expectedSchemaVersion=value\?\.schemaVersion\)/);
assert.match(backup,/value\.schemaVersion!==expectedSchemaVersion/);
assert.doesNotMatch(backup,/value\.schemaVersion!==envelope\.schemaVersion/);
assert.match(backup,/item\.bucket!=='avatars'&&!available\.has\(item\.conversationId\)/);
assert.match(backup,/تُضمّن المرفقات المسموح بها داخل الملف المشفّر/);
assert.match(backup,/\[1,2\]\.includes\(envelope\?\.schemaVersion\)/);
assert.match(backup,/crypto\.subtle\.digest\('SHA-256'/);
assert.match(backup,/AES-256-GCM/);
assert.match(backup,/PBKDF2-SHA-256/);
assert.match(backup,/BACKUP_KDF_ITERATIONS=310000/);
assert.match(backup,/BACKUP_MAX_BINARY_BYTES=65\*1024\*1024/);
assert.match(backup,/backupEncryptEnvelope/);
assert.match(backup,/backupParseFile\(file,passphrase\)/);
assert.match(backup,/backupExportPassword/);
assert.match(backup,/backupImportPassword/);
assert.match(backup,/backupDownload\(backup,pass\)/);
assert.match(backup,/backupFetchAll\(makeQuery,label,orderBy\)/);
assert.match(backup,/query\.order\(column,\{ascending:true\}\)/);
assert.match(backup,/chat_lists/);
assert.match(backup,/chat_list_items/);
assert.match(backup,/conversation_documents/);
assert.match(backup,/message_edit_history/);
assert.match(backup,/private_reply_contexts/);
assert.match(backup,/conversation_member_events/);
assert.match(backup,/conversation_group_settings/);
assert.match(backup,/backupStoragePathFromPublicUrl/);
assert.match(backup,/storage\.from\(ref\.bucket\)\.download\(ref\.path\)/);
assert.match(backup,/backupRestoreAttachments/);
assert.match(backup,/storage\.from\(item\.bucket\)\.upload/);
assert.match(backup,/value\.userId!==user\.id/);
assert.match(backup,/value\.checksum!==expected/);
assert.match(backup,/row\.recipient_id!==user\.id/);
assert.match(backup,/row\.user_id!==user\.id/);
assert.match(backup,/function backupAssertRestorableTable/);
assert.match(backup,/const RESTORE_TABLES=\[/);
assert.match(backup,/backupExistingMembershipPairs/);
assert.match(backup,/!row\.deleted_at/);
assert.match(backup,/\.upsert\(/);
assert.doesNotMatch(backup,/\.delete\(\s*\)/);
assert.doesNotMatch(backup,/\.truncate\(/);
assert.doesNotMatch(backup,/localStorage|sessionStorage|auth\.getSession|refresh_token|access_token/);
assert.doesNotMatch(backup,/selectedBackup=backup/,"export must not bypass import-file validation");
assert.match(backup,/disabled=!selectedBackup/);

const restoreStart=backup.indexOf("async function backupRestore(");
const restoreEnd=backup.indexOf("function backupSetBusy(",restoreStart);
assert.ok(restoreStart>=0&&restoreEnd>restoreStart,"restore implementation must be present");
const restoreBody=backup.slice(restoreStart,restoreEnd);
assert.doesNotMatch(restoreBody,/conversationArchive\.(?:conversations|messages|reactions|pins)\s*\).*?upsert/s,
  "shared archive data must never be restored");
assert.match(restoreBody,/backupAssertRestorableTable\('user_settings'\)/);
assert.match(restoreBody,/backupAssertRestorableTable\('user_conversation_labels'\)/);
assert.match(restoreBody,/backupAssertRestorableTable\('user_conversation_label_items'\)/);
assert.match(restoreBody,/chat_lists/);
assert.match(restoreBody,/backupRestoreAttachments/);
assert.doesNotMatch(restoreBody,/membership_number|membership_status|membership_number_verified/);

const scriptSources=[...index.matchAll(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(match=>match[1]);
const backupScript=scriptSources.indexOf("./modules/backup.js");
const membershipScript=scriptSources.indexOf("./membership.js");
const appScript=scriptSources.indexOf("./app.js");
assert.ok(backupScript>membershipScript&&backupScript>appScript,
  "backup module must load after app state and membership initialization");
assert.ok(worker.includes('./modules/backup.js'),"backup module must be included in shell precache");
assert.match(worker,/CACHE_VERSION = "v23"/);
assert.match(backup,/const BACKUP_MAX_FILE_BYTES=140\*1024\*1024/);
assert.match(backup,/const BACKUP_MAX_PLAINTEXT_BYTES=100\*1024\*1024/);
assert.match(architecture,/backup\.js/,"architecture guard must account for the backup module");

console.log("Backup module static regression checks: PASS");
