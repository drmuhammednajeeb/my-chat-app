import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sourcePath = path.join(root, 'database/changes/20261107152733_fix_official_membership_invite_duplicate_validation.sql');
const copyPath = path.join(root, 'tests/staging/local-supabase/fixtures/20261107152733_fix_official_membership_invite_duplicate_validation.sql');
const manifestPath = path.join(root, 'tests/staging/local-supabase/fixtures/patch-manifest.json');
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');

test('test-only SQL patch changes only the missing function terminator', async () => {
  const [source, copy, manifest] = await Promise.all([readFile(sourcePath, 'utf8'), readFile(copyPath, 'utf8'), readFile(manifestPath, 'utf8').then(JSON.parse)]);
  const marker = '$function$\n\nrevoke all on function app_private.admin_create_official_member_invites_impl(jsonb)';
  assert.ok(source.includes(marker), 'canonical source must retain the original syntax hazard');
  const expected = source.replace(marker, '$function$;\n\nrevoke all on function app_private.admin_create_official_member_invites_impl(jsonb)');
  assert.equal(copy, expected, 'test copy must differ by exactly one semicolon');
  assert.notEqual(sha256(source), sha256(copy));
  assert.equal(sha256(source), manifest.canonicalSource.sha256);
  assert.equal(sha256(copy), manifest.testCopy.sha256);
  console.log('PATCH_SOURCE_SHA256=' + sha256(source));
  console.log('PATCH_TEST_COPY_SHA256=' + sha256(copy));
});
