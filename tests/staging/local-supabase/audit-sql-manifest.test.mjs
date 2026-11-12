import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSqlAudit } from './audit-sql-manifest.mjs';

const scriptPath = fileURLToPath(new URL('./audit-sql-manifest.mjs', import.meta.url));

async function createRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sql-audit-'));
  await mkdir(path.join(root, 'supabase/migrations'), { recursive: true });
  await mkdir(path.join(root, 'database/changes'), { recursive: true });
  return root;
}

test('read-only audit inventories sources, hashes duplicates, and blocks unresolved legacy table refs', async () => {
  const root = await createRoot();
  try {
    const migration = '-- current schema\ncreate table public.chat_messages(id uuid);\ncreate policy p on public.messages for select using(false);\n';
    const duplicate = 'create index ix on public.chat_messages(id);\n';
    await writeFile(path.join(root, 'supabase/migrations/20261101000000_base.sql'), migration);
    await writeFile(path.join(root, 'supabase/migrations/20261102000000_index.sql'), duplicate);
    await writeFile(path.join(root, 'database/changes/index-copy.sql'), duplicate);

    const report = await buildSqlAudit(root);
    assert.equal(report.schemaVersion, 3);
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
    assert.ok(report.findings.some(item => item.code === 'SUPABASE_CONFIG_MISSING' && item.severity === 'warning'));
    assert.equal(report.localEnvironment.localCliReadiness, 'NOT_CONFIGURED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing Supabase CLI config is not a SQL blocker when migration source has no blockers', async () => {
  const root = await createRoot();
  try {
    await writeFile(path.join(root, 'supabase/migrations/20261101000000_base.sql'), 'create table public.chat_messages(id uuid);\n');
    const report = await buildSqlAudit(root);
    assert.equal(report.bootstrap.status, 'AUDIT_ONLY_NOT_APPROVED');
    assert.equal(report.findings.some(item => item.code === 'SUPABASE_CONFIG_MISSING' && item.severity === 'blocking'), false);
    assert.equal(report.findings.some(item => item.severity === 'blocking'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy table dependency is resolved only when its definition precedes its first use', async () => {
  const root = await createRoot();
  try {
    await writeFile(path.join(root, 'supabase/migrations/20261101000000_create_legacy.sql'), 'create table public.messages(id uuid);\n');
    await writeFile(path.join(root, 'supabase/migrations/20261102000000_use_legacy.sql'), 'alter table public.messages enable row level security;\n');
    let report = await buildSqlAudit(root);
    assert.equal(report.legacyBlockers.length, 0);

    await writeFile(path.join(root, 'supabase/migrations/20261100000000_before_definition.sql'), 'revoke all on table public.messages from anon;\n');
    report = await buildSqlAudit(root);
    assert.equal(report.legacyBlockers.length, 1);
    assert.equal(report.legacyBlockers[0].path, 'supabase/migrations/20261100000000_before_definition.sql');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('migration order reports duplicate version timestamps as blockers', async () => {
  const root = await createRoot();
  try {
    await writeFile(path.join(root, 'supabase/migrations/20261101000000_first.sql'), 'create table public.first_table(id uuid);\n');
    await writeFile(path.join(root, 'supabase/migrations/20261101000000_second.sql'), 'create table public.second_table(id uuid);\n');
    const report = await buildSqlAudit(root);
    assert.equal(report.migrationOrderReview.duplicateTimestamps.length, 1);
    assert.ok(report.findings.some(item => item.code === 'DUPLICATE_MIGRATION_TIMESTAMPS' && item.severity === 'blocking'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('comment-like tokens inside quoted SQL strings are preserved', async () => {
  const root = await createRoot();
  try {
    const original = "create table public.chat_messages(id uuid);\nselect '-- not a comment /* still text */';\n";
    const file = path.join(root, 'supabase/migrations/20261101000000_base.sql');
    await writeFile(file, original);
    const report = await buildSqlAudit(root);
    assert.equal(report.bootstrap.status, 'AUDIT_ONLY_NOT_APPROVED');
    assert.equal(await readFile(file, 'utf8'), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dollar-quoted statement terminator audit ignores valid bodies and detects missing terminators', async () => {
  const root = await createRoot();
  try {
    await writeFile(
      path.join(root, 'supabase/migrations/20261101000000_valid.sql'),
      'create function app_private.valid() returns void as $ begin null; end; $ language plpgsql;\n'
    );
    await writeFile(
      path.join(root, 'database/changes/bad.sql'),
      'create function app_private.invalid() returns void language plpgsql as $body$ begin null; end; $body$\nrevoke all on function app_private.invalid() from public;\n'
    );
    const report = await buildSqlAudit(root);
    assert.equal(report.syntaxHazards.length, 1);
    assert.equal(report.syntaxHazards[0].path, 'database/changes/bad.sql');
    assert.equal(report.syntaxHazards[0].reason, 'missing_statement_terminator');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fail-on-blockers CLI exits nonzero for unresolved legacy dependencies', async () => {
  const root = await createRoot();
  try {
    await writeFile(path.join(root, 'supabase/migrations/20261101000000_base.sql'), 'create policy p on public.messages for all using(false);\n');
    const result = spawnSync(process.execPath, [scriptPath, root, '--fail-on-blockers'], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stdout, /UNRESOLVED_LEGACY_TABLE_DEPENDENCY/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('audit preserves original SQL bytes and does not create a bootstrap config', async () => {
  const root = await createRoot();
  try {
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
  const root = await createRoot();
  try {
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
