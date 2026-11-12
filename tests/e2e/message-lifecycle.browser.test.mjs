import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const voiceModuleSource = await readFile(new URL('../../modules/voice-recorder.js', import.meta.url), 'utf8');

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
  await page.setContent([
    '<!doctype html><html><body>',
    '<div class="composer">',
    '<button id="voiceRecordBtn" type="button"></button>',
    '<button id="stickerBtn" type="button"></button>',
    '<button id="attachBtn" type="button"></button>',
    '<textarea id="messageInput"></textarea>',
    '<div id="voiceRecordingControls" class="hidden">',
    '<button id="voicePauseBtn" type="button"></button>',
    '<strong id="voiceRecordingTime"></strong>',
    '<span id="voiceRecordingStatus"></span>',
    '<button id="voiceTrashBtn" type="button"></button>',
    '</div>',
    '<button id="sendBtn" type="button"></button>',
    '</div>',
    '<div id="attachmentPreview"></div>',
    '</body></html>'
  ].join(''));
  await page.addScriptTag({ content: voiceModuleSource });
  await page.evaluate(() => {
    window.__voiceEvents = [];
    window.__voiceSent = [];
    window.__voiceTracks = [];
    window.__voiceContext = {
      active: { id: 'conversation-a', type: 'direct', members: [] },
      user: { id: 'user-a' },
      uploading: false,
      attachment: null,
      groupSettings: null
    };
    class FakeMediaRecorder {
      static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
      constructor(_stream, options) {
        this.mimeType = options?.mimeType || 'audio/webm';
        this.state = 'inactive';
      }
      start(timeslice) {
        this.timeslice = timeslice;
        this.state = 'recording';
        window.__voiceEvents.push('start');
      }
      requestData() {
        window.__voiceEvents.push('requestData');
        this.ondataavailable?.({ data: new Blob(['final-chunk'], { type: 'audio/webm' }) });
      }
      stop() {
        this.state = 'inactive';
        window.__voiceEvents.push('stop');
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob(['stop-chunk'], { type: 'audio/webm' }) });
          this.onstop?.();
        });
      }
      pause() { this.state = 'paused'; }
      resume() { this.state = 'recording'; }
    }
    window.__voiceController = window.BizmindVoiceRecorder.create({
      getContext: () => window.__voiceContext,
      mediaDevices: {
        async getUserMedia() {
          const track = { stopped: false, stop() { this.stopped = true; } };
          window.__voiceTracks.push(track);
          return { getTracks: () => [track] };
        }
      },
      MediaRecorder: FakeMediaRecorder,
      isSecureContext: true,
      setInterval: () => 1,
      clearInterval: () => {},
      toast: message => { window.__voiceToast = message; },
      onRecordingReady: ({ file, duration }) => {
        window.__voiceContext.attachment = file;
        window.__voicePreview = { name: file.name, type: file.type, size: file.size, duration };
      },
      send: async () => {
        const file = window.__voiceContext.attachment;
        window.__voiceSent.push({ name: file?.name, type: file?.type });
        window.__voiceContext.attachment = null;
      },
      elements: {
        composer: document.querySelector('.composer'),
        recordButton: document.getElementById('voiceRecordBtn'),
        controls: document.getElementById('voiceRecordingControls'),
        pauseButton: document.getElementById('voicePauseBtn'),
        trashButton: document.getElementById('voiceTrashBtn'),
        time: document.getElementById('voiceRecordingTime'),
        status: document.getElementById('voiceRecordingStatus'),
        sendButton: document.getElementById('sendBtn')
      }
    });
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal(await page.evaluate(() => window.__voiceController.start()), true);
    assert.equal(await page.evaluate(() => window.__voiceController.send()), true);
  }
  const result = await page.evaluate(() => ({
    events: window.__voiceEvents,
    sent: window.__voiceSent,
    preview: window.__voicePreview,
    tracksStopped: window.__voiceTracks.every(track => track.stopped),
    active: window.__voiceController.isActive()
  }));
  assert.deepEqual(result.events, [
    'start','requestData','stop',
    'start','requestData','stop'
  ]);
  assert.equal(result.sent.length, 2);
  assert.ok(result.sent.every(item => item.type === 'audio/webm'));
  assert.equal(result.preview.type, 'audio/webm');
  assert.equal(result.tracksStopped, true);
  assert.equal(result.active, false);
  await page.close();
});
