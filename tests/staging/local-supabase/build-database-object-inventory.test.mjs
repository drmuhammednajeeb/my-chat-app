// Integrated release audit: includes all standalone feature modules and their policy coverage.
// Keep this contract aligned with the active release's private media buckets.
// The audit only inventories repository source; it never connects to a database.
// This test suite is part of the integrated release gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildObjectInventory } from './build-database-object-inventory.mjs';

test('source inventory covers all known SQL files and remains read-only', async () => {
  const report = await buildObjectInventory();
  assert.equal(report.auditMode, 'READ_ONLY_SOURCE_INVENTORY');
  assert.deepEqual(report.sourceCounts, { migrations: 62, historicalSql: 0, archivedSql: 12, totalSqlFiles: 62, supabaseConfigPresent: false });
  assert.ok(report.inventoryTotals.createdTables > 0);
  assert.ok(report.inventoryTotals.columns > 0);
  assert.ok(report.inventoryTotals.foreignKeys > 0);
  assert.ok(report.inventoryTotals.grantStatements > 0);
  assert.ok(report.inventoryTotals.functionDefinitions > 0);
  assert.ok(report.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.equal(report.scope, 'Repository SQL definitions and references only; not a live deployed database catalog.');
});

test('inventory exposes unresolved legacy and missing RPC dependencies', async () => {
  const report = await buildObjectInventory();
  assert.equal(report.legacyMessages.tableDefinitionFoundInRepositorySql, false);
  assert.ok(report.legacyMessages.referencedByMigrations.includes('supabase/migrations/20261106061954_ultra_chat_pro_v2.sql'));
  assert.ok(report.legacyMessages.referencedByMigrations.includes('supabase/migrations/20261106062207_explicit_legacy_deny.sql'));
  assert.deepEqual(report.unresolvedInternalFunctions, []);
  assert.equal(report.missingClientRpcs.includes('get_or_create_direct_conversation'), false);
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
  assert.equal(report.duplicateGroups.length, 0);
  assert.ok(report.archivedSyntaxHazards.some(item => item.path === 'database/archive/source-provenance/20261107152733_fix_official_membership_invite_duplicate_validation.sql'));
});

test('platform service dependencies are explicit', async () => {
  const report = await buildObjectInventory();
  assert.equal(report.platformDependencies.authSchema, true);
  assert.equal(report.platformDependencies.storageSchema, true);
  assert.equal(report.platformDependencies.realtimePublication, true);
  assert.equal(report.platformDependencies.pgcrypto, true);
  assert.equal(report.platformDependencies.pgCron, true);
});


test('all policy definitions after the membership rewrite enforce active membership', async () => {
  const report = await buildObjectInventory();
  assert.equal(report.policyCoverage.policiesAfterMembershipBase.length, 17);
  assert.deepEqual(report.policyCoverage.laterPoliciesMissingActiveMemberGuard, []);
});


test('fixed identity literals are inventoried for synthetic test substitution', async () => {
  const report = await buildObjectInventory();
  assert.ok(report.hardcodedIdentityReview.emailLiteralFiles.includes('database/archive/source-provenance/team_management_dashboard.sql'));
  assert.ok(report.hardcodedIdentityReview.uuidLiteralFiles.includes('supabase/migrations/20261107144109_private_membership_system_20261107.sql'));
  assert.ok(report.hardcodedIdentityReview.membershipNumberLiteralFiles.includes('supabase/migrations/20261107152550_official_forever_membership_numbers_manual_verification.sql'));
  assert.ok(report.hardcodedIdentityReview.membershipNumberLiteralFiles.includes('supabase/migrations/20261107153110_anchor_initial_official_membership_verification_by_number.sql'));
});


test('application Storage buckets are compared with repository bucket declarations and policies', async () => {
  const report = await buildObjectInventory();
  assert.deepEqual(report.storageCoverage.clientBuckets, ['avatars', 'chat-media', 'conversation-avatars', 'conversation-documents', 'profile-status-media']);
  assert.deepEqual(report.storageCoverage.declaredBucketIds, ['avatars', 'channel-avatars', 'chat-media', 'conversation-avatars', 'conversation-documents', 'profile-status-media']);
  assert.deepEqual(report.storageCoverage.missingBucketDeclarations, []);
  assert.deepEqual(report.storageCoverage.storageObjectPolicyBuckets, ['avatars', 'channel-avatars', 'chat-media', 'conversation-avatars', 'conversation-documents', 'profile-status-media']);
  assert.deepEqual(report.storageCoverage.clientBucketsWithoutStoragePolicies, []);
  assert.equal(report.storageCoverage.chatMediaUploadPathOwnershipGuard, false);
});


test('Supabase platform dependencies are inventoried before any local stack launch', async () => {
  const report = await buildObjectInventory();
  assert.equal(report.platformDependencies.authSchema, true);
  assert.equal(report.platformDependencies.storageSchema, true);
  assert.equal(report.platformDependencies.realtimePublication, true);
  assert.equal(report.platformDependencies.pgcrypto, true);
  assert.equal(report.platformDependencies.pgCron, true);
  assert.equal(report.sourceCounts.supabaseConfigPresent, false);
});
