import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const modulePaths = ["js/00-bootstrap.js","js/10-conversations.js","js/20-message-interactions.js","js/30-receipts-rendering.js","js/40-message-runtime.js","js/50-group-management.js","js/60-personal-chat-settings.js","js/70-workspace.js"];
const moduleSources = await Promise.all(modulePaths.map(path => readFile(new URL('../' + path, import.meta.url), 'utf8')));
// Keep this order aligned with the classic script tags in index.html.
const moduleSource = moduleSources.join('\n');
const source = moduleSource + '\n' + indexSource;
const overrides = await readFile(new URL('../app-overrides.css', import.meta.url), 'utf8');

function extractFunction(name) {
  const pattern = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const match = pattern.exec(source);
  assert.ok(match, 'Function not found: ' + name);
  const start = match.index;
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i], next = source[i + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('Unbalanced function body: ' + name);
}

test('all six message reactions are rendered and the message menu is reachable without hover', () => {
  const start = source.indexOf('const MESSAGE_REACTION_OPTIONS=');
  const end = source.indexOf('function renderReactionBar(', start);
  assert.ok(start >= 0 && end > start);
  const options = source.slice(start, end);
  assert.equal((options.match(/type:'/g) || []).length, 6);
  assert.match(source, /renderReactionBar\(row,m\)/);
  assert.match(overrides, /\.message-menu-trigger\{opacity:1;pointer-events:auto\}/);
});

test('stickers are sent through the existing message pipeline and rendered as validated sticker content', () => {
  assert.match(source, /id="stickerBtn"/);
  assert.match(source, /\$\('stickerBtn'\)\.onclick=openChatStickerPicker/);
  assert.match(source, /function encodeChatSticker\(emoji\)/);
  assert.match(source, /function decodeChatSticker\(content\)/);
  assert.match(source, /CHAT_STICKERS\.includes\(emoji\)/);
  assert.match(source, /const sticker=decodeChatSticker\(m\.content\)/);
  assert.match(source, /\$\('messageInput'\)\.value=encodeChatSticker\(emoji\);sendMessage\(\)/);
});

test('voice send button dispatches stop-and-send while recording', () => {
  assert.match(source, /\$\('sendBtn'\)\.onclick=\(\)=>state\.voiceRecorder\?sendVoiceRecording\(\):sendMessage\(\)/);
  assert.match(source, /function sendVoiceRecording\(\)[\s\S]*?state\.voiceSendOnStop=true/);
  assert.match(source, /if\(shouldSend\)\{setTimeout\(\(\)=>\{if\(state\.attachment===file\)sendMessage\(\)\},0\)\}/);
  assert.match(source, /\$\('sendBtn'\)\.setAttribute\('aria-label','إرسال التسجيل الصوتي'\)/);
});

test('chat timeline rows cannot flex-shrink or rely on browser scroll anchoring', () => {
  assert.match(overrides, /#chat \.messages\{overflow-anchor:none\}/);
  assert.match(overrides, /#chat \.messages>\.message,[\s\S]*?#chat \.messages>\.messages-history-loader\{flex:0 0 auto\}/);
});

test('all ordered classic JavaScript modules parse independently and as one shared global program', () => {
  moduleSources.forEach((module, index) => {
    new vm.Script(module, { filename: modulePaths[index] });
  });
  new vm.Script(moduleSource, { filename: 'combined-classic-app.js' });
  const inlineBlocks = [...indexSource.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/.test(match[1]) && match[2].trim());
  inlineBlocks.forEach((match, index) => {
    new vm.Script(match[2], { filename: 'inline-bootstrap-' + index + '.js' });
  });
  const externalPaths = [...indexSource.matchAll(/<script\b[^>]*src=["']([^"']+\.js)["']/gi)].map(match => match[1]);
  assert.deepEqual(externalPaths.filter(path => path.startsWith('./js/')), modulePaths.map(path => './' + path));
});

test('chronological comparator orders timestamps then stable IDs', () => {
  const compare = vm.runInNewContext('(' + extractFunction('compareMessagesChronologically') + ')');
  assert.ok(compare({ created_at: '2026-11-09T10:00:00Z', id: 'a' }, { created_at: '2026-11-09T10:00:00Z', id: 'b' }) < 0);
  assert.ok(compare({ created_at: '2026-11-09T10:00:01Z', id: 'a' }, { created_at: '2026-11-09T10:00:00Z', id: 'z' }) > 0);
});

test('message renderer serializes same-ID work and retries with the newest row', async () => {
  const state = { active: { id: 'c1' }, messageLoadVersion: 7, messages: [], messageIds: new Set(), messageRenderPromises: new Map() };
  let releaseFirst;
  const gate = new Promise(resolve => { releaseFirst = resolve; });
  const calls = [];
  const renderMessageInternal = async message => {
    calls.push(message.version);
    if (calls.length === 1) { await gate; return false; }
    state.messageIds.add(message.id);
    return true;
  };
  const renderMessage = vm.runInNewContext('(' + extractFunction('renderMessage') + ')', { state, renderMessageInternal });
  const oldRow = { id: 'm1', version: 'old' }, newRow = { id: 'm1', version: 'new' };
  state.messages = [oldRow];
  const first = renderMessage(oldRow, 'c1', 7);
  await Promise.resolve();
  state.messages = [newRow];
  const second = renderMessage(oldRow, 'c1', 7);
  releaseFirst();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.deepEqual(calls, ['old', 'new']);
  assert.equal(state.messageIds.has('m1'), true);
  assert.equal(state.messageRenderPromises.size, 0);
});

test('renderer never retries a message after it has been removed from the active conversation', async () => {
  const state = { active: { id: 'c1' }, messageLoadVersion: 4, messages: [], messageIds: new Set(), messageRenderPromises: new Map() };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const renderMessageInternal = async () => { calls += 1; await gate; return false; };
  const renderMessage = vm.runInNewContext('(' + extractFunction('renderMessage') + ')', { state, renderMessageInternal });
  const pending = renderMessage({ id: 'deleted-1' }, 'c1', 4);
  await Promise.resolve();
  state.messages = [];
  release();
  assert.equal(await pending, false);
  assert.equal(calls, 1);
  assert.equal(state.messageRenderPromises.size, 0);
});

test('timeline reconciler sorts concurrent rows and keeps one day divider per date', () => {
  const makeNode = (kind, day, createdAt, id) => ({
    classList: { contains: name => name === kind },
    dataset: { day, createdAt, messageId: id },
    textContent: day,
  });
  const area = {
    children: [
      makeNode('message', 'Tue', '2026-11-10T10:02:00Z', 'm2'),
      makeNode('day-divider', 'Tue', '', ''),
      makeNode('message', 'Tue', '2026-11-10T10:01:00Z', 'm1'),
      makeNode('day-divider', 'Tue', '', ''),
    ],
    querySelectorAll(selector) { assert.equal(selector, ':scope > .message'); return this.children.filter(node => node.classList.contains('message')); },
    replaceChildren(...nodes) { this.children = nodes; }
  };
  const document = { createElement: () => ({ classList: { contains: name => name === 'day-divider' }, dataset: {}, textContent: '' }) };
  const reconcile = vm.runInNewContext('(' + extractFunction('reconcileMessageTimeline') + ')', { document, Date, String, Array });
  reconcile(area);
  const ids = area.children.filter(node => node.classList.contains('message')).map(node => node.dataset.messageId);
  const dividers = area.children.filter(node => node.classList.contains('day-divider'));
  assert.deepEqual(ids, ['m1', 'm2']);
  assert.equal(dividers.length, 1);
});

test('hard-delete realtime handler removes the row and all local message indexes', () => {
  let removed = false;
  const row = { dataset: { messageId: 'm1' }, remove() { removed = true; } };
  const area = {};
  const state = {
    active: { id: 'c1' },
    messages: [{ id: 'm1', conversation_id: 'c1' }, { id: 'm2', conversation_id: 'c1' }],
    messageIds: new Set(['m1', 'm2']),
    reactions: new Map([['m1', []]]),
    pinnedMessages: new Map([['m1', {}]]),
    replyMessages: new Map([['m1', {}]]),
    conversations: []
  };
  const document = { querySelectorAll: selector => selector === '.message' ? [row] : [] };
  const handler = vm.runInNewContext('(' + extractFunction('handleMessageDeleteRealtime') + ')', {
    state, document, $: () => area, reconcileMessageTimeline: () => {}
  });
  assert.equal(handler({ old: { id: 'm1' } }, 'c1'), true);
  assert.deepEqual(state.messages.map(message => message.id), ['m2']);
  assert.equal(state.messageIds.has('m1'), false);
  assert.equal(state.reactions.has('m1'), false);
  assert.equal(state.pinnedMessages.has('m1'), false);
  assert.equal(state.replyMessages.has('m1'), false);
  assert.equal(removed, true);
});

test('conversation subscription listens for hard deletes and soft-delete rendering is local', () => {
  const subscribe = extractFunction('subscribeConversation');
  const update = extractFunction('handleMessageUpdateRealtime');
  assert.match(subscribe, /event:'DELETE',schema:'public',table:'chat_messages'/);
  assert.match(subscribe, /handleMessageDeleteRealtime\(p,id\)/);
  assert.match(subscribe, /channelHasSubscribed&&s==='SUBSCRIBED'/);
  assert.match(subscribe, /reconnected&&state\.active\?\.id===id\)loadMessages\(\)/);
  assert.match(update, /renderMessage\(incoming,conversationId,state\.messageLoadVersion\)/);
  assert.doesNotMatch(update, /Deleted message refresh failed/);
});

test('hard-deleting the final message restores the empty-conversation state', () => {
  const state = {
    active: { id: 'c1' }, messages: [{ id: 'm1', conversation_id: 'c1' }],
    messageIds: new Set(['m1']), reactions: new Map(), pinnedMessages: new Map(),
    replyMessages: new Map(), conversations: []
  };
  const area = { innerHTML: '' };
  const handler = vm.runInNewContext('(' + extractFunction('handleMessageDeleteRealtime') + ')', {
    state, document: { querySelectorAll: () => [] }, $: () => area,
    reconcileMessageTimeline() {}
  });
  assert.equal(handler({ old: { id: 'm1' } }, 'c1'), true);
  assert.equal(state.messages.length, 0);
  assert.match(area.innerHTML, /بداية محادثة جديدة/);
});

test('duplicate soft-delete events do not repeatedly replace the tombstone row', () => {
  const deletedAt = '2026-11-10T10:00:00.000Z';
  const row = { dataset: { messageId: 'm1' }, querySelector: selector => selector === '.bubble.deleted' ? {} : null };
  const state = {
    active: { id: 'c1' },
    messages: [{ id: 'm1', conversation_id: 'c1', deleted_at: deletedAt }],
    messageIds: new Set(['m1'])
  };
  let renders = 0;
  const handler = vm.runInNewContext('(' + extractFunction('handleMessageUpdateRealtime') + ')', {
    state, document: { querySelectorAll: () => [row] },
    renderMessage: () => { renders += 1; }, console
  });
  handler({ new: { id: 'm1', conversation_id: 'c1', deleted_at: deletedAt } }, 'c1');
  assert.equal(renders, 0);
  assert.equal(state.messageIds.has('m1'), true);
});

test('delete action uses the returned database row and avoids a competing full reload', () => {
  const remove = extractFunction('deleteMessage');
  assert.match(remove, /\.select\('\*'\)\.single\(\)/);
  assert.match(remove, /handleMessageUpdateRealtime\(\{new:data\},data\.conversation_id\)/);
  assert.doesNotMatch(remove, /loadMessages\(\)/);
});

test('initial message snapshot removes stale rows inside its authoritative window', () => {
  const load = extractFunction('loadMessages');
  assert.match(load, /fetchedIds=new Set\(fetchedRows\.map\(m=>m\.id\)\)/);
  assert.match(load, /isOlderHistory=fetchedRows\.length===50/);
  assert.match(load, /afterPersonalClear=!state\.activeChatPreference\?\.cleared_before/);
  assert.match(load, /if\(afterPersonalClear&&\(fetchedIds\.has\(m\.id\)\|\|isNewerRealtime\|\|isOlderHistory\|\|arrivedDuringEmptyFetch\)\)/);
});

test('renderer rejects an obsolete request token before starting work', async () => {
  const state = { active: { id: 'c1' }, messageLoadVersion: 9, messages: [], messageIds: new Set(), messageRenderPromises: new Map() };
  let calls = 0;
  const renderMessage = vm.runInNewContext('(' + extractFunction('renderMessage') + ')', { state, renderMessageInternal: async () => { calls += 1; return true; } });
  assert.equal(await renderMessage({ id: 'm1' }, 'c1', 8), false);
  assert.equal(calls, 0);
});

test('poll cadence preserves connected, disconnected and background intervals', () => {
  const state = { realtimeStatus: 'SUBSCRIBED' }, document = { visibilityState: 'visible' };
  const delay = vm.runInNewContext('(' + extractFunction('messagePollingDelay') + ')', { state, document });
  assert.equal(delay(), 30000);
  state.realtimeStatus = 'CHANNEL_ERROR';
  assert.equal(delay(), 8000);
  document.visibilityState = 'hidden';
  assert.equal(delay(), 60000);
});

test('receipt writes are serialized per conversation in one client session', async () => {
  const updates = [], resolvers = [];
  const supabaseClient = {
    from() {
      return { update(patch) {
        updates.push(patch);
        return { eq() { return { eq() { return new Promise(resolve => resolvers.push(resolve)); } }; } };
      } };
    }
  };
  const state = { user: { id: 'u1' }, active: { id: 'c1', members: [] }, messageLoadVersion: 3, memberReads: {}, conversations: [], messages: [] };
  const document = { querySelectorAll: () => [] };
  const receipt = vm.runInNewContext('(' + extractFunction('markConversationReceipt') + ')', {
    state, supabaseClient, document, renderConversations() {}, renderMessageStatus() {}, console
  });
  const first = receipt('c1', false, 3);
  await new Promise(resolve => setImmediate(resolve));
  const second = receipt('c1', true, 3);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates.length, 1);
  resolvers[0]({ error: null });
  assert.equal(await first, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates.length, 2);
  assert.ok('last_read_at' in updates[1]);
  resolvers[1]({ error: null });
  assert.equal(await second, true);
  assert.equal(state.receiptQueues.size, 0);
});

test('render and initial-load paths retain stale-result guards', () => {
  const render = extractFunction('renderMessageInternal'), load = extractFunction('loadMessages');
  assert.match(render, /if\(!isCurrent\(\)\)return false/);
  assert.match(render, /createSignedUrl\(m\.attachment_path,3600\)/);
  assert.match(load, /if\(requestId!==state\.messageLoadVersion\|\|state\.active\?\.id!==conversationId\)return false/);
  assert.ok(load.includes('state.messagePollCursor=(data||[])[0]?'));
  assert.match(load, /allMessagesRendered/);
});

test('fallback synchronization is cursor-based and reconciles edits and deletions', () => {
  const poll = extractFunction('pollMessagesFallback');
  assert.match(poll, /messagePollCursor/);
  assert.match(poll, /and\(created_at\.eq\./);
  assert.match(poll, /id\.gt\./);
  assert.match(poll, /edited_at\.gt\./);
  assert.match(poll, /deleted_at\.gt\./);
  assert.match(poll, /limit\(200\)/);
  assert.match(poll, /messageRequestId!==state\.messageLoadVersion/);
});

test('send attempts reuse a stable message ID and uploaded attachment on retry', () => {
  const send = extractFunction('sendMessage');
  assert.match(send, /pendingMessageSends/);
  assert.match(send, /id:crypto\.randomUUID\(\)/);
  assert.match(send, /insert\(\{id:pendingSend\.id/);
  assert.match(send, /eq\('id',pendingSend\.id\)/);
  assert.match(send, /pendingSend\?\.attachmentPath/);
  assert.match(send, /Number\(verified\.edit_revision\|\|0\)<=expectedRevision/);
  assert.match(send, /finally\{state\.uploading=false;resizeComposer\(\)\}/);
});

test('group-only-admin restrictions survive composer, polling and voice entry points', () => {
  assert.match(extractFunction('resizeComposer'), /groupBlocked/);
  assert.match(extractFunction('pollMessagesFallback'), /groupReadOnly/);
  assert.match(extractFunction('startVoiceRecording'), /only_admins_can_send/);
});


test('late reaction failures cannot mutate the next conversation state', async () => {
  const state = {
    user: { id: 'u1' }, active: { id: 'c1' }, messageLoadVersion: 1,
    reactions: new Map(), messages: []
  };
  let finishUpsert;
  const supabaseClient = {
    from(table) {
      assert.equal(table, 'message_reactions');
      return { upsert: () => new Promise(resolve => { finishUpsert = resolve; }) };
    }
  };
  const toggle = vm.runInNewContext('(' + extractFunction('toggleMessageReaction') + ')', {
    state, supabaseClient, pendingReactionKeys: new Set(),
    document: { querySelectorAll: () => [] }, renderReactionBar() {},
    toast() {}, console
  });
  const pending = toggle({ id: 'm1', conversation_id: 'c1' }, 'heart', null);
  assert.equal(state.reactions.has('m1'), true);
  state.active = { id: 'c2' };
  state.messageLoadVersion = 2;
  state.reactions = new Map([['m2', []]]);
  finishUpsert({ error: { message: 'simulated network failure' } });
  await pending;
  assert.equal(state.reactions.has('m1'), false);
  assert.equal(state.reactions.has('m2'), true);
});

test('ambiguous reaction writes are verified against the authoritative row before rollback', async () => {
  const state = {
    user: { id: 'u1' }, active: { id: 'c1' }, messageLoadVersion: 1,
    reactions: new Map([['m1', []]]), messages: [{ id: 'm1', conversation_id: 'c1' }]
  };
  let finishWrite;
  const verified = { message_id: 'm1', conversation_id: 'c1', user_id: 'u1', reaction_type: 'heart' };
  const supabaseClient = {
    from(table) {
      assert.equal(table, 'message_reactions');
      return {
        upsert: () => new Promise(resolve => { finishWrite = resolve; }),
        select() {
          const query = { eq() { return query; }, async maybeSingle() { return { data: verified, error: null }; } };
          return query;
        }
      };
    }
  };
  const toggle = vm.runInNewContext('(' + extractFunction('toggleMessageReaction') + ')', {
    state, supabaseClient, document: { querySelectorAll: () => [] },
    renderReactionBar() {}, toast() {}, console
  });
  const pending = toggle({ id: 'm1', conversation_id: 'c1' }, 'heart', null);
  finishWrite({ error: { message: 'response lost after commit' } });
  assert.equal(await pending, true);
  assert.deepEqual(state.reactions.get('m1'), [verified]);
});

test('message stars persist, serialize, and verify ambiguous outcomes before changing local state', async () => {
  const state = {
    user: { id: 'u1' }, active: { id: 'c1' },
    messages: [{ id: 'm1', conversation_id: 'c1' }],
    starredMessageIds: new Set()
  };
  const calls = [];
  let fail = false, verifiedRow = null;
  const supabaseClient = {
    from(table) {
      assert.equal(table, 'user_message_stars');
      return {
        async upsert(row, options) {
          calls.push({ operation: 'upsert', row, options });
          return { error: fail ? { message: 'simulated network failure' } : null };
        },
        delete() {
          return { eq(key, value) {
            calls.push({ operation: 'delete-user', key, value });
            return { async eq(secondKey, secondValue) {
              calls.push({ operation: 'delete-message', key: secondKey, value: secondValue });
              return { error: fail ? { message: 'simulated network failure' } : null };
            } };
          } };
        },
        select() {
          const query = { eq() { return query; }, async maybeSingle() { return { data: verifiedRow, error: null }; } };
          return query;
        }
      };
    }
  };
  const notices = [];
  const toggle = vm.runInNewContext('(' + extractFunction('toggleMessageStar') + ')', {
    state, supabaseClient, toast: message => notices.push(message), console
  });
  assert.equal(await toggle('m1', true), true);
  assert.equal(state.starredMessageIds.has('m1'), true);
  assert.equal(calls[0].options.onConflict, 'user_id,message_id');
  assert.equal(await toggle('m1', false), true);
  assert.equal(state.starredMessageIds.has('m1'), false);

  fail = true;
  verifiedRow = { message_id: 'm1' };
  assert.equal(await toggle('m1', true), true);
  assert.equal(state.starredMessageIds.has('m1'), true);

  verifiedRow = null;
  assert.equal(await toggle('m1', true), false);
  assert.equal(state.starredMessageIds.has('m1'), false);
  assert.ok(notices.length > 0);
});

test('chat attachment MIME resolution handles browsers that omit file.type', () => {
  const resolve = vm.runInNewContext('(' + extractFunction('resolveChatAttachmentMime') + ')', {
    CHAT_ATTACHMENT_MIME_BY_EXTENSION: {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      mov: 'video/quicktime', webm: 'video/webm', txt: 'text/plain'
    }
  });
  assert.equal(resolve({ name: 'report.docx', type: '' }), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(resolve({ name: 'clip.mov', type: 'application/octet-stream' }), 'video/quicktime');
  assert.equal(resolve({ name: 'voice.webm', type: 'audio/webm;codecs=opus' }), 'audio/webm');
  assert.equal(resolve({ name: 'notes.txt', type: 'text/plain' }), 'text/plain');
});

test('chat attachment upload enforces non-empty bounded files and sends normalized MIME', () => {
  const upload = extractFunction('uploadAttachment');
  assert.match(upload, /file\.size<=0/);
  assert.match(upload, /12\*1024\*1024/);
  assert.match(upload, /CHAT_ATTACHMENT_ALLOWED_MIME_TYPES\.has\(type\)/);
  assert.match(upload, /contentType:type/);
});

test('document storage filename sanitizer removes path separators and unsafe characters', () => {
  const sanitize = vm.runInNewContext('(' + extractFunction('sanitizeStorageFileName') + ')');
  assert.equal(sanitize('../Report Q4.pdf'), '_Report_Q4.pdf');
  assert.equal(sanitize('   '), '_');
  assert.equal(sanitize('...'), 'attachment');
  assert.equal(sanitize('a'.repeat(140)).length, 120);
  assert.equal(sanitize('folder\\\\name.pdf').includes('/'), false);
  assert.equal(sanitize('folder\\\\name.pdf').includes('\\\\'), false);
});
