#!/usr/bin/env node
// Read-only SQL inventory and migration-order audit.
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

// Remove comments without corrupting quoted strings or dollar-quoted bodies.
function stripSqlComments(sql) {
  let output = '';
  let index = 0;
  let quote = null;
  let dollar = null;
  while (index < sql.length) {
    if (dollar) {
      if (sql.startsWith(dollar, index)) {
        output += dollar;
        index += dollar.length;
        dollar = null;
      } else {
        output += sql[index++];
      }
      continue;
    }
    if (quote) {
      const char = sql[index];
      output += char;
      index++;
      if (char === quote) {
        if (quote === "'" && sql[index] === "'") output += sql[index++];
        else quote = null;
      } else if (char === '\\' && quote === "'" && index < sql.length) {
        output += sql[index++];
      }
      continue;
    }
    if (sql[index] === "'" || sql[index] === '"') {
      quote = sql[index];
      output += sql[index++];
      continue;
    }
    if (sql[index] === '$') {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/);
      if (match) {
        dollar = match[0];
        output += dollar;
        index += dollar.length;
        continue;
      }
    }
    if (sql.startsWith('--', index)) {
      while (index < sql.length && sql[index] !== '\n') {
        output += sql[index] === '\r' ? '\r' : ' ';
        index++;
      }
      continue;
    }
    if (sql.startsWith('/*', index)) {
      output += '  ';
      index += 2;
      let depth = 1;
      while (index < sql.length && depth > 0) {
        if (sql.startsWith('/*', index)) {
          depth++;
          output += '  ';
          index += 2;
        } else if (sql.startsWith('*/', index)) {
          depth--;
          output += '  ';
          index += 2;
        } else {
          output += sql[index] === '\n' || sql[index] === '\r' ? sql[index] : ' ';
          index++;
        }
      }
      continue;
    }
    output += sql[index++];
  }
  return output;
}

function skipSqlTrivia(sql, start) {
  let index = start;
  while (index < sql.length) {
    if (/\s/.test(sql[index])) { index++; continue; }
    if (sql.startsWith('--', index)) {
      while (index < sql.length && sql[index] !== '\n') index++;
      continue;
    }
    if (sql.startsWith('/*', index)) {
      index += 2;
      let depth = 1;
      while (index < sql.length && depth > 0) {
        if (sql.startsWith('/*', index)) { depth++; index += 2; }
        else if (sql.startsWith('*/', index)) { depth--; index += 2; }
        else index++;
      }
      continue;
    }
    break;
  }
  return index;
}

// Only inspect dollar-quoted SQL/DO bodies. A terminator is valid when the
// closing delimiter is followed by a statement semicolon (comments allowed).
function inspectDollarQuoteTerminators(sql) {
  const issues = [];
  let index = 0;
  let quote = null;
  while (index < sql.length) {
    if (quote) {
      const char = sql[index++];
      if (char === quote) {
        if (quote === "'" && sql[index] === "'") index++;
        else quote = null;
      } else if (char === '\\' && quote === "'" && index < sql.length) index++;
      continue;
    }
    if (sql[index] === "'" || sql[index] === '"') {
      quote = sql[index++];
      continue;
    }
    if (sql.startsWith('--', index)) {
      while (index < sql.length && sql[index] !== '\n') index++;
      continue;
    }
    if (sql.startsWith('/*', index)) {
      index = skipSqlTrivia(sql, index);
      continue;
    }
    if (sql[index] !== '$') { index++; continue; }
    const token = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/)?.[0];
    if (!token) { index++; continue; }
    const prefix = sql.slice(Math.max(0, index - 80), index);
    if (!/(?:\bAS|\bDO)\s*$/i.test(prefix)) {
      index += token.length;
      continue;
    }
    const closing = sql.indexOf(token, index + token.length);
    const line = sql.slice(0, index).split('\n').length;
    if (closing < 0) {
      issues.push({ line, reason: 'unterminated_dollar_quoted_body', delimiter: token });
      break;
    }
    const after = skipSqlTrivia(sql, closing + token.length);
    const following = sql.slice(after).match(/^[A-Za-z_]+/)?.[0]?.toUpperCase() ?? 'END_OF_FILE';
        const functionTail = /^(?:LANGUAGE|TRANSFORM|WINDOW|IMMUTABLE|STABLE|VOLATILE|STRICT|CALLED|RETURNS|SECURITY|PARALLEL|LEAKPROOF|NOT|SET|COST|ROWS|SUPPORT)\b/.test(following);
        const nextStatement = /^(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|SELECT|BEGIN|COMMIT|ROLLBACK|DO|TRUNCATE)\b/.test(following);
    if (sql[after] !== ';' && !functionTail && (nextStatement || following === 'END_OF_FILE')) {
      issues.push({ line: sql.slice(0, closing).split('\n').length, reason: 'missing_statement_terminator', followingStatement: following.toLowerCase() });
    }
    index = closing + token.length;
  }
  return issues;
}

function inspectFile(file) {
  const sql = stripSqlComments(file.content);
  const digest = createHash('sha256').update(file.content, 'utf8').digest('hex');
  const legacyRefs = [...sql.matchAll(/\bpublic\s*\.\s*messages\b/gi)].map(match => ({
    token: match[0].replace(/\s+/g, ''),
    line: sql.slice(0, match.index).split('\n').length,
    offset: match.index
  }));
  const createdPublicTables = [...sql.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?public\s*\.\s*([a-z_][\w$]*)/gi)].map(match => ({
    name: match[1].toLowerCase(),
    line: sql.slice(0, match.index).split('\n').length,
    offset: match.index
  }));
  const publicTableReferences = [...sql.matchAll(/\b(?:from|join|update|into|on(?:\s+table)?|references|alter\s+table|drop\s+table)\s+public\s*\.\s*([a-z_][\w$]*)/gi)].map(match => ({ name: match[1].toLowerCase(), line: sql.slice(0, match.index).split('\n').length, offset: match.index }));
  const referencedPublicTables = [...new Set(publicTableReferences.map(reference => reference.name))].sort();
  const timestamp = file.kind === 'migration'
    ? file.path.split('/').at(-1).match(/^(\d{14}|\d{12}|\d{8})/)?.[1] ?? null
    : null;
  const terminatorIssues = inspectDollarQuoteTerminators(sql);
  const hasCurrentChatMessages = /\bpublic\s*\.\s*chat_messages\b/i.test(sql);
  return {
    path: file.path,
    kind: file.kind,
    bytes: file.bytes,
    sha256: digest,
    migrationTimestamp: timestamp,
    createsPublicTables: createdPublicTables,
    referencedPublicTables,
    publicTableReferences,
    legacyMessagesReferences: legacyRefs.map(({ token, line }) => ({ token, line })),
    legacyMessagesDependency: legacyRefs.length
      ? (hasCurrentChatMessages ? 'mixed_current_and_legacy_reference' : 'legacy_messages_reference')
      : 'none',
    suspectedMissingFunctionTerminators: terminatorIssues
  };
}

function buildMigrationOrder(migrationFiles) {
  const ordered = [...migrationFiles].sort((a, b) =>
    (a.migrationTimestamp ?? '').localeCompare(b.migrationTimestamp ?? '') || a.path.localeCompare(b.path)
  );
  const byTimestamp = new Map();
  for (const file of ordered) {
    if (!file.migrationTimestamp) continue;
    const list = byTimestamp.get(file.migrationTimestamp) ?? [];
    list.push(file.path);
    byTimestamp.set(file.migrationTimestamp, list);
  }
  const duplicateTimestamps = [...byTimestamp.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([timestamp, paths]) => ({ timestamp, paths }));
  const missingTimestamps = ordered.filter(file => !file.migrationTimestamp).map(file => file.path);
  const positions = new Map(ordered.map((file, index) => [file.path, index]));
  const tableDefinitions = new Map();
  for (const file of ordered) {
    for (const definition of file.createsPublicTables) {
      const list = tableDefinitions.get(definition.name) ?? [];
      list.push({ path: file.path, timestamp: file.migrationTimestamp, line: definition.line, offset: definition.offset, position: positions.get(file.path) });
      tableDefinitions.set(definition.name, list);
    }
  }
  const forwardDependencies = [];
  const unresolvedLegacyReferences = [];
  for (const file of ordered) {
    for (const reference of file.publicTableReferences) {
      const definitions = tableDefinitions.get(reference.name) ?? [];
      const priorDefinition = definitions.some(definition =>
        definition.position < positions.get(file.path)
        || (definition.position === positions.get(file.path) && definition.offset < reference.offset)
      );
      const laterDefinition = definitions.find(definition =>
        definition.position > positions.get(file.path)
        || (definition.position === positions.get(file.path) && definition.offset > reference.offset)
      );
      if (!priorDefinition && laterDefinition) {
        forwardDependencies.push({
          path: file.path,
          line: reference.line,
          table: 'public.' + reference.name,
          laterDefinition: laterDefinition.path,
          reason: 'Migration references a public table before its defining migration or statement.'
        });
      }
      if (reference.name === 'messages' && !priorDefinition) {
        unresolvedLegacyReferences.push({
          path: file.path,
          line: reference.line,
          reason: 'References public.messages before any preceding CREATE TABLE public.messages in the migration sequence.'
        });
      }
    }
  }
  return {
    ordered,
    duplicateTimestamps,
    missingTimestamps,
    forwardDependencies,
    unresolvedLegacyReferences
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

  const migrationFiles = inspected.filter(file => file.kind === 'migration');
  const order = buildMigrationOrder(migrationFiles);
  const syntaxHazards = inspected.flatMap(file =>
    file.suspectedMissingFunctionTerminators.map(item => ({ path: file.path, kind: file.kind, ...item }))
  );
  const migrationSyntaxHazards = syntaxHazards.filter(item => item.kind === 'migration');
  const historicalSyntaxHazards = syntaxHazards.filter(item => item.kind === 'historical_change');
  const configExists = await stat(path.join(root, 'supabase/config.toml')).then(() => true).catch(() => false);

  const findings = [];
  if (!configExists) findings.push({
    severity: 'warning',
    code: 'SUPABASE_CONFIG_MISSING',
    message: 'supabase/config.toml is absent. This affects local Supabase CLI stack readiness only; it is not evidence of invalid SQL or a deployed-application failure.'
  });
  if (migrationFiles.length === 0) findings.push({
    severity: 'blocking',
    code: 'NO_MIGRATIONS',
    message: 'No SQL files were found in supabase/migrations/.'
  });
  if (order.duplicateTimestamps.length) findings.push({
    severity: 'blocking',
    code: 'DUPLICATE_MIGRATION_TIMESTAMPS',
    message: 'Multiple migration files share the same version timestamp; Supabase migration ordering is ambiguous.',
    groups: order.duplicateTimestamps
  });
  if (order.missingTimestamps.length) findings.push({
    severity: 'warning',
    code: 'MIGRATION_TIMESTAMP_MISSING',
    message: 'One or more migration files do not begin with a recognized timestamp.',
    files: order.missingTimestamps
  });
  if (order.unresolvedLegacyReferences.length) findings.push({
    severity: 'blocking',
    code: 'UNRESOLVED_LEGACY_TABLE_DEPENDENCY',
    message: 'A migration references public.messages before the migration set creates that table.',
    files: [...new Set(order.unresolvedLegacyReferences.map(item => item.path))]
  });
  if (order.forwardDependencies.length) findings.push({
    severity: 'blocking',
    code: 'MIGRATION_FORWARD_DEPENDENCY',
    message: 'A migration references a public table that is only created by a later migration.',
    files: [...new Set(order.forwardDependencies.map(item => item.path))]
  });
  if (migrationSyntaxHazards.length) findings.push({
    severity: 'blocking',
    code: 'SUSPECTED_MISSING_FUNCTION_TERMINATOR',
    message: 'A Supabase migration candidate contains a dollar-quoted SQL/DO body without a statement terminator.',
    files: [...new Set(migrationSyntaxHazards.map(item => item.path))]
  });
  if (historicalSyntaxHazards.length) findings.push({
    severity: 'warning',
    code: 'HISTORICAL_SQL_SYNTAX_REVIEW',
    message: 'Historical SQL outside supabase/migrations contains a suspected missing statement terminator. It is not a Supabase CLI migration candidate, so it is reported for manual review rather than blocking migration ordering.',
    files: [...new Set(historicalSyntaxHazards.map(item => item.path))]
  });
  if (duplicateGroups.length) findings.push({
    severity: 'warning',
    code: 'DUPLICATE_SQL_CONTENT',
    message: 'Byte-identical SQL files exist; they are reported, never automatically deduplicated.',
    groups: duplicateGroups
  });

  const blockingFindings = findings.filter(item => item.severity === 'blocking');
  return {
    schemaVersion: 3,
    auditMode: 'READ_ONLY',
    sourceDirectories: [
      { path: 'supabase/migrations', role: 'Supabase CLI migration candidates', fileCount: migrations.length },
      { path: 'database/changes', role: 'Historical SQL; excluded from automatic migration execution', fileCount: historical.length }
    ],
    migrationOrder: order.ordered.map(file => ({
      path: file.path,
      timestamp: file.migrationTimestamp,
      createsPublicTables: file.createsPublicTables.map(item => 'public.' + item.name),
      referencesPublicTables: file.referencedPublicTables
    })),
    migrationOrderReview: {
      status: blockingFindings.length ? 'BLOCKED' : 'NO_STATIC_ORDER_BLOCKERS',
      duplicateTimestamps: order.duplicateTimestamps,
      missingTimestamps: order.missingTimestamps,
      forwardDependencies: order.forwardDependencies,
      unresolvedLegacyReferences: order.unresolvedLegacyReferences
    },
    files: inspected.sort((a, b) => a.path.localeCompare(b.path)),
    duplicateGroups,
    legacyBlockers: order.unresolvedLegacyReferences,
    syntaxHazards,
    localEnvironment: {
      supabaseConfigPresent: configExists,
      localCliReadiness: configExists ? 'CONFIG_PRESENT_NOT_RUNTIME_VERIFIED' : 'NOT_CONFIGURED',
      productionDatabaseInspected: false
    },
    bootstrap: {
      status: blockingFindings.length ? 'BLOCKED' : 'AUDIT_ONLY_NOT_APPROVED',
      executable: false,
      reason: 'This source audit does not establish live database state or authorize SQL execution. Review and explicitly approve a separate test-only bootstrap before starting Supabase.'
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
