import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const manifestPath = path.join(root, 'tests/staging/local-supabase/fixtures/synthetic-fixture-patches.json');
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');

test('all synthetic SQL copies differ from canonical sources only by declared replacements', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.mode, 'TEST_COPY_ONLY');
  for (const patch of manifest.patches) {
    const [source, copy] = await Promise.all([
      readFile(path.join(root, patch.sourcePath), 'utf8'),
      readFile(path.join(root, patch.testCopyPath), 'utf8')
    ]);
    let expected = source;
    for (const replacement of patch.replacements ?? [patch.replacement]) {
      const count = expected.split(replacement.from).length - 1;
      assert.equal(count, replacement.expectedOccurrences, 'unexpected source match count in ' + patch.sourcePath);
      expected = expected.replace(replacement.from, replacement.to);
    }
    assert.equal(copy, expected, 'undeclared SQL changes in ' + patch.testCopyPath);
    const sourceHash = sha256(source);
    const copyHash = sha256(copy);
    if (patch.sourceSha256 !== 'COMPUTED_BY_CI') assert.equal(sourceHash, patch.sourceSha256);
    if (patch.testCopySha256 !== 'COMPUTED_BY_CI') assert.equal(copyHash, patch.testCopySha256);
    console.log('PATCH_SOURCE_SHA256=' + patch.sourcePath + ':' + sourceHash);
    console.log('PATCH_TEST_COPY_SHA256=' + patch.testCopyPath + ':' + copyHash);
  }
});

test('synthetic admin fixtures use only reserved test identity and deterministic membership values', async () => {
  const [authSeed, profileSeed, manifest] = await Promise.all([
    readFile(path.join(root, 'tests/staging/local-supabase/fixtures/synthetic-auth-admin-before-membership.sql'), 'utf8'),
    readFile(path.join(root, 'tests/staging/local-supabase/fixtures/synthetic-admin-profile-after-membership.sql'), 'utf8'),
    readFile(manifestPath, 'utf8').then(JSON.parse)
  ]);
  assert.match(authSeed, /admin@bizmindmakers\.test/);
  assert.match(authSeed, /971001000001/);
  assert.match(profileSeed, /11111111-1111-4111-8111-111111111111/);
  assert.equal(manifest.execution.enabled, false);
  assert.equal(manifest.execution.productionAllowed, false);
  assert.equal(manifest.execution.cloudAllowed, false);
});
