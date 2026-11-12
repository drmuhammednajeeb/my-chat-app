import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const registryPath = path.join(root, 'supabase/migrations/source-registry.json');
const gitBlobSha = (buffer) => createHash('sha1')
  .update(`blob ${buffer.length}\0`)
  .update(buffer)
  .digest('hex');

test('production migration source registry is explicit, complete, and fail-closed', async () => {
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.registryStatus, 'RECONCILIATION_INCOMPLETE');
  assert.equal(registry.productionDatabase.migrationCount, 62);
  assert.equal(registry.productionMigrations.length, 62);
  assert.equal(registry.sourceSets.sqlSourceFiles, 55);
  assert.equal(registry.sourceFiles.length, 55);
  assert.equal(registry.sourceSets.cliMigrationFiles, 10);
  assert.equal(registry.sourceSets.historicalChangeFiles, 45);
  assert.equal(registry.sourceSets.duplicatePairs, 3);
  assert.equal(registry.sourceSets.testOnlyFixtureCount, 19);
  assert.equal(registry.sourceSets.testOnlyFixturePaths.length, 19);

  const versions = registry.productionMigrations.map(item => item.version);
  assert.equal(new Set(versions).size, versions.length, 'production migration versions must be unique');
  assert.deepEqual(versions, [...versions].sort(), 'production migrations must be ordered by production version');

  const sourcePaths = new Set(registry.sourceFiles.map(item => item.path));
  assert.equal(sourcePaths.size, registry.sourceFiles.length, 'source file paths must be unique');

  for (const source of registry.sourceFiles) {
    const bytes = await readFile(path.join(root, source.path));
    assert.equal(gitBlobSha(bytes), source.gitBlobSha, 'Git blob provenance mismatch: ' + source.path);
    assert.ok(['cli-migration', 'historical-change'].includes(source.sourceType));
    assert.equal(source.executionPolicy, 'NOT_EXECUTABLE_FROM_REGISTRY');
    if (source.duplicateOf) {
      assert.ok(sourcePaths.has(source.duplicateOf), 'duplicate target missing: ' + source.duplicateOf);
      const duplicate = registry.sourceFiles.find(item => item.path === source.duplicateOf);
      assert.equal(source.gitBlobSha, duplicate.gitBlobSha, 'duplicate files must have identical Git blobs');
    }
  }

  const fixturePaths = new Set(registry.sourceSets.testOnlyFixturePaths);
  for (const fixture of fixturePaths) await readFile(path.join(root, fixture));

  const externalPaths = new Set(
    registry.externalSources.flatMap(group => group.files.map(file => file.path))
  );
  for (const external of registry.externalSources) {
    assert.equal(external.state, 'OPEN_DRAFT_NOT_MERGED');
    assert.ok(external.headSha);
    for (const file of external.files) {
      assert.match(file.blobSha, /^[a-f0-9]{40}$/);
      assert.equal(file.status, 'SOURCE_IN_OPEN_PR_NOT_MAIN');
    }
  }

  const allowedStatuses = new Set([
    'SOURCE_NAME_MATCH',
    'DUPLICATE_SOURCE_MATCH',
    'SOURCE_CANDIDATE',
    'COMPOUND_SOURCE_CANDIDATE',
    'DUPLICATE_IDENTICAL_SOURCE',
    'RECOVERED_FIXTURE_ONLY',
    'MISSING_CANONICAL_SOURCE',
    'UNVERIFIED_SOURCE_CANDIDATE',
    'SOURCE_IN_OPEN_PR_NOT_MAIN'
  ]);

  for (const migration of registry.productionMigrations) {
    assert.match(migration.version, /^\d{14}$/);
    assert.ok(migration.name);
    assert.ok(allowedStatuses.has(migration.mappingStatus), 'unrecognized mapping status: ' + migration.mappingStatus);
    for (const sourcePath of migration.sourcePaths) {
      assert.ok(
        sourcePaths.has(sourcePath) || fixturePaths.has(sourcePath) || externalPaths.has(sourcePath),
        'migration references an unregistered source path: ' + sourcePath
      );
    }
    if (migration.mappingStatus === 'MISSING_CANONICAL_SOURCE') {
      assert.equal(migration.sourcePaths.length, 0);
      assert.ok(migration.note);
    }
  }

  assert.equal(registry.safety.executionAuthorized, false);
  assert.equal(registry.safety.productionChangesAllowed, false);
  assert.equal(registry.safety.localReplayEnabled, false);
  assert.equal(registry.safety.mainModified, false);
  assert.equal(registry.safety.pr138Merged, false);
  assert.ok(registry.unresolvedProductionEntries.length > 0);
  assert.ok(registry.knownReplayBlockers.some(item => item.id === 'DAG-014'));
  assert.ok(registry.knownReplayBlockers.some(item => item.id === 'DAG-015'));
  assert.ok(registry.knownReplayBlockers.some(item => item.id === 'DAG-016'));
});

test('the registry never treats historical SQL or test fixtures as an executable migration stream', async () => {
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  assert.equal(registry.productionMigrations.length, registry.productionDatabase.migrationCount);
  assert.ok(registry.rules.some(rule => rule.includes('Do not execute database/changes by glob')));
  assert.ok(registry.rules.some(rule => rule.includes('test fixtures')));
  assert.ok(registry.rules.some(rule => rule.includes('No migration is replay-authorized')));
  assert.ok(registry.sourceFiles.every(source => source.executionPolicy === 'NOT_EXECUTABLE_FROM_REGISTRY'));
});
