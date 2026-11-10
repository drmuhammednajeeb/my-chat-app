#!/usr/bin/env node
// Read-only SQL inventory and bootstrap-readiness audit.
// Never executes, rewrites, renames, or deletes SQL files.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '../../..');

async function walkSql(root, relativeDir, kind) {
  const absoluteDir = path.join(root, relativeDir);
  let entries;
  try { entries = await readdir(absoluteDir, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) files.push(...await walkSql(root, rel, kind));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) {
      const absolute = path.join(root, rel);
      const [content, info] = await Promise.all([readFile(absolute, 'utf8'), stat(absolute)]);
      files.push({ path: rel, kind, content, bytes: info.size });
    }
  }
  return files;
}

function stripSqlComments(sql) {
  return sql.replace(/--[^\r\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function inspectFile(file) {
  const sql = stripSqlComments(file.content);
  const digest = createHash('sha256').update(file.content, 'utf8').digest('hex');
  const legacyRefs = [...sql.matchAll(/\bpublic\s*\.\s*messages\b/gi)].map(match => ({
    token: match[0].replace(/\s+/g, ''),
    line: sql.slice(0, match.index).split('\n').length
  }));
  const creates = [...sql.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\s*\.\s*)?([a-z_][\w$]*)/gi)].map(m => m[1].toLowerCase());
  const referencedPublicTables = [...new Set([...sql.matchAll(/\b(?:from|join|update|into|on|references)\s+public\s*\.\s*([a-z_][\w$]*)/gi)].map(m => m[1].toLowerCase()))].sort();
  const timestamp = file.kind === 'migration' ? file.path.split('/').at(-1).match(/^(\d{14}|\d{12}|\d{8})/)?.[1] ?? null : null;
  const hasCurrentChatMessages = /\bpublic\s*\.\s*chat_messages\b/i.test(sql);
  const missingFunctionTerminators = [...sql.matchAll(/\$(?:function)?\$\s*\r?\n\s*(?:revoke|grant|create|alter|drop)\b/gi)].map(match => ({
    line: sql.slice(0, match.index).split('\n').length,
    followingStatement: match[0].trim().split(/\s+/).at(-1).toLowerCase()
  }));
  return {
    path: file.path,
    kind: file.kind,
    bytes: file.bytes,
    sha256: digest,
    migrationTimestamp: timestamp,
    createsTables: [...new Set(creates)].sort(),
    referencedPublicTables,
    legacyMessagesReferences: legacyRefs,
    suspectedMissingFunctionTerminators: missingFunctionTerminators,
    classification: legacyRefs.length
      ? (hasCurrentChatMessages ? 'mixed_current_and_legacy_reference' : 'legacy_messages_reference')
      : 'no_legacy_messages_reference'
  };
}

export async function buildSqlAudit(root = DEFAULT_ROOT) {
  const [migrations, historical] = await Promise.all([
    walkSql(root, 'supabase/migrations', 'migration'),
    walkSql(root, 'database/changes', 'historical_change')
  ]);
  const inspected = [...migrations, ...historical].map(inspectFile);
  const byHash = new Map();
  for (const file of inspected) {
    const list = byHash.get(file.sha256) ?? [];
    list.push(file.path);
    byHash.set(file.sha256, list);
  }
  const duplicateGroups = [...byHash.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([sha256, paths]) => ({ sha256, paths: paths.sort() }))
    .sort((a, b) => a.paths[0].localeCompare(b.paths[0]));

  const migrationFiles = inspected.filter(file => file.kind === 'migration')
    .sort((a, b) => (a.migrationTimestamp ?? '').localeCompare(b.migrationTimestamp ?? '') || a.path.localeCompare(b.path));
  const hasLegacyTableDefinition = migrationFiles.some(file => file.createsTables.includes('messages'));
  const legacyBlockers = migrationFiles
    .filter(file => file.legacyMessagesReferences.length && !hasLegacyTableDefinition)
    .map(file => ({
      path: file.path,
      reason: 'References public.messages, but no CREATE TABLE public.messages exists in the migration set.',
      classification: file.classification
    }));
  const syntaxHazards = inspected.flatMap(file =>
    file.suspectedMissingFunctionTerminators.map(item => ({ path: file.path, ...item }))
  );
  const configExists = await stat(path.join(root, 'supabase/config.toml')).then(() => true).catch(() => false);

  const findings = [];
  if (!configExists) findings.push({ severity: 'blocking', code: 'SUPABASE_CONFIG_MISSING', message: 'supabase/config.toml is absent; the local CLI stack is not configured.' });
  if (migrationFiles.length === 0) findings.push({ severity: 'blocking', code: 'NO_MIGRATIONS', message: 'No SQL files were found in supabase/migrations/.' });
  if (legacyBlockers.length) findings.push({ severity: 'blocking', code: 'UNRESOLVED_LEGACY_TABLE_DEPENDENCY', message: 'One or more migrations reference public.messages without defining it in the migration set.', files: legacyBlockers.map(item => item.path) });
  if (syntaxHazards.length) findings.push({ severity: 'blocking', code: 'SUSPECTED_MISSING_FUNCTION_TERMINATOR', message: 'A dollar-quoted function body is followed by another SQL statement without a visible semicolon.', files: syntaxHazards.map(item => item.path) });
  if (duplicateGroups.length) findings.push({ severity: 'warning', code: 'DUPLICATE_SQL_CONTENT', message: 'Byte-identical SQL files exist; they are reported, never automatically deduplicated.', groups: duplicateGroups });

  return {
    schemaVersion: 2,
    auditMode: 'READ_ONLY',
    sourceDirectories: [
      { path: 'supabase/migrations', role: 'Supabase CLI migration candidates', fileCount: migrations.length },
      { path: 'database/changes', role: 'Historical SQL; excluded from automatic migration execution', fileCount: historical.length }
    ],
    migrationOrder: migrationFiles.map(file => ({ path: file.path, timestamp: file.migrationTimestamp })),
    files: inspected.sort((a, b) => a.path.localeCompare(b.path)),
    duplicateGroups,
    legacyBlockers,
    syntaxHazards,
    bootstrap: {
      status: findings.some(item => item.severity === 'blocking') ? 'BLOCKED' : 'AUDIT_ONLY_NOT_APPROVED',
      executable: false,
      reason: 'This audit does not establish a canonical dependency order or authorize SQL execution. Review and explicitly approve a separate test-only bootstrap before starting Supabase.'
    },
    findings
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootArg = process.argv.find((arg, index) => index > 1 && !arg.startsWith('--'));
  const root = rootArg ? path.resolve(rootArg) : DEFAULT_ROOT;
  try {
    const report = await buildSqlAudit(root);
    console.log(JSON.stringify(report, null, 2));
    if (process.argv.includes('--fail-on-blockers') && report.findings.some(item => item.severity === 'blocking')) process.exitCode = 2;
  } catch (error) {
    console.error('SQL_AUDIT_FAILED:', error.message);
    process.exitCode = 1;
  }
}
