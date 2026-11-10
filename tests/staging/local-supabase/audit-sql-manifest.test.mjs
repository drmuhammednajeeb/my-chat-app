import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSqlAudit } from './audit-sql-manifest.mjs';

test('read-only audit inventories sources, hashes duplicates, and blocks unresolved legacy table refs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sql-audit-'));
  try {
    await mkdir(path.join(root, 'supabase/migrations'), { recursive: true });
    await mkdir(path.join(root, 'database/changes'), { recursive: true });
    const migration = '-- current schema\ncreate table public.chat_messages(id uuid);\ncreate policy p on public.messages for select using(false);\n';
    const duplicate = 'create index ix on public.chat_messages(id);\n';
    await writeFile(path.join(root, 'supabase/migrations/20261101000000_base.sql'), migration);
    await writeFile(path.join(root, 'supabase/migrations/20261102000000_index.sql'), duplicate);
    await writeFile(path.join(root, 'database/changes/index-copy.sql'), duplicate);

    const report = await buildSqlAudit(root);
    assert.equal(report.auditMode, 'READ_ONLY');
    assert.equal(report.bootstrap.executable, false);
    assert.equal(report.bootstrap.status, 'BLOCKED');
    assert.equal(report.sourceDirectories[0].fileCount, 2);
    assert.equal(report.sourceDirectories[1].fileCount, 1);
    assert.equal(report.duplicateGroups.length, 1);
    assert.deepEqual(report.duplicateGroups[0].paths, [
      'database/changes/index-copy.sql',
      'supabase/migrations/20261102000000_index.sql'
    ]);
    assert.equal(report.legacyBlockers.length, 1);
    assert.equal(report.legacyBlockers[0].path, 'supabase/migrations/20261101000000_base.sql');
    assert.ok(report.findings.some(item => item.code === 'SUPABASE_CONFIG_MISSING'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('audit preserves original SQL bytes and does not create a bootstrap config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sql-audit-'));
  try {
    await mkdir(path.join(root, 'supabase/migrations'), { recursive: true });
    const sqlPath = path.join(root, 'supabase/migrations/20261101000000_base.sql');
    const original = 'create table public.chat_messages(id uuid);\n';
    await writeFile(sqlPath, original);
    await buildSqlAudit(root);
    assert.equal(await readFile(sqlPath, 'utf8'), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('comment-only legacy table mentions are ignored', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sql-audit-'));
  try {
    await mkdir(path.join(root, 'supabase/migrations'), { recursive: true });
    await writeFile(
      path.join(root, 'supabase/migrations/20261101000000_base.sql'),
      '-- public.messages is a legacy table\ncreate table public.chat_messages(id uuid);\n'
    );
    const report = await buildSqlAudit(root);
    assert.equal(report.legacyBlockers.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('qualified legacy references are detected and missing function terminators are reported', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sql-audit-'));
  try {
    await mkdir(path.join(root, 'supabase/migrations'), { recursive: true });
    await mkdir(path.join(root, 'database/changes'), { recursive: true });
    await writeFile(
      path.join(root, 'supabase/migrations/20261101000000_base.sql'),
      'create table public.chat_messages(id uuid);\ncreate policy deny_old on public.messages for all using(false);\n'
    );
    await writeFile(
      path.join(root, 'database/changes/20261102000000_bad_function.sql'),
      'create or replace function app_private.sample() returns void language sql as $function$ select 1; $function$\nrevoke all on function app_private.sample() from public;\n'
    );
    const report = await buildSqlAudit(root);
    assert.equal(report.legacyBlockers.length, 1);
    assert.equal(report.syntaxHazards.length, 1);
    assert.ok(report.findings.some(item => item.code === 'SUSPECTED_MISSING_FUNCTION_TERMINATOR'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
