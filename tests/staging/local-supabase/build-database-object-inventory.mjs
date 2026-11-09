#!/usr/bin/env node
// Read-only repository SQL object inventory. This is not a live catalog dump.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

async function walkSql(root, dir, kind) {
  const base = path.join(root, dir);
  let entries;
  try { entries = await readdir(base, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walkSql(root, rel, kind));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) {
      const full = path.join(root, rel);
      const [sql, info] = await Promise.all([readFile(full, 'utf8'), stat(full)]);
      result.push({ path: rel, kind, sql, bytes: info.size });
    }
  }
  return result;
}

function stripComments(sql) {
  let out = '', i = 0, quote = null, dollar = null;
  while (i < sql.length) {
    if (dollar) {
      if (sql.startsWith(dollar, i)) { out += dollar; i += dollar.length; dollar = null; }
      else out += sql[i++];
      continue;
    }
    if (quote) {
      const c = sql[i]; out += c; i++;
      if (c === quote) {
        if (quote === "'" && sql[i] === "'") out += sql[i++];
        else quote = null;
      } else if (c === '\\' && quote === "'" && i < sql.length) out += sql[i++];
      continue;
    }
    if (sql[i] === "'" || sql[i] === '"') { quote = sql[i]; out += sql[i++]; continue; }
    if (sql[i] === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/);
      if (match) { dollar = match[0]; out += dollar; i += dollar.length; continue; }
    }
    if (sql.startsWith('--', i)) {
      while (i < sql.length && sql[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (sql.startsWith('/*', i)) {
      out += '  '; i += 2; let depth = 1;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; out += '  '; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; out += '  '; i += 2; }
        else { out += sql[i] === '\n' ? '\n' : ' '; i++; }
      }
      continue;
    }
    out += sql[i++];
  }
  return out;
}
function matches(sql, regex, map) { return [...sql.matchAll(regex)].map(map); }


function findClosingParen(source, openIndex) {
  let depth = 0, quote = null;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) {
        if (quote === "'" && source[i + 1] === "'") i++;
        else quote = null;
      } else if (ch === '\\' && quote === "'") i++;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}
function splitTopLevel(source) {
  const parts = []; let start = 0, depth = 0, quote = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) {
        if (quote === "'" && source[i + 1] === "'") i++;
        else quote = null;
      } else if (ch === '\\' && quote === "'") i++;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { parts.push(source.slice(start, i).trim()); start = i + 1; }
  }
  if (source.slice(start).trim()) parts.push(source.slice(start).trim());
  return parts;
}
function extractTableDetails(sql) {
  const tables = [], foreignKeys = [];
  const re = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?((?:[a-z_]\w*\.)?[a-z_]\w*)\s*\(/gi;
  for (const match of sql.matchAll(re)) {
    const open = match.index + match[0].lastIndexOf('(');
    const close = findClosingParen(sql, open);
    if (close < 0) continue;
    const name = match[1].toLowerCase();
    const columns = [];
    for (const definition of splitTopLevel(sql.slice(open + 1, close))) {
      const fk = definition.match(/\bforeign\s+key\s*\(([^)]+)\)\s+references\s+((?:[a-z_]\w*\.)?[a-z_]\w*)\s*\(([^)]+)\)/i)
        || definition.match(/^\s*([a-z_]\w*)[\s\S]*?\breferences\s+((?:[a-z_]\w*\.)?[a-z_]\w*)\s*\(([^)]+)\)/i);
      if (fk) {
        const localColumns = definition.match(/\bforeign\s+key\s*\(([^)]+)\)/i)?.[1]
          ?? definition.match(/^\s*("?[\w$]+"?)/)?.[1] ?? '';
        foreignKeys.push({
          source: name, constraint: definition.match(/\bconstraint\s+([a-z_]\w*)/i)?.[1] ?? null,
          columns: localColumns.split(',').filter(Boolean).map(x => x.trim()),
          target: fk[2].toLowerCase(), targetColumns: fk[3].split(',').map(x => x.trim())
        });
      }
      if (!/^\s*(?:constraint|primary\s+key|foreign\s+key|unique|check|exclude)\b/i.test(definition)) {
        const column = definition.match(/^\s*("?[\w$]+"?)/);
        if (column) columns.push({ name: column[1].replace(/"/g, ''), declaration: definition.replace(/\s+/g, ' ').trim() });
      }
    }
    tables.push({ name, columns });
  }
  const alterForeignKeys = matches(sql,
    /\balter\s+table\s+((?:[a-z_]\w*\.)?[a-z_]\w*)[\s\S]{0,300}?\badd\s+constraint\s+([a-z_]\w*)\s+foreign\s+key\s*\(([^)]+)\)\s+references\s+((?:[a-z_]\w*\.)?[a-z_]\w*)\s*\(([^)]+)\)/gi,
    m => ({ source: m[1].toLowerCase(), constraint: m[2], columns: m[3].split(',').map(x => x.trim()), target: m[4].toLowerCase(), targetColumns: m[5].split(',').map(x => x.trim()) }));
  foreignKeys.push(...alterForeignKeys);
  return { tables, foreignKeys };
}

function inspect(file) {
  const sql = stripComments(file.sql);
  const sha256 = createHash('sha256').update(file.sql, 'utf8').digest('hex');
  const tableDetails = extractTableDetails(sql);
  const createdTables = tableDetails.tables.map(table => table.name);
  const alteredTables = matches(sql, /\balter\s+table\s+(?:if\s+exists\s+)?((?:[a-z_]\w*\.)?[a-z_]\w*)/gi, m => m[1].toLowerCase());
  const functions = matches(sql, /\bcreate\s+(?:or\s+replace\s+)?function\s+((?:[a-z_]\w*\.)?[a-z_]\w*)\s*\(([\s\S]*?)\)\s*returns\b/gi,
    m => ({ name: m[1].toLowerCase(), signature: m[2].replace(/\s+/g, ' ').trim() }));
  const sequences = matches(sql, /\bcreate\s+sequence\s+(?:if\s+not\s+exists\s+)?((?:[a-z_]\w*\.)?[a-z_]\w*)/gi, m => m[1].toLowerCase());
  const indexes = matches(sql, /\bcreate\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([a-z_]\w*)\s+on\s+((?:[a-z_]\w*\.)?[a-z_]\w*)/gi, m => ({ name: m[1].toLowerCase(), table: m[2].toLowerCase() }));
  const triggers = matches(sql, /\bcreate\s+trigger\s+([a-z_]\w*)[\s\S]*?\bon\s+((?:[a-z_]\w*\.)?[a-z_]\w*)/gi, m => ({ name: m[1].toLowerCase(), table: m[2].toLowerCase() }));
  const policyDetails = matches(sql, /\bcreate\s+policy\s+"?([^"\r\n]+?)"?\s+on\s+((?:[a-z_]\w*\.)?[a-z_]\w*)\b([\s\S]*?);/gi, m => {
    const statement = m[3].replace(/\s+/g, ' ').trim();
    const direct = /\bapp_private\.is_active_member\s*\(/i.test(statement);
    const indirect = /\bapp_private\.(?:is_conversation_member|can_manage_conversation|is_team_admin)\s*\(/i.test(statement);
    const denyAll = /\busing\s*\(\s*false\s*\)/i.test(statement) || /\bwith\s+check\s*\(\s*false\s*\)/i.test(statement);
    const selfScoped = /\bauth\.uid\s*\(\s*\)/i.test(statement) || /\bowner_id\s*=/i.test(statement) || /\buser_id\s*=/i.test(statement);
    return { name: m[1].trim(), table: m[2].toLowerCase(), statement, guardClass: denyAll ? 'DENY_ALL' : direct ? 'DIRECT_ACTIVE_MEMBER' : indirect ? 'INDIRECT_ACTIVE_MEMBER' : selfScoped ? 'SELF_SCOPE_ONLY' : 'NO_RECOGNIZED_GUARD' };
  });
  const policies = policyDetails.map(({ name, table }) => ({ name, table }));
  const constraints = matches(sql, /\badd\s+constraint\s+([a-z_]\w*)/gi, m => m[1].toLowerCase());
  const relationsReferenced = [...new Set(matches(sql, /\b(?:from|join|update|into|references)\s+((?:public|app_private|auth|storage|cron|extensions)\s*\.\s*[a-z_]\w*)/gi, m => m[1].replace(/\s+/g, '').toLowerCase()))].sort();
  const internalFunctionsReferenced = [...new Set([...sql.matchAll(/\bapp_private\s*\.\s*([a-z_]\w*)\s*\(/gi)]
    .filter(m => !/\b(?:into|from|join|update|references|table)\s*$/i.test(sql.slice(Math.max(0, m.index - 32), m.index)))
    .map(m => m[1].toLowerCase()))].sort();
  const extensionCreates = matches(sql, /\bcreate\s+extension\s+(?:if\s+not\s+exists\s+)?(?:with\s+schema\s+([a-z_]\w*)\s+)?([a-z_]\w*)/gi, m => ({ name: m[2].toLowerCase(), schema: m[1]?.toLowerCase() ?? null }));
  const storageBucketIds = matches(sql, /\binsert\s+into\s+storage\.buckets[\s\S]{0,300}?\bvalues\s*\(\s*'([^']+)'/gi, m => m[1]);
  const publicationTables = matches(sql, /\balter\s+publication\s+supabase_realtime\s+add\s+table\s+((?:public|app_private)\.[a-z_]\w*)/gi, m => m[1].toLowerCase());
  const legacyMessagesReferences = matches(sql, /\bpublic\s*\.\s*messages\b/gi, m => m[0].replace(/\s+/g, ''));
  const hardcodedEmails = matches(sql, /'([^']+@[^']+)'/gi, m => m[1]);
  const hardcodedUuids = matches(sql, /'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/gi, m => m[1].toLowerCase());
  const hardcodedMembershipNumbers = matches(sql, /'(971[0-9]{9})'/gi, m => m[1]);
  const cronUsage = /\b(?:cron\.schedule|cron\.unschedule|create\s+extension\s+(?:if\s+not\s+exists\s+)?pg_cron)\b/i.test(sql);
  const grants = matches(sql, /\b(grant|revoke)\s+([^;]+?)\s+on\s+(?:table\s+)?((?:public|app_private|auth|storage|cron|extensions)\.[a-z_]\w*)\s+(to|from)\s+([^;]+);/gi, m => ({ action: m[1].toUpperCase(), privileges: m[2].replace(/\s+/g, ' ').trim(), object: m[3].toLowerCase(), direction: m[4].toUpperCase(), roles: m[5].replace(/\s+/g, ' ').trim() }));
  const syntaxHazards = matches(sql, /\$(?:function|body)?\$\s*\r?\n\s*(?:revoke|grant|create|alter|drop)\b/gi, m => ({ line: sql.slice(0, m.index).split('\n').length }));
  const sourceTimestamp = file.path.split('/').at(-1).match(/^(\d{8,14})/)?.[1] ?? null;
  const migrationTimestamp = file.kind === 'migration' ? sourceTimestamp : null;
  return { path: file.path, kind: file.kind, bytes: file.bytes, sha256, migrationTimestamp,
    createdTables: [...new Set(createdTables)].sort(), tableDetails: tableDetails.tables, foreignKeys: tableDetails.foreignKeys, alteredTables: [...new Set(alteredTables)].sort(), sourceTimestamp,
    functions, sequences: [...new Set(sequences)].sort(), indexes, triggers, policies, policyDetails,
    constraints: [...new Set(constraints)].sort(), grants, relationsReferenced, internalFunctionsReferenced,
    extensionCreates, storageBucketIds, publicationTables: [...new Set(publicationTables)].sort(), legacyMessagesReferences, hardcodedEmails, hardcodedUuids, hardcodedMembershipNumbers, cronUsage, syntaxHazards };
}

export async function buildObjectInventory(root = ROOT) {
  const [migrations, historical] = await Promise.all([
    walkSql(root, 'supabase/migrations', 'migration'), walkSql(root, 'database/changes', 'historical_change')
  ]);
  const files = [...migrations, ...historical].map(inspect).sort((a, b) => a.path.localeCompare(b.path));
  const definitions = new Set(files.flatMap(file => file.functions.map(fn => fn.name)));
  const referenced = new Set(files.flatMap(file => file.internalFunctionsReferenced.map(name => 'app_private.' + name)));
  const relationDefinitions = new Set(files.flatMap(file => [...file.createdTables, ...file.alteredTables]));
  const unresolvedInternalFunctions = [...referenced].filter(name => !definitions.has(name) && !relationDefinitions.has(name)).sort();
  const hashGroups = new Map();
  for (const file of files) { const list = hashGroups.get(file.sha256) ?? []; list.push(file.path); hashGroups.set(file.sha256, list); }
  const duplicateGroups = [...hashGroups.entries()].filter(([, paths]) => paths.length > 1)
    .map(([sha256, paths]) => ({ sha256, paths: paths.sort() })).sort((a, b) => a.paths[0].localeCompare(b.paths[0]));
  const appHtml = await readFile(path.join(root, 'index.html'), 'utf8').catch(() => '');
  const membershipJs = await readFile(path.join(root, 'membership.js'), 'utf8').catch(() => '');
  const clientRpcNames = [...new Set(matches(appHtml, /\.rpc\(\s*['"]([a-z_]\w*)['"]/gi, m => m[1]))].sort();
  const publicFunctionNames = new Set(files.flatMap(file => file.functions.filter(fn => fn.name.startsWith('public.')).map(fn => fn.name.slice(7))));
  const missingClientRpcs = clientRpcNames.filter(name => !publicFunctionNames.has(name));
  const finalPath = 'supabase/migrations/20261108075913_unify_forever_membership_number_format.sql';
  const officialPath = 'database/changes/20261107152550_official_forever_membership_numbers_manual_verification.sql';
  const finalSql = await readFile(path.join(root, finalPath), 'utf8').catch(() => '');
  const officialSql = await readFile(path.join(root, officialPath), 'utf8').catch(() => '');
  const finalTargets = matches(finalSql, /p\.proname\s+in\s*\(([\s\S]*?)\)/gi, m => m[1].match(/'([^']+)'/g)?.map(x => x.slice(1, -1)) ?? []).flat();
  const frontendRequires971Nine = /\^971\[0-9\]\{9\}\$/.test(membershipJs) && /\^971\[0-9\]\{9\}\$/.test(appHtml);
  const officialInviteStillLegacy = /\^971001\[0-9\]\{6\}\$/.test(officialSql);
  const finalCoversInviteImplementations = finalTargets.includes('admin_create_official_member_invites_impl') && finalTargets.includes('admin_set_member_official_number_impl');
  const membershipBaseTimestamp = 20261107144109;
  const policiesAfterMembershipBase = files.filter(file => file.sourceTimestamp && Number(file.sourceTimestamp) > membershipBaseTimestamp).flatMap(file => file.policyDetails.map(policy => ({ path: file.path, ...policy })));
  const laterPoliciesMissingActiveMemberGuard = policiesAfterMembershipBase.filter(policy => !['DIRECT_ACTIVE_MEMBER', 'INDIRECT_ACTIVE_MEMBER', 'DENY_ALL'].includes(policy.guardClass));
  const clientStorageBuckets = [...new Set(matches(appHtml, /storage\.from\(\s*['"]([^'"]+)['"]/gi, m => m[1]))].sort();
  const declaredStorageBuckets = [...new Set(files.flatMap(file => file.storageBucketIds))].sort();
  const storageObjectPolicyBuckets = [...new Set(files.flatMap(file => file.policyDetails.filter(policy => policy.table === 'storage.objects').flatMap(policy => matches(policy.statement, /bucket_id\s*=\s*['"]([^'"]+)['"]/gi, m => m[1]))) )].sort();
  const storageCoverage = {
    clientBuckets: clientStorageBuckets,
    declaredBucketIds: declaredStorageBuckets,
    missingBucketDeclarations: clientStorageBuckets.filter(bucket => !declaredStorageBuckets.includes(bucket)),
    storageObjectPolicyBuckets,
    clientBucketsWithoutStoragePolicies: clientStorageBuckets.filter(bucket => !storageObjectPolicyBuckets.includes(bucket))
  };
  const hardcodedIdentityReview = {
    emailLiteralFiles: files.filter(file => file.hardcodedEmails.length > 0).map(file => file.path),
    uuidLiteralFiles: files.filter(file => file.hardcodedUuids.length > 0).map(file => file.path),
    membershipNumberLiteralFiles: files.filter(file => file.hardcodedMembershipNumbers.length > 0).map(file => file.path)
  };
  const platformDependencies = {
    authSchema: files.some(file => file.relationsReferenced.some(name => name.startsWith('auth.'))),
    storageSchema: files.some(file => file.relationsReferenced.some(name => name.startsWith('storage.')) || file.storageBucketIds.length),
    realtimePublication: files.some(file => file.publicationTables.length),
    pgcrypto: files.some(file => file.extensionCreates.some(ext => ext.name === 'pgcrypto')) || files.some(file => file.relationsReferenced.some(name => name.startsWith('extensions.'))),
    pgCron: files.some(file => file.cronUsage)
  };
  return {
    schemaVersion: 1, auditMode: 'READ_ONLY_SOURCE_INVENTORY',
    scope: 'Repository SQL definitions and references only; not a live deployed database catalog.',
    sourceCounts: { migrations: migrations.length, historicalSql: historical.length, totalSqlFiles: files.length },
    inventoryTotals: {
      createdTables: files.reduce((n, f) => n + f.createdTables.length, 0),
      columns: files.reduce((n, f) => n + f.tableDetails.reduce((count, table) => count + table.columns.length, 0), 0),
      foreignKeys: files.reduce((n, f) => n + f.foreignKeys.length, 0),
      grantStatements: files.reduce((n, f) => n + f.grants.length, 0),
      alteredTableStatements: files.reduce((n, f) => n + f.alteredTables.length, 0),
      functionDefinitions: files.reduce((n, f) => n + f.functions.length, 0),
      sequences: files.reduce((n, f) => n + f.sequences.length, 0),
      indexes: files.reduce((n, f) => n + f.indexes.length, 0),
      triggers: files.reduce((n, f) => n + f.triggers.length, 0),
      policies: files.reduce((n, f) => n + f.policies.length, 0),
      policiesAfterMembershipBase: files.filter(f => f.sourceTimestamp && Number(f.sourceTimestamp) > 20261107144109).reduce((n, f) => n + f.policyDetails.length, 0),
      constraints: files.reduce((n, f) => n + f.constraints.length, 0)
    },
    platformDependencies,
    legacyMessages: {
      referencedByMigrations: files.filter(f => f.kind === 'migration' && f.legacyMessagesReferences.length > 0).map(f => f.path),
      tableDefinitionFoundInRepositorySql: files.some(f => f.createdTables.includes('public.messages')),
      currentClientUsesLegacyMessagesTable: /\.from\(\s*['"]messages['"]\s*\)/i.test(appHtml)
    },
    unresolvedInternalFunctions, missingClientRpcs,
    membershipFormatReview: {
      frontendRequires971PlusNineDigits: frontendRequires971Nine,
      officialInviteSourceStillContains971001PlusSixDigits: officialInviteStillLegacy,
      finalMigrationFunctionTargets: finalTargets,
      finalMigrationAlsoUpdatesOfficialInviteAndAdminSetImplementations: finalCoversInviteImplementations,
      status: frontendRequires971Nine && officialInviteStillLegacy && finalCoversInviteImplementations && finalTargets.length === 6 ? 'SEQUENCED_FORMAT_TRANSITION' : 'REVIEW_REQUIRED'
    },
    duplicateGroups,
    policyCoverage: { membershipRewriteSource: 'database/changes/20261107144109_private_membership_system_20261107.sql', policiesAfterMembershipBase, laterPoliciesMissingActiveMemberGuard },
    storageCoverage,
    hardcodedIdentityReview,
    syntaxHazards: files.flatMap(f => f.syntaxHazards.map(item => ({ path: f.path, ...item }))),
    files
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await buildObjectInventory(), null, 2)); }
  catch (error) { console.error('OBJECT_INVENTORY_FAILED:', error.message); process.exitCode = 1; }
}
