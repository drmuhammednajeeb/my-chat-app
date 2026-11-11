import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
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

test('all inline JavaScript blocks parse without a bundler', () => {
  const blocks = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/.test(match[1]) && match[2].trim());
  assert.ok(blocks.length > 0, 'Expected inline application scripts');
  blocks.forEach((match, index) => {
    new vm.Script(match[2], { filename: 'inline-script-' + index + '.js' });
  });
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

test('poll cadence prioritizes realtime and keeps a fast bounded fallback', () => {
  const state = { realtimeStatus: 'SUBSCRIBED' }, document = { visibilityState: 'visible' };
  const delay = vm.runInNewContext('(' + extractFunction('messagePollingDelay') + ')', { state, document });
  assert.equal(delay(), 15000);
  state.realtimeStatus = 'CHANNEL_ERROR';
  assert.equal(delay(), 1200);
  document.visibilityState = 'hidden';
  assert.equal(delay(), 60000);
});

test('realtime subscription state immediately reconciles messages on connect and failure', () => {
  const subscribe = extractFunction('subscribeConversation');
  assert.match(subscribe, /requestImmediateMessageReconciliation\(s==='SUBSCRIBED'\?'realtime-subscribed':'realtime-unavailable'\)/);
  assert.match(subscribe, /s==='CHANNEL_ERROR'\|\|s==='TIMED_OUT'/);
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

test('fallback synchronization uses a bounded overlap and reconciles edits and deletions', () => {
  const poll = extractFunction('pollMessagesFallback');
  assert.match(poll, /messagePollCursor/);
  assert.match(poll, /overlapStartedAt/);
  assert.match(poll, /Date\.parse\(pollStartedAt\)-5000/);
  assert.match(poll, /and\(created_at\.eq\./);
  assert.match(poll, /id\.gt\./);
  assert.match(poll, /edited_at\.gt\./);
  assert.match(poll, /deleted_at\.gt\./);
  assert.match(poll, /limit\(200\)/);
  assert.match(poll, /messageRequestId!==state\.messageLoadVersion/);
});

test('cross-device sync reconciles immediately when the page becomes active or online', () => {
  assert.match(source, /function requestImmediateMessageReconciliation\(reason='lifecycle'\)/);
  assert.match(source, /document\.visibilityState==='visible'\)requestImmediateMessageReconciliation\('visible'\)/);
  assert.match(source, /addEventListener\('online',\(\)=>requestImmediateMessageReconciliation\('online'\)\)/);
  assert.match(source, /addEventListener\('focus',\(\)=>requestImmediateMessageReconciliation\('focus'\)\)/);
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

test('message stars persist before updating local state and recover from backend failures', async () => {
  const state = {
    user: { id: 'u1' },
    messages: [{ id: 'm1', conversation_id: 'c1' }],
    starredMessageIds: new Set()
  };
  const calls = [];
  let fail = false;
  const supabaseClient = {
    from(table) {
      assert.equal(table, 'user_message_stars');
      return {
        async upsert(row, options) {
          calls.push({ operation: 'upsert', row, options });
          return { error: fail ? { message: 'denied' } : null };
        },
        delete() {
          return { eq(key, value) {
            calls.push({ operation: 'delete-user', key, value });
            return { async eq(secondKey, secondValue) {
              calls.push({ operation: 'delete-message', key: secondKey, value: secondValue });
              return { error: fail ? { message: 'denied' } : null };
            } };
          } };
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

test('recorded audio/webm is accepted by the upload MIME allowlist', async () => {
  const allowlistStart = source.indexOf('const CHAT_ATTACHMENT_ALLOWED_MIME_TYPES=');
  const allowlistEnd = source.indexOf(';', allowlistStart);
  assert.ok(allowlistStart >= 0 && allowlistEnd > allowlistStart, 'Expected the attachment MIME allowlist declaration');
  const allowlistExpression = source.slice(allowlistStart, allowlistEnd).split('=').slice(1).join('=');
  const allowed = vm.runInNewContext(allowlistExpression, {
    CHAT_ATTACHMENT_MIME_BY_EXTENSION: {
      jpg: 'image/jpeg', webm: 'video/webm', m4a: 'audio/mp4',
      mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', aac: 'audio/aac'
    }
  });
  assert.equal(allowed.has('audio/webm'), true);

  const uploaded = [];
  const uploadAttachment = vm.runInNewContext('(' + extractFunction('uploadAttachment') + ')', {
    state: { active: { id: 'conversation-1' }, user: { id: 'user-1' } },
    CHAT_ATTACHMENT_ALLOWED_MIME_TYPES: allowed,
    resolveChatAttachmentMime: file => String(file.type || '').split(';')[0].toLowerCase(),
    crypto: { randomUUID: () => 'voice-test-id' },
    supabaseClient: {
      storage: {
        from(bucket) {
          assert.equal(bucket, 'chat-media');
          return { async upload(path, file, options) {
            uploaded.push({ path, type: options.contentType, size: file.size });
            return { error: null };
          } };
        }
      }
    }
  });
  const result = await uploadAttachment({
    name: 'voice-test.webm', type: 'audio/webm;codecs=opus', size: 2048
  }, 'conversation-1', 'user-1');
  assert.equal(result.type, 'audio/webm');
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].type, 'audio/webm');
  assert.equal(uploaded[0].path, 'conversation-1/user-1/voice-test-id_voice-test.webm');
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


test('loadMessages completes for both empty and populated timelines without a render-scope ReferenceError', async () => {
  const loadSource = extractFunction('loadMessages');
  const runLoad = async rows => {
    const area = {
      innerHTML: '',
      scrollHeight: 0,
      scrollTop: 0,
      replaceChildren() { this.cleared = true; }
    };
    const state = {
      active: { id: 'c1', type: 'group', members: [] },
      activeChatPreference: null,
      messageLoadVersion: 0,
      messages: [],
      messageIds: new Set(),
      hasMoreMessages: false,
      newMessageCount: 0,
      messagePollLastCheckedAt: null,
      messagePollCursor: null,
      diagnostics: {},
      isLoadingMessages: false,
      reactions: new Map(),
      pinnedMessages: new Map(),
      replyMessages: new Map(),
      privateReplyContexts: new Map()
    };
    let receipts = 0;
    const queryFor = table => {
      const query = {
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        limit() { return query; },
        in() { return query; },
        then(resolve, reject) {
          return Promise.resolve({ data: table === 'chat_messages' ? rows : [], error: null }).then(resolve, reject);
        }
      };
      return query;
    };
    const supabaseClient = { from: table => queryFor(table) };
    const load = vm.runInNewContext('(' + loadSource + ')', {
      state,
      supabaseClient,
      $: id => id === 'messages' ? area : null,
      performance: { now: () => 1 },
      Date,
      Set,
      Map,
      Array,
      console: { error() {}, warn() {} },
      document: { visibilityState: 'visible' },
      updateNewMessagesIndicator() {},
      diagLog() {},
      recordPerf() {},
      compareMessagesChronologically(a, b) {
        const delta = Date.parse(a.created_at) - Date.parse(b.created_at);
        return delta || String(a.id).localeCompare(String(b.id));
      },
      loadMessageReactions: async () => false,
      loadMessagePins: async () => false,
      loadPrivateReplyContexts: async () => false,
      renderMessage: async message => {
        state.messageIds.add(message.id);
        return true;
      },
      markConversationReceipt: async () => { receipts += 1; return true; },
      toast() {}
    });
    const result = await load();
    return { result, state, area, receipts };
  };

  const empty = await runLoad([]);
  assert.equal(empty.result, true);
  assert.equal(empty.state.isLoadingMessages, false);
  assert.match(empty.area.innerHTML, /بداية محادثة جديدة/);
  assert.equal(empty.receipts, 1);

  const populated = await runLoad([
    {
      id: 'm2',
      conversation_id: 'c1',
      sender_id: 'u1',
      content: 'latest',
      created_at: '2026-11-11T06:01:00.000Z'
    },
    {
      id: 'm1',
      conversation_id: 'c1',
      sender_id: 'u1',
      content: 'older',
      created_at: '2026-11-11T06:00:00.000Z'
    }
  ]);
  assert.equal(populated.result, true);
  assert.equal(populated.state.isLoadingMessages, false);
  assert.equal(populated.state.messageIds.has('m2'), true);
  assert.equal(populated.state.messageIds.has('m1'), false);
  assert.equal(populated.state.hasMoreMessages, true);
  assert.equal(populated.receipts, 1);
});


test('optional pin metadata network failures do not reject the message timeline load', async () => {
  const state = {
    active: { id: 'c1' },
    messageLoadVersion: 5,
    messages: [],
    replyMessages: new Map(),
    pinnedMessages: new Map([['stale', {}]])
  };
  const query = {
    select() { return query; },
    eq() { return query; },
    order() { return query; },
    then(resolve, reject) {
      return Promise.reject(new Error('simulated network failure')).then(resolve, reject);
    }
  };
  let bannerRenders = 0;
  const loadPins = vm.runInNewContext('(' + extractFunction('loadMessagePins') + ')', {
    state,
    supabaseClient: { from: () => query },
    renderPinnedBanner() { bannerRenders += 1; },
    console: { warn() {} }
  });
  assert.equal(await loadPins('c1', 5), false);
  assert.equal(state.pinnedMessages.size, 0);
  assert.equal(bannerRenders, 1);
});

test('optional private-reply metadata network failures do not reject the message timeline load', async () => {
  const state = {
    active: { id: 'c1', type: 'direct' },
    messageLoadVersion: 8,
    privateReplyContexts: new Map([['stale', {}]])
  };
  const query = {
    select() { return query; },
    in() { return query; },
    then(resolve, reject) {
      return Promise.reject(new Error('simulated network failure')).then(resolve, reject);
    }
  };
  const loadContexts = vm.runInNewContext('(' + extractFunction('loadPrivateReplyContexts') + ')', {
    state,
    supabaseClient: { from: () => query },
    console: { warn() {} },
    Map
  });
  assert.equal(await loadContexts('c1', [{ id: 'm1' }], 8), false);
  assert.equal(state.privateReplyContexts.size, 0);
});


test('opening a conversation fetches only the newest message and defers older history to pagination', () => {
  const load = extractFunction('loadMessages');
  assert.match(load, /\.order\('created_at',\{ascending:false\}\)\.order\('id',\{ascending:false\}\)\.limit\(2\)/);
  assert.match(load, /const fetchedRows=\(data\|\|\[\]\)\.slice\(0,1\)/);
  assert.match(load, /state\.hasMoreMessages=\(data\|\|\[\]\)\.length>1/);
  const older = extractFunction('loadOlderMessages');
  assert.match(older, /\.limit\(50\)/);
  assert.doesNotMatch(older, /area\.replaceChildren\(\)/);
  assert.match(older, /insertBefore\(fragment,originalFirstChild\)/);
  assert.match(older, /state\.batchRenderingMessages=true/);
  assert.match(older, /state\.batchRenderingMessages=false;reconcileMessageTimeline\(area\)/);
  assert.match(older, /olderIds/);
});

test('starting and stopping the polling timer does not erase the loaded history cursor', () => {
  const state = {
    messagePollGeneration: 4,
    messagePollTimer: 12,
    messagePollBusy: true,
    hasMoreMessages: true,
    isLoadingMessages: true,
    loadingOlderMessages: false
  };
  const stop = vm.runInNewContext('(' + extractFunction('stopMessagePolling') + ')', {
    state,
    clearTimeout() {},
    diagLog() {}
  });
  stop();
  assert.equal(state.hasMoreMessages, true);
  assert.equal(state.isLoadingMessages, false);
  assert.equal(state.loadingOlderMessages, false);
  assert.equal(state.messagePollTimer, null);
  assert.equal(state.messagePollGeneration, 5);
  assert.equal(state.messagePollBusy, false);
  const start = vm.runInNewContext('(' + extractFunction('startMessagePolling') + ')', {
    state,
    stopMessagePolling: stop,
    scheduleMessagePolling() {},
    diagLog() {},
    messagePollingDelay: () => 15000
  });
  start('c1');
  assert.equal(state.hasMoreMessages, true);
});

test('Realtime reconnection does not start a competing full timeline reload', () => {
  const subscribe = extractFunction('subscribeConversation');
  assert.doesNotMatch(subscribe, /reconnected&&state\.active\?\.id===id\)loadMessages\(\)/);
  assert.match(subscribe, /requestImmediateMessageReconciliation/);
});

test('conversation opens latest-message loading before optional settings finish', () => {
  const open = extractFunction('openConversation');
  assert.ok(open.indexOf('subscribeConversation();subscribeProfileUpdates(c)') < open.indexOf('const messageLoadPromise=loadMessages()'));
  assert.ok(open.indexOf('const messageLoadPromise=loadMessages().finally') < open.indexOf('await Promise.all([messageLoadPromise,starredLoadPromise,settingsLoadPromise])'));
});
