import test from 'node:test';
import assert from 'node:assert/strict';
import { buildObjectInventory } from './build-database-object-inventory.mjs';

test('source inventory covers all known SQL files and remains read-only', async () => {
  const report = await buildObjectInventory();
  assert.equal(report.auditMode, 'READ_ONLY_SOURCE_INVENTORY');
  assert.deepEqual(report.sourceCounts, { migrations: 10, historicalSql: 43, totalSqlFiles: 53 });
  assert.ok(report.inventoryTotals.createdTables > 0);
  assert.ok(report.inventoryTotals.functionDefinitions > 0);
  assert.ok(report.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.equal(report.scope, 'Repository SQL definitions and references only; not a live deployed database catalog.');
});

test('inventory exposes unresolved legacy and missing RPC dependencies', async () => {
  const report = await buildObjectInventory();
  assert.equal(report.legacyMessages.tableDefinitionFoundInRepositorySql, false);
  assert.ok(report.legacyMessages.referencedByMigrations.includes('supabase/migrations/202611060001_ultra_chat_pro_v2.sql'));
  assert.ok(report.legacyMessages.referencedByMigrations.includes('supabase/migrations/202611060006_explicit_legacy_deny.sql'));
  assert.ok(report.unresolvedInternalFunctions.includes('app_private.get_or_create_direct_conversation_impl'));
  assert.ok(report.missingClientRpcs.includes('get_or_create_direct_conversation'));
});

test('inventory identifies the application/database Forever membership format conflict', async () => {
  const report = await buildObjectInventory();
  assert.equal(report.membershipFormatReview.frontendRequires971PlusNineDigits, true);
  assert.equal(report.membershipFormatReview.officialInviteSourceStillContains971001PlusSixDigits, true);
  assert.equal(report.membershipFormatReview.finalMigrationAlsoUpdatesOfficialInviteAndAdminSetImplementations, true);
  assert.equal(report.membershipFormatReview.finalMigrationFunctionTargets.length, 6);
  assert.equal(report.membershipFormatReview.status, 'SEQUENCED_FORMAT_TRANSITION');
});

test('inventory retains duplicate provenance and the known syntax hazard', async () => {
  const report = await buildObjectInventory();
  assert.equal(report.duplicateGroups.length, 3);
  assert.ok(report.syntaxHazards.some(item => item.path === 'database/changes/20261107152733_fix_official_membership_invite_duplicate_validation.sql'));
});

test('platform service dependencies are explicit', async () => {
  const report = await buildObjectInventory();
  assert.equal(report.platformDependencies.authSchema, true);
  assert.equal(report.platformDependencies.storageSchema, true);
  assert.equal(report.platformDependencies.realtimePublication, true);
  assert.equal(report.platformDependencies.pgcrypto, true);
  assert.equal(report.platformDependencies.pgCron, true);
});
