import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const registryPath = path.join(root, 'supabase/migrations/source-registry.json');
const blobSha = buffer => createHash('sha1').update(`blob ${buffer.length}\\0`).update(buffer).digest('hex');

test('production source registry maps all 62 ledger versions to one canonical migration each', async () => {
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  assert.equal(registry.schemaVersion, 2);
  assert.equal(registry.registryStatus, 'CANONICAL_SOURCE_STREAM_ASSEMBLED_REVIEW_REQUIRED');
  assert.equal(registry.productionDatabase.migrationCount, 62);
  assert.equal(registry.productionMigrations.length, 62);
  assert.equal(registry.sourceSets.productionLedgerMigrations, 62);
  assert.equal(registry.sourceSets.canonicalCliMigrationFiles, 62);
  assert.equal(registry.sourceSets.archiveSqlFiles, 12);
  assert.equal(registry.sourceSets.duplicatePairs, 0);
  assert.equal(registry.sourceFiles.length, 62);
  assert.equal(registry.sourceSets.testOnlyFixtureCount, 17);
  assert.equal(registry.sourceSets.testOnlyFixturePaths.length, 17);

  const versions = registry.productionMigrations.map(item => item.version);
  assert.equal(new Set(versions).size, 62);
  assert.deepEqual(versions, [...versions].sort());
  const paths = registry.productionMigrations.map(item => item.path);
  assert.equal(new Set(paths).size, 62);
  assert.deepEqual(new Set(registry.sourceFiles.map(item => item.path)), new Set(paths));

  const migrationDirectory = await readdir(path.join(root, 'supabase/migrations'));
  assert.equal(migrationDirectory.filter(name => name.endsWith('.sql')).length, 62);
  for (const migration of registry.productionMigrations) {
    assert.match(migration.version, /^\\d{14}$/);
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

  for (const source of registry.sourceFiles) {
    assert.ok(source.path.startsWith('supabase/migrations/'));
    assert.equal(source.executionPolicy, 'REVIEW_REQUIRED_NOT_EXECUTION_AUTHORIZED');
  }
  for (const fixture of registry.sourceSets.testOnlyFixturePaths) {
    assert.ok(fixture.startsWith('tests/staging/local-supabase/fixtures/'));
    await readFile(path.join(root, fixture));
  }
  assert.equal(JSON.stringify(registry).includes('database/changes'), false);
  assert.equal(registry.unresolvedProductionEntries.length, 0);
  assert.ok(registry.reviewRequiredProductionEntries.length > 0);
  assert.equal(registry.safety.executionAuthorized, false);
  assert.equal(registry.safety.productionChangesAllowed, false);
  assert.equal(registry.safety.localReplayEnabled, false);
  assert.equal(registry.safety.mainModified, false);
  assert.equal(registry.safety.productionModified, false);
  assert.equal(registry.safety.sqlExecuted, false);
  assert.equal(registry.safety.pr139Merged, false);
  for (const id of ['DAG-014', 'DAG-015', 'DAG-016']) {
    assert.ok(registry.knownReplayBlockers.some(item => item.id === id));
  }
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
