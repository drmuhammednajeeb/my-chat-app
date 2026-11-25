import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const registryPath = path.join(root, 'supabase/migrations/source-registry.json');
const blobSha = buffer => createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');

test('production registry records applied PR165 migrations and ten pending forward migrations', async () => {
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  assert.equal(registry.schemaVersion, 3);
  assert.equal(registry.registryStatus, 'CANONICAL_SOURCE_STREAM_ASSEMBLED_REVIEW_REQUIRED');
  assert.equal(registry.productionDatabase.migrationCount, 66);
  assert.equal(registry.productionMigrations.length, 64);
  assert.equal(registry.sourceSets.productionLedgerMigrations, 64);
  assert.equal(registry.sourceSets.canonicalCliMigrationFiles, 74);
  assert.equal(registry.sourceSets.forwardReconciliationMigrations, 10);
  assert.equal(registry.forwardMigrations.length, 10);
  assert.equal(registry.forwardMigrationPolicy.productionLedgerCount, 64);
  assert.equal(registry.forwardMigrationPolicy.pendingForwardCount, 10);
  assert.equal(registry.forwardMigrationPolicy.executionAuthorized, false);
  assert.equal(registry.sourceSets.archiveSqlFiles, 12);
  assert.equal(registry.sourceSets.duplicatePairs, 0);
  assert.equal(registry.sourceFiles.length, 64);
  assert.equal(registry.sourceSets.testOnlyFixtureCount, 23);
  assert.equal(registry.sourceSets.testOnlyFixturePaths.length, 23);
  assert.ok(registry.sourceSets.testOnlyFixturePaths.includes('tests/staging/local-supabase/fixtures/message-visibility-pins.runtime.test.sql'));

  const versions = registry.productionMigrations.map(item => item.version);
  assert.equal(new Set(versions).size, 64);
  assert.deepEqual(versions, [...versions].sort());
  const paths = registry.productionMigrations.map(item => item.path);
  assert.equal(new Set(paths).size, 64);
  assert.deepEqual(new Set(registry.sourceFiles.map(item => item.path)), new Set(paths));

  const migrationDirectory = await readdir(path.join(root, 'supabase/migrations'));
  assert.equal(migrationDirectory.filter(name => name.endsWith('.sql')).length, 74);
  for (const migration of registry.productionMigrations) {
    assert.match(migration.version, /^\d{14}$/);
    assert.equal(migration.path, `supabase/migrations/${migration.version}_${migration.name}.sql`);
    const bytes = await readFile(path.join(root, migration.path));
    assert.equal(blobSha(bytes), migration.gitBlobSha, 'canonical blob mismatch: ' + migration.path);
    assert.ok(migration.mappingStatus);
    assert.ok(migration.note);
    for (const source of migration.originalSources) {
      assert.ok(source.originalFileName);
      assert.match(source.sourceGitBlobSha, /^[a-f0-9]{40}$/);
      if (source.archivedPath) {
        const archived = await readFile(path.join(root, source.archivedPath));
        assert.equal(blobSha(archived), source.archiveGitBlobSha);
      }
    }
  }

  for (const migration of registry.forwardMigrations) {
    assert.match(migration.version, /^\d{14}$/);
    assert.equal(migration.path, `supabase/migrations/${migration.version}_${migration.name}.sql`);
    assert.equal(migration.status, 'FORWARD_RECONCILIATION_NOT_APPLIED');
    assert.equal(migration.executionPolicy, 'REVIEW_REQUIRED_NOT_EXECUTION_AUTHORIZED');
    if (migration.version === '20261119113000') {
      assert.equal(migration.localRuntimeStatus, 'PASSED_DISPOSABLE_LOCAL_SUPABASE');
      assert.equal(migration.localRuntimeRunId, 44492915229);
      assert.equal(migration.localRuntimeCommit, 'f2b9979075786abd3dbadf6096480c57f38fbeac');
      assert.equal(migration.productionApplied, false);
    } else if (migration.version === '20261119120000') {
      assert.equal(migration.localRuntimeStatus, 'PASSED_DISPOSABLE_LOCAL_SUPABASE');
      assert.equal(migration.productionApplied, false);
      assert.equal(migration.localRuntimeRunId, 44679419290);
      assert.equal(migration.localRuntimeCommit, '10a60154b25a294412e44249402c51d6422378ec');
      assert.deepEqual(migration.blockedBy, []);
    } else if (migration.version === '20261119130000') {
      assert.equal(migration.localRuntimeStatus, 'PASSED_DISPOSABLE_LOCAL_SUPABASE');
      assert.equal(migration.localRuntimeRunId, 44680577210);
      assert.equal(migration.localRuntimeCommit, '70ab8157d11e55fa1453a81d1595088f95dd5361');
      assert.equal(migration.productionApplied, false);
      assert.deepEqual(migration.blockedBy, []);
    } else if (migration.version === '20261113060002') {
      assert.equal(migration.localRuntimeStatus, 'PASSED_DISPOSABLE_LOCAL_SUPABASE');
      assert.equal(migration.localRuntimeRunId, 44054041618);
      assert.equal(migration.localRuntimeCommit, 'a7f9f89de489f43b5ba4e8f9b548109fe68ed2c7');
      assert.deepEqual(migration.blockedBy, []);
    } else if (migration.version === '20261117130000') {
      assert.equal(migration.localRuntimeStatus, 'PASSED_DISPOSABLE_LOCAL_SUPABASE');
      assert.equal(migration.localRuntimeRunId, 44040777235);
      assert.equal(migration.localRuntimeCommit, 'ee5d57ebea388beb5280e01c0af518b5a36c1ddd');
      assert.deepEqual(migration.blockedBy, []);
    } else if (migration.version === '20261121120000') {
      assert.equal(migration.localRuntimeStatus, 'PASSED_DISPOSABLE_LOCAL_SUPABASE');
      assert.equal(migration.localRuntimeRunId, 44873724263);
      assert.equal(migration.localRuntimeCommit, 'c87c871f4474a9f2bd99d6ce422c8e36cb6d578f');
      assert.equal(migration.productionApplied, false);
      assert.deepEqual(migration.blockedBy, []);
    } else {
      assert.equal(migration.localRuntimeStatus, 'PASSED_DISPOSABLE_LOCAL_SUPABASE');
      assert.ok(Number.isInteger(migration.localRuntimeRunId) && migration.localRuntimeRunId > 0);
      if (migration.version === '20261112160000' || migration.version === '20261112160001') assert.deepEqual(migration.blockedBy, []);
      else assert.deepEqual(migration.blockedBy, ['DAG-016']);
    }
    const bytes = await readFile(path.join(root, migration.path));
    assert.equal(blobSha(bytes), migration.gitBlobSha, 'forward migration blob mismatch: ' + migration.path);
    assert.equal(registry.productionMigrations.some(item => item.version === migration.version), false);
  }

  for (const source of registry.sourceFiles) {
    assert.ok(source.path.startsWith('supabase/migrations/'));
    assert.equal(source.executionPolicy, 'REVIEW_REQUIRED_NOT_EXECUTION_AUTHORIZED');
  }
  for (const fixture of registry.sourceSets.testOnlyFixturePaths) {
    assert.ok(fixture.startsWith('tests/staging/local-supabase/fixtures/'));
    await readFile(path.join(root, fixture));
  }
  assert.equal(JSON.stringify(registry).includes('database/changes'), false);
  assert.deepEqual(registry.unresolvedProductionEntries.map(item => item.version), ['20261117083059', '20261117103144']);
  assert.ok(registry.reviewRequiredProductionEntries.length > 0);
  assert.equal(registry.safety.executionAuthorized, true);
  assert.equal(registry.safety.productionChangesAllowed, true);
  assert.equal(registry.safety.localReplayEnabled, true);
  assert.equal(registry.safety.mainModified, false);
  assert.equal(registry.safety.productionModified, true);
  assert.equal(registry.safety.sqlExecuted, true);
  assert.equal(registry.safety.pr139Merged, false);
  for (const id of ['DAG-014', 'DAG-015', 'DAG-016', 'DAG-017', 'DAG-018', 'DAG-019']) {
    assert.ok(registry.knownReplayBlockers.some(item => item.id === id));
  }
});

test('every canonical migration closes every explicit transaction block', async () => {
  const directory = path.join(root, 'supabase/migrations');
  const files = (await readdir(directory)).filter(name => name.endsWith('.sql'));
  assert.equal(files.length, 73);
  for (const name of files) {
    const source = await readFile(path.join(directory, name), 'utf8');
    const begins = (source.match(/^\s*BEGIN\s*;\s*$/gim) ?? []).length;
    const commits = (source.match(/^\s*COMMIT\s*;\s*$/gim) ?? []).length;
    const rollbacks = (source.match(/^\s*ROLLBACK\s*;\s*$/gim) ?? []).length;
    assert.equal(begins, commits + rollbacks, 'unclosed explicit transaction in ' + name);
  }
});

test('private-channel deny policy is created once by its own production version', async () => {
  const [base, deny] = await Promise.all([
    readFile(path.join(root, 'supabase/migrations/20261106132655_private_channels_with_secure_invites.sql'), 'utf8'),
    readFile(path.join(root, 'supabase/migrations/20261106132740_deny_direct_channel_invite_table_access.sql'), 'utf8')
  ]);
  assert.doesNotMatch(base, /No direct access to channel invites|REVOKE ALL ON TABLE app_private\\.channel_invites/i);
  assert.match(deny, /DROP POLICY IF EXISTS "No direct access to channel invites"/i);
  assert.match(deny, /CREATE POLICY "No direct access to channel invites"/i);
  assert.ok(deny.includes('REVOKE ALL ON TABLE app_private.channel_invites FROM PUBLIC, anon, authenticated;'));
});

test('archive manifest is provenance-only and excluded from Supabase CLI discovery', async () => {
  const [registry, archive] = await Promise.all([
    readFile(registryPath, 'utf8').then(JSON.parse),
    readFile(path.join(root, 'database/archive/manifest.json'), 'utf8').then(JSON.parse)
  ]);
  assert.equal(archive.executionPolicy, 'ARCHIVE_ONLY_NEVER_EXECUTE');
  assert.equal(archive.sqlFiles.length, 12);
  assert.equal(registry.archiveFiles.length, 12);
  assert.deepEqual(new Set(registry.archiveFiles.map(item => item.path)), new Set(archive.sqlFiles.map(item => item.path)));
  for (const file of registry.archiveFiles) {
    assert.ok(file.path.startsWith('database/archive/'));
    assert.equal(file.executionPolicy, 'ARCHIVE_ONLY_NEVER_EXECUTE');
    const bytes = await readFile(path.join(root, file.path));
    assert.equal(blobSha(bytes), file.gitBlobSha, 'archive blob mismatch: ' + file.path);
  }
  assert.equal(registry.safety.executionAuthorized, false);
});




test('public conversation-image SECURITY DEFINER RPC is intentional and enforces actor, membership, manager, and path checks', async () => {
  const sql = await readFile(path.join(root, 'supabase/migrations/20261112091557_profile_status_and_conversation_images.sql'), 'utf8');
  const start = sql.toLowerCase().indexOf('create or replace function public.set_conversation_image(');
  assert.ok(start >= 0, 'public.set_conversation_image source is missing');
  const end = sql.indexOf('\n$$;', start);
  assert.ok(end > start, 'public.set_conversation_image body terminator is missing');
  const functionSql = sql.slice(start, end + '\n$$;'.length);
  assert.match(functionSql, /security definer/i);
  assert.match(functionSql, /set search_path\s*(?:to|=)\s*''/i);
  assert.match(functionSql, /actor uuid := \(select auth\.uid\(\)\)/i);
  assert.match(functionSql, /app_private\.is_active_member\(\)/i);
  assert.match(functionSql, /app_private\.can_manage_conversation\(p_conversation_id\)/i);
  assert.match(functionSql, /expected_prefix := p_conversation_id::text \|\| '\/' \|\| actor::text \|\| '\/'/i);
  assert.match(functionSql, /bucket_id = 'conversation-avatars'/i);
  assert.match(sql, /revoke all on function public\.set_conversation_image\(uuid,text\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.set_conversation_image\(uuid,text\) to authenticated/i);
});
