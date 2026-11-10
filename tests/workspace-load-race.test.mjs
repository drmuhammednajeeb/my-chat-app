import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `missing function: ${name}`);
  assert.notEqual(end, -1, `missing next function boundary: ${nextName}`);
  return source.slice(start, end);
}

test('workspace loader accepts only the active conversation and current request generation', () => {
  const guard = extractFunction('isCurrentWorkspaceLoad', 'loadPrivateConversationNotes');
  assert.match(guard, /state\\.active\\?\\.id===id/);
  assert.match(guard, /requestId===state\\.workspaceLoadVersion/);
  assert.match(guard, /classList\\.contains\\('open'\\)/);
});

test('notes and documents loaders reject stale results after awaiting Supabase', () => {
  const notes = extractFunction('loadPrivateConversationNotes', 'savePrivateConversationNote');
  const documents = extractFunction('loadConversationDocuments', 'sanitizeStorageFileName');
  for (const [name, body] of [['notes', notes], ['documents', documents]]) {
    assert.match(body, /if\\(!isCurrentWorkspaceLoad\\(id,requestId\\)\\)return false;/, `${name}: preflight guard`);
    assert.match(body, /await supabaseClient\\.from/);
    assert.equal((body.match(/if\\(!isCurrentWorkspaceLoad\\(id,requestId\\)\\)return false;/g) || []).length, 2, `${name}: guards before and after await`);
  }
});

test('opening and closing the workspace invalidates older requests', () => {
  const open = extractFunction('openConversationWorkspace', 'renderWorkspaceLabels');
  const close = extractFunction('closeConversationWorkspace', 'renderWorkspaceCategoryButtons');
  assert.match(open, /workspaceLoadVersion=.*\\+1/);
  assert.match(open, /loadPrivateConversationNotes\\(c\\.id,requestId\\)/);
  assert.match(open, /loadConversationDocuments\\(c\\.id,requestId\\)/);
  assert.match(open, /if\\(!isCurrentWorkspaceLoad\\(c\\.id,requestId\\)\\)return/);
  assert.match(close, /workspaceLoadVersion=.*\\+1/);
});

test('switching conversations closes and invalidates the old workspace', () => {
  const start = source.indexOf('async function openConversation(c)');
  const end = source.indexOf('async function loadMessageReactions', start);
  const openConversation = source.slice(start, end);
  assert.match(openConversation, /closeConversationWorkspace\\(\\)/);
});

test('SQL audit workflow uses an interpolated branch-specific concurrency group', () => {
  const workflow = readFileSync(new URL('../.github/workflows/local-supabase-sql-audit.yml', import.meta.url), 'utf8');
  assert.match(workflow, /group: local-sql-audit-\\$\\{\\{ github\\.ref \\}\\}/);
  assert.doesNotMatch(workflow, /group: local-sql-audit-\\\\\\$\\{\\{/);
});
