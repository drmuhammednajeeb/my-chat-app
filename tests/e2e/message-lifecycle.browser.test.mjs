import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const pattern = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const match = pattern.exec(html);
  assert.ok(match, 'Missing application function: ' + name);
  const start = match.index;
  const open = html.indexOf('{', start);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let i = open; i < html.length; i += 1) {
    const char = html[i], next = html[i + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (char === "'" || char === '"' || char === '\x60') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') { depth -= 1; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('Unbalanced function body: ' + name);
}

const sendSource = extractFunction('sendMessage');
const renderSource = extractFunction('renderMessage');
let browser;

before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function newPage() {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body><textarea id="messageInput"></textarea><button id="sendBtn"></button><input id="fileInput" type="file"><div id="attachmentPreview"></div><div id="messages"></div></body></html>');
  return page;
}

async function installSendHarness(page, { text = 'hello', attachment = false } = {}) {
  await page.evaluate(({ source, text, attachment }) => {
    const state = window.__state = {
      voiceRecorder: null,
      active: { id: 'conversation-1', type: 'direct', members: [] },
      user: { id: 'user-1' },
      attachment: attachment ? new File(['fixture'], 'proof.pdf', { type: 'application/pdf' }) : null,
      replyTarget: null, editTarget: null, privateReplyPending: null,
      uploading: false, pendingMessageSends: new Map(),
      messageIds: new Set(), messages: [], conversations: [{ id: 'conversation-1' }]
    };
    const backend = window.__backend = {
      insertCalls: [], insertMode: 'success', verifyCommitted: false,
      delayInsert: false, releaseInsert: null, uploadCalls: 0, notices: []
    };
    let uuidCounter = 0;
    const testCrypto = { randomUUID: () => '00000000-0000-4000-8000-' + String(++uuidCounter).padStart(12, '0') };
    const rowFrom = payload => ({
      ...payload, created_at: '2026-11-09T10:00:00.000Z',
      edited_at: null, deleted_at: null, edit_revision: 0
    });
    const supabaseClient = {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }) },
      from(table) {
        return {
          insert(payload) {
            backend.insertCalls.push({ table, payload: { ...payload } });
            return { select() { return { async single() {
              if (backend.delayInsert) await new Promise(resolve => { backend.releaseInsert = resolve; });
              if (backend.insertMode !== 'success') return { data: null, error: { message: 'simulated insert failure' } };
              return { data: rowFrom(payload), error: null };
            } }; } };
          },
          select() {
            const filters = [];
            const query = {
              eq(key, value) { filters.push([key, value]); return query; },
              async maybeSingle() {
                const inserted = backend.insertCalls.at(-1)?.payload;
                const matches = inserted && filters.every(([key, value]) => inserted[key] === value);
                return { data: backend.verifyCommitted && matches ? rowFrom(inserted) : null, error: null };
              }
            };
            return query;
          }
        };
      }
    };
    const $ = id => document.getElementById(id);
    $('messageInput').value = text;
    window.__runSend = new Function(
      'state', '$', 'toast', 'supabaseClient', 'withAuthTimeout', 'canEditMessage',
      'uploadAttachment', 'renderComposerContext', 'resizeComposer', 'publishTyping',
      'loadMessages', 'renderMessage', 'renderConversations', 'console', 'crypto',
      'return (' + source + ');'
    )(
      state, $, message => backend.notices.push(message), supabaseClient,
      promise => promise, () => true,
      async file => { backend.uploadCalls += 1; return { path: 'conversation-1/user-1/proof.pdf', type: file.type }; },
      () => {}, () => {}, () => {}, async () => true,
      async message => { state.messageIds.add(message.id); state.messages.push(message); return true; },
      () => {}, console, testCrypto
    );
  }, { source: sendSource, text, attachment });
  return page;
}

test('browser: a successful send persists once, renders, and clears only the sent draft', async () => {
  const page = await newPage();
  try {
    await installSendHarness(page);
    await page.evaluate(() => window.__runSend());
    const result = await page.evaluate(() => ({
      inserts: window.__backend.insertCalls.length,
      content: window.__backend.insertCalls[0]?.payload.content,
      rendered: window.__state.messageIds.size,
      draft: document.getElementById('messageInput').value,
      uploading: window.__state.uploading
    }));
    assert.deepEqual(result, { inserts: 1, content: 'hello', rendered: 1, draft: '', uploading: false });
  } finally { await page.close(); }
});

test('browser: an ambiguous committed insert is verified by the same ID without a duplicate insert', async () => {
  const page = await newPage();
  try {
    await installSendHarness(page);
    await page.evaluate(() => {
      window.__backend.insertMode = 'ambiguous';
      window.__backend.verifyCommitted = true;
      return window.__runSend();
    });
    const result = await page.evaluate(() => ({
      insertCount: window.__backend.insertCalls.length,
      persistedId: window.__backend.insertCalls[0]?.payload.id,
      pendingCount: window.__state.pendingMessageSends.size,
      rendered: window.__state.messageIds.size,
      draft: document.getElementById('messageInput').value
    }));
    assert.equal(result.insertCount, 1);
    assert.ok(result.persistedId);
    assert.equal(result.pendingCount, 0);
    assert.equal(result.rendered, 1);
    assert.equal(result.draft, '');
  } finally { await page.close(); }
});

test('browser: a failed attachment send can retry with the same ID and without uploading twice', async () => {
  const page = await newPage();
  try {
    await installSendHarness(page, { text: 'document attached', attachment: true });
    await page.evaluate(() => { window.__backend.insertMode = 'failed'; return window.__runSend(); });
    const first = await page.evaluate(() => ({
      id: window.__backend.insertCalls[0]?.payload.id,
      uploads: window.__backend.uploadCalls,
      pending: window.__state.pendingMessageSends.size,
      draft: document.getElementById('messageInput').value,
      unlocked: !window.__state.uploading
    }));
    assert.equal(first.uploads, 1);
    assert.equal(first.pending, 1);
    assert.equal(first.draft, 'document attached');
    assert.equal(first.unlocked, true);

    await page.evaluate(() => { window.__backend.insertMode = 'success'; return window.__runSend(); });
    const second = await page.evaluate(() => ({
      id: window.__backend.insertCalls[1]?.payload.id,
      uploads: window.__backend.uploadCalls,
      pending: window.__state.pendingMessageSends.size,
      draft: document.getElementById('messageInput').value,
      rendered: window.__state.messageIds.size
    }));
    assert.equal(second.id, first.id);
    assert.equal(second.uploads, 1);
    assert.equal(second.pending, 0);
    assert.equal(second.draft, '');
    assert.equal(second.rendered, 1);
  } finally { await page.close(); }
});

test('browser: a draft typed while persistence is pending is not erased by the earlier send', async () => {
  const page = await newPage();
  try {
    await installSendHarness(page);
    const sendPromise = page.evaluate(() => {
      window.__backend.delayInsert = true;
      return window.__runSend();
    });
    await page.waitForFunction(() => window.__backend.insertCalls.length === 1 && typeof window.__backend.releaseInsert === 'function');
    await page.locator('#messageInput').fill('new draft while sending');
    await page.evaluate(() => window.__backend.releaseInsert());
    await sendPromise;
    const result = await page.evaluate(() => ({
      draft: document.getElementById('messageInput').value,
      uploading: window.__state.uploading,
      rendered: window.__state.messageIds.size
    }));
    assert.equal(result.draft, 'new draft while sending');
    assert.equal(result.uploading, false);
    assert.equal(result.rendered, 1);
  } finally { await page.close(); }
});

test('browser: group send restrictions block a non-admin before any persistence call', async () => {
  const page = await newPage();
  try {
    await installSendHarness(page);
    await page.evaluate(() => {
      window.__state.active.type = 'group';
      window.__state.active.members = [{ user_id: 'user-1', role: 'member' }];
      window.__state.groupSettings = { only_admins_can_send: true };
    });
    await page.evaluate(() => window.__runSend());
    const result = await page.evaluate(() => ({
      inserts: window.__backend.insertCalls.length,
      draft: document.getElementById('messageInput').value,
      uploading: window.__state.uploading,
      notices: window.__backend.notices
    }));
    assert.equal(result.inserts, 0);
    assert.equal(result.draft, 'hello');
    assert.equal(result.uploading, false);
    assert.ok(result.notices.some(message => message.includes('مشرفي المجموعة')));
  } finally { await page.close(); }
});

test('browser: obsolete render tokens are rejected before DOM work begins', async () => {
  const page = await newPage();
  try {
    await page.evaluate(({ source }) => {
      const state = { active: { id: 'conversation-1' }, messageLoadVersion: 9, messages: [], messageIds: new Set(), messageRenderPromises: new Map() };
      window.__renderCalls = 0;
      window.__runRender = new Function('state', 'renderMessageInternal', 'return (' + source + ');')(
        state, async () => { window.__renderCalls += 1; return true; }
      );
      window.__runRenderState = state;
    }, { source: renderSource });
    const result = await page.evaluate(async () => ({
      rendered: await window.__runRender({ id: 'stale-message' }, 'conversation-1', 8),
      calls: window.__renderCalls
    }));
    assert.equal(result.rendered, false);
    assert.equal(result.calls, 0);
  } finally { await page.close(); }
});

test('browser: same-ID render requests serialize and retry using the newest in-memory message', async () => {
  const page = await newPage();
  try {
    await page.evaluate(({ source }) => {
      const state = window.__renderState = {
        active: { id: 'conversation-1' }, messageLoadVersion: 4,
        messages: [], messageIds: new Set(), messageRenderPromises: new Map()
      };
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      window.__renderCalls = [];
      const internal = async message => {
        window.__renderCalls.push(message.version);
        if (window.__renderCalls.length === 1) { await gate; return false; }
        state.messageIds.add(message.id);
        return true;
      };
      window.__releaseRender = release;
      window.__runRender = new Function('state', 'renderMessageInternal', 'return (' + source + ');')(state, internal);
    }, { source: renderSource });
    await page.evaluate(() => {
      window.__renderState.messages = [{ id: 'm1', version: 'old' }];
      window.__firstRender = window.__runRender({ id: 'm1', version: 'old' }, 'conversation-1', 4);
    });
    await page.waitForFunction(() => window.__renderCalls.length === 1);
    await page.evaluate(() => {
      window.__renderState.messages = [{ id: 'm1', version: 'new' }];
      window.__secondRender = window.__runRender({ id: 'm1', version: 'old' }, 'conversation-1', 4);
      window.__releaseRender();
    });
    const result = await page.evaluate(async () => ({
      first: await window.__firstRender,
      second: await window.__secondRender,
      calls: window.__renderCalls,
      rendered: window.__renderState.messageIds.has('m1'),
      pending: window.__renderState.messageRenderPromises.size
    }));
    assert.equal(result.first, false);
    assert.equal(result.second, true);
    assert.deepEqual(result.calls, ['old', 'new']);
    assert.equal(result.rendered, true);
    assert.equal(result.pending, 0);
  } finally { await page.close(); }
});



test('voice recording finalizes the last MediaRecorder chunk before dispatching send', async () => {
  const page = await newPage();
  await page.setContent(`<!doctype html><html><body>
    <button id="voiceRecordBtn"></button><button id="voiceCancelBtn"></button>
    <div id="voiceRecordingControls" class="hidden"><span id="voiceRecordingTime"></span><button id="voicePauseBtn"></button><span id="voiceRecordingStatus"></span></div>
    <button id="sendBtn"></button><div id="attachmentPreview"></div>
  </body></html>`);
  const startSource = extractFunction('startVoiceRecording');
  const sendSource = extractFunction('sendVoiceRecording');
  const stopSource = extractFunction('stopVoiceRecording');
  await page.evaluate(({ startSource, sendSource, stopSource }) => {
    const state = window.__voiceState = {
      active: { id: 'conversation-a', type: 'direct', members: [] },
      user: { id: 'user-a' }, uploading: false, attachment: null,
      voiceRecorder: null, voiceChunks: [], voiceElapsedMs: 0,
      voiceSegmentStartedAt: null, voicePaused: false,
      voiceSendOnStop: false, cancelVoiceOnStop: false
    };
    const nodes = Object.fromEntries([
      'voiceRecordBtn','voiceCancelBtn','voiceRecordingControls',
      'voiceRecordingTime','voicePauseBtn','voiceRecordingStatus',
      'sendBtn','attachmentPreview'
    ].map(id => [id, document.getElementById(id)]));
    window.__voiceSent = [];
    window.__voiceRecorderEvents = [];
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) }
    });
    class FakeMediaRecorder {
      static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
      constructor(_stream, options) { this.mimeType = options?.mimeType || 'audio/webm'; this.state = 'inactive'; }
      start() { this.state = 'recording'; window.__voiceRecorderEvents.push('start'); }
      requestData() {
        window.__voiceRecorderEvents.push('requestData');
        this.ondataavailable?.({ data: new Blob(['final-chunk'], { type: this.mimeType }) });
      }
      stop() {
        this.state = 'inactive';
        window.__voiceRecorderEvents.push('stop');
        this.ondataavailable?.({ data: new Blob(['stop-chunk'], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: FakeMediaRecorder });
    const $ = id => nodes[id];
    const directStop = new Function('state', stopSource + '; return stopVoiceRecording;')(state);
    const helpers = {
      clearVoiceTimer() {},
      cleanupVoiceCapture() {
        state.voiceRecorder = null; state.voiceChunks = [];
        state.voiceStream = null; state.voiceStartedAt = null;
        state.voiceElapsedMs = 0; state.voiceSegmentStartedAt = null;
        state.voicePaused = false;
      },
      setVoiceComposerActive(active) { nodes.voiceRecordingControls.classList.toggle('hidden', !active); },
      updateVoiceRecordingUI() {},
      currentVoiceElapsedMs: () => 1250,
      formatVoiceDuration: seconds => String(seconds),
      showAttachmentPreview(file, label) {
        nodes.attachmentPreview.textContent = label;
        window.__voicePreview = { name: file.name, type: file.type, size: file.size };
      },
      resizeComposer() {},
      toast(message) { window.__voiceToast = message; },
      sendMessage() {
        window.__voiceSent.push({
          file: state.attachment?.name,
          type: state.attachment?.type,
          recorderCleared: state.voiceRecorder === null
        });
        // Model the production sendMessage success path: it clears the
        // attachment only after persistence succeeds, enabling the next recording.
        state.attachment = null;
        state.voiceDuration = 0;
        nodes.attachmentPreview.replaceChildren();
      }
    };
    const start = new Function(
      'state','$','navigator','window','MediaRecorder','console','Date','Blob','File',
      'setInterval','clearInterval','stopVoiceRecording','clearVoiceTimer','cleanupVoiceCapture',
      'setVoiceComposerActive','updateVoiceRecordingUI','currentVoiceElapsedMs','formatVoiceDuration',
      'showAttachmentPreview','resizeComposer','toast','sendMessage',
      startSource + '; return startVoiceRecording;'
    )(
      state,$,navigator,window,FakeMediaRecorder,console,Date,Blob,File,
      setInterval,clearInterval,directStop,helpers.clearVoiceTimer,helpers.cleanupVoiceCapture,
      helpers.setVoiceComposerActive,helpers.updateVoiceRecordingUI,helpers.currentVoiceElapsedMs,
      helpers.formatVoiceDuration,helpers.showAttachmentPreview,helpers.resizeComposer,
      helpers.toast,helpers.sendMessage
    );
    const send = new Function('state','$','stopVoiceRecording',sendSource + '; return sendVoiceRecording;')(
      state,$,directStop
    );
    window.__startVoice = start;
    window.__sendVoice = send;
  }, { startSource, sendSource, stopSource });
  // Exercise two complete record/send cycles in the same page and session.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.evaluate(() => window.__startVoice());
    await page.evaluate(() => window.__sendVoice());
    await page.waitForTimeout(20);
  }
  const result = await page.evaluate(() => ({
    events: window.__voiceRecorderEvents,
    sent: window.__voiceSent,
    preview: window.__voicePreview,
    toast: window.__voiceToast,
    recorderCleared: window.__voiceState.voiceRecorder === null,
    chunksCleared: window.__voiceState.voiceChunks.length === 0
  }));
  assert.deepEqual(result.events, [
    'start','requestData','stop',
    'start','requestData','stop'
  ], 'Two consecutive voice record/send cycles did not complete: ' + JSON.stringify(result));
  assert.equal(result.sent.length, 2, 'Both voice recordings must reach the send pipeline');
  assert.ok(result.sent.every(item => item.recorderCleared), 'Recorder state must be reset after each send');
  assert.equal(result.sent[0].type, 'audio/webm');
  assert.equal(result.sent[1].type, 'audio/webm');
  assert.equal(result.recorderCleared, true);
  assert.equal(result.chunksCleared, true);
  assert.equal(result.preview.type, 'audio/webm');
  await page.close();
});
